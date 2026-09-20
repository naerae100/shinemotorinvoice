import { Capacitor } from '@capacitor/core';

/**
 * The only place the web app and the Android app differ.
 *
 * Both ship from one build and one codebase: `npm run build` produces the
 * site, and `npx cap sync` copies that same output into the Android shell.
 * Nothing is forked. But two things genuinely cannot behave the same way in a
 * WebView as in a browser tab, and they are both here so a change is made once:
 *
 *   Saving a file. `<a download>` and a Blob URL are browser mechanics. Inside
 *   the shell there is no download manager and no Downloads shelf, so a PDF has
 *   to be written to the device and handed to the Android share sheet.
 *
 *   The API's address. In a browser the app is served from the same origin as
 *   the API, so a relative /api works. In the shell the page is served locally
 *   from https://localhost, where /api is the shell itself — it has to be an
 *   absolute URL, which is why VITE_API_URL exists and why the Android build
 *   script sets it.
 *
 * Anything else that starts to differ belongs in this file, not in a component.
 */

/** True inside the Android (or iOS) shell; false in any browser. */
export const isNativeApp = () => Capacitor.isNativePlatform();

/** 'android' | 'ios' | 'web' — for the rare case a message needs to name it. */
export const platformName = () => Capacitor.getPlatform();

/** Blob → base64, which is the only shape the Filesystem plugin accepts. */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    // The result is a data: URL; the plugin wants only the payload.
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(blob);
  });
}

/**
 * Put a generated file in the operator's hands.
 *
 * On the web that is a download. In the app it is written to the device's
 * cache and offered to the share sheet, which is how a PDF gets to email, to
 * Drive, or to a printer app — the things actually done with an invoice.
 *
 * Cache rather than Documents on purpose: these are regenerated from the
 * record on demand, so they are disposable, and Android is free to reclaim
 * them. The copy that matters is the record, not the file.
 */
export async function deliverFile(blob, filename, { title } = {}) {
  if (!isNativeApp()) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoking immediately can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { delivered: 'download' };
  }

  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ]);

  const data = await blobToBase64(blob);
  const written = await Filesystem.writeFile({
    path: filename,
    data,
    directory: Directory.Cache,
  });

  try {
    await Share.share({ title: title ?? filename, url: written.uri });
    return { delivered: 'share', uri: written.uri };
  } catch (err) {
    // Dismissing the share sheet throws. That is a choice, not a failure, and
    // the file is on the device either way.
    return { delivered: 'saved', uri: written.uri, dismissed: true };
  }
}

/**
 * Print what is on screen.
 *
 * Android's WebView implements window.print() against the system print
 * framework, so the same call opens the Android print dialog in the app and
 * the browser's in a tab. It is wrapped here anyway: if a device turns out not
 * to honour it, this is the one function to change, rather than the four
 * screens that print.
 */
export function printDocument() {
  window.print();
}

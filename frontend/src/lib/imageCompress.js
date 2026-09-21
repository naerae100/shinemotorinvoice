/**
 * Shrink a photo in the browser before it is uploaded.
 *
 * A photo off a modern phone is 3–12 MB and about 4000px wide. Nobody needs
 * that to see which bin the copper came out of, and on a yard's signal a
 * contractor with six grades photographed would be standing there for
 * minutes — or would simply give up, which is worse, because then there is
 * no photograph at all.
 *
 * 1600px on the long edge at 75% quality lands around 300KB: still enough to
 * read a label or count a bundle, about twenty times smaller, and under the
 * API's own limit rather than relying on it.
 *
 * Done with a canvas rather than a library: this is the whole of it, and a
 * dependency for thirty lines is a dependency to keep updated.
 */
const MAX_EDGE = 1600;
const QUALITY = 0.75;

/** Below this there is nothing worth re-encoding — it would only add noise. */
const SKIP_UNDER_BYTES = 400 * 1024;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image'));
    };
    img.src = url;
  });
}

/**
 * @returns {Promise<File>} the smaller file, or the original when shrinking
 *   it would not help or is not possible.
 */
export async function compressImage(file) {
  if (!file?.type?.startsWith('image/')) return file;
  if (file.size <= SKIP_UNDER_BYTES) return file;

  try {
    const img = await loadImage(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));

    // Already small enough in pixels and still a big file — usually a PNG
    // screenshot. Re-encoding to JPEG is worth it; resizing is not.
    const width = Math.round(img.width * scale);
    const height = Math.round(img.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY)
    );
    // A canvas that cannot encode, or a result no smaller than we started
    // with: keep the original rather than upload something worse.
    if (!blob || blob.size >= file.size) return file;

    const name = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${name}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    // An unreadable or exotic format (some HEICs) still uploads as it came.
    // The server accepts it; it is only bigger.
    return file;
  }
}

/** Human-sized, for telling somebody why an upload is taking a moment. */
export const readableSize = (bytes) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

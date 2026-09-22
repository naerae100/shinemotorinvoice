/**
 * Turn a User-Agent string into something a person can recognise.
 *
 * The only question this has to answer is "is that one of my devices?", so it
 * aims for "iPhone · Safari", not for a version matrix. A User-Agent is a pile
 * of historical lies — every browser claims to be Mozilla, Edge claims to be
 * Chrome, Chrome claims to be Safari — so the order of these checks matters
 * more than the patterns do: the most specific claim has to be tested first or
 * it is swallowed by the one it is imitating.
 *
 * Deliberately not a library. The list of things that matter here is short,
 * the yard uses four devices, and a dependency that parses every crawler on
 * the internet is a dependency to keep up to date forever.
 */

const OS = [
  // Order matters: an iPad's UA says "Mac OS X" too.
  [/iPhone/i, 'iPhone'],
  [/iPad/i, 'iPad'],
  [/Android/i, 'Android'],
  [/Windows NT/i, 'Windows'],
  [/Macintosh|Mac OS X/i, 'Mac'],
  [/CrOS/i, 'Chromebook'],
  [/Linux/i, 'Linux'],
];

const BROWSER = [
  // Each of these lies about being the next one down.
  [/Edg[eA]?\//i, 'Edge'],
  [/OPR\/|Opera/i, 'Opera'],
  [/SamsungBrowser/i, 'Samsung Internet'],
  [/FxiOS|Firefox/i, 'Firefox'],
  [/CriOS/i, 'Chrome'],
  [/Chrome\//i, 'Chrome'],
  [/Safari\//i, 'Safari'],
];

const match = (list, ua) => list.find(([re]) => re.test(ua))?.[1] ?? null;

/**
 * @returns {string} e.g. "iPhone · Safari", "Windows · Chrome", or
 *   "Unrecognised device" when the header is absent or says nothing useful.
 */
export function describeDevice(userAgent) {
  const ua = String(userAgent ?? '');
  if (!ua.trim()) return 'Unrecognised device';

  // The app shell reports itself, and it is the one client where knowing it
  // is the installed app rather than a browser tab actually tells you
  // something about where the device is.
  const shell = /Capacitor|wv\)/i.test(ua) ? ' app' : '';

  const os = match(OS, ua);
  const browser = match(BROWSER, ua);

  if (!os && !browser) return 'Unrecognised device';
  if (!os) return `${browser}${shell}`;
  if (!browser) return `${os}${shell}`;
  return `${os} · ${browser}${shell}`;
}

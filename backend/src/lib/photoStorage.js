/**
 * Where collection photographs are kept.
 *
 * One interface, so the place the bytes live is a decision this file holds
 * and nothing else has to know about:
 *
 *   save({ buffer, filename, contentType, folders }) -> { provider, externalId }
 *   read(externalId)                                 -> { stream, contentType }
 *   remove(externalId)                               -> void
 *
 * Google Drive today. The reason the interface exists at all is that the
 * choice was made knowing it might change — and because the provider is
 * recorded per photo, a later move does not strand everything uploaded
 * before it.
 *
 * Why OAuth rather than a service account, which would be the obvious way to
 * do this server-side: a service account has no Drive storage quota of its
 * own and cannot own files, so writing into a folder shared with it fails
 * with storageQuotaExceeded. Google's own answer is a Shared Drive, which
 * needs Workspace, or OAuth on behalf of a person. The yard's Drive is a
 * personal account, so the app holds a refresh token and acts as that user.
 *
 * The scope is drive.file — the narrowest one there is. The app can only ever
 * see files it created itself, so connecting it exposes nothing else in that
 * Drive. It is also classified non-sensitive, which is what lets the consent
 * screen be published without Google's verification review; an unpublished
 * app expires its refresh token every seven days.
 */

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * A disk-backed provider, for development only.
 *
 * Switched on with PHOTO_STORAGE=local and off by every other value,
 * including unset. It exists so the upload path — resize, post, store,
 * sign, serve, delete — can be exercised before Google is connected,
 * because shipping that untested and finding out in a yard is not a plan.
 *
 * It is not a production fallback and cannot quietly become one: Vercel's
 * filesystem is ephemeral, so anything written there is gone with the
 * instance. If Drive is not configured in production, uploads fail loudly
 * and say why, which is the honest outcome.
 */
const useLocal = () => process.env.PHOTO_STORAGE === 'local';

const localDir = async () => {
  const { mkdir } = await import('node:fs/promises');
  const dir = new URL('../../.photos/', import.meta.url).pathname;
  await mkdir(dir, { recursive: true });
  return dir;
};

export const isConfigured = () =>
  useLocal() ||
  Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_REFRESH_TOKEN
  );

/** Thrown when Drive has not been set up, so callers can say so plainly. */
export class StorageNotConfigured extends Error {
  constructor() {
    super('Photo storage is not connected yet.');
    this.name = 'StorageNotConfigured';
    this.status = 503;
  }
}

/**
 * Access tokens last an hour; the refresh token is the durable credential.
 * Cached in module scope and refreshed a minute early — on a serverless
 * runtime the cache lives as long as the warm instance does, which is enough
 * to stop every photo in a batch minting its own token.
 */
let cached = { token: null, expiresAt: 0 };

async function accessToken() {
  if (!isConfigured()) throw new StorageNotConfigured();
  if (cached.token && Date.now() < cached.expiresAt) return cached.token;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // invalid_grant means the token was revoked, or the consent screen is
    // still in Testing and the seven days are up. Worth saying which.
    const hint =
      body.error === 'invalid_grant'
        ? ' The refresh token is no longer valid — it was revoked, or the OAuth consent screen is still in Testing mode, where tokens expire after seven days.'
        : '';
    throw new Error(`Could not reach Google Drive.${hint}`);
  }
  cached = {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 - 60_000,
  };
  return cached.token;
}

async function driveFetch(url, opts = {}) {
  const token = await accessToken();
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google Drive said ${res.status}: ${text.slice(0, 200)}`);
  }
  return res;
}

/**
 * A folder name Drive and a human can both live with.
 *
 * Drive itself allows almost anything, but a name with a slash or a newline
 * in it is miserable to find by hand later, and these folders are meant to be
 * browsable without the app.
 */
const safeName = (s) =>
  String(s ?? '')
    .replace(/[\\/:*?"<>|\r\n]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'Unnamed';

/** Folder ids are stable, so looking one up twice a second is wasteful. */
const folderCache = new Map();

async function folderId(name, parentId) {
  const key = `${parentId}/${name}`;
  if (folderCache.has(key)) return folderCache.get(key);

  const q = [
    `name = '${name.replace(/'/g, "\\'")}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    `'${parentId}' in parents`,
    'trashed = false',
  ].join(' and ');

  const found = await (
    await driveFetch(`${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`)
  ).json();

  let id = found.files?.[0]?.id;
  if (!id) {
    const made = await (
      await driveFetch(`${DRIVE}/files?fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parentId],
        }),
      })
    ).json();
    id = made.id;
  }
  folderCache.set(key, id);
  return id;
}

/**
 * Walk (and create) a folder path under the configured root.
 *
 * The yard asked for supplier, then collection, so a folder can be opened in
 * Drive on its own and make sense without the app:
 *
 *   <root> / Riverstone Auto Wreckers / Collection 12 / photo.jpg
 */
async function resolveFolders(folders = []) {
  let parent = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || 'root';
  for (const raw of folders) {
    parent = await folderId(safeName(raw), parent);
  }
  return parent;
}

/**
 * Does the stored credential actually work?
 *
 * `configured` only says the variables are present. A token that was
 * truncated on the way into Vercel, revoked since, or minted while the
 * consent screen was still in Testing looks identical until the first
 * upload — and the first upload happens in a yard, which is the worst place
 * to discover it. This asks Google, and creates nothing.
 */
export async function verifyCredentials() {
  if (useLocal()) return { ok: true, provider: 'LOCAL' };
  if (!isConfigured()) return { ok: false, error: 'Not configured' };
  try {
    await accessToken();
    return { ok: true, provider: 'GOOGLE_DRIVE' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function save({ buffer, filename, contentType, folders }) {
  if (useLocal()) {
    const { writeFile } = await import('node:fs/promises');
    const crypto = await import('node:crypto');
    const id = crypto.randomUUID();
    // The folder path is kept in the name so the dev provider shows the same
    // shape the Drive one builds.
    await writeFile(`${await localDir()}${id}.bin`, buffer);
    await writeFile(
      `${await localDir()}${id}.json`,
      JSON.stringify({ filename, contentType, folders })
    );
    return { provider: 'LOCAL', externalId: id };
  }

  const parent = await resolveFolders(folders);

  // Multipart: the metadata and the bytes in one request, so a photo is never
  // half-created if the second call fails.
  const boundary = `shine${Math.random().toString(36).slice(2)}`;
  const meta = JSON.stringify({ name: safeName(filename), parents: [parent] });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const res = await driveFetch(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  const { id } = await res.json();
  return { provider: 'GOOGLE_DRIVE', externalId: id };
}

export async function read(externalId) {
  if (useLocal()) {
    const { readFile } = await import('node:fs/promises');
    const dir = await localDir();
    const meta = JSON.parse(await readFile(`${dir}${externalId}.json`, 'utf8'));
    const buf = await readFile(`${dir}${externalId}.bin`);
    const { Readable } = await import('node:stream');
    return { stream: Readable.toWeb(Readable.from(buf)), contentType: meta.contentType };
  }

  const res = await driveFetch(`${DRIVE}/files/${externalId}?alt=media`);
  return {
    stream: res.body,
    contentType: res.headers.get('content-type') || 'application/octet-stream',
  };
}

export async function remove(externalId) {
  if (useLocal()) {
    const { rm } = await import('node:fs/promises');
    const dir = await localDir();
    await rm(`${dir}${externalId}.bin`, { force: true });
    await rm(`${dir}${externalId}.json`, { force: true });
    return;
  }

  // Trashed, not purged: a photograph is the evidence behind a disputed
  // weight, and "deleted" should be recoverable from Drive's bin for the
  // thirty days Google keeps it.
  await driveFetch(`${DRIVE}/files/${externalId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });
}

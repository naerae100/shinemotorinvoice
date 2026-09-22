/**
 * Put a database dump into the yard's Google Drive.
 *
 * Drive rather than a bucket because the yard already owns 100 GB of it, the
 * app is already connected to it with a working refresh token, and a backup
 * nobody can reach without a console is a backup nobody will reach. These
 * land in a plain folder that can be opened, read and downloaded by a person
 * with no credentials but their own Google login.
 *
 * It reuses lib/photoStorage.js rather than talking to Drive itself: that
 * module already handles the token refresh, the folder walk and the
 * multipart upload, and it is the path that has been exercised in
 * production. A second implementation would be a second thing to get wrong.
 *
 *   node scripts/backup-to-drive.mjs backups/prod-20260922-135704.sql.gz
 *
 * Needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN —
 * the same three the photo uploads use.
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { isConfigured, save } from '../src/lib/photoStorage.js';

const FOLDER = process.env.BACKUP_DRIVE_FOLDER || 'Shine Metals — database backups';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/backup-to-drive.mjs <path-to-dump.sql.gz>');
  process.exit(1);
}

// PHOTO_STORAGE=local is a development convenience for photographs. Writing a
// backup to the runner's own disk and calling it done would be worse than not
// running at all, because the job would go green.
if (process.env.PHOTO_STORAGE === 'local') {
  console.error('error: PHOTO_STORAGE=local would write this backup to a disk that is about to vanish.');
  process.exit(1);
}

if (!isConfigured()) {
  console.error(
    'error: Google Drive is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN.'
  );
  process.exit(1);
}

const buffer = await readFile(file);

// A dump that is suspiciously small is usually a dump of nothing — a failed
// connection that still exited zero, or a schema with no rows. Better to fail
// the job than to file it next to the real ones.
const MIN_BYTES = 10 * 1024;
if (buffer.length < MIN_BYTES) {
  console.error(
    `error: ${basename(file)} is only ${buffer.length} bytes. That is too small to be a real backup — refusing to upload it.`
  );
  process.exit(1);
}

// Year folders, so five years of daily dumps stay openable. The ATO expects
// records kept for five years, which is what this retention is for.
const year = String(new Date().getFullYear());

const { externalId } = await save({
  buffer,
  filename: basename(file),
  contentType: 'application/gzip',
  folders: [FOLDER, year],
});

const kb = (buffer.length / 1024).toFixed(0);
console.log(`uploaded ${basename(file)} (${kb} KB) to Drive: ${FOLDER}/${year}`);
console.log(`file id: ${externalId}`);

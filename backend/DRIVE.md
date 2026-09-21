# Connecting Google Drive

Collection photographs are stored in Google Drive. This is the one-time
setup; everything else is automatic.

---

## Why it works this way

The obvious server-side approach is a **service account**, and it does not
work here. A service account has no Drive storage quota of its own and cannot
own files, so writing into a folder shared with it fails with
`storageQuotaExceeded`. Google's own answer is either a **Shared Drive**,
which needs a Google Workspace subscription, or **OAuth on behalf of a
person**.

The yard's Drive is a personal Google account, so the app holds a refresh
token and uploads as that user. Photos live in that account's Drive and count
against its storage.

The scope is `drive.file` — the narrowest one Google offers. **The app can
only ever see files it created itself.** Connecting it does not expose
anything else in that Drive. It is also classified non-sensitive, which is
what allows the consent screen to be published without Google's verification
review.

---

## Setup

### 1. A Google Cloud project

At <https://console.cloud.google.com> create a project, then enable the
**Google Drive API** under *APIs & Services → Library*.

### 2. The consent screen

*APIs & Services → OAuth consent screen*

- User type: **External**
- Add the scope `https://www.googleapis.com/auth/drive.file` and nothing else
- **Publish to Production**

That last step matters. While the consent screen is in *Testing*, Google
expires refresh tokens after **seven days**, and uploads would break every
week with no obvious cause. Because `drive.file` is non-sensitive, publishing
does not require Google to review the app.

### 3. An OAuth client

*APIs & Services → Credentials → Create credentials → OAuth client ID*

- Type: **Web application**
- Authorised redirect URIs:
  - `https://shinemotorinvoice.vercel.app/api/drive/callback`
  - `http://localhost:5174/api/drive/callback`

`GET /api/drive/status` reports the exact `redirectUri` this deployment will
send — paste that one rather than assuming, because it follows the
deployment's own domain.

Copy the **Client ID** and **Client secret**.

### 4. Environment

In Vercel (and `.env` locally):

```
GOOGLE_CLIENT_ID=…
GOOGLE_CLIENT_SECRET=…
```

Redeploy so the API can see them.

### 5. Approve it, once

Signed in as an **admin**, open:

```
/api/drive/auth
```

It returns a Google URL. Open it, sign in **as the account that should own
the photographs**, and approve. Google returns to `/api/drive/callback`,
which shows a refresh token once.

Add it and redeploy:

```
GOOGLE_REFRESH_TOKEN=…
```

Optionally, to keep everything under one folder rather than the Drive root,
create a folder, take the id from its URL, and set:

```
GOOGLE_DRIVE_ROOT_FOLDER_ID=…
```

### 6. Check

```
GET /api/drive/status          # admin — what is configured
GET /api/collections/photos/status   # what the app tells the form
```

`configured: true` means the upload buttons appear.

---

## What ends up in Drive

```
<root folder>/
  Riverstone Auto Wreckers/
    Collection 12/
      1735… -photo.jpg
```

Supplier, then collection, so a folder makes sense opened in Drive without
the app. Folder names are sanitised — a slash or a newline in a supplier's
name would otherwise make a folder nobody can find by hand.

---

## Things worth knowing

**Whose account.** Photos live in whichever Google account approved the app,
and stay there. Use one the company controls, not an employee's personal
login — if they leave, the images go with them while the records stay.

**Revoking.** Anyone with that account's password can remove the app at
<https://myaccount.google.com/permissions>, and uploads stop. The API says so
rather than failing silently: the error names `invalid_grant` and explains it.

**Deleting.** A photo deleted in the app is **trashed** in Drive, not purged,
so Google keeps it for thirty days. A photograph is the evidence behind a
disputed weight, and "deleted" should be recoverable.

**Only an admin can delete.** The person who took the photo is deliberately
not the person who can quietly remove it.

**Size.** The browser resizes to 1600px at 75% quality before uploading —
about 300KB from a 6MB phone photo. Without that, a contractor on one bar of
signal never finishes.

---

## Developing without Drive

```
PHOTO_STORAGE=local
```

Writes to `backend/.photos/` instead, so the upload path can be exercised
before Google is connected. `npm run dev:local` sets it already.

It is **not** a production fallback and cannot become one by accident:
Vercel's filesystem is ephemeral. With Drive unconfigured in production,
uploads fail loudly and the form says photo storage is not connected.

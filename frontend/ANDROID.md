# The Android app

The tablet app is the **same build as the website**. There is no second
codebase: `vite build` produces the app, Capacitor copies that output into an
Android shell, and the shell is a thin native wrapper around it. A change to a
screen reaches both.

Only two things genuinely differ, and both live in `src/lib/platform.js`:

- **Saving a file.** The browser downloads it. The shell has no download
  manager, so a PDF is written to the device and handed to the Android share
  sheet — which is how it reaches email, Drive or a printer app.
- **Where the API is.** In a browser the app and the API share an origin, so a
  relative `/api` works. In the shell the page is served from
  `https://localhost`, where `/api` is the shell itself — so the app build sets
  an absolute URL.

Anything else that starts to differ belongs in that file, not in a component.

---

## Before the first build

Two installs, neither of which this repository can do for you.

1. **A JDK (Java 21).** Easiest via Homebrew:
   ```
   brew install --cask temurin@21
   ```
2. **Android Studio** — <https://developer.android.com/studio>. On first launch
   let it install the Android SDK and accept the licences. That is what
   provides `sdkmanager`, the build tools and an emulator.

Then point the shell at them, in `~/.zshrc`:

```sh
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$PATH:$ANDROID_HOME/platform-tools"
```

Check it took:

```sh
java -version        # should say 21
adb --version        # should print a version
```

---

## Building

From `frontend/`:

| | |
|---|---|
| `npm run app:sync` | build the web app and copy it into the shell |
| `npm run app:open` | the above, then open Android Studio |
| `npm run app:apk` | the above, then build a debug APK |
| `npm run app:release` | build an `.aab` bundle for the Play Store |

A debug APK lands at:

```
android/app/build/outputs/apk/debug/app-debug.apk
```

Install it on a tablet plugged in over USB with developer mode on:

```sh
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

**Run `app:sync` after every web change.** The shell holds a copy of the build;
without a sync it runs the previous one, and the symptom is a change that
"didn't deploy" with nothing wrong in the logs.

---

## Play Store

A release build needs a signing key. Generate it once and keep it somewhere it
cannot be lost — **if it goes, you cannot update the app**, only publish a new
listing:

```sh
keytool -genkey -v -keystore shine-release.keystore \
  -alias shine -keyalg RSA -keysize 2048 -validity 10000
```

Then follow Capacitor's signing guide to reference it from
`android/app/build.gradle`, and upload the `.aab` from `app:release`.

For a yard tablet you may not need the store at all — a signed APK installed
over USB, or Play Console's internal testing track, avoids review entirely.

---

## Things that are already handled

- **CORS.** The shell's origin is `https://localhost`, not the Vercel domain.
  The API allows both; without that every request from the app fails.
- **No service worker in the app.** `build:app` sets `VITE_APP_SHELL=1` and the
  PWA plugin is skipped. Inside the shell the assets are already on the device,
  and a worker caching a copy of a copy serves the old one after an update.
- **Sessions slide**, so the tablet is not signed out mid-shift. Used daily it
  never expires; left a fortnight it does.
- **Touch targets** are 44px minimum under `pointer: coarse`, set once in
  `index.css` rather than per component.

## Things to check on the real device

Neither can be verified from a development machine.

- **Printing.** Android's WebView implements `window.print()` against the
  system print framework, so it should open the Android print dialog. If a
  device does not honour it, `printDocument()` in `src/lib/platform.js` is the
  single function to change.
- **The 80mm receipt** on the actual thermal printer. The geometry is verified
  in Chrome's print pipeline, never on a real head.

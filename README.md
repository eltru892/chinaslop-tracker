# Chinaslop Tracker

A local tracker for **Genshin Impact**, **Honkai: Star Rail**, **Zenless Zone Zero**, and **Arknights: Endfield**.

## Download

- [Windows portable EXE](https://github.com/eltru892/chinaslop-tracker/releases/download/v1.0.0/Chinaslop-Tracker-Windows-1.0.0.exe)
- [Standalone Android APK](https://github.com/eltru892/chinaslop-tracker/releases/download/v1.0.0/Chinaslop-Tracker-Android-1.0.0.apk)
- [All releases](https://github.com/eltru892/chinaslop-tracker/releases)

This first release has passed build, package, signature and local automated checks, but has not been tested on a physical Windows PC or Android phone.

- **Windows:** open the portable EXE. Node.js is bundled. This personal build is not signed with a trusted Windows publisher certificate.
- **Android:** install the APK on an ARM64 phone running Android 8.0 or newer. It runs independently and does not need a computer. Keep Android System WebView updated.

Set an encryption password and connect your own accounts on first launch. Downloads contain no saved account credentials, passwords, configuration or personal history.

## Features

- Daily and weekly progress, resource recovery timers, and server reset timers.
- Per-game event, banner and challenge timelines with server selection and official artwork lookup.
- Daily and weekly history with pagination and a mobile layout.
- Manual HoYoLAB and SKPORT daily check-in, plus an optional automatic check-in setting.
- Background images, matching color palettes and translucent game cards.
- Local account storage encrypted with scrypt and AES-256-GCM.

Automatic check-in requires the server to remain running and unlocked. Android can suspend or terminate background apps; reopen and unlock to resume. Expired sessions or CAPTCHA challenges require attention. Check-in claims web rewards, not in-game commissions.

## Run the browser version

Install Node.js 20 or newer, then:

```sh
cd tracker
node server.mjs
```

Open `http://127.0.0.1:4317/`. No npm installation is needed for the browser version. Keep the terminal running. See [the tracker guide](tracker/README.md) for account setup and details.

GitHub Pages cannot run this local Node.js server. Use the downloads or run the browser version on your own device.

## Tests

From the repository root:

```sh
node --test tracker/*.test.mjs
```

The tests use fake credentials and mocked service responses. GitHub Actions runs them on pushes and pull requests.

## Build Windows

Install Node.js 22 or newer and Python 3, then run from the repository root:

```sh
python scripts/prepare.py
cd desktop
npm ci
npm run dist:win
```

The EXE is created in `desktop/dist`. Building on Windows is recommended. No account data is copied into the package.

## Build Android

Install Python 3, JDK 17, Gradle 8.10.2, Android SDK Platform 35, Build Tools 35.0.0, NDK 27.2.12479018, and CMake 3.22.1. Accept the Android SDK license yourself. Set `ANDROID_HOME` and `ANDROID_NDK_HOME` to their installed locations, and make `cmake` available on PATH.

```sh
python scripts/prepare.py --android
cd android
sh rebuild-native.sh
gradle :app:assembleRelease
```

The Android Node runtime is downloaded from a pinned release and checked against its SHA-256 checksum. Native runtime binaries and generated app assets are not stored in Git. Sign the unsigned APK under `android/app/build/outputs/apk/release` with your own Android signing key. Keep that key private and backed up; future updates must use the same key.

## Project layout

| Folder | Purpose |
| --- | --- |
| `tracker` | Shared web UI, server, connectors, assets and tests |
| `desktop` | Windows Electron app wrapper |
| `android` | Standalone Android WebView and embedded Node app |
| `scripts` | Clean asset preparation and runtime download |

## Privacy and sources

Game requests go from the local server to HoYoLAB and SKPORT. Event details and images also use official game sites and image hosts. These service APIs can change and are not a stable public developer API contract.

Never commit cookies, tokens, account history, encryption passwords or signing keys. Local servers bind to loopback. Native apps add a random local session key. Account credentials remain encrypted at rest; the unlock password is held in memory while the server runs. Uninstalling the Android app removes its local storage.

See [ATTRIBUTION.md](ATTRIBUTION.md) for artwork and runtime credits. This is an unofficial project and is not affiliated with the game publishers. No repository-wide open-source license has been selected; publishing the source does not grant rights to third-party game artwork.

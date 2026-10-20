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
- Daily and weekly SQLite history with server pagination, per-game account selectors, and a mobile layout.
- Manual HoYoLAB and SKPORT daily check-in, plus an optional automatic check-in setting.
- Background images, matching color palettes and translucent game cards.
- Local account storage encrypted with scrypt and AES-256-GCM.

Automatic check-in requires the server to remain running and unlocked. Android can suspend or terminate background apps; reopen and unlock to resume. Expired sessions or CAPTCHA challenges require attention. Check-in claims web rewards, not in-game commissions.

## Run the browser version

Install Node.js 24 or newer, then:

```sh
cd tracker
node server.mjs
```

Open `http://127.0.0.1:4317/`. No npm installation is needed for the browser version. Keep the terminal running. See [the tracker guide](tracker/README.md) for account setup and details.

GitHub Pages cannot run this local Node.js server. Use the downloads or run the browser version on your own device.

## Tests

For consistent formatting, install pnpm 11.25.0 and run these commands from the repository root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm format
pnpm format:check
pnpm format:rust
```

Prettier formats the JavaScript, HTML, CSS, JSON, YAML, and Markdown source. Rust uses `rustfmt` (install with `rustup component add rustfmt`). Generated files, downloaded assets, and personal data are excluded. CI checks formatting and runs the tests.

From the repository root:

```sh
node --test tracker/*.test.mjs
```

The tests use fake credentials and mocked service responses. GitHub Actions runs them on pushes and pull requests.

## Build Windows and Android

New builds use **Tauri 2**. See [the native build guide](native/README.md) for Windows installers and standalone Android APKs. The shared Node backend and web UI remain in `tracker/`.

The published v1.0.0 downloads above are the previous Electron/Android builds. Rebuilding source does not replace those release assets automatically. Android updates require the original signing key.

## Project layout

| Folder    | Purpose                                                      |
| --------- | ------------------------------------------------------------ |
| `tracker` | Shared web UI, server, connectors, assets and tests          |
| `native`  | Tauri Windows and Android applications                       |
| `desktop` | Legacy Electron wrapper and original icon assets             |
| `android` | Embedded Node/JNI bridge, runtime notices and legacy wrapper |
| `scripts` | Clean asset preparation and runtime download                 |

## Privacy and sources

Game requests go from the local server to HoYoLAB and SKPORT. Event details and images also use official game sites and image hosts. These service APIs can change and are not a stable public developer API contract.

Never commit cookies, tokens, account history, encryption passwords or signing keys. Local servers bind to loopback. Native apps add a random local session key. Account credentials remain encrypted at rest; the unlock password is held in memory while the server runs. Uninstalling the Android app removes its local storage.

See [ATTRIBUTION.md](ATTRIBUTION.md) for artwork and runtime credits. This is an unofficial project and is not affiliated with the game publishers. No repository-wide open-source license has been selected; publishing the source does not grant rights to third-party game artwork.

## History storage and account switching

History is stored locally in `data/history.sqlite`, separately for each game UID and server. On the History page, use each game's account selector to view previous accounts without reconnecting. Reconnecting the same UID/server resumes its history. Disconnecting clears current progress; temporary refresh failures show the last successful observation with its original timestamp. Changing credentials clears current progress until the new connection is confirmed.

On first launch after updating, the tracker streams the old `data/snapshots.jsonl` into SQLite. It first creates `snapshots.jsonl.pre-sqlite.bak` and leaves the original file unchanged. Migration is resumable and does not duplicate observations. Records without a UID or server are kept under that game's **Legacy history**; they are never guessed to belong to another account. Existing gaps or account identities lost by older versions cannot be reconstructed.

Raw observations are retained for 365 days. Account names remain selectable after that window, but expired observations are removed. Daily and weekly history uses the viewing device's timezone, as before. Each game uses its last successful observation within that day/week; failed refreshes do not fabricate progress for a new period. Only the requested page is returned, and other pages do not download history.

Use Node.js 24 or newer with built-in `node:sqlite` support (bundled mobile Node 24 includes it). The database and backup contain game progress and game UIDs; account cookies, service account IDs, and tokens remain in the separate encrypted credential file. Do not commit private data. To back up SQLite consistently, close the tracker first and copy the whole `data` directory, including any WAL files.

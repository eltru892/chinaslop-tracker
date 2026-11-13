<!-- Project overview and setup notes for the Chinaslop Tracker application. -->

# Chinaslop Tracker

A local tracker for **Genshin Impact**, **Honkai: Star Rail**, **Zenless Zone Zero**, and **Arknights: Endfield**.

## Published legacy downloads

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
- Saved account profiles with encrypted connections and a selector above Daily progress. Names come from the Genshin or Endfield nickname after syncing (with HSR or ZZZ as a fallback). Automatic refresh and check-in use the selected profile; historical records remain available after switching or deleting a profile.
- Local account storage encrypted with scrypt and AES-256-GCM.
- Automatic unlocking after the first password entry on macOS (Keychain) and Windows (user-scoped DPAPI). If protected device storage is unavailable, enter the password manually; Android/Linux currently use this fallback. Keep the password for recovery or moving to another computer.

Automatic check-in requires the server to remain running and unlocked. Android can suspend or terminate background apps; reopen and unlock to resume. Expired sessions or CAPTCHA challenges require attention. Check-in claims web rewards, not in-game commissions.

## Run the browser version

Install Node.js 24 or newer. On macOS, double-click **Start Tracker.command** in the project folder; it starts the server and opens your browser. On Windows, double-click **launch.bat**, then open the local address printed in the terminal. Keep the terminal window open; press Control+C to stop.

To start manually:

```sh
cd tracker
node server.mjs
```

Open `http://127.0.0.1:4317/`. No npm installation is needed for the browser version. Keep the terminal running. See [the tracker guide](tracker/README.md) for account setup and details.

GitHub Pages cannot run this local Node.js server. Use the downloads or run the browser version on your own device.

## Tests

Automated checks live in the top-level `tests/` folder; `tracker/` contains the application. These checks verify API response handling, account history, timers, encryption, and server behavior using fake credentials and temporary storage. They do not use your saved accounts.

Tests are grouped by their main responsibility:

- `tests/data/`: history storage, saved settings, encryption, and time calculations.
- `tests/services/`: provider requests, check-in scheduling, device unlock, and artwork services.
- `tests/integration/`: server endpoints, account switching, and serving the browser modules.
- `tests/ui/`: browser rendering, account controls, and refresh-status behavior.

Some feature suites also check their server integration. `npm test` discovers test files recursively, including new subfolders.

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
npm test
```

The tests use fake credentials and mocked service responses. GitHub Actions runs them on pushes and pull requests.

## Build Windows and Android

The native Windows app is written in Rust with egui and lives in `windows/`. See [the native build guide](windows/README.md). On Windows, install Rust and Visual Studio C++ Build Tools, then run `windows/Build Windows.cmd`. It produces a portable executable and assets in `windows/artifacts/windows/`. Windows runtime validation is still pending.

The browser tracker remains in `tracker/`. The `android/` and `desktop/` folders contain the earlier Android and Electron wrappers; `scripts/prepare.py` prepares their generated tracker assets. The planned Kotlin Android rewrite has not been built yet.

The published v1.0.0 downloads above are the previous Electron/Android builds. Rebuilding source does not replace those release assets automatically. Android updates require the original signing key.

## Project layout

| Folder    | Purpose                                                             |
| --------- | ------------------------------------------------------------------- |
| `tracker` | App entry point, UI modules, server, connectors and assets          |
| `windows` | Native Rust desktop app, tests, artwork, and Windows build launcher |
| `desktop` | Legacy Electron wrapper and original icon assets                    |
| `android` | Embedded Node/JNI bridge, runtime notices and legacy wrapper        |
| `tests`   | Automated checks using fake accounts and temporary storage          |
| `scripts` | Clean asset preparation and runtime download                        |

## Browser code layout

`tracker/app.js` starts the page and coordinates navigation and refreshes. Each feature initializes its own state and event handlers:

| File                          | Responsibility                                                     |
| ----------------------------- | ------------------------------------------------------------------ |
| `tracker/ui/dashboard.js`     | Progress cards, resource recovery and reset timers                 |
| `tracker/ui/events.js`        | Event timeline, game/server selectors and event details            |
| `tracker/ui/history.js`       | Account selectors and daily/weekly history pagination              |
| `tracker/ui/settings.js`      | Account settings, unlock and password forms                        |
| `tracker/ui/check-in.js`      | Check-in button and result dialog                                  |
| `tracker/ui/appearance.js`    | Background selection, browser storage, palettes and canvas drawing |
| `tracker/ui/shared.js`        | DOM helpers, request handling, game labels and shared formatting   |
| `tracker/data/backgrounds.js` | Public artwork catalog and palette presets                         |

Browser modules use explicit imports; no framework or bundler is required. The server lists public module paths explicitly. Packaging copies the UI modules and the artwork catalog, without copying private history from `tracker/data/`. Automated tests remain in the top-level `tests/` folder.

## Privacy and sources

Game requests go from the local server to HoYoLAB and SKPORT. Event details and images also use official game sites and image hosts. These service APIs can change and are not a stable public developer API contract.

Never commit cookies, tokens, account history, encryption passwords or signing keys. Local servers bind to loopback. The legacy web wrappers add a random local session key. The Rust app makes requests directly and uses its own encrypted storage, with its encryption key in the OS credential store. Account credentials remain encrypted at rest; the unlock password is held in memory while the server runs. Uninstalling the Android app removes its local storage.

See [ATTRIBUTION.md](ATTRIBUTION.md) for artwork and runtime credits. This is an unofficial project and is not affiliated with the game publishers. No repository-wide open-source license has been selected; publishing the source does not grant rights to third-party game artwork.

## History storage and account switching

History is stored locally in `data/history.sqlite`, separately for each game UID and server. On the History page, use each game's account selector to view previous accounts without reconnecting. Reconnecting the same UID/server resumes its history. Disconnecting clears current progress; temporary refresh failures show the last successful observation with its original timestamp. Changing credentials clears current progress until the new connection is confirmed.

On first launch after updating, the tracker streams the old `data/snapshots.jsonl` into SQLite. It first creates `snapshots.jsonl.pre-sqlite.bak` and leaves the original file unchanged. Migration is resumable and does not duplicate observations. Records without a UID or server are kept under that game's **Legacy history**; they are never guessed to belong to another account. Existing gaps or account identities lost by older versions cannot be reconstructed.

Raw observations are retained for 365 days. Account names remain selectable after that window, but expired observations are removed. Daily and weekly history uses the viewing device's timezone, as before. Each game uses its last successful observation within that day/week; failed refreshes do not fabricate progress for a new period. Only the requested page is returned, and other pages do not download history.

Use Node.js 24 or newer with built-in `node:sqlite` support (bundled mobile Node 24 includes it). The database and backup contain game progress and game UIDs; account cookies, service account IDs, and tokens remain in the separate encrypted credential file. Do not commit private data. To back up SQLite consistently, close the tracker first and copy the whole `data` directory, including any WAL files.

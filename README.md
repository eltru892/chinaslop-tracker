# Chinaslop Tracker

Track daily tasks, weekly progress, resources, and ongoing events for **Genshin Impact**, **Honkai: Star Rail**, **Zenless Zone Zero**, and **Arknights: Endfield**.

Connect your own HoYoLAB and SKPORT accounts to refresh progress automatically. Account credentials and history stay on your device; requests go directly to the providers and official event sources.

## Versions

| Version            | Location               | Status                                                                   |
| ------------------ | ---------------------- | ------------------------------------------------------------------------ |
| Browser tracker    | [`tracker/`](tracker/) | Local Node.js server with a browser interface                            |
| Native Windows app | [`windows/`](windows/) | Rust + egui implementation; Windows build and runtime validation pending |
| Older Android app  | [`android/`](android/) | Legacy Android wrapper with an embedded Node.js runtime                  |

The Rust app has its own interface and storage. It does not automatically import the browser tracker's accounts or history.

[Published releases](https://github.com/eltru892/chinaslop-tracker/releases) contain earlier builds. They are not automatically updated when source code changes.

## Features

- **Daily and weekly progress:** commissions, training, activity, weekly tasks, and resource levels where the game APIs expose them.
- **Timers:** estimated resource recovery, daily resets, weekly resets, and the next refresh. Game reset timers use the account's server.
- **Saved accounts:** add profiles, switch accounts, and manage HoYoLAB and SKPORT connections separately. Profile names come from linked game nicknames after syncing.
- **History:** browse daily and weekly records, filter previous game accounts, and choose how many entries to display.
- **Events:** view calendars by game and server, with event, banner, and challenge filters; countdowns; official artwork; and links to sources. Only ongoing entries with confirmed end dates are shown.
- **Check-in:** claim HoYoLAB and SKPORT web check-in rewards manually or enable automatic check-in for the selected profile while the tracker is running.
- **Appearance:** choose bundled backgrounds or a custom image, with matching colors and translucent game cards.

Event calendars load before optional artwork discovery finishes. HoYoLAB thumbnails use smaller images where the official CDN supports resizing; event details retain the original artwork.

## Run the browser tracker

### Requirements

Install [Node.js](https://nodejs.org/) **24 or newer**. No dependency installation is needed to run the browser tracker.

### Double-click launcher

From the project folder:

- **macOS:** open `Start Tracker.command`. It starts the server and opens your default browser once the page is ready.
- **Windows:** open `launch.bat`, then visit the local address printed in the terminal.

The default address is **http://127.0.0.1:4317/**. Keep the terminal open while using the tracker. Press **Control+C** to stop it.

### Terminal

From the repository root:

```sh
cd tracker
node server.mjs
```

Then open http://127.0.0.1:4317/ in your browser. If the port is already in use, close the other tracker instance before starting another.

The browser tracker needs its local server. GitHub Pages cannot run it.

## Connect your accounts

1. Open the tracker and set an encryption password when prompted.
2. Open **Settings** and select or add a saved account.
3. Expand the connection instructions for HoYoLAB or SKPORT.
4. Enter the required values and choose **Save and sync**.

| Provider | Values                                                  | Games             |
| -------- | ------------------------------------------------------- | ----------------- |
| HoYoLAB  | `ltuid_v2` account ID value and `ltoken_v2` token value | Genshin, HSR, ZZZ |
| SKPORT   | Account token                                           | Endfield          |

Paste the values themselves; the tracker handles request formatting. You can connect either provider independently. Leave a saved connection field blank to keep its existing value.

In the browser version, supported macOS and Windows installations can remember the unlock credentials using protected device storage. Otherwise, unlock manually after restarting. Keep your password for recovery.

Deleting a saved profile or disconnecting a provider keeps its recorded game history. Use the History page's account selectors to view previous records.

## Build the native Windows app

The native app is written in Rust with egui/eframe. It does not need Node.js or a local web server.

On Windows:

1. Install [Rust](https://rustup.rs/).
2. Install Visual Studio Build Tools with **Desktop development with C++** and the Windows SDK.
3. Open `windows/Build Windows.cmd`.
4. Find the executable and assets in `windows/artifacts/windows/`.

Keep the `assets` folder beside the executable. The output is a portable, unsigned app, not an installer.

For a source-code preview, run from `windows/`:

```sh
cargo run --locked -- --demo
```

Remove `--demo` to use real account connections. See the [native Rust guide](windows/README.md) for storage details and build instructions.

## Data and backups

The browser tracker normally stores private files inside `tracker/`:

| Path                | Contents                                                                      |
| ------------------- | ----------------------------------------------------------------------------- |
| `secrets.enc.json`  | Encrypted credentials and saved profiles                                      |
| `config.local.json` | Local configuration                                                           |
| `data/`             | SQLite history and migration backups, alongside the public background catalog |

Browser appearance preferences may also live in browser storage. The native Rust app uses a separate operating-system application-data directory and stores its encryption key in Windows Credential Manager or macOS Keychain.

Stop the tracker before backing up its private files. Copy the entire history directory, including any SQLite WAL files. Device-protected automatic unlock information may not transfer to another computer.

Do not commit cookies, tokens, private history, passwords, or signing keys. The repository's ignore rules exclude these files and generated builds. Encryption protects stored credentials but does not make them inaccessible to malware running as your user.

## Development

The browser interface uses JavaScript, HTML, and CSS. The server uses Node.js built-in modules. The native desktop app uses Rust.

| Folder               | Purpose                                                              |
| -------------------- | -------------------------------------------------------------------- |
| `tracker/ui/`        | Browser dashboard, events, history, settings, and appearance modules |
| `tracker/`           | Server, provider integrations, storage, and public assets            |
| `windows/src/`       | Native Rust interface and backend                                    |
| `windows/tests/`     | Rust tests                                                           |
| `tests/data/`        | Browser tracker storage and time-calculation tests                   |
| `tests/services/`    | Provider, check-in, and artwork tests                                |
| `tests/integration/` | Local server and account-switching tests                             |
| `tests/ui/`          | Browser interface behavior tests                                     |
| `scripts/`           | Asset preparation for the legacy Android app                         |

### Test the browser tracker

From the repository root:

```sh
npm test
```

These tests use fake credentials, mocked provider responses, and temporary storage. They do not use your saved accounts.

### Format source code

Install pnpm 11.25.0, then run from the repository root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm format
pnpm format:check
pnpm format:rust
```

Prettier handles browser code and documentation; `rustfmt` handles Rust. Generated files, public artwork, and private data are excluded. `windows/target/` contains generated compiler output and can be recreated by Cargo.

### Check the Rust app

From `windows/`:

```sh
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked --tests
```

Ignored Rust tests contact public official feeds. Run them separately with `cargo test --locked -- --ignored`.

GitHub Actions checks source formatting and runs the Node.js tests on pushes and pull requests. It does not currently build or test the Windows executable.

## Limitations and credits

The tracker can only display information returned by the providers. Missing fields appear as unavailable. Event coverage and artwork depend on official feeds and website formats, which can change.

Automatic refresh and check-in require the tracker to remain running. Expired sessions and CAPTCHA challenges may require action on the official website. Mobile operating systems can suspend the legacy Android app. Check-in claims website rewards; it does not complete in-game tasks.

This is an unofficial project and is not affiliated with the game publishers. See [ATTRIBUTION.md](ATTRIBUTION.md) for artwork and runtime credits. No repository-wide open-source license has been selected; third-party artwork remains subject to its owners' rights.

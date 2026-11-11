# Chinaslop Tracker — native Rust

An independent desktop implementation using egui/eframe. The interface and backend run in Rust; there is no browser, WebView, Node.js process, or local HTTP server.

## Run from source

Install stable Rust from https://rustup.rs/. On Windows, also install Visual Studio Build Tools with the **Desktop development with C++** workload and Windows SDK.

From this folder:

```sh
cargo run --locked
```

To explore four synthetic game accounts without accessing saved credentials:

```sh
cargo run --locked -- --demo
```

## Build on Windows

Double-click **Build Windows.cmd**. It runs the release build and copies the executable and public artwork into `artifacts/windows`. Keep the `assets` folder beside the executable. This is a portable, unsigned build, not an installer.

This implementation has compiled and passed core tests on macOS. A Windows build and live Windows UI verification are still required before calling it a release.

## Features

- Daily and weekly progress for Genshin, HSR, ZZZ, and Endfield; resource recovery and server reset timers.
- Saved profiles, provider connections, and account switching.
- SQLite history with account filters and pagination, retained after disconnecting a profile.
- Official dated event feeds, banners, challenges, server selection, and a native timeline. Artwork is used when the upstream feed or matching official announcement provides it; some events may have no image.
- Manual check-in and optional automatic check-in for the selected profile while the app is running. CAPTCHA challenges require the official website.
- Configurable refresh intervals, progress messages, parallel requests, and minute-based timers.
- Background artwork, custom local images, sampled theme colors, and translucent cards.

## Storage

This app uses its own application-data directory, separate from the web tracker and the C# prototype. It does not import their saved tokens or history. Add your connections in Settings.

Settings and credentials are encrypted with AES-256-GCM. A random key is remembered in Windows Credential Manager or macOS Keychain. SQLite stores progress history, not tokens. OS credential protection does not protect against malicious software already running as your user.

A second instance cannot open the same store. If decryption or credential-store access fails, the app retains the original files and reports the error instead of replacing them. Linux credential storage is not implemented.

## Code layout

- `src/app.rs`: application state, worker messages, refresh scheduling, and navigation.
- `src/app/`: separate dashboard, history, events, settings, and appearance views.
- `src/model.rs`: shared data types and server-time calculations.
- `src/provider.rs`: HoYoLAB and SKPORT requests and normalization.
- `src/check_in.rs`: check-in requests and verification.
- `src/events.rs`: official calendars and announcement artwork matching.
- `src/storage.rs`: encrypted settings and SQLite history.
- `tests/core.rs`: data normalization, signatures, date boundaries, encryption, and history tests.

```sh
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked --tests
```

The ignored public-feed test contacts Endfield's official feed. Run it explicitly with `cargo test --locked -- --ignored`.

See `ATTRIBUTION.md` and `assets/sources.json` for artwork credits. Artwork has not been AI edited.

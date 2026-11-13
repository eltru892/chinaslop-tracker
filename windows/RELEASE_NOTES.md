## Native Windows app

A standalone Windows x64 tracker built with Rust and egui. No Node.js installation or local web server is required.

- Daily and weekly progress for Genshin Impact, Honkai: Star Rail, Zenless Zone Zero, and Arknights: Endfield.
- Saved account profiles, encrypted connections, and SQLite history.
- Resource recovery and server reset timers.
- Event, banner, and challenge timelines with server selection, official artwork, and event details.
- Calendar-first loading, background artwork discovery, and smaller HoYoLAB thumbnails.
- Manual check-in, optional automatic check-in while running, and configurable refresh intervals.
- Bundled backgrounds, custom images, and matching appearance colors.

## Download and run

Download the **Windows x64 ZIP**, extract the entire folder, and open **Chinaslop Tracker.exe**. Keep the **assets** folder beside the executable. `SHA256SUMS.txt` contains the archive checksum.

This is a portable, unsigned build, not an installer. Windows may show an unknown publisher warning. It uses separate local storage from previous apps; reconnect accounts in Settings. Existing history is not automatically imported.

Validation includes Windows automated tests, compilation, package checks, and launching the packaged native window with sample data. Live account behavior and visual appearance have not been fully tested on a physical Windows PC.

This release contains the Windows app only; no new Android APK is included.

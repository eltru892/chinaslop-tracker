# Tauri applications

The Windows and Android applications use Tauri 2 and the shared `tracker` UI/server. Windows uses WebView2 and a bundled Node executable. Android embeds Node in the app process through the existing JNI bridge. No remote backend is needed.

## Windows

Install Rust, the Visual Studio C++ build tools, Python 3, and Node 24. Install the build CLI with `cargo install tauri-cli --version 2.12.3 --locked`.

From the repository root:

```powershell
python scripts/prepare-tauri.py --node (Get-Command node).Source
cd native
cargo tauri build --bundles nsis
```

The installer is written under `native/src-tauri/target/release/bundle/nsis`. It installs the shared assets and Node alongside the app. This is an installer, not the old Electron portable executable. WebView2 is installed by the installer if needed.

The Windows app retains `%APPDATA%/Chinaslop Tracker/tracker` as its private account/history directory. Appearance preferences belong to the WebView browser profile and do not migrate from Electron automatically. Close the old app before starting the new one; both use port 4318.

## Android

Install the Tauri Android prerequisites, including JDK, Android SDK/NDK, and the ARM64 Rust target. The generated Tauri project specifies its required SDK and Gradle versions. Configure `JAVA_HOME`, `ANDROID_HOME`, and `NDK_HOME`; set `ANDROID_NDK_HOME` to the same NDK for the existing bridge script.

From the repository root:

```sh
python scripts/prepare.py --android
sh android/rebuild-native.sh
cd native
cargo tauri android init --ci
cd ..
python scripts/prepare-tauri.py --android
cd native
cargo tauri android build --target aarch64 --apk
```

On Windows, compile the JNI bridge with the SDK's CMake and Ninja using `android/app/src/main/cpp` and the NDK's `build/cmake/android.toolchain.cmake`. Copy the resulting `libtracker.so` and NDK `libc++_shared.so` to `android/app/src/main/jniLibs/arm64-v8a` before preparing Tauri assets.

`native/MainActivity.kt` is the maintained activity source. `prepare-tauri.py --android` copies it into the generated project, applies loopback-only cleartext networking, disables backups, and copies only public tracker assets and runtime libraries. Rerun preparation after changing shared code or regenerating the Android project.

Release APKs require signing with the original application's key to update an existing installation. The repository contains no release key. An unsigned APK cannot be installed; a differently signed APK cannot update the old app. Do not uninstall an existing installation without preserving needed data.

The application ID and `files/tracker-data` location are unchanged. Android may suspend background work; automatic check-in still requires a running, unlocked server.

## Validation

```sh
node --test tracker/*.test.mjs
cargo check --manifest-path native/src-tauri/Cargo.toml
```

Native builds do not establish that live account authentication, launcher behavior, or background operation work on a physical device.

The Windows startup smoke test uses temporary account storage:

```powershell
./scripts/smoke-windows.ps1
```

If Windows disallows symbolic links, Tauri may compile the Android library successfully but fail to link it into the Gradle project. After that specific failure, copy `native/src-tauri/target/aarch64-linux-android/release/libchinaslop_tracker_lib.so` into `native/src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a/`, then package that compiled library:

```powershell
./native/src-tauri/gen/android/gradlew.bat -p native/src-tauri/gen/android --no-daemon :app:assembleArm64Release -x rustBuildArm64Release
```

Only skip the Rust task after a successful Rust compile. The generated Android project and bundled runtime resources are ignored by Git and recreated by the initialization/preparation commands.

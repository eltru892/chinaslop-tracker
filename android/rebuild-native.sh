#!/bin/sh
set -eu
cd "$(dirname "$0")"
: "${ANDROID_NDK_HOME:?Set ANDROID_NDK_HOME to your Android NDK directory}"
cmake -S app/src/main/cpp -B .native-build -DCMAKE_TOOLCHAIN_FILE="$ANDROID_NDK_HOME/build/cmake/android.toolchain.cmake" -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-26 -DCMAKE_BUILD_TYPE=Release
cmake --build .native-build
cp .native-build/libtracker.so app/src/main/jniLibs/arm64-v8a/libtracker.so
cp "$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/$(ls "$ANDROID_NDK_HOME/toolchains/llvm/prebuilt" | head -1)/sysroot/usr/lib/aarch64-linux-android/libc++_shared.so" app/src/main/jniLibs/arm64-v8a/libc++_shared.so

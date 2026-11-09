#!/usr/bin/env python3
"""Prepare Tauri resources and apply the Android runtime integration after init."""
from pathlib import Path
import argparse
import shutil
import subprocess
import urllib.request
import re
from tracker_assets import copy_tracker

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--android', action='store_true')
parser.add_argument('--node', type=Path, help='Windows Node executable to bundle')
args = parser.parse_args()
tauri = root / 'tauri/src-tauri'
copy_tracker(tauri / 'resources/tracker')
if args.node:
    (tauri / 'resources/runtime').mkdir(parents=True, exist_ok=True)
    shutil.copy2(args.node, tauri / 'resources/runtime/node.exe')
    version = subprocess.check_output([str(args.node), '--version'], text=True).strip()
    urllib.request.urlretrieve(f'https://raw.githubusercontent.com/nodejs/node/{version}/LICENSE', tauri / 'resources/runtime/LICENSE.txt')
if args.android:
    app = tauri / 'gen/android/app'
    if not app.exists():
        raise SystemExit('Run cargo tauri android init in tauri first.')
    copy_tracker(app / 'src/main/assets/tracker')
    shutil.copytree(root / 'android/app/src/main/jniLibs', app / 'src/main/jniLibs', dirs_exist_ok=True)
    for license_file in ['NODE-LICENSE.txt', 'LIBCXX-LICENSE.txt']:
        shutil.copy2(root / 'android/app/src/main/assets' / license_file, app / 'src/main/assets' / license_file)
    activity = app / 'src/main/java/local/chinaslop/tracker/MainActivity.kt'
    activity.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(root / 'tauri/MainActivity.kt', activity)
    xml = app / 'src/main/res/xml'
    xml.mkdir(parents=True, exist_ok=True)
    shutil.copy2(root / 'android/app/src/main/res/xml/network_security.xml', xml / 'network_security.xml')
    drawable = app / 'src/main/res/drawable'
    drawable.mkdir(parents=True, exist_ok=True)
    shutil.copy2(root / 'android/app/src/main/res/drawable/app_icon.png', drawable / 'app_icon.png')
    manifest = app / 'src/main/AndroidManifest.xml'
    text = manifest.read_text()
    if 'android:networkSecurityConfig=' not in text:
        text = text.replace('<application', '<application android:networkSecurityConfig="@xml/network_security"', 1)
    text = re.sub(r'\s+android:allowBackup="[^"]*"', '', text)
    text = text.replace('<application', '<application android:allowBackup="false"', 1)
    text = re.sub(r'android:icon="[^"]*"', 'android:icon="@drawable/app_icon"', text)
    manifest.write_text(text)
    proguard = app / 'proguard-rules.pro'
    rules = proguard.read_text()
    if '# Tracker JNI entry point' not in rules:
        proguard.write_text(rules + '\n# Tracker JNI entry point\n-keep class local.chinaslop.tracker.MainActivity** { *; }\n')
    build = app / 'build.gradle.kts'
    text = build.read_text()
    if '// Embedded Node runtime' not in text:
        text += '\n// Embedded Node runtime: retain symbols and legacy extraction for Node.\nandroid {\n    packaging { jniLibs { useLegacyPackaging = true; keepDebugSymbols += "**/*.so" } }\n}\n'
    build.write_text(text)
print('Tauri resources prepared without account data.')

#!/usr/bin/env python3
"""Prepare Android app assets; optionally download the pinned Node runtime."""
from pathlib import Path
import argparse
import hashlib
import urllib.request
import zipfile
from tracker_assets import copy_tracker

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--android', action='store_true')
parser.add_argument('--runtime-archive', type=Path)
args = parser.parse_args()

copy_tracker(root / 'android/app/src/main/assets/tracker')
print('Prepared clean app assets. Personal settings and account data were excluded.')

if args.android:
    expected = 'e3cd29a1be03405f11dd5c857af8cd3ad13f84f1409ea648f5328f0bada5bd76'
    archive = args.runtime_archive or root / '.cache/nodejs-mobile-android-24.21.0-0.zip'
    if not archive.exists():
        archive.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(
            'https://github.com/fogtape/nodejs-mobile/releases/download/'
            'v24.21.0-0/nodejs-mobile-android-24.21.0-0.zip', archive,
        )
    if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
        raise SystemExit('Android runtime checksum mismatch; download a fresh archive.')
    destination = root / 'android/app/src/main/jniLibs/arm64-v8a'
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as bundle:
        (destination / 'libnode.so').write_bytes(bundle.read('bin/arm64-v8a/libnode.so'))
    print('Android runtime verified and extracted. Run android/rebuild-native.sh next.')

#!/usr/bin/env python3
"""Prepare clean app assets; optionally download the pinned Android Node runtime."""
from pathlib import Path
import argparse,hashlib,shutil,urllib.request,zipfile
root=Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser()
parser.add_argument('--android',action='store_true')
parser.add_argument('--runtime-archive',type=Path)
args=parser.parse_args()
source=root/'tracker'
files=['index.html','app.js','style.css','server.mjs','history.mjs','history-dates.mjs','collector.mjs','check-in.mjs','auto-check-in.mjs','events.mjs','official-art.mjs','event-images.mjs','secrets.mjs','hoyolab-settings.mjs','resource-time.mjs','logo.png','package.json','config.example.json']
files += [p.relative_to(source).as_posix() for p in (source/'assets').rglob('*') if p.is_file() and not p.is_symlink()]
for destination in [root/'desktop/tracker',root/'android/app/src/main/assets/tracker']:
 destination.mkdir(parents=True,exist_ok=True)
 for name in files:
  target=destination/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source/name,target)
print('Prepared clean app assets. Personal settings and account data were excluded.')
if args.android:
 expected='e3cd29a1be03405f11dd5c857af8cd3ad13f84f1409ea648f5328f0bada5bd76'
 archive=args.runtime_archive or root/'.cache/nodejs-mobile-android-24.21.0-0.zip'
 if not archive.exists():
  archive.parent.mkdir(parents=True,exist_ok=True)
  urllib.request.urlretrieve('https://github.com/fogtape/nodejs-mobile/releases/download/v24.21.0-0/nodejs-mobile-android-24.21.0-0.zip',archive)
 if hashlib.sha256(archive.read_bytes()).hexdigest()!=expected:raise SystemExit('Android runtime checksum mismatch; download a fresh archive.')
 destination=root/'android/app/src/main/jniLibs/arm64-v8a';destination.mkdir(parents=True,exist_ok=True)
 with zipfile.ZipFile(archive) as z:(destination/'libnode.so').write_bytes(z.read('bin/arm64-v8a/libnode.so'))
 print('Android runtime verified and extracted. Run android/rebuild-native.sh next.')

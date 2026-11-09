"""Shared source selection for generated application bundles."""
from pathlib import Path
import re
import shutil
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parent.parent
TRACKER = ROOT / 'tracker'
SOURCE_FILES = (
    'index.html', 'app.js', 'style.css', 'server.mjs', 'history.mjs',
    'history-dates.mjs', 'collector.mjs', 'check-in.mjs', 'auto-check-in.mjs',
    'events.mjs', 'official-art.mjs', 'event-images.mjs', 'secrets.mjs',
    'hoyolab-settings.mjs', 'resource-time.mjs', 'package.json', 'config.example.json',
    'data/backgrounds.js',
)


def tracker_files(source=TRACKER):
    files = [Path(name) for name in SOURCE_FILES]
    files += [p.relative_to(source) for p in (source / 'ui').glob('*.js')]
    for path in (source / 'assets').rglob('*'):
        relative = path.relative_to(source).as_posix()
        if re.fullmatch(
            r'assets/(?:(?:logo|genshin-logo|hsr-logo|zzz-logo|endfield-logo)\.png|'
            r'sources\.json|endfield-backgrounds/(?:\d+(?:-thumb)?\.webp|SOURCES\.json))',
            relative,
        ):
            files.append(Path(relative))
    # Reject links even in parent directories, so only repository source is packaged.
    for relative in files:
        path = source / relative
        if not path.is_file() or any(p.is_symlink() for p in [path, *path.parents]):
            raise ValueError(f'Not a regular source file: {relative}')
    return sorted(files)


def copy_tracker(destination):
    """Replace only one of the known generated tracker bundles, never runtime storage."""
    destination = Path(destination)
    allowed = [ROOT / path for path in (
        'desktop/tracker', 'android/app/src/main/assets/tracker',
        'tauri/src-tauri/resources/tracker', 'tauri/src-tauri/gen/android/app/src/main/assets/tracker',
    )]
    if destination not in allowed or any(p.is_symlink() for p in [destination, *destination.parents]):
        raise ValueError(f'Not a generated tracker bundle: {destination}')
    files = tracker_files(TRACKER)
    # Build a complete replacement before touching the previous generated bundle.
    destination.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix='tracker-assets-', dir=destination.parent) as temp:
        staged = Path(temp) / 'tracker'
        for relative in files:
            target = staged / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(TRACKER / relative, target)
        if destination.exists():
            shutil.rmtree(destination)
        staged.rename(destination)

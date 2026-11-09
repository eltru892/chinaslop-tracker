import { backgroundDefaults, backgroundArtworks, backgroundColors } from '../data/backgrounds.js';
import { getElement, createElement, extractBackgroundColor } from './shared.js';
// Preview and persist browser-specific artwork, palette, and overlay preferences.
export function initAppearance() {
  let backgroundPreferences = { ...backgroundDefaults };
  let backgroundFile = null;
  let backgroundBitmap = null;
  let backgroundImageColor = '#172238';
  let backgroundFileName = '';
  let backgroundImageVersion = 0;
  function backgroundDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('tracker-appearance', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('settings');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  // IndexedDB can store the image Blob together with its appearance settings.
  async function backgroundStorage(write = false) {
    const db = await backgroundDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('settings', write ? 'readwrite' : 'readonly');
        const store = transaction.objectStore('settings');
        const request = write
          ? store.put(
              {
                preferences: backgroundPreferences,
                image: backgroundFile,
                name: backgroundFileName,
              },
              'background',
            )
          : store.get('background');
        let result;
        request.onsuccess = () => {
          result = request.result;
        };
        // A successful individual request is not enough; wait for the transaction to commit.
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () =>
          reject(transaction.error || new Error('Storage operation cancelled'));
      });
    } finally {
      db.close();
    }
  }
  function updateBackgroundControls() {
    getElement('backgroundPreset').value = backgroundPreferences.preset;
    getElement('backgroundColor').value = backgroundPreferences.color;
    getElement('backgroundColorLabel').hidden = backgroundPreferences.preset !== 'custom';
    getElement('backgroundPreset').querySelector('option[value="image"]').disabled =
      !backgroundBitmap;
    getElement('backgroundDim').value = backgroundPreferences.dim;
    getElement('backgroundDimValue').textContent = `${backgroundPreferences.dim}%`;
    getElement('backgroundFileName').textContent = backgroundFile
      ? backgroundFileName || 'Saved image'
      : 'No image selected · JPG, PNG or WebP, up to 16 MB';
    getElement('removeBackgroundImage').disabled = !backgroundFile;
    for (const button of getElement('backgroundGalleryGrid').querySelectorAll('button'))
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.artwork === backgroundPreferences.artwork),
      );
  }
  // Derive CSS theme variables from a preset, custom color, or sampled image color.
  function applyColorPalette() {
    const root = document.documentElement;
    const hex =
      backgroundPreferences.preset === 'image'
        ? backgroundImageColor
        : backgroundPreferences.preset === 'custom'
          ? backgroundPreferences.color
          : backgroundPreferences.preset === 'default'
            ? '#0c101b'
            : backgroundColors[backgroundPreferences.preset];
    const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
    const max = Math.max(...channels),
      min = Math.min(...channels),
      delta = max - min;
    const lightness = (max + min) / 2;
    const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
    let hue =
      delta === 0
        ? 220
        : max === channels[0]
          ? ((channels[1] - channels[2]) / delta) % 6
          : max === channels[1]
            ? (channels[2] - channels[0]) / delta + 2
            : (channels[0] - channels[1]) / delta + 4;
    hue = delta === 0 ? 220 : (hue * 60 + 360) % 360;
    const light = backgroundPreferences.preset !== 'image' && lightness > 0.72;
    const sat = saturation < 0.08 ? 0 : Math.max(18, Math.min(48, saturation * 100));
    // Keep the palette within neighboring hues: background → panels → controls.
    const shiftedHue = (offset) => Math.round((hue + offset + 360) % 360);
    const tone = (level, weight = 1, offset = 0) =>
      `hsl(${shiftedHue(offset)} ${Math.round(sat * weight)}% ${level}%)`;
    const accent = (level) => `hsl(${shiftedHue(30)} ${sat === 0 ? 0 : 64}% ${level}%)`;
    const palette = {
      'page-bg': tone(light ? 96 : 7, 1, -15),
      surface: tone(light ? 99 : 12, 0.8),
      panel: tone(light ? 98 : 13, 0.8, 10),
      'surface-low': tone(light ? 94 : 9, 0.75, -5),
      field: tone(light ? 100 : 7, 0.7, 5),
      'field-button': tone(light ? 88 : 23, 0.8, 20),
      text: tone(light ? 12 : 95, 0.3),
      'text-soft': tone(light ? 23 : 82, 0.4),
      muted: tone(light ? 35 : 69, 0.35),
      faint: tone(light ? 40 : 61, 0.3),
      placeholder: tone(light ? 44 : 57, 0.3),
      border: tone(light ? 74 : 28, 0.65, 15),
      primary: accent(light ? 32 : 77),
      'primary-hover': accent(light ? 26 : 84),
      'primary-ink': tone(light ? 100 : 10, 0.5),
      'primary-soft': accent(light ? 34 : 76),
      'ink-rgb': light ? '20,25,35' : '245,248,255',
      'inset-rgb': light ? '222,226,233' : '4,8,14',
      danger: light ? '#a32639' : '#f3a4ad',
      warning: light ? '#805313' : '#edc78c',
      line: light ? 'rgba(20,25,35,.14)' : 'rgba(245,248,255,.12)',
    };
    for (const [key, value] of Object.entries(palette)) root.style.setProperty('--' + key, value);
    // Resolve separate neighboring colors for translucent accents and background glow.
    const swatch = document.createElement('canvas');
    swatch.width = swatch.height = 1;
    const sample = swatch.getContext('2d');
    sample.fillStyle = accent(light ? 32 : 77);
    sample.fillRect(0, 0, 1, 1);
    const rgb = [...sample.getImageData(0, 0, 1, 1).data].slice(0, 3).join(',');
    root.style.setProperty('--primary-rgb', rgb);
    sample.fillStyle = tone(light ? 45 : 45, 1, -15);
    sample.fillRect(0, 0, 1, 1);
    root.style.setProperty(
      '--glow-rgb',
      [...sample.getImageData(0, 0, 1, 1).data].slice(0, 3).join(','),
    );
    root.dataset.themeMode = light ? 'light' : 'dark';
  }
  function drawBackground() {
    const canvas = getElement('backgroundCanvas');
    applyColorPalette();
    document.body.style.background = '';
    document.body.classList.toggle('hasBackgroundImage', !!backgroundBitmap);
    canvas.hidden = !backgroundBitmap;
    if (!backgroundBitmap) {
      canvas.width = 1;
      canvas.height = 1;
      return;
    }
    // Match the actual fixed background box, including mobile browser chrome.
    const viewport = canvas.getBoundingClientRect();
    const viewportWidth = Math.max(1, viewport.width);
    const viewportHeight = Math.max(1, viewport.height);
    const scale = Math.min(
      window.devicePixelRatio || 1,
      2,
      2560 / Math.max(viewportWidth, viewportHeight),
    );
    canvas.width = Math.max(1, Math.round(viewportWidth * scale));
    canvas.height = Math.max(1, Math.round(viewportHeight * scale));
    const context = canvas.getContext('2d');
    // Crop equal amounts from opposite edges to fill every screen without stretching.
    const aspect = canvas.width / canvas.height;
    const sourceWidth = Math.min(backgroundBitmap.width, backgroundBitmap.height * aspect);
    const sourceHeight = Math.min(backgroundBitmap.height, backgroundBitmap.width / aspect);
    context.drawImage(
      backgroundBitmap,
      (backgroundBitmap.width - sourceWidth) / 2,
      (backgroundBitmap.height - sourceHeight) / 2,
      sourceWidth,
      sourceHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    const overlay =
      document.documentElement.dataset.themeMode === 'light' ? '245,247,250' : '12,16,27';
    context.fillStyle = `rgba(${overlay},${backgroundPreferences.dim / 100})`;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  async function setBackgroundImage(
    file,
    name = '',
    artwork = '',
    matchPalette = true,
    version = ++backgroundImageVersion,
  ) {
    if (!file) {
      backgroundBitmap?.close();
      backgroundBitmap = null;
      backgroundFile = null;
      backgroundFileName = '';
      if (backgroundPreferences.preset === 'image') backgroundPreferences.preset = 'default';
    } else {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
        throw new Error('Choose a JPG, PNG or WebP image.');
      if (file.size > 16 * 1024 * 1024) throw new Error('Choose an image smaller than 16 MB.');
      const original = await createImageBitmap(file);
      let next = original;
      const maximum = Math.max(original.width, original.height);
      // Limit decoded image size to reduce canvas memory use on large uploads.
      if (maximum > 2560) {
        try {
          next = await createImageBitmap(original, {
            resizeWidth: Math.max(1, Math.round((original.width * 2560) / maximum)),
            resizeHeight: Math.max(1, Math.round((original.height * 2560) / maximum)),
            resizeQuality: 'high',
          });
        } finally {
          original.close();
        }
      }
      // A later selection wins even if this image takes longer to decode.
      if (version !== backgroundImageVersion) {
        next.close();
        return;
      }
      backgroundBitmap?.close();
      backgroundBitmap = next;
      backgroundFile = file;
      backgroundFileName = name;
      backgroundImageColor = extractBackgroundColor(next);
      if (matchPalette) backgroundPreferences.preset = 'image';
    }
    backgroundPreferences.artwork = artwork;
    getElement('saveBackground').disabled = false;
    updateBackgroundControls();
    drawBackground();
  }
  // Validate persisted preferences before restoring them, including older saved formats.
  async function restoreBackground() {
    try {
      const saved = await backgroundStorage();
      if (saved) {
        const preferences = saved.preferences || {};
        backgroundPreferences = {
          preset: ['default', 'custom', 'image', ...Object.keys(backgroundColors)].includes(
            preferences.preset,
          )
            ? preferences.preset
            : 'default',
          color: /^#[0-9a-f]{6}$/i.test(preferences.color)
            ? preferences.color
            : backgroundDefaults.color,
          dim: Number.isFinite(preferences.dim)
            ? Math.max(0, Math.min(90, preferences.dim))
            : backgroundDefaults.dim,
        };
        await setBackgroundImage(
          saved.image || null,
          saved.name || '',
          backgroundArtworks.some((art) => art.id === preferences.artwork)
            ? preferences.artwork
            : '',
          false,
        );
      }
    } catch {
      getElement('backgroundMessage').textContent =
        'Saved appearance could not be loaded. You can choose a new one below.';
    }
    updateBackgroundControls();
    drawBackground();
  }
  // Controls change the preview immediately; persistence waits for Save appearance.
  function previewBackground() {
    backgroundPreferences.preset = getElement('backgroundPreset').value;
    backgroundPreferences.color = getElement('backgroundColor').value;
    backgroundPreferences.dim = Number(getElement('backgroundDim').value);
    updateBackgroundControls();
    drawBackground();
    getElement('backgroundMessage').textContent =
      'Previewing changes. Select Save appearance to keep them.';
  }
  function renderBackgroundGallery() {
    const query = getElement('backgroundSearch').value.trim().toLocaleLowerCase();
    const artworks = backgroundArtworks.filter((art) =>
      `${art.name} ${art.title}`.toLocaleLowerCase().includes(query),
    );
    const buttons = artworks.map((art) => {
      const button = createElement('button', 'backgroundChoice');
      button.type = 'button';
      button.dataset.artwork = art.id;
      button.setAttribute('aria-pressed', String(art.id === backgroundPreferences.artwork));
      button.setAttribute('aria-label', `Use ${art.name} background`);
      const image = createElement('img');
      image.src = art.thumbnail;
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.width = 360;
      image.height = 180;
      button.append(
        image,
        createElement('span', '', art.name),
        createElement('small', '', art.title),
      );
      return button;
    });
    getElement('backgroundGalleryGrid').replaceChildren(...buttons);
    getElement('backgroundGalleryEmpty').hidden = artworks.length !== 0;
  }
  getElement('backgroundGallery').addEventListener('toggle', () => {
    if (getElement('backgroundGallery').open) renderBackgroundGallery();
  });
  getElement('backgroundSearch').addEventListener('input', renderBackgroundGallery);
  getElement('backgroundGalleryGrid').addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-artwork]');
    if (!button) return;
    const artwork = backgroundArtworks.find((art) => art.id === button.dataset.artwork);
    if (!artwork) return;
    const version = ++backgroundImageVersion;
    getElement('saveBackground').disabled = true;
    getElement('backgroundMessage').textContent = `Loading ${artwork.name} artwork…`;
    try {
      const response = await fetch(artwork.image);
      if (!response.ok) throw new Error('Could not load this background. Please try again.');
      const image = await response.blob();
      if (version !== backgroundImageVersion) return;
      await setBackgroundImage(
        image,
        `${artwork.name} · ${artwork.title}`,
        artwork.id,
        true,
        version,
      );
      if (version !== backgroundImageVersion) return;
      getElement('backgroundMessage').textContent =
        `Previewing ${artwork.name}. Select Save appearance to keep it.`;
    } catch (error) {
      if (version === backgroundImageVersion)
        getElement('backgroundMessage').textContent = error.message;
    } finally {
      if (version === backgroundImageVersion) getElement('saveBackground').disabled = false;
    }
  });
  getElement('backgroundPreset').addEventListener('change', previewBackground);
  getElement('backgroundColor').addEventListener('input', previewBackground);
  getElement('backgroundDim').addEventListener('input', previewBackground);
  getElement('backgroundFile').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      await setBackgroundImage(file, file.name);
      getElement('backgroundMessage').textContent =
        'Previewing image. Select Save appearance to keep it.';
    } catch (error) {
      getElement('backgroundMessage').textContent = error.message;
    }
    event.target.value = '';
  });
  getElement('removeBackgroundImage').addEventListener('click', async () => {
    await setBackgroundImage(null);
    getElement('backgroundMessage').textContent =
      'Image removed from preview. Select Save appearance to keep this change.';
  });
  getElement('backgroundForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    getElement('saveBackground').disabled = true;
    try {
      await backgroundStorage(true);
      getElement('backgroundMessage').textContent = 'Appearance saved in this browser.';
    } catch {
      getElement('backgroundMessage').textContent =
        'Could not save the appearance. Check browser storage permissions and available space.';
    } finally {
      getElement('saveBackground').disabled = false;
    }
  });
  getElement('resetBackground').addEventListener('click', async () => {
    backgroundPreferences = { ...backgroundDefaults };
    await setBackgroundImage(null);
    try {
      await backgroundStorage(true);
      getElement('backgroundMessage').textContent = 'Default appearance restored.';
    } catch {
      getElement('backgroundMessage').textContent =
        'Default appearance restored for this page, but could not be saved.';
    }
  });
  let backgroundResizeFrame = null;
  // Coalesce resize notifications into one draw per animation frame.
  function scheduleBackgroundResize() {
    if (backgroundResizeFrame !== null) cancelAnimationFrame(backgroundResizeFrame);
    backgroundResizeFrame = requestAnimationFrame(() => {
      backgroundResizeFrame = null;
      if (backgroundBitmap) drawBackground();
    });
  }
  window.addEventListener('resize', scheduleBackgroundResize);
  window.addEventListener('orientationchange', scheduleBackgroundResize);
  window.visualViewport?.addEventListener('resize', scheduleBackgroundResize);
  const backgroundSizeObserver = new ResizeObserver(scheduleBackgroundResize);
  backgroundSizeObserver.observe(getElement('backgroundCanvas'));

  return { restore: restoreBackground };
}

// Browser helpers shared by the UI features. No feature state lives here.
export const GAME_NAMES = {
  genshin: 'Genshin Impact',
  hsr: 'Honkai: Star Rail',
  zzz: 'Zenless Zone Zero',
  endfield: 'Arknights: Endfield',
};
export const GAME_ORDER = Object.keys(GAME_NAMES);
export const getElement = (id) => document.getElementById(id);
export const createElement = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
// Browser storage holds UI preferences. Restricted storage falls back to defaults.
export function readStoredValue(key, fallback = null) {
  try {
    const value = localStorage.getItem(key);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}
export function writeStoredValue(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}
export function readStoredJSON(key, fallback = {}) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw) || fallback;
  } catch {
    return fallback;
  }
}
export function writeStoredJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
export function count(value) {
  return value && typeof value.current === 'number' && typeof value.total === 'number'
    ? `${value.current}/${value.total}`
    : 'Not exposed';
}
export function percentage(value) {
  return value && value.total > 0
    ? Math.max(0, Math.min(100, Math.round((value.current / value.total) * 100)))
    : 0;
}
// Older snapshots can use older labels; display the current in-game names.
export function metricLabel(game, label) {
  if (game !== 'zzz') return label;
  return (
    { 'Weekly bounty': 'Bounty Commissions', 'Weekly activity': 'Ridu Weekly' }[label] || label
  );
}
// Translate provider-specific region codes into the same readable server labels.
export function serverName(game, region) {
  const value = String(region || '').trim();
  const labels = {
    os_usa: 'America',
    os_euro: 'Europe',
    os_asia: 'Asia',
    os_cht: 'TW / HK / MO',
    cn_gf01: 'China',
    cn_qd01: 'China (Bilibili)',
    prod_official_usa: 'America',
    prod_official_eur: 'Europe',
    prod_official_euro: 'Europe',
    prod_official_asia: 'Asia',
    prod_official_cht: 'TW / HK / MO',
    prod_gf_us: 'America',
    prod_gf_eu: 'Europe',
    prod_gf_jp: 'Asia',
    prod_gf_sg: 'TW / HK / MO',
    prod_gf_cn: 'China',
    prod_qd_cn: 'China (Bilibili)',
  };
  if (game === 'endfield') {
    const endfield = {
      2: 'Asia',
      3: 'Americas / Europe',
      asia: 'Asia',
      'america and europe': 'Americas / Europe',
      'americas and europe': 'Americas / Europe',
      'america/europe': 'Americas / Europe',
      'americas/europe': 'Americas / Europe',
      'americas / europe': 'Americas / Europe',
    };
    return endfield[value.toLowerCase()] || value;
  }
  return labels[value.toLowerCase()] || value;
}
export function gameIcon(game) {
  const img = createElement('img');
  img.src = `/assets/${game}-logo.png`;
  img.alt = '';
  img.width = 56;
  img.height = 56;
  return img;
}
// Present the commission reward beside 4/4 without changing the stored snapshot.
export function displayProgress(game, data, kind) {
  const items = data?.[kind] || [];
  if (game !== 'genshin' || kind !== 'daily') return items;
  const commissions = items.find((item) => item.label === 'Daily commissions');
  const reward = items.find((item) => item.label === 'Extra commission reward');
  if (!commissions || !reward) return items;
  return items
    .filter((item) => item !== reward)
    .map((item) =>
      item !== commissions
        ? item
        : {
            label: 'Daily commissions',
            description: 'The circle shows whether the extra commission reward has been claimed.',
            value: commissions.value,
            rewardClaimed: reward.value ? reward.value.current >= reward.value.total : null,
          },
    );
}
export function progressText(item) {
  return count(item.value);
}
// Send JSON requests to the local server and surface its error messages to the caller.
export async function requestJson(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
export function showNotice(message) {
  const node = getElement('notice');
  node.textContent = message;
  node.hidden = !message;
}
export function extractBackgroundColor(bitmap) {
  // Sample once per image. Favor colorful pixels so white space and black line art
  // don't drown out the illustration's dominant color.
  const sample = document.createElement('canvas');
  sample.width = sample.height = 64;
  const context = sample.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, 64, 64);
  const pixels = context.getImageData(0, 0, 64, 64).data;
  const buckets = Array.from({ length: 36 }, () => ({ weight: 0, r: 0, g: 0, b: 0 }));
  let neutral = 0,
    neutralWeight = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const [r, g, b, alpha] = pixels.slice(i, i + 4);
    if (alpha < 128) continue;
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b),
      chroma = max - min;
    neutral += (r + g + b) / 3;
    neutralWeight++;
    if (chroma < 24 || max < 35 || min > 225) continue;
    let hue =
      max === r ? ((g - b) / chroma) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
    hue = (hue * 60 + 360) % 360;
    const weight = (chroma / 255) ** 2 * (alpha / 255);
    const bucket = buckets[Math.floor(hue / 10) % 36];
    bucket.weight += weight;
    bucket.r += r * weight;
    bucket.g += g * weight;
    bucket.b += b * weight;
  }
  // Combine neighboring hues so small color variations count toward the same result.
  let best = null;
  for (let i = 0; i < buckets.length; i++) {
    const group = [-1, 0, 1].map((offset) => buckets[(i + offset + 36) % 36]);
    const combined = group.reduce(
      (sum, b) => ({
        weight: sum.weight + b.weight,
        r: sum.r + b.r,
        g: sum.g + b.g,
        b: sum.b + b.b,
      }),
      { weight: 0, r: 0, g: 0, b: 0 },
    );
    if (!best || combined.weight > best.weight) best = combined;
  }
  const channels =
    best.weight > 0
      ? [best.r, best.g, best.b].map((value) => Math.round(value / best.weight))
      : Array(3).fill(Math.round(neutralWeight ? neutral / neutralWeight : 100));
  return '#' + channels.map((value) => value.toString(16).padStart(2, '0')).join('');
}

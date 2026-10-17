import fs from 'node:fs/promises';
import path from 'node:path';

export const HISTORY_DAYS = 365;

export function mergeSnapshot(previous, incoming) {
  const games = {};
  for (const [game, data] of Object.entries(incoming.games || {})) {
    const saved = previous?.games?.[game];
    games[game] =
      data.error && saved && !saved.error
        ? {
            ...saved,
            stale: true,
            syncError: data.error,
            observedAt: saved.observedAt || previous.at,
          }
        : { ...data, observedAt: data.observedAt || incoming.at };
  }
  return { ...incoming, games };
}

// Keep raw observations for a fixed time window, independent of polling frequency.
// This preserves local-day grouping even when the browser's timezone changes.
export function retainHistory(rows, now = Date.now()) {
  const cutoff = now - HISTORY_DAYS * 86400000;
  return rows.filter((row) => Date.parse(row.at) >= cutoff);
}

export async function readHistory(file, now = Date.now()) {
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (
        !Number.isFinite(Date.parse(row?.at)) ||
        !row.games ||
        typeof row.games !== 'object' ||
        Array.isArray(row.games)
      )
        continue;
      rows.push(mergeSnapshot(rows.at(-1), row));
    } catch {
      /* Recover complete records after an interrupted or damaged write. */
    }
  }
  return retainHistory(rows, now);
}

export async function writeHistory(file, rows) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = file + '.tmp';
  await fs.writeFile(temporary, rows.map((row) => JSON.stringify(row) + '\n').join(''), {
    mode: 0o600,
  });
  await fs.rename(temporary, file);
}

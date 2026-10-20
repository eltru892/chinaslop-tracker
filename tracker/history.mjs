import fs from 'node:fs/promises';
import { createReadStream, constants } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export const HISTORY_DAYS = 365;
export const HISTORY_GAMES = ['genshin', 'hsr', 'zzz', 'endfield'];

export function mergeSnapshot(previous, incoming) {
  const games = {};
  for (const [game, data] of Object.entries(incoming.games || {})) {
    const saved = previous?.games?.[game];
    games[game] =
      data.error && !data.disconnected && saved && !saved.error
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

export function historyAccount(game, data) {
  const uid = String(data.identity?.uid || '').trim();
  const region = String(data.identity?.region || '').trim();
  const legacy = !uid || !region;
  const id = createHash('sha256')
    .update(JSON.stringify([game, legacy ? '' : uid, legacy ? '' : region]))
    .digest('hex');
  return {
    id,
    game,
    uid: legacy ? '' : uid,
    region: legacy ? '' : region,
    nickname: legacy ? 'Legacy history' : String(data.identity?.nickname || ''),
    legacy,
  };
}

function calendar(timeZone) {
  // Validate the browser's IANA zone once; all grouping stays independent of the host timezone.
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const wallTime = (at) => {
    const p = Object.fromEntries(
      formatter.formatToParts(new Date(at)).map(({ type, value }) => [type, value]),
    );
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  };
  const midnight = (date) => {
    let at = +date;
    for (let i = 0; i < 4; i++) {
      const adjusted = at + (+date - wallTime(at));
      if (adjusted === at) break;
      at = adjusted;
    }
    return at;
  };
  return { wallTime, midnight };
}

function periods(kind, timeZone, now) {
  const { wallTime, midnight } = calendar(timeZone);
  const day = 86400000;
  const today = new Date(wallTime(now));
  today.setUTCHours(0, 0, 0, 0);
  if (kind === 'weekly') today.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7));
  const step = kind === 'weekly' ? 7 : 1;
  const rows = [];
  for (
    let start = +today;
    start + step * day > now - (HISTORY_DAYS + 2) * day;
    start -= step * day
  ) {
    rows.push({
      date: new Date(start).toISOString().slice(0, 10),
      from: midnight(new Date(start)),
      to: midnight(new Date(start + step * day)),
    });
  }
  return rows;
}

export async function openHistoryStore(directory, { now = () => Date.now() } = {}) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'history.sqlite');
  // Create with private permissions before SQLite opens it (including on first launch).
  const handle = await fs.open(file, 'a', 0o600);
  await handle.close();
  await fs.chmod(file, 0o600);
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, game TEXT NOT NULL, uid TEXT NOT NULL, region TEXT NOT NULL,
      nickname TEXT NOT NULL, legacy INTEGER NOT NULL, last_seen INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS observations (
      id INTEGER PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
      observed_at INTEGER NOT NULL, payload TEXT NOT NULL,
      UNIQUE(account_id, observed_at)
    );
    CREATE INDEX IF NOT EXISTS observation_age ON observations(observed_at);`);
  const getMeta = db.prepare('SELECT value FROM metadata WHERE key = ?');
  const setMeta = db.prepare(
    'INSERT INTO metadata VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  const putAccount = db.prepare(`INSERT INTO accounts VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET nickname = CASE WHEN excluded.last_seen >= last_seen THEN excluded.nickname ELSE nickname END, last_seen = MAX(last_seen, excluded.last_seen)`);
  const putObservation = db.prepare(
    'INSERT OR IGNORE INTO observations(account_id, observed_at, payload) VALUES (?, ?, ?)',
  );
  const findObservation = db.prepare(
    `SELECT id, observed_at FROM observations WHERE account_id = ? AND observed_at >= ? AND observed_at < ? ORDER BY observed_at DESC LIMIT 1`,
  );
  const payload = db.prepare('SELECT payload FROM observations WHERE id = ?');
  const accountRows = db.prepare('SELECT * FROM accounts ORDER BY last_seen DESC, id');
  const pruneRows = db.prepare('DELETE FROM observations WHERE observed_at < ?');
  const metadata = (key, fallback) => {
    const row = getMeta.get(key);
    return row ? JSON.parse(row.value) : fallback;
  };
  const transaction = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      db.exec('COMMIT');
      return value;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  function insert(snapshot) {
    const active = {};
    for (const [game, data] of Object.entries(snapshot.games || {})) {
      if (
        !HISTORY_GAMES.includes(game) ||
        !data ||
        typeof data !== 'object' ||
        data.error ||
        data.disconnected
      )
        continue;
      const account = historyAccount(game, data);
      const at = Date.parse(data.observedAt || snapshot.at);
      if (!Number.isFinite(at) || at < now() - HISTORY_DAYS * 86400000) continue;
      // A stale retry is not a new observation and cannot extend retention or change its day.
      putAccount.run(
        account.id,
        game,
        account.uid,
        account.region,
        account.nickname,
        +account.legacy,
        at,
      );
      putObservation.run(
        account.id,
        at,
        JSON.stringify({
          ...data,
          stale: undefined,
          syncError: undefined,
          observedAt: new Date(at).toISOString(),
        }),
      );
      active[game] = account.id;
    }
    return active;
  }
  let lastPruned = 0;
  const store = {
    latest: () => metadata('latest', null),
    current: () => metadata('current', {}),
    accounts: () =>
      accountRows.all().map((row) => ({
        id: row.id,
        game: row.game,
        uid: row.uid,
        region: row.region,
        nickname: row.nickname,
        legacy: !!row.legacy,
        lastSeen: new Date(row.last_seen).toISOString(),
      })),
    record(snapshot) {
      return transaction(() => {
        const active = insert(snapshot);
        const current = store.current();
        for (const [game, data] of Object.entries(snapshot.games || {})) {
          if (data.disconnected) delete current[game];
          else if (active[game]) current[game] = active[game];
        }
        setMeta.run('latest', JSON.stringify(snapshot));
        setMeta.run('current', JSON.stringify(current));
        if (now() - lastPruned > 3600000) {
          pruneRows.run(now() - HISTORY_DAYS * 86400000);
          lastPruned = now();
        }
      });
    },
    clearCurrent(games, message) {
      transaction(() => {
        const latest = store.latest() || { at: new Date(now()).toISOString(), games: {} };
        const current = store.current();
        for (const game of games) {
          delete current[game];
          latest.games[game] = { error: message, disconnected: true };
        }
        setMeta.run('current', JSON.stringify(current));
        setMeta.run('latest', JSON.stringify(latest));
      });
    },
    page({ kind = 'daily', page = 0, size = 10, timeZone = 'UTC', accounts = {} } = {}) {
      if (!['daily', 'weekly'].includes(kind)) throw new Error('Invalid history period');
      if (!(size === 'all' || [1, 3, 5, 10, 25].includes(Number(size))))
        throw new Error('Invalid history page size');
      if (!Number.isInteger(Number(page)) || Number(page) < 0)
        throw new Error('Invalid history page');
      const current = store.current();
      const available = store.accounts();
      const selected = HISTORY_GAMES.flatMap((game) => {
        const id = accounts[game] ?? current[game];
        if (!id) return [];
        if (!available.some((account) => account.id === id && account.game === game))
          throw new Error('Unknown history account');
        return [{ game, id }];
      });
      const cutoff = now() - HISTORY_DAYS * 86400000;
      // At most 367/54 indexed probes per selected account; JSON is loaded only for this page.
      const populated = [];
      for (const period of periods(kind, timeZone, now())) {
        const matches = selected.flatMap(({ game, id }) => {
          const observation = findObservation.get(id, Math.max(cutoff, period.from), period.to);
          return observation ? [{ game, ...observation }] : [];
        });
        if (matches.length) populated.push({ date: period.date, matches });
      }
      const pageSize = size === 'all' ? Math.max(populated.length, 1) : Number(size);
      const pages = Math.max(1, Math.ceil(populated.length / pageSize));
      const index = Math.min(Number(page), pages - 1);
      const rows = populated
        .slice(index * pageSize, (index + 1) * pageSize)
        .map(({ date, matches }) => ({
          date,
          snapshot: {
            at: new Date(Math.max(...matches.map((item) => item.observed_at))).toISOString(),
            games: Object.fromEntries(
              matches.map(({ game, id }) => [game, JSON.parse(payload.get(id).payload)]),
            ),
          },
        }));
      return { rows, total: populated.length, page: index, pageSize, pages };
    },
    close: () => db.close(),
  };
  try {
    if (!metadata('jsonl-migrated', false)) {
      const legacy = path.join(directory, 'snapshots.jsonl');
      try {
        await fs.access(legacy);
        try {
          await fs.copyFile(legacy, legacy + '.pre-sqlite.bak', constants.COPYFILE_EXCL);
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
        }
        await fs.chmod(legacy + '.pre-sqlite.bak', 0o600);
        const lines = createInterface({ input: createReadStream(legacy), crlfDelay: Infinity });
        let last = null;
        let batch = [];
        const flush = () => {
          transaction(() => {
            for (const snapshot of batch) insert(snapshot);
          });
          batch = [];
        };
        for await (const line of lines) {
          let row;
          try {
            row = JSON.parse(line);
          } catch {
            continue;
          }
          if (
            !Number.isFinite(Date.parse(row?.at)) ||
            !row.games ||
            typeof row.games !== 'object' ||
            Array.isArray(row.games)
          )
            continue;
          // Preserve account identity per record; never infer an identity from another row.
          last = mergeSnapshot(last, row);
          batch.push(row);
          if (batch.length >= 500) flush();
        }
        flush();
        transaction(() => {
          if (last && !store.latest()) {
            setMeta.run('latest', JSON.stringify(last));
            setMeta.run('current', JSON.stringify(insert(last)));
          }
          setMeta.run('jsonl-migrated', 'true');
        });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        setMeta.run('jsonl-migrated', 'true');
      }
    }
    pruneRows.run(now() - HISTORY_DAYS * 86400000);
    return store;
  } catch (error) {
    db.close();
    throw error;
  }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { openHistoryStore, mergeSnapshot, historyAccount, HISTORY_DAYS } from './history.mjs';

const now = Date.now();
const progress = (uid = '111', region = 'os_usa', current = 4) => ({
  identity: { uid, region, nickname: `Account ${uid}` },
  daily: [{ label: 'Daily Commissions', value: { current, total: 4 } }],
  weekly: [{ label: 'Weekly Bosses', value: { current, total: 3 } }],
});
const row = (at, games = {}) => ({ at: new Date(at).toISOString(), games });
async function storage(t, clock = () => now) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tracker-sqlite-'));
  const directory = path.join(root, 'data');
  const store = await openHistoryStore(directory, { now: clock });
  t.after(() => {
    store.close();
    return fs.rm(root, { recursive: true, force: true });
  });
  return { store, root, directory };
}

test('SQLite isolates accounts, games and servers and restores previous-account history after reconnecting', async (t) => {
  const { store } = await storage(t);
  store.record(row(now - 2000, { genshin: progress('A') }));
  const first = store.current().genshin;
  store.record(row(now - 1000, { genshin: progress('B', 'os_asia', 1), hsr: progress('A') }));
  const second = store.current().genshin;
  assert.notEqual(first, second);
  assert.equal(
    store.page({ accounts: { genshin: first, hsr: '' } }).rows[0].snapshot.games.genshin.identity
      .uid,
    'A',
  );
  assert.equal(
    store.page({ accounts: { genshin: second, hsr: '' } }).rows[0].snapshot.games.genshin.daily[0]
      .value.current,
    1,
  );
  store.clearCurrent(['genshin'], 'Connect HoYoLAB in Settings');
  assert.equal(store.current().genshin, undefined);
  assert.equal(store.latest().games.genshin.disconnected, true);
  assert.equal(store.accounts().length, 3);
  assert.equal(store.page({ accounts: { genshin: first, hsr: '' } }).total, 1);
  store.record(row(now, { genshin: progress('A') }));
  assert.equal(store.current().genshin, first);
  assert.equal(store.accounts().length, 3);
  assert.notEqual(historyAccount('genshin', progress('A', 'os_asia')).id, first);
  assert.throws(
    () => store.page({ accounts: { genshin: store.current().hsr } }),
    /Unknown history account/,
  );
});

test('migration backs up damaged JSONL unchanged, streams complete records, isolates legacy and is idempotent', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tracker-migration-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const original =
    [
      row(now - 2000, { genshin: progress('A') }),
      row(now - 1000, { genshin: { daily: [] } }),
      row(now, { genshin: progress('B') }),
    ]
      .map(JSON.stringify)
      .join('\n') + '\nbroken\nnull\n{"at":';
  const legacy = path.join(root, 'snapshots.jsonl');
  await fs.writeFile(legacy, original);
  let store = await openHistoryStore(root);
  assert.equal(store.accounts().length, 3);
  const account = store.accounts().find((item) => item.legacy);
  assert.equal(account.nickname, 'Legacy history');
  assert.equal(account.uid, '');
  assert.equal(store.page({ accounts: { genshin: account.id } }).total, 1);
  assert.equal(await fs.readFile(legacy + '.pre-sqlite.bak', 'utf8'), original);
  assert.equal(await fs.readFile(legacy, 'utf8'), original);
  store.record(row(now + 100, { genshin: progress('C') }));
  store.close();
  store = await openHistoryStore(root);
  assert.equal(store.accounts().length, 4);
  assert.equal(store.latest().games.genshin.identity.uid, 'C');
  assert.equal(
    (await fs.readFile(path.join(root, 'history.sqlite'))).subarray(0, 16).toString(),
    'SQLite format 3\u0000',
  );
  store.close();
});

test('stale errors keep original observation date; disconnects do not carry progress forward', async (t) => {
  const { store } = await storage(t);
  const good = row(now - 86400000, { genshin: progress() });
  store.record(good);
  const failed = mergeSnapshot(good, row(now, { genshin: { error: 'Offline' } }));
  assert.equal(failed.games.genshin.observedAt, good.at);
  store.record(failed);
  const again = mergeSnapshot(failed, row(now + 100, { genshin: { error: 'Expired session' } }));
  assert.equal(again.games.genshin.observedAt, good.at);
  store.record(again);
  assert.equal(store.page().total, 1);
  assert.equal(store.page().rows[0].snapshot.games.genshin.stale, undefined);
  const disconnected = mergeSnapshot(
    again,
    row(now + 200, { genshin: { error: 'Connect HoYoLAB', disconnected: true } }),
  );
  assert.equal(disconnected.games.genshin.daily, undefined);
  store.record(disconnected);
  assert.equal(store.current().genshin, undefined);
});

test('history paginates grouped days and weeks in the browser timezone, returning latest per-game observations', async (t) => {
  const clock = () => Date.parse('2026-10-19T12:00:00Z');
  const { store } = await storage(t, clock);
  store.record(
    row('2026-10-18T23:00:00Z', { genshin: progress('A', 'os_asia', 1), hsr: progress('H') }),
  );
  store.record(row('2026-10-19T01:00:00Z', { genshin: progress('A', 'os_asia', 2) }));
  const tokyo = store.page({ timeZone: 'Asia/Tokyo', size: 1 });
  assert.equal(tokyo.total, 1);
  assert.equal(tokyo.rows[0].date, '2026-10-19');
  assert.equal(tokyo.rows[0].snapshot.games.genshin.daily[0].value.current, 2);
  assert.equal(tokyo.rows[0].snapshot.games.hsr.identity.uid, 'H');
  assert.equal(store.page({ timeZone: 'UTC' }).total, 2);
  assert.equal(store.page({ timeZone: 'UTC', size: 1, page: 1 }).rows[0].date, '2026-10-18');
  assert.equal(store.page({ timeZone: 'UTC', size: 1, page: 999 }).page, 1);
  assert.equal(store.page({ kind: 'weekly', timeZone: 'UTC' }).total, 2);
  assert.equal(store.page({ kind: 'weekly', timeZone: 'Asia/Tokyo' }).rows[0].date, '2026-10-19');
  assert.throws(() => store.page({ timeZone: 'not/a-zone' }), /time zone/i);
  assert.throws(() => store.page({ kind: 'bad' }), /Invalid/);
  assert.throws(() => store.page({ size: -1 }), /Invalid/);
  assert.throws(() => store.page({ page: -1 }), /Invalid/);
});

test('daily grouping covers DST short and long days without skipping or duplicating observations', async (t) => {
  const { store } = await storage(t, () => Date.parse('2026-11-03T12:00:00Z'));
  for (const at of [
    '2026-03-08T09:30:00Z',
    '2026-03-09T06:30:00Z',
    '2026-11-01T07:30:00Z',
    '2026-11-02T07:30:00Z',
  ])
    store.record(row(at, { genshin: progress() }));
  const page = store.page({ timeZone: 'America/Los_Angeles' });
  assert.deepEqual(
    page.rows.map((item) => item.date),
    ['2026-11-01', '2026-03-08'],
  );
});

test('retention bounds raw history to 365 days without rewriting the legacy archive or losing account names', async (t) => {
  let clock = now;
  const { store } = await storage(t, () => clock);
  store.record(row(now, { genshin: progress('A') }));
  const first = store.current().genshin;
  clock += (HISTORY_DAYS + 1) * 86400000;
  store.record(row(clock, { genshin: progress('B') }));
  assert.equal(store.page({ accounts: { genshin: first } }).total, 0);
  assert.equal(store.accounts().length, 2);
});

test('real server migrates history and serves bounded history/account endpoints', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tracker-history-api-'));
  await fs.mkdir(path.join(root, 'data'));
  const jsonl = JSON.stringify(row(now, { genshin: progress('A') })) + '\n{"at":';
  await fs.writeFile(path.join(root, 'data/snapshots.jsonl'), jsonl);
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    env: { ...process.env, PORT: '0', TRACKER_DATA_DIR: root },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await once(child, 'exit');
    }
    await fs.rm(root, { recursive: true, force: true });
  });
  const ready = await Promise.race([
    once(child, 'message').then(([message]) => message),
    once(child, 'exit').then(() => {
      throw new Error('Server exited before ready');
    }),
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('Startup timed out')), 5000);
      timer.unref();
    }),
  ]);
  const origin = `http://127.0.0.1:${ready.port}`;
  const accounts = await (await fetch(origin + '/api/history/accounts')).json();
  assert.equal(accounts.accounts[0].uid, 'A');
  const result = await (
    await fetch(origin + `/api/history?size=1&genshin=${accounts.accounts[0].id}`)
  ).json();
  assert.equal(result.total, 1);
  assert.equal(result.rows.length, 1);
  assert.equal((await fetch(origin + '/api/history?kind=invalid')).status, 400);
  assert.equal((await fetch(origin + '/data/history.sqlite')).status, 404);
  assert.equal(await fs.readFile(path.join(root, 'data/snapshots.jsonl'), 'utf8'), jsonl);
});

test('weekly keys use local Mondays in positive and negative offsets, DST and year boundaries', () => {
  for (const timezone of ['Asia/Tokyo', 'Pacific/Auckland', 'America/Anchorage', 'UTC']) {
    const script = `import { weekKey } from ${JSON.stringify(new URL('./history-dates.mjs', import.meta.url).href)}; console.log(JSON.stringify(['2026-10-12T00:00:00','2026-10-18T23:59:59','2027-01-01T12:00:00','2026-03-08T12:00:00'].map(value=>weekKey(new Date(value)))));`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TZ: timezone },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [
      '2026-10-12',
      '2026-10-12',
      '2026-12-28',
      '2026-03-02',
    ]);
  }
});

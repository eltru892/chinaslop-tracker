import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { readHistory, writeHistory, mergeSnapshot, HISTORY_DAYS } from './history.mjs';

const now = Date.now();
const row = (at, games = {}) => ({ at: new Date(at).toISOString(), games });
async function storage(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tracker-history-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return path.join(root, 'data', 'snapshots.jsonl');
}

test('damaged records are recovered and the real server starts with a truncated final write', async (t) => {
  const file = await storage(t);
  await writeHistory(file, [row(now)]);
  await fs.appendFile(file, 'broken\nnull\n{"at":');
  assert.deepEqual(await readHistory(file), [row(now)]);
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    env: { ...process.env, PORT: '0', TRACKER_DATA_DIR: path.dirname(path.dirname(file)) },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await once(child, 'exit');
    }
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
  assert.equal(ready.type, 'ready');
  assert.deepEqual((await fs.readFile(file, 'utf8')).trim().split('\n').map(JSON.parse), [
    row(now),
  ]);
});

test('failed refresh retains per-game progress and original timestamp across repeated failures and restarts', async (t) => {
  const file = await storage(t);
  const progress = { daily: [{ label: 'Daily', value: { current: 4, total: 4 } }] };
  const good = row(now - 3000, { genshin: progress, hsr: progress });
  const failed = mergeSnapshot(
    good,
    row(now - 2000, { genshin: { error: 'Offline' }, hsr: { daily: [] } }),
  );
  assert.deepEqual(failed.games.genshin.daily, progress.daily);
  assert.equal(failed.games.genshin.observedAt, good.at);
  assert.equal(failed.games.genshin.stale, true);
  assert.deepEqual(failed.games.hsr.daily, []);
  const repeated = mergeSnapshot(
    failed,
    row(now - 1000, { genshin: { error: 'Expired session' } }),
  );
  assert.equal(repeated.games.genshin.observedAt, good.at);
  await writeHistory(file, [good, failed, repeated]);
  const restored = (await readHistory(file)).at(-1);
  assert.equal(restored.games.genshin.observedAt, good.at);
  assert.equal(restored.games.genshin.syncError, 'Expired session');
  const recovered = mergeSnapshot(restored, row(now, { genshin: progress }));
  assert.equal(recovered.games.genshin.stale, undefined);
  assert.equal(recovered.games.genshin.syncError, undefined);
  assert.equal(recovered.games.genshin.observedAt, recovered.at);
  assert.equal(
    mergeSnapshot(null, row(now, { genshin: { error: 'Offline' } })).games.genshin.error,
    'Offline',
  );
});

test('retention keeps more than 3000 observations and removes expired records from disk', async (t) => {
  const file = await storage(t);
  const recent = Array.from({ length: 4000 }, (_, i) => row(now - (4000 - i) * 60000));
  const olderDay = row(now - 100 * 86400000);
  await writeHistory(file, [row(now - (HISTORY_DAYS + 1) * 86400000), olderDay, ...recent]);
  const retained = await readHistory(file, now);
  assert.equal(retained.length, 4001);
  assert.equal(retained[0].at, olderDay.at);
  await writeHistory(file, retained);
  assert.equal((await fs.readFile(file, 'utf8')).trim().split('\n').length, 4001);
});

test('weekly keys use local Mondays in positive and negative offsets, DST and year boundaries', () => {
  for (const timezone of ['Asia/Tokyo', 'Pacific/Auckland', 'America/Anchorage', 'UTC']) {
    const script = `import { weekKey } from ${JSON.stringify(new URL('./history-dates.mjs', import.meta.url).href)};
      console.log(JSON.stringify(['2026-10-12T00:00:00','2026-10-18T23:59:59','2027-01-01T12:00:00','2026-03-08T12:00:00'].map(value=>weekKey(new Date(value)))));`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TZ: timezone },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      JSON.parse(result.stdout),
      ['2026-10-12', '2026-10-12', '2026-12-28', '2026-03-02'],
      timezone,
    );
  }
});

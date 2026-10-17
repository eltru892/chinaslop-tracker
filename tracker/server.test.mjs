import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { encryptSecrets, decryptSecrets } from './secrets.mjs';

test('saved ID stays encrypted and is never returned by the settings API', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tracker-settings-'));
  const password = 'example-test-password';
  for (const file of [
    'server.mjs',
    'history.mjs',
    'history-dates.mjs',
    'auto-check-in.mjs',
    'check-in.mjs',
    'secrets.mjs',
    'hoyolab-settings.mjs',
    'resource-time.mjs',
    'events.mjs',
    'official-art.mjs',
    'event-images.mjs',
  ]) {
    await fs.copyFile(new URL(file, import.meta.url), path.join(root, file));
  }
  // No real network requests or account credentials are used in this test.
  await fs.writeFile(
    path.join(root, 'collector.mjs'),
    'export function hoyoHeaders(){return {}};export function skportHeaders(){return {}};export async function getSkportContext(){throw new Error("Test network disabled")};export async function collect(){ return {at:new Date().toISOString(),games:{}}; }',
  );
  await fs.writeFile(
    path.join(root, 'config.local.json'),
    JSON.stringify({ hoyolabUid: '123456789', pollMinutes: 30 }),
  );
  await fs.writeFile(
    path.join(root, 'secrets.enc.json'),
    JSON.stringify(
      encryptSecrets(
        { hoyolabCookie: 'ltoken_v2=example; ltuid_v2=123456789', skportToken: '' },
        password,
      ),
    ),
  );
  const child = spawn(process.execPath, [path.join(root, 'server.mjs')], {
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await once(child, 'exit');
    }
    await fs.rm(root, { recursive: true, force: true });
  });
  const address = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Test server did not start')), 5000);
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(output);
      if (match) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', () => {
      clearTimeout(timeout);
      reject(new Error('Test server exited early'));
    });
  });
  const api = async (route, body) => {
    const response = await fetch(
      address + route,
      body
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        : {},
    );
    assert.equal(response.status, 200);
    return response.json();
  };
  const locked = await api('/api/state');
  assert.equal((await fetch(address + '/api/check-in', { method: 'POST' })).status, 423);
  assert.equal(
    (
      await fetch(address + '/api/check-in', {
        method: 'POST',
        headers: { Origin: 'https://example.com' },
      })
    ).status,
    403,
  );
  const moduleResponse = await fetch(address + '/resource-time.mjs');
  assert.equal(moduleResponse.status, 200);
  assert.match(moduleResponse.headers.get('content-type'), /^text\/javascript/);
  assert.equal(locked.autoCheckIn.enabled, false);
  assert.equal(locked.autoCheckIn.nextAt, null);
  assert.equal(locked.nextRefreshAt, null);
  assert.equal(locked.configured.hoyolabUid, undefined);
  assert.equal(JSON.stringify(locked).includes('123456789'), false);
  await api('/api/unlock', { passphrase: password });
  const unlocked = await api('/api/state');
  assert.ok(Math.abs(unlocked.nextRefreshAt - unlocked.serverTime - 30 * 60_000) < 2000);
  const initialDeadline = unlocked.nextRefreshAt;
  const beforeManualRefresh = Date.now();
  await api('/api/sync', {});
  const reset = await api('/api/state');
  assert.ok(reset.nextRefreshAt > initialDeadline);
  assert.ok(reset.nextRefreshAt >= beforeManualRefresh + 30 * 60_000);
  assert.ok(Math.abs(reset.nextRefreshAt - reset.serverTime - 30 * 60_000) < 2000);
  assert.equal(unlocked.configured.hoyolabUidSaved, true);
  assert.equal(JSON.stringify(unlocked).includes('123456789'), false);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(root, 'config.local.json'), 'utf8')).hoyolabUid,
    undefined,
  );
  await api('/api/settings', { hoyolabToken: 'replacement', hoyolabUid: '', pollMinutes: 60 });
  const envelope = JSON.parse(await fs.readFile(path.join(root, 'secrets.enc.json'), 'utf8'));
  assert.equal(JSON.stringify(envelope).includes('123456789'), false);
  const saved = decryptSecrets(envelope, password);
  assert.equal(saved.hoyolabUid, '123456789');
  assert.equal(saved.hoyolabCookie, 'ltoken_v2=replacement; ltuid_v2=123456789');
  for (const minutes of [5, 480, 17, 1440]) {
    await api('/api/settings', { pollMinutes: String(minutes), hoyolabToken: '', hoyolabUid: '' });
    const scheduled = await api('/api/state');
    assert.equal(scheduled.configured.pollMinutes, minutes);
    assert.ok(Math.abs(scheduled.nextRefreshAt - scheduled.serverTime - minutes * 60_000) < 2000);
    assert.equal(
      JSON.parse(await fs.readFile(path.join(root, 'config.local.json'), 'utf8')).pollMinutes,
      minutes,
    );
  }
  for (const minutes of [0, 1.5, 1441, 'custom']) {
    const invalid = await fetch(address + '/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pollMinutes: minutes }),
    });
    assert.equal(invalid.status, 400);
  }
  assert.equal((await api('/api/state')).configured.pollMinutes, 1440);
  const originalEnvelope = await fs.readFile(path.join(root, 'secrets.enc.json'), 'utf8');
  for (const [payload, status] of [
    [{ currentPassword: 'wrong', newPassword: 'x', confirmPassword: 'x' }, 403],
    [{ currentPassword: password, newPassword: 'x', confirmPassword: 'y' }, 400],
    [{ currentPassword: password, newPassword: '', confirmPassword: '' }, 400],
  ]) {
    const response = await fetch(address + '/api/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(response.status, status);
    assert.equal(await fs.readFile(path.join(root, 'secrets.enc.json'), 'utf8'), originalEnvelope);
  }
  await api('/api/password', { currentPassword: password, newPassword: 'x', confirmPassword: 'x' });
  const changed = JSON.parse(await fs.readFile(path.join(root, 'secrets.enc.json'), 'utf8'));
  assert.deepEqual(
    decryptSecrets(changed, 'x'),
    decryptSecrets(JSON.parse(originalEnvelope), password),
  );
  assert.throws(() => decryptSecrets(changed, password));
  // Future settings saves must also use the new password.
  await api('/api/settings', { pollMinutes: 30 });
  decryptSecrets(JSON.parse(await fs.readFile(path.join(root, 'secrets.enc.json'), 'utf8')), 'x');
  await api('/api/settings', { removeHoyo: true });
  assert.equal((await api('/api/state')).nextRefreshAt, null);
  await api('/api/settings', { autoCheckIn: true });
  const automatic = await api('/api/state');
  assert.equal(automatic.autoCheckIn.enabled, true);
  assert.equal(automatic.autoCheckIn.nextAt, null); // No credentials: no claims.
  assert.equal(
    JSON.parse(await fs.readFile(path.join(root, 'config.local.json'), 'utf8')).autoCheckIn,
    true,
  );
  await api('/api/settings', { pollMinutes: 60 });
  assert.equal((await api('/api/state')).autoCheckIn.enabled, true);
  const invalidAuto = await fetch(address + '/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ autoCheckIn: 'yes' }),
  });
  assert.equal(invalidAuto.status, 400);
  await api('/api/settings', { autoCheckIn: false });
  assert.equal((await api('/api/state')).autoCheckIn.enabled, false);
});

test('packaged runtime separates private storage and requires its app session', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tracker-app-'));
  const storage = path.join(root, 'private');
  for (const file of [
    'server.mjs',
    'history.mjs',
    'history-dates.mjs',
    'auto-check-in.mjs',
    'check-in.mjs',
    'secrets.mjs',
    'hoyolab-settings.mjs',
    'resource-time.mjs',
    'events.mjs',
    'official-art.mjs',
    'event-images.mjs',
  ])
    await fs.copyFile(new URL(file, import.meta.url), path.join(root, file));
  await fs.writeFile(path.join(root, 'index.html'), '<title>Test tracker</title>');
  await fs.writeFile(
    path.join(root, 'collector.mjs'),
    'export function hoyoHeaders(){return {}};export function skportHeaders(){return {}};export async function getSkportContext(){throw new Error("Disabled")};export async function collect(){return {games:{}}}',
  );
  const child = spawn(process.execPath, [path.join(root, 'server.mjs')], {
    env: {
      ...process.env,
      PORT: '0',
      TRACKER_DATA_DIR: storage,
      TRACKER_ACCESS_KEY: 'fake-test-session',
    },
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
    once(child, 'message').then(([value]) => value),
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('No packaged server ready message')), 5000);
      timer.unref();
    }),
  ]);
  const address = `http://127.0.0.1:${ready.port}`;
  assert.equal((await fetch(address + '/api/state')).status, 403);
  assert.equal((await fetch(address + '/')).status, 403);
  assert.equal(
    (await fetch(address + '/api/health', { headers: { 'X-Tracker-Key': 'wrong' } })).status,
    403,
  );
  assert.equal(
    (await fetch(address + '/api/health', { headers: { 'X-Tracker-Key': 'fake-test-session' } }))
      .status,
    200,
  );
  const response = await fetch(address + '/api/unlock', {
    method: 'POST',
    headers: {
      Origin: address,
      Cookie: 'tracker_session=fake-test-session',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ passphrase: 'test' }),
  });
  assert.equal(response.status, 200);
  assert.ok(JSON.parse(await fs.readFile(path.join(storage, 'secrets.enc.json'), 'utf8')).data);
  await assert.rejects(fs.stat(path.join(root, 'secrets.enc.json')), { code: 'ENOENT' });
  const state = await (
    await fetch(address + '/api/state', {
      headers: { Cookie: 'tracker_session=fake-test-session' },
    })
  ).json();
  assert.equal(state.security.locked, false);
  assert.equal(JSON.stringify(state).includes('fake-test-session'), false);
});

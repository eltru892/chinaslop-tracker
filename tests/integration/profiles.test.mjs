import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { encryptSecrets, decryptSecrets } from '../../tracker/secrets.mjs';

test('profiles migrate, switch, persist, isolate history, reject stale edits, and survive password changes', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tracker-profiles-'));
  let child;
  let origin;
  for (const name of await fs.readdir(new URL('../../tracker/', import.meta.url))) {
    if (name.endsWith('.mjs'))
      await fs.copyFile(new URL('../../tracker/' + name, import.meta.url), path.join(root, name));
  }
  // Only synthetic accounts and local files are used; no provider requests.
  await fs.writeFile(
    path.join(root, 'collector.mjs'),
    `
    export function hoyoHeaders(){return {}};
    export function skportHeaders(){return {}};
    export async function getSkportContext(){throw new Error('Network disabled')};
    export async function collect(config){
      const uid=config.hoyolabUid || '111';
      return {at:new Date().toISOString(),games:{genshin:config.hoyolabCookie ?
        {identity:{uid,region:'os_usa',nickname:uid},daily:[{label:'Daily',value:{current:4,total:4}}]} : {error:'Disconnected'},endfield:config.skportToken ? {identity:{uid:'endfield-test',region:'2',nickname:'EndfieldPlayer'}} : {error:'Disconnected'}}};
    }
  `,
  );
  const secretFile = path.join(root, 'secrets.enc.json');
  await fs.writeFile(
    secretFile,
    JSON.stringify(
      encryptSecrets(
        { hoyolabCookie: 'ltoken_v2=FAKE-A; ltuid_v2=111', hoyolabUid: '111', skportToken: '' },
        'old',
      ),
    ),
  );
  async function stop() {
    if (child && child.exitCode === null) {
      child.kill();
      await once(child, 'exit');
    }
  }
  t.after(async () => {
    await stop();
    await fs.rm(root, { recursive: true, force: true });
  });
  async function start() {
    child = spawn(process.execPath, [path.join(root, 'server.mjs')], {
      env: {
        ...process.env,
        TRACKER_DISABLE_AUTO_UNLOCK: '1',
        PORT: '0',
        TRACKER_DATA_DIR: root,
        TRACKER_ACCESS_KEY: '',
      },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    const [ready] = await once(child, 'message', { signal: AbortSignal.timeout(5000) });
    origin = `http://127.0.0.1:${ready.port}`;
  }
  async function api(route, body, status = 200) {
    const response = await fetch(
      origin + route,
      body === undefined
        ? {}
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
    );
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    return result;
  }
  async function settled(uid) {
    for (let i = 0; i < 100; i++) {
      const state = await api('/api/state');
      if (!state.syncing && (!uid || state.latest?.games.genshin.identity?.uid === uid))
        return state;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Sync did not settle');
  }
  await start();
  assert.equal((await api('/api/state')).profiles, null);
  await api('/api/profiles', { action: 'create', name: 'Blocked' }, 423);
  await api('/api/unlock', { passphrase: 'old' });
  let state = await settled('111');
  const first = state.profiles.activeId;
  assert.equal(state.profiles.items[0].name, '111');
  const firstHistory = (await api('/api/history/accounts')).current.genshin;
  await api('/api/profiles', { action: 'create', expectedActiveId: first });
  state = await settled();
  const second = state.profiles.activeId;
  assert.notEqual(second, first);
  assert.equal(state.profiles.items.find((p) => p.id === second).name, 'Account 1');
  assert.equal(state.configured.hoyolab, false);
  assert.equal(state.latest.games.genshin.identity, undefined);
  await api('/api/settings', { profileId: first, hoyolabToken: 'STALE' }, 409);
  await api('/api/settings', { profileId: second, hoyolabUid: '222', hoyolabToken: 'FAKE-B' });
  await settled('222');
  await api('/api/profiles', { action: 'switch', id: first, expectedActiveId: second });
  state = await settled('111');
  assert.equal(state.profiles.activeId, first);
  assert.equal((await api('/api/history/accounts')).current.genshin, firstHistory);
  assert.equal((await api('/api/history/accounts')).accounts.length, 2);
  await api('/api/profiles', { action: 'switch', id: first, expectedActiveId: second }, 409);
  await api('/api/profiles', { action: 'switch', id: 'missing', expectedActiveId: first }, 400);
  await api('/api/profiles', { action: 'invalid', expectedActiveId: first }, 400);
  // Concurrent password/settings writes must both succeed and keep the latest password.
  await Promise.all([
    api('/api/password', { currentPassword: 'old', newPassword: 'new', confirmPassword: 'new' }),
    api('/api/settings', { profileId: first, pollMinutes: 17 }),
  ]);
  let envelope = JSON.parse(await fs.readFile(secretFile, 'utf8'));
  assert.throws(() => decryptSecrets(envelope, 'old'));
  const vault = decryptSecrets(envelope, 'new');
  assert.equal(vault.profiles.length, 2);
  assert.match(vault.profiles.find((p) => p.id === second).hoyolabCookie, /FAKE-B/);
  assert.equal(JSON.stringify(state.profiles).includes('FAKE-'), false);
  assert.equal(JSON.stringify(envelope).includes('Alternate'), false);
  await stop();
  await start();
  assert.equal((await api('/api/state')).profiles, null);
  await api('/api/unlock', { passphrase: 'new' });
  assert.equal((await settled('111')).profiles.activeId, first);
  await api('/api/profiles', { action: 'switch', id: second, expectedActiveId: first });
  await settled('222');
  assert.equal((await api('/api/state')).profiles.items.find((p) => p.id === second).name, '222');
  await api('/api/profiles', { action: 'delete', expectedActiveId: second });
  await settled('111');
  assert.equal((await api('/api/history/accounts')).accounts.length, 2);
  envelope = JSON.parse(await fs.readFile(secretFile, 'utf8'));
  assert.equal(decryptSecrets(envelope, 'new').profiles.length, 1);
  await api('/api/profiles', { action: 'delete', expectedActiveId: first }, 400);
  await api('/api/settings', { profileId: first, removeHoyo: true, skportToken: 'FAKE-ENDFIELD' });
  state = await settled();
  assert.equal(state.profiles.items[0].name, 'EndfieldPlayer');
  await api('/api/settings', { profileId: first, removeSkport: true });
  state = await settled();
  assert.equal(state.profiles.items[0].name, 'EndfieldPlayer'); // Failed/missing identities never erase a saved nickname.
});

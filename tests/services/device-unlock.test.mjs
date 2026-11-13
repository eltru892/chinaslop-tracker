import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createDeviceUnlock } from '../../tracker/device-unlock.mjs';

// No test below accesses the real OS credential store.
test('Keychain passwords travel only over stdin and installations stay isolated', async () => {
  const items = new Map();
  const calls = [];
  const execute = async (file, args, input) => {
    calls.push({ file, args, input });
    if (args[0] === '-i') {
      const account = /-a (\w+)/.exec(input)[1];
      items.set(account, /-w (\S+)/.exec(input)[1]);
      return { code: 0, output: '' };
    }
    const value = items.get(args[args.indexOf('-a') + 1]);
    return { code: value ? 0 : 44, output: value ? value + '\n' : '' };
  };
  const options = { platform: 'darwin', execute, disabled: false };
  const device = createDeviceUnlock('/tmp/example-a', options);
  const secret = 'fake password "quoted"\n雪';
  assert.equal(await device.read(), null);
  await device.write(secret);
  assert.equal(await device.read(), secret);
  assert.equal(await createDeviceUnlock('/tmp/example-b', options).read(), null);
  assert.ok(calls.every((call) => !JSON.stringify(call.args).includes(secret)));
  assert.deepEqual(calls.find((call) => call.input).args, ['-i']);
  assert.equal(
    calls
      .find((call) => call.input)
      .input.trim()
      .split('\n').length,
    1,
  );
});

test('Keychain write verification rejects silent failures without exposing passwords', async () => {
  const device = createDeviceUnlock('/tmp/example', {
    platform: 'darwin',
    disabled: false,
    execute: async (_file, args) => ({ code: args[0] === '-i' ? 0 : 44, output: '' }),
  });
  await assert.rejects(device.write('fake-sensitive-password'), /secure device storage/);
  const unavailable = createDeviceUnlock('/tmp/example', {
    platform: 'linux',
    disabled: false,
    execute: () => {
      throw new Error('must not run');
    },
  });
  assert.equal(unavailable.supported, false);
  assert.equal(await unavailable.read(), null);
});

test('Windows stores only OS-protected output and uses CurrentUser scope', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tracker-dpapi-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const calls = [];
  let remembered;
  const device = createDeviceUnlock(root, {
    platform: 'win32',
    disabled: false,
    execute: async (_file, args, input) => {
      const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
      calls.push({ script, input });
      if (script.includes('::Protect(')) {
        remembered = input;
        return { code: 0, output: 'b3MtcHJvdGVjdGVk' };
      }
      assert.equal(input, 'b3MtcHJvdGVjdGVk');
      return { code: 0, output: remembered };
    },
  });
  assert.equal(await device.read(), null);
  await device.write('fake-windows-password');
  assert.equal(
    await fs.readFile(path.join(root, 'device-unlock.dpapi'), 'utf8'),
    'b3MtcHJvdGVjdGVk',
  );
  assert.equal(await device.read(), 'fake-windows-password');
  assert.ok(calls.every((call) => call.script.includes('DataProtectionScope]::CurrentUser')));
  assert.ok(calls.every((call) => !call.script.includes('fake-windows-password')));
});

test('server remembers after unlock, restarts unlocked, updates passwords, and recovers from stale storage', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tracker-auto-unlock-test-'));
  let child;
  let origin;
  for (const name of await fs.readdir(new URL('../../tracker/', import.meta.url))) {
    if (name.endsWith('.mjs'))
      await fs.copyFile(new URL('../../tracker/' + name, import.meta.url), path.join(root, name));
  }
  // Test-only fake store: only synthetic passwords, in a disposable directory.
  await fs.writeFile(
    path.join(root, 'device-unlock.mjs'),
    `
    import fs from 'node:fs/promises';
    import path from 'node:path';
    export function createDeviceUnlock(root) { const file=path.join(root,'fake-device-store');return {
      supported:true,provider:'Test secure store',
      read:async()=>fs.readFile(file,'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e;}),
      write:async(password)=>{if(await fs.stat(path.join(root,'fail-store')).catch(()=>false))throw Error('Unavailable');await fs.writeFile(file,password);}
    };}
  `,
  );
  async function stop() {
    if (child?.exitCode === null) {
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
        PORT: '0',
        TRACKER_DATA_DIR: root,
        TRACKER_ACCESS_KEY: '',
        TRACKER_DISABLE_AUTO_UNLOCK: '1',
      },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    const [ready] = await once(child, 'message', { signal: AbortSignal.timeout(5000) });
    origin = `http://127.0.0.1:${ready.port}`;
  }
  async function api(route, body) {
    const response = await fetch(
      origin + route,
      body
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        : {},
    );
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    return data;
  }
  async function settled() {
    for (let i = 0; i < 100; i++) {
      const state = await api('/api/state');
      if (!state.security.automaticUnlock.pending) return state;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw Error('Startup never settled');
  }
  await start();
  assert.equal((await settled()).security.locked, true);
  await api('/api/unlock', { passphrase: 'fake-first' });
  assert.equal((await settled()).security.automaticUnlock.remembered, true);
  await stop();
  await start();
  assert.equal((await settled()).security.locked, false);
  await api('/api/password', {
    currentPassword: 'fake-first',
    newPassword: 'fake-second',
    confirmPassword: 'fake-second',
  });
  await stop();
  await start();
  let state = await settled();
  assert.equal(state.security.locked, false);
  assert.equal(JSON.stringify(state).includes('fake-second'), false);
  const encrypted = await fs.readFile(path.join(root, 'secrets.enc.json'), 'utf8');
  assert.equal(encrypted.includes('fake-second'), false);
  await stop();
  await fs.writeFile(path.join(root, 'fake-device-store'), 'stale-password');
  await start();
  state = await settled();
  assert.equal(state.security.locked, true);
  assert.match(state.security.automaticUnlock.error, /Automatic unlock was unavailable/);
  await api('/api/unlock', { passphrase: 'fake-second' });
  await stop();
  await start();
  assert.equal((await settled()).security.locked, false);
  await fs.writeFile(path.join(root, 'fail-store'), '');
  await api('/api/password', {
    currentPassword: 'fake-second',
    newPassword: 'fake-third',
    confirmPassword: 'fake-third',
  });
  state = await settled();
  assert.equal(state.security.locked, false);
  assert.equal(state.security.automaticUnlock.remembered, false);
  assert.match(state.security.automaticUnlock.error, /Could not remember/);
});

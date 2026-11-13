import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

test('the browser module graph is served as JavaScript without exposing private data or backend source', async (t) => {
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'tracker-ui-modules-'));
  await fs.mkdir(path.join(storage, 'data'));
  await fs.writeFile(path.join(storage, 'data/private-test.json'), '{"private":true}');
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('../../tracker/server.mjs', import.meta.url))],
    {
      env: {
        ...process.env,
        TRACKER_DISABLE_AUTO_UNLOCK: '1',
        PORT: '0',
        TRACKER_DATA_DIR: storage,
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await once(child, 'exit');
    }
    await fs.rm(storage, { recursive: true, force: true });
  });
  const ready = await Promise.race([
    once(child, 'message').then(([message]) => message),
    once(child, 'exit').then(() => {
      throw new Error('UI test server exited before ready');
    }),
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('UI test server timed out')), 5000);
      timer.unref();
    }),
  ]);
  const origin = `http://127.0.0.1:${ready.port}`;
  const pending = ['/app.js'];
  const visited = new Set();
  while (pending.length) {
    const pathname = pending.pop();
    if (visited.has(pathname)) continue;
    visited.add(pathname);
    const response = await fetch(origin + pathname);
    assert.equal(response.status, 200, pathname);
    assert.match(response.headers.get('content-type'), /^text\/javascript/, pathname);
    const source = await response.text();
    for (const [, specifier] of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
      assert.ok(specifier.startsWith('.'), `Unexpected external dependency: ${specifier}`);
      const dependency = new URL(specifier, origin + pathname);
      assert.equal(dependency.origin, origin);
      pending.push(dependency.pathname);
    }
  }
  assert.ok(visited.has('/ui/history.js'));
  assert.ok(visited.has('/ui/appearance.js'));
  assert.ok(visited.has('/data/backgrounds.js'));
  for (const pathname of [
    '/server.mjs',
    '/data/private-test.json',
    '/data/history.sqlite',
    '/secrets.enc.json',
    '/ui/not-a-public-module.js',
  ]) {
    assert.equal((await fetch(origin + pathname)).status, 404, pathname);
  }
});

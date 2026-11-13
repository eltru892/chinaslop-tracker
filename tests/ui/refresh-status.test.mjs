import test from 'node:test';
import assert from 'node:assert/strict';
import { initRefreshStatus, refreshStatusText } from '../../tracker/ui/refresh-status.js';

test('refresh text describes parallel requests, saving, partial failure and locked storage', () => {
  assert.equal(refreshStatusText(null), 'Ready to refresh');
  assert.equal(
    refreshStatusText({ phase: 'fetching', active: ['Genshin progress', 'Endfield progress'] }),
    'Fetching Genshin · Fetching Endfield',
  );
  assert.equal(refreshStatusText({ phase: 'saving' }), 'Saving progress…');
  assert.equal(refreshStatusText({ phase: 'complete' }), 'Progress updated');
  assert.equal(refreshStatusText({ phase: 'partial' }), 'Updated — some games could not refresh');
  assert.equal(refreshStatusText(null, true), 'Unlock to refresh');
});

test('refresh status polls only while busy and ignores stale responses after completion', async (t) => {
  const node = { textContent: '' };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { getElementById: () => node },
  });
  t.after(() =>
    descriptor
      ? Object.defineProperty(globalThis, 'document', descriptor)
      : delete globalThis.document,
  );
  const timers = new Map();
  let counter = 0;
  t.mock.method(globalThis, 'setTimeout', (callback) => {
    const id = ++counter;
    timers.set(id, callback);
    return id;
  });
  t.mock.method(globalThis, 'clearTimeout', (id) => timers.delete(id));
  let release;
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(url, '/api/refresh-status');
    return new Promise((resolve) => {
      release = () =>
        resolve({
          ok: true,
          json: async () => ({
            syncing: true,
            refreshProgress: { phase: 'fetching', active: ['HSR progress'] },
          }),
        });
    });
  });
  const ui = initRefreshStatus();
  ui.update({ syncing: false });
  assert.equal(timers.size, 0);
  ui.begin();
  assert.equal(node.textContent, 'Starting refresh…');
  assert.equal(timers.size, 1);
  const [id, callback] = timers.entries().next().value;
  timers.delete(id);
  const pending = callback();
  ui.update({ syncing: false, refreshProgress: { phase: 'complete' } });
  ui.end();
  release();
  await pending;
  assert.equal(node.textContent, 'Progress updated');
  assert.equal(timers.size, 0);
  ui.update({
    syncing: true,
    refreshProgress: { phase: 'fetching', active: ['Endfield progress'] },
  });
  assert.equal(timers.size, 1);
  ui.fail();
  ui.end();
  assert.equal(timers.size, 0);
  assert.match(node.textContent, /Refresh failed/);
});

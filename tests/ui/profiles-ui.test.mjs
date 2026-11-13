import test from 'node:test';
import assert from 'node:assert/strict';
import { initSettings } from '../../tracker/ui/settings.js';

test('account picker switches with profile guards and settings edit only the selected profile', async (t) => {
  const nodes = new Map();
  function element() {
    return {
      value: '',
      hidden: true,
      checked: false,
      children: [],
      listeners: {},
      options: [{ value: '30' }],
      classList: { toggle() {} },
      addEventListener(type, callback) {
        this.listeners[type] = callback;
      },
      replaceChildren(...children) {
        this.children = children;
      },
      setAttribute() {},
      scrollIntoView() {},
    };
  }
  function get(id) {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  }
  for (const [name, value] of Object.entries({
    document: { getElementById: get, querySelectorAll: () => [], createElement: element },
    window: { confirm: () => true },
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() =>
      descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name],
    );
  }
  const state = {
    security: { locked: false },
    configured: { hoyolab: true, pollMinutes: 30 },
    profiles: {
      activeId: 'A',
      items: [
        { id: 'A', name: 'Main' },
        { id: 'B', name: 'Alt' },
      ],
    },
  };
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, body });
    if (url === '/api/profiles') state.profiles.activeId = body.id;
    return { ok: true, json: async () => ({ ok: true }) };
  });
  const ui = initSettings({ reload: async () => ui.render(state), refresh: async () => {} });
  ui.render(state);
  assert.equal(get('accountProfileControl').hidden, false);
  assert.equal(get('accountProfile').children.length, 2);
  assert.equal(get('accountProfile').value, 'A');
  assert.equal(get('removeHoyo').textContent, 'Disconnect HoYoLAB');
  assert.equal(get('removeSkport').disabled, true);
  get('hoyoCookie').value = 'unsaved';
  get('accountProfile').value = 'B';
  get('accountProfile').listeners.change({ target: get('accountProfile') });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(requests[0].body, { action: 'switch', id: 'B', expectedActiveId: 'A' });
  assert.equal(get('accountProfile').value, 'B');
  assert.equal(get('settingsAccountName').value, 'B');
  assert.equal(get('settingsAccountName').children[1].textContent, 'Alt');
  assert.equal(get('removeHoyo').textContent, 'Disconnect HoYoLAB');
  assert.equal(get('hoyoCookie').value, '');
  get('hoyoCookie').value = 'fake-new-token';
  get('settingsForm').listeners.submit({ preventDefault() {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests[1].body.profileId, 'B');
  assert.equal(requests[1].body.hoyolabToken, 'fake-new-token');
  get('settings').hidden = false;
  get('settingsAccountName').value = 'A';
  get('settingsAccountName').listeners.change({ target: get('settingsAccountName') });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(requests[2].body, { action: 'switch', id: 'A', expectedActiveId: 'B' });
  assert.equal(get('accountProfile').value, 'A');
  assert.equal(get('settingsAccountName').value, 'A');
  assert.equal(get('settings').hidden, false);
  assert.equal(get('settingsAccountName').disabled, false);
  state.security.locked = true;
  state.profiles = null;
  ui.render(state);
  assert.equal(get('accountProfileControl').hidden, true);
  assert.equal(get('accountProfile').children.length, 0);
});

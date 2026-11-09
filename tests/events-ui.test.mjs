import test from 'node:test';
import assert from 'node:assert/strict';
import { initEvents } from '../tracker/ui/events.js';

// A small DOM substitute lets the test track element replacement without a browser.
class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.style = { setProperty() {} };
    this.classList = { add() {} };
    this.clientWidth = 800;
    this.scrollLeft = 0;
    this.replacements = 0;
  }
  append(...children) {
    this.children.push(...children);
  }
  replaceChildren(...children) {
    this.children = children;
    this.replacements++;
  }
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
  addEventListener(name, callback) {
    this.listeners[name] = callback;
  }
  querySelector(selector) {
    return this.find((node) => node.className?.split(' ').includes(selector.slice(1)));
  }
  find(predicate) {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const found = child.find(predicate);
      if (found) return found;
    }
    return null;
  }
}

test('event ticks preserve elements while refreshing countdowns and rebuilding at boundaries', async (t) => {
  let now = Date.parse('2026-10-23T17:00:00Z');
  const initial = now;
  const nodes = new Map();
  const get = (id) => {
    if (!nodes.has(id)) nodes.set(id, new Element('div'));
    return nodes.get(id);
  };
  const globals = {
    document: { createElement: (tag) => new Element(tag), getElementById: get },
    window: { addEventListener() {} },
  };
  for (const [name, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() =>
      descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name],
    );
  }
  t.mock.method(Date, 'now', () => now);
  const events = [
    { id: 'ending', name: 'Ending event', startAt: initial - 3600000, endAt: initial + 180000 },
    {
      id: 'starting',
      name: 'Starting event',
      startAt: initial + 120000,
      endAt: initial + 3 * 86400000,
    },
  ];
  const calendar = { region: 'os_usa', events };
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({ serverTime: now, games: { genshin: structuredClone(calendar) } }),
  }));
  const ui = initEvents({ enabled: true });
  await ui.load();
  const grid = get('eventsGrid');
  const bar = grid.querySelector('.timelineBar');
  const remaining = grid.querySelector('.timelineRemaining');
  const marker = grid.querySelector('.timelineNow');
  const scroll = grid.querySelector('.timelineScroll');
  scroll.scrollLeft = 123;
  const previousLabel = remaining.textContent;
  const previousPosition = marker.style.left;
  now += 60000;
  ui.updateTimers();
  assert.equal(grid.replacements, 1);
  assert.equal(grid.querySelector('.timelineBar'), bar);
  assert.notEqual(remaining.textContent, previousLabel);
  assert.notEqual(marker.style.left, previousPosition);
  assert.match(bar.attributes['aria-label'], /2m/);
  await ui.load();
  assert.equal(grid.replacements, 1, 'clock-only poll must preserve the timeline');
  assert.equal(scroll.scrollLeft, 123);

  now += 60000;
  ui.updateTimers();
  assert.equal(grid.replacements, 2, 'event start must rebuild');
  assert.equal(get('eventsSummary').textContent, '2 ongoing events');
  now += 60000;
  ui.updateTimers();
  assert.equal(grid.replacements, 3, 'event end must rebuild');
  assert.equal(get('eventsSummary').textContent, '1 ongoing event');
  assert.equal(grid.querySelector('.timelineBarTitle').textContent, 'Starting event');

  now += 86400000;
  ui.updateTimers();
  assert.equal(grid.replacements, 4, 'server day rollover must rebuild');
  calendar.events[1].name = 'Updated event';
  await ui.load();
  assert.equal(grid.replacements, 5, 'changed calendar must rebuild');
  const category = grid.find((node) => node.attributes['aria-label'] === 'Calendar category');
  category.value = 'banner';
  category.listeners.change();
  assert.equal(grid.replacements, 6, 'filter change must rebuild');
  assert.equal(get('eventsSummary').textContent, '0 ongoing events');
});

test('dashboard date labels advance without rebuilding unchanged cards', async (t) => {
  const { initDashboard } = await import('../tracker/ui/dashboard.js');
  const nodes = new Map();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      getElementById(id) {
        if (!nodes.has(id)) nodes.set(id, new Element('div'));
        return nodes.get(id);
      },
    },
  });
  t.after(() =>
    descriptor
      ? Object.defineProperty(globalThis, 'document', descriptor)
      : delete globalThis.document,
  );
  let now = +new Date(2026, 9, 25, 23, 59);
  t.mock.method(Date, 'now', () => now);
  const dashboard = initDashboard();
  dashboard.updateTimers();
  const day = nodes.get('todayLabel').textContent;
  const week = nodes.get('weekLabel').textContent;
  now = +new Date(2026, 9, 26, 0, 0);
  dashboard.updateTimers();
  assert.notEqual(nodes.get('todayLabel').textContent, day);
  assert.notEqual(nodes.get('weekLabel').textContent, week);
  assert.equal(nodes.has('dailyGrid'), false, 'date updates must not rebuild cards');
});

test('history skips unchanged polls, reloads at boundaries, and retries failed pages', async (t) => {
  const { initHistory } = await import('../tracker/ui/history.js');
  let now = +new Date(2026, 9, 25, 23, 59);
  t.mock.method(Date, 'now', () => now);
  const nodes = new Map();
  const get = (id) => {
    if (!nodes.has(id)) nodes.set(id, new Element('div'));
    return nodes.get(id);
  };
  for (const [name, value] of Object.entries({
    document: { createElement: (tag) => new Element(tag), getElementById: get },
    window: { matchMedia: () => ({ matches: false }) },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() =>
      previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name],
    );
  }
  let requests = 0,
    fail = false;
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests++;
    if (url === '/api/history/accounts')
      return { ok: true, json: async () => ({ accounts: [], current: {} }) };
    return {
      ok: !fail,
      json: async () =>
        fail
          ? { error: 'temporary failure' }
          : { rows: [], total: 0, pages: 1, page: 0, pageSize: 10 },
    };
  });
  const history = initHistory({ enabled: true });
  const snapshot = { at: '2026-10-25T00:00:00Z', games: {} };
  await history.load(snapshot);
  assert.equal(requests, 3);
  await history.load(structuredClone(snapshot));
  assert.equal(requests, 3, 'unchanged snapshot must not query history');
  snapshot.at = '2026-10-25T01:00:00Z';
  await history.load(snapshot);
  assert.equal(requests, 6);
  now = +new Date(2026, 9, 26, 0, 0);
  await history.load(snapshot);
  assert.equal(requests, 9, 'date rollover must refresh history');
  now += 3600000;
  fail = true;
  await history.load(snapshot);
  assert.equal(requests, 12);
  fail = false;
  await history.load(snapshot);
  assert.equal(requests, 15, 'failed pages must be retried on the next poll');
  get('historyDailySize').value = '1';
  get('historyDailySize').listeners.change({ target: { value: '1' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests, 16, 'page controls must still fetch immediately');
});

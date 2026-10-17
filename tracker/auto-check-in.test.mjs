import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoCheckInScheduler } from './auto-check-in.mjs';
function fixture(run = async () => ({ games: {} })) {
  const timers = new Map();
  let id = 0,
    calls = 0,
    time = 100;
  const scheduler = createAutoCheckInScheduler({
    run: async () => {
      calls++;
      return run();
    },
    now: () => time,
    setTimer: (callback, delay) => {
      timers.set(++id, { callback, delay });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return {
    scheduler,
    timers,
    settle,
    calls: () => calls,
    advance: async () => {
      const [key, timer] = timers.entries().next().value;
      timers.delete(key);
      time += timer.delay;
      await timer.callback();
    },
  };
}
test('off by default; enabling checks immediately and schedules hourly', async () => {
  const f = fixture();
  assert.equal(f.calls(), 0);
  assert.equal(f.scheduler.state().nextAt, null);
  f.scheduler.configure(true);
  await f.settle();
  assert.equal(f.calls(), 1);
  assert.equal(f.scheduler.state().nextAt, 3600100);
  assert.equal(f.timers.size, 1);
  f.scheduler.configure(true);
  await f.settle();
  assert.equal(f.calls(), 1);
  assert.equal(f.timers.size, 1);
  await f.advance();
  assert.equal(f.calls(), 2);
  assert.equal(f.timers.size, 1);
});
test('disabling cancels future checks and re-enabling resumes immediately', async () => {
  const f = fixture();
  f.scheduler.configure(true);
  await f.settle();
  f.scheduler.configure(false);
  assert.equal(f.timers.size, 0);
  assert.equal(f.scheduler.state().nextAt, null);
  f.scheduler.configure(true);
  await f.settle();
  assert.equal(f.calls(), 2);
});
test('a failure is sanitized and retried without leaving an unhandled rejection', async () => {
  const f = fixture(async () => {
    throw new Error('private cookie');
  });
  f.scheduler.configure(true);
  await f.settle();
  assert.equal(f.scheduler.state().lastResult, null);
  assert.equal(f.timers.size, 1);
  assert.equal(JSON.stringify(f.scheduler.state()).includes('private cookie'), false);
  await f.advance();
  assert.equal(f.calls(), 2);
});
test('disabling while running prevents rescheduling', async () => {
  let finish;
  const f = fixture(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  f.scheduler.configure(true);
  assert.equal(f.scheduler.state().running, true);
  f.scheduler.configure(false);
  finish({ games: {} });
  await f.settle();
  assert.equal(f.scheduler.state().running, false);
  assert.equal(f.scheduler.state().nextAt, null);
  assert.equal(f.timers.size, 0);
});

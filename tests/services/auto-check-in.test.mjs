import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoCheckInScheduler } from '../../tracker/auto-check-in.mjs';
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

test('switching accounts discards the previous automatic check-in result', async () => {
  const completions = [];
  const scheduler = createAutoCheckInScheduler({
    run: () => new Promise((resolve) => completions.push(resolve)),
    setTimer: () => 1,
    clearTimer() {},
  });
  scheduler.configure(true);
  scheduler.reset();
  scheduler.configure(true);
  completions[0]({ account: 'old' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scheduler.state().lastResult, null);
  assert.equal(scheduler.state().running, true);
  completions[1]({ account: 'new' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(scheduler.state().lastResult, { account: 'new' });
  scheduler.reset();
});

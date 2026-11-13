import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, skportSignature, fetchHoyo, collect } from '../../tracker/collector.mjs';

test('Genshin daily and weekly progress use source fields', () => {
  const data = normalize('genshin', {
    finished_task_num: 3,
    total_task_num: 4,
    is_extra_task_reward_received: false,
    current_resin: 120,
    max_resin: 200,
    resin_discount_num_limit: 3,
    remain_resin_discount_num: 1,
  });
  assert.deepEqual(data.daily[0].value, { current: 3, total: 4 });
  assert.deepEqual(data.weekly[0].value, { current: 2, total: 3 });
  assert.deepEqual(data.resources[0].value, { current: 120, total: 200 });
});
test('missing values stay unavailable', () => {
  const data = normalize('zzz', { energy: { progress: { current: 80 } } });
  assert.equal(data.daily[0].value, null);
  assert.equal(data.weekly[0].value, null);
  assert.equal(data.resources[0].value, null);
});
test('Endfield daily and weekly fields are separate', () => {
  const data = normalize('endfield', {
    dailyMission: { dailyActivation: 80, maxDailyActivation: 100 },
    weeklyMission: { score: 450, total: 600 },
    dungeon: { curStamina: 50, maxStamina: 240 },
  });
  assert.deepEqual(data.daily[0].value, { current: 80, total: 100 });
  assert.deepEqual(data.weekly[0].value, { current: 450, total: 600 });
});
test('SKPORT signature is stable for fixed inputs', () => {
  const a = skportSignature('secret', '/path', '', '1000');
  const b = skportSignature('secret', '/path', '', '1000');
  assert.deepEqual(a, b);
  assert.match(a.sign, /^[a-f0-9]{32}$/);
});

test('Star Rail reads the API training and universe score fields including zero', () => {
  const data = normalize('hsr', {
    current_train_score: 0,
    max_train_score: 500,
    current_rogue_score: 14000,
    max_rogue_score: 14000,
    current_stamina: 120,
    max_stamina: 300,
  });
  assert.deepEqual(data.daily[0].value, { current: 0, total: 500 });
  assert.deepEqual(data.weekly[0].value, { current: 14000, total: 14000 });
});

test('ZZZ reads vitality, bounty count and weekly activity separately', () => {
  const data = normalize('zzz', {
    vitality: { current: 400, max: 400 },
    bounty_commission: { num: 2, total: 4 },
    weekly_task: { cur_point: 700, max_point: 1000 },
    energy: { progress: { current: 240, max: 240 } },
  });
  assert.deepEqual(data.daily[0].value, { current: 400, total: 400 });
  assert.deepEqual(data.weekly[0].value, { current: 2, total: 4 });
  assert.deepEqual(data.weekly[1].value, { current: 700, total: 1000 });
  assert.deepEqual(data.resources[0].value, { current: 240, total: 240 });
  assert.deepEqual(
    normalize('zzz', { hollow_zero: { bounty_commission: { num: 0, total: 4 } } }).weekly[0].value,
    { current: 0, total: 4 },
  );
});

test('game requests use the HSR host and correctly sign its request', async (t) => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    urls.push(String(url));
    let data;
    if (String(url).includes('getGameRecordCard'))
      data = {
        list: [
          { game_id: 2, game_role_id: '100', region: 'os_usa' },
          { game_id: 6, game_role_id: '200', region: 'prod_official_usa' },
          { game_id: 8, game_role_id: '300', region: 'prod_gf_us' },
        ],
      };
    else if (String(url).includes('/hkrpg/')) {
      const parsed = new URL(url);
      assert.equal(parsed.origin, 'https://bbs-api-os.hoyolab.com');
      assert.equal(parsed.pathname, '/game_record/hkrpg/api/note');
      assert.equal(parsed.searchParams.get('role_id'), '200');
      assert.equal(parsed.searchParams.get('server'), 'prod_official_usa');
      assert.match(options.headers.DS, /^\d+,[A-Za-z]{6},[a-f0-9]{32}$/);
      data = { current_train_score: 500, max_train_score: 500 };
    } else if (String(url).includes('/zzz/')) data = { vitality: { current: 400, max: 400 } };
    else data = {};
    return new Response(JSON.stringify({ retcode: 0, data }));
  });
  const data = await fetchHoyo({ hoyolabCookie: 'ltoken_v2=example; ltuid_v2=123' });
  assert.equal(urls.length, 4);
  assert.deepEqual(data.hsr.daily[0].value, { current: 500, total: 500 });
  assert.deepEqual(data.zzz.daily[0].value, { current: 400, total: 400 });
});

test('HoYoLAB progress requests overlap and one failed game does not hide the others', async (t) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = [];
  let lookups = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('getGameRecordCard')) {
      lookups++;
      return Response.json({
        retcode: 0,
        data: {
          list: [
            { game_id: 2, game_role_id: '100', region: 'os_usa' },
            { game_id: 6, game_role_id: '200', region: 'prod_official_usa' },
            { game_id: 8, game_role_id: '300', region: 'prod_gf_us' },
          ],
        },
      });
    }
    const game = String(url).includes('/hkrpg/')
      ? 'hsr'
      : String(url).includes('/zzz/')
        ? 'zzz'
        : 'genshin';
    started.push(game);
    await gate;
    if (game === 'hsr') throw new Error('Test HSR unavailable');
    return Response.json({ retcode: 0, data: {} });
  });
  const pending = fetchHoyo({ hoyolabCookie: 'ltoken_v2=fake; ltuid_v2=123' });
  // Hold every game response; all three requests must start before any completes.
  await new Promise((resolve) => setImmediate(resolve));
  const concurrent = [...started].sort();
  release();
  const result = await pending;
  assert.deepEqual(concurrent, ['genshin', 'hsr', 'zzz']);
  assert.equal(lookups, 1);
  assert.equal(result.genshin.identity.uid, '100');
  assert.equal(result.zzz.identity.uid, '300');
  assert.equal(result.hsr.error, 'Test HSR unavailable');
});

for (const failedProvider of ['hoyo', 'endfield']) {
  test(`providers start together and preserve results when ${failedProvider} fails`, async (t) => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const started = [];
    t.mock.method(globalThis, 'fetch', async (url) => {
      const address = String(url);
      if (address.includes('getGameRecordCard') || address.includes('/grant')) {
        const provider = address.includes('getGameRecordCard') ? 'hoyo' : 'endfield';
        started.push(provider);
        await gate;
        if (provider === failedProvider) throw new Error(`Test ${provider} unavailable`);
        return Response.json(
          provider === 'hoyo'
            ? {
                retcode: 0,
                data: { list: [{ game_id: 2, game_role_id: '100', region: 'os_usa' }] },
              }
            : { status: 0, data: { code: 'fake-grant' } },
        );
      }
      if (address.includes('generate_cred'))
        return Response.json({ code: 0, data: { cred: 'fake', token: 'fake' } });
      if (address.includes('/binding'))
        return Response.json({
          code: 0,
          data: {
            list: [
              {
                appCode: 'endfield',
                bindingList: [
                  { defaultRole: { roleId: '400', serverId: '2', serverName: 'Asia' } },
                ],
              },
            ],
          },
        });
      if (address.includes('/card/detail')) return Response.json({ code: 0, data: { detail: {} } });
      return Response.json({ retcode: 0, data: {} });
    });
    const timings = [];
    const progress = [];
    const pending = collect(
      { hoyolabCookie: 'ltoken_v2=fake; ltuid_v2=123', skportToken: `fake-${failedProvider}` },
      { onTiming: (entry) => timings.push(entry), onProgress: (entry) => progress.push(entry) },
    );
    await new Promise((resolve) => setImmediate(resolve));
    const concurrent = [...started].sort();
    release();
    const result = await pending;
    assert.deepEqual(concurrent, ['endfield', 'hoyo']);
    assert.equal(progress.filter((entry) => entry.running).length, timings.length);
    assert.equal(progress.filter((entry) => !entry.running).length, timings.length);
    assert.equal(/fake|https:|ltuid|ltoken/.test(JSON.stringify(progress)), false);
    assert.equal(timings.filter((entry) => !entry.ok).length, 1);
    assert.ok(timings.every((entry) => Number.isFinite(entry.durationMs) && entry.durationMs >= 0));
    assert.ok(timings.every((entry) => Number.isFinite(entry.startedMs) && entry.startedMs >= 0));
    assert.equal(/fake|https:|ltuid|ltoken/.test(JSON.stringify(timings)), false);
    assert.ok(timings.some((entry) => entry.request === 'HoYoLAB linked accounts'));
    assert.ok(timings.some((entry) => entry.request === 'SKPORT authorization'));
    assert.deepEqual(Object.keys(result.games).sort(), ['endfield', 'genshin', 'hsr', 'zzz']);
    if (failedProvider === 'hoyo') {
      assert.equal(result.games.endfield.identity.uid, '400');
      for (const game of ['genshin', 'hsr', 'zzz'])
        assert.equal(result.games[game].error, 'Test hoyo unavailable');
    } else {
      assert.equal(result.games.genshin.identity.uid, '100');
      assert.equal(result.games.endfield.error, 'Test endfield unavailable');
      assert.equal(result.games.hsr.error, 'No linked game role found in HoYoLAB');
    }
  });
}

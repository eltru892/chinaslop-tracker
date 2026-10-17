import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeHoyoEvents,
  officialEndfieldEvents,
  eventTimestamp,
  createEventService,
  eventImage,
  addAnnouncementImages,
} from './events.mjs';
import { eventCountdown } from './resource-time.mjs';
const now = Date.UTC(2026, 9, 16, 12),
  sec = (t) => t / 1000;
const event = (id, start, end) => ({
  id,
  name: `Event ${id}`,
  start_timestamp: sec(start),
  end_timestamp: sec(end),
});
test('ongoing only, earliest first, deduplicated and missing end dates excluded', () => {
  const data = {
    act_list: [
      event(1, now - 1000, now + 3600000),
      event(2, now - 1000, now + 60000),
      event(3, now + 1000, now + 5000),
      event(4, now - 2000, now),
      event(2, now - 1000, now + 60000),
      event(5, now - 1000, 0),
    ],
  };
  assert.deepEqual(
    normalizeHoyoEvents('genshin', data, now).map((x) => x.id),
    ['2', '1'],
  );
});
test('HSR and ZZZ epochs preserve timezone and reject ambiguous dates', () => {
  const hsr = normalizeHoyoEvents(
    'hsr',
    {
      act_list: [
        {
          id: 1,
          name: 'HSR',
          time_info: { start_ts: String(sec(now - 1000)), end_ts: String(sec(now + 60000)) },
        },
      ],
    },
    now,
  );
  const zzz = normalizeHoyoEvents(
    'zzz',
    {
      activity_list: [
        { activity_id: 2, name: 'ZZZ', start_ts: sec(now - 1000), end_ts: sec(now + 60000) },
      ],
    },
    now,
  );
  assert.equal(hsr[0].endAt, zzz[0].endAt);
  assert.equal(eventTimestamp('2026-10-16 12:00:00'), null);
  assert.equal(eventTimestamp('2026-10-16T20:00:00+08:00'), now);
});
test('official Endfield schedules use fixed server offsets and exclude unconfirmed end dates', () => {
  const notice = {
    cid: 'patch',
    title: '[Test] Version Update Notes',
    data: `<p>Asia Server: Oct. 15, 2026 at 06:00 – Oct. 15, 2026 at 12:00 (UTC+8)</p><p>Americas / Europe Server: Oct. 14, 2026 at 17:00 – Oct. 14, 2026 at 23:00 (UTC-5)</p><p>1. [Test Event] Guide Event</p><p>· Event Time: After [Test] version update – Nov. 5, 2026 at 12:00 (server time)</p><p>2. [Unknown End] Event</p><p>· Event Time: After [Test] version update – Before the next version update and maintenance</p><p>3. [Future] Event</p><p>· Event Time: Nov. 5, 2026 at 12:00 – Nov. 12, 2026 at 04:00 (server time)</p><p>4. [Split Schedule] Event</p><p>· Event Time:</p><p>Asia Server:</p><p>Oct. 15, 2026 at 04:00 – Nov. 26, 2026 at 04:00 (server time)</p><p>Americas / Europe Server:</p><p>Oct. 15, 2026 at 04:00 – Nov. 25, 2026 at 17:00 (server time)</p>`,
  };
  const asia = officialEndfieldEvents([notice], 'Asia', now),
    america = officialEndfieldEvents([notice], 'Americas / Europe', now);
  assert.equal(asia.length, 2);
  assert.equal(america.length, 2);
  assert.equal(asia[0].endAt, Date.UTC(2026, 10, 5, 4));
  assert.equal(america[0].endAt, Date.UTC(2026, 10, 5, 17));
  assert.equal(asia[0].startAt, america[0].startAt);
  assert.equal(america[1].endAt, Date.UTC(2026, 10, 25, 22));
  assert.throws(
    () => officialEndfieldEvents([notice], 'unknown', now),
    /Choose an Endfield server/,
  );
});
test('countdown uses minutes and ends at deadline', () => {
  assert.equal(eventCountdown(now + 90061000, now), 'Ends in 1d 1h 2m');
  assert.equal(eventCountdown(now + 1000, now), 'Ends in <1m');
  assert.equal(eventCountdown(now, now), 'Ended');
  assert.equal(eventCountdown(null, now), 'No scheduled end');
});
test('credential isolation, shared role lookup, cache, partial failures and locked state', async () => {
  let clock = now,
    failed = false;
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url, options });
    if (failed && url.includes('get_act_calender')) return new Response('{}', { status: 503 });
    if (url.includes('getNewsList')) {
      assert.equal(options.headers.Cookie, undefined);
      return Response.json({ retcode: 0, data: { list: [] } });
    }
    if (url.includes('web-news.gryphline.com')) {
      assert.equal(options.headers.Cookie, undefined);
      return Response.json({ code: 0, data: { list: [] } });
    }
    assert.equal(options.headers.Cookie, 'ltuid_v2=1; ltoken_v2=fixture');
    let data;
    if (url.includes('getUserGameRolesByCookie'))
      return Response.json({
        retcode: 0,
        data: { list: [{ game_uid: 'europe-role', region: 'prod_gf_eu' }] },
      });
    if (url.includes('getGameRecordCard'))
      data = {
        list: [
          { game_id: 2, game_role_id: '1', region: 'os_usa' },
          { game_id: 6, game_role_id: '2', region: 'prod_official_usa' },
          { game_id: 8, game_role_id: '3', region: 'prod_gf_us' },
        ],
      };
    else if (url.includes('activity_calendar'))
      data = {
        activity_list: [
          { activity_id: 1, name: 'ZZZ', start_ts: sec(now - 1000), end_ts: sec(now + 10000000) },
        ],
      };
    else data = { act_list: [event(1, now - 1000, now + 10000000)] };
    return Response.json({ retcode: 0, data });
  };
  const get = createEventService({ fetcher, clock: () => clock }),
    secrets = { hoyolabCookie: 'ltuid_v2=1; ltoken_v2=fixture' };
  const initial = await get(secrets);
  assert.equal(initial.games.hsr.events.length, 1);
  assert.equal(requests.filter((r) => r.url.includes('getGameRecordCard')).length, 1);
  assert.equal(requests.find((r) => r.url.includes('/act_calendar')).options.method, 'POST');
  const count = requests.length;
  await get(secrets);
  assert.equal(requests.length, count);
  clock += 16 * 60000;
  failed = true;
  const stale = await get(secrets);
  assert.equal(stale.games.hsr.stale, true);
  assert.equal(stale.games.hsr.updatedAt, now);
  assert.match(stale.games.hsr.error, /503/);
  assert.equal(stale.games.genshin.error, null);
  const locked = await get();
  assert.match(locked.games.genshin.error, /Unlock/);
  assert.equal(locked.games.genshin.events.length, 0);
  const europe = await get(secrets, null, { zzz: 'prod_gf_eu' });
  assert.equal(europe.games.zzz.region, 'prod_gf_eu');
  assert.equal(europe.games.zzz.error, null);
  const request = requests.find((r) => r.url.includes('uid=europe-role'));
  assert.ok(request);
  assert.match(request.url, /region=prod_gf_eu/);
  const missing = await get(secrets, null, { zzz: 'prod_gf_jp' });
  assert.match(missing.games.zzz.error, /No linked character/);
  assert.equal(missing.games.zzz.events.length, 0);
});
test('event artwork accepts HTTPS, resolves calendar paths and matches event titles only', () => {
  assert.equal(eventImage('javascript:alert(1)'), null);
  assert.equal(eventImage('http://example.com/a.png'), null);
  assert.equal(
    eventImage('/assets/event.webp', 'https://ef-cal.mogujun.icu/'),
    'https://ef-cal.mogujun.icu/assets/event.webp',
  );
  const posts = [
    {
      post: { subject: '“Planar Fissure” Event Details' },
      image_list: [{ url: 'https://example.com/planar.png' }],
    },
  ];
  const result = addAnnouncementImages(
    [{ name: 'Planar Fissure' }, { name: 'Gift of Odyssey' }],
    posts,
  );
  assert.equal(result[0].imageUrl, 'https://example.com/planar.png');
  assert.equal(result[1].imageUrl, undefined);
});
test('Genshin calendar includes character, weapon and chronicled banners and fixed challenges', () => {
  const base = { start_timestamp: sec(now - 1000), end_timestamp: sec(now + 60000) };
  const data = {
    act_list: [{ ...base, id: 1, name: 'Activity' }],
    fixed_act_list: [
      { ...base, id: 1, name: 'Spiral Abyss' },
      { ...base, id: 2, name: 'Imaginarium Theater' },
    ],
    avatar_card_pool_list: [
      {
        ...base,
        pool_id: 1,
        pool_name: 'Character Wish',
        avatars: [{ name: 'Featured', icon: 'https://act-webstatic.hoyolab.com/a.png' }],
      },
    ],
    weapon_card_pool_list: [{ ...base, pool_id: 1, pool_name: 'Epitome Invocation' }],
    mixed_card_pool_list: [
      { ...base, pool_id: 1, pool_name: 'Chronicled Wish' },
      { ...base, pool_id: 2, pool_name: 'No End', end_timestamp: 0 },
      { ...base, pool_id: 3, pool_name: 'Future', start_timestamp: sec(now + 1000) },
    ],
  };
  const events = normalizeHoyoEvents('genshin', data, now);
  assert.equal(events.length, 6);
  assert.equal(events.filter((e) => e.category === 'banner').length, 3);
  assert.equal(events.filter((e) => e.category === 'challenge').length, 2);
  assert.equal(new Set(events.map((e) => e.id)).size, 6);
  assert.ok(events.find((e) => e.name.startsWith('Character Wish')).imageUrl);
});
test('HSR banner and challenge periods come from time_info, including separate simultaneous banners', () => {
  const time_info = { start_ts: String(sec(now - 1000)), end_ts: String(sec(now + 60000)) };
  const events = normalizeHoyoEvents(
    'hsr',
    {
      act_list: [],
      avatar_card_pool_list: [
        { id: '1', name: 'Same Warp Name', time_info },
        { id: '2', name: 'Same Warp Name', time_info },
      ],
      equip_card_pool_list: [{ id: '1', name: 'Light Cone Warp', time_info }],
      challenge_list: [
        { group_id: 1, name_mi18n: 'Memory of Chaos', time_info },
        { group_id: 2, name_mi18n: 'Pure Fiction', time_info },
        { group_id: 3, name_mi18n: 'Apocalyptic Shadow', time_info },
      ],
    },
    now,
  );
  assert.equal(events.length, 6);
  assert.equal(events.filter((e) => e.category === 'banner').length, 3);
  assert.equal(events.filter((e) => e.category === 'challenge').length, 3);
});
test('ZZZ banners and structured challenge periods use the selected server and exclude unknown dates', () => {
  const start_time = { year: 2026, month: 10, day: 15, hour: 4, minute: 0, second: 0 },
    end_time = { ...start_time, day: 20 };
  const data = {
    activity_list: [],
    gacha_calendar: {
      avatar_gacha_schedule_list: [
        {
          gacha_type: 'featured',
          start_ts: sec(now - 1000),
          end_ts: sec(now + 60000),
          avatar_list: [{ avatar_id: 1, avatar_name: 'Agent', rarity: 'S' }],
        },
      ],
      weapon_gacha_schedule_list: [
        {
          gacha_type: 'weapon',
          start_ts: sec(now - 1000),
          end_ts: sec(now + 60000),
          weapon_list: [{ weapon_id: 1 }],
        },
      ],
    },
    challenge_calendars: {
      'Deadly Assault': { start_time, end_time },
      'Threshold Simulation': { void_front_battle_abstract_info_brief: { start_time, end_time } },
      'Shiyu Defense': {
        hadal_info_v2: { begin_time: String(sec(now - 1000)), end_time: String(sec(now + 60000)) },
      },
      'Annihilation Simulacrum': { start_time },
    },
  };
  const asia = normalizeHoyoEvents('zzz', data, now, 'prod_gf_jp'),
    america = normalizeHoyoEvents('zzz', data, now, 'prod_gf_us');
  assert.equal(asia.length, 5);
  assert.equal(
    america.find((e) => e.name === 'Deadly Assault').endAt -
      asia.find((e) => e.name === 'Deadly Assault').endAt,
    13 * 3600000,
  );
  assert.equal(asia.find((e) => e.name === 'Shiyu Defense').endAt, now + 60000);
  assert.ok(!asia.find((e) => e.name === 'Annihilation Simulacrum'));
});

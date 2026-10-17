import test from 'node:test';
import assert from 'node:assert/strict';
import { resourceFullAt, resourceCountdown, dailyResetInfo, dailyResetCountdown, weeklyResetInfo, weeklyResetCountdown } from './resource-time.mjs';
import { normalize } from './collector.mjs';

const now = 1_800_000_000_000;
const value = {current:100,total:240};

test('relative recovery time counts down rather than restarting on each render', () => {
  const item = {value,fullAt:resourceFullAt(value,{recoverySeconds:'3661',observedAt:now})};
  assert.equal(resourceCountdown(item,now),'Full in 1h 1m');
  assert.equal(resourceCountdown(item,now+1000),'Full in 1h 1m');
  assert.equal(resourceCountdown(item,now+3660000),'Full in <1m');
  assert.equal(resourceCountdown(item,now+3661000),'Full (estimated)');
});
test('already full and over-cap resources need no recovery duration', () => {
  for (const current of [240,300]) {
    const item = {value:{current,total:240}};
    assert.equal(resourceFullAt(item.value,{observedAt:now}),now);
    assert.equal(resourceCountdown(item,now),'Full');
  }
});
test('missing and invalid durations do not falsely report full', () => {
  for (const recoverySeconds of [null,undefined,'',0,-1,'invalid',Infinity]) {
    const fullAt = resourceFullAt(value,{recoverySeconds,observedAt:now});
    assert.equal(fullAt,null);
    assert.equal(resourceCountdown({value,fullAt},now),'Full time unavailable');
  }
  assert.equal(resourceCountdown({value},now),'Refresh to load full time');
  assert.equal(resourceFullAt(null,{recoverySeconds:600,observedAt:now}),null);
});
test('Sanity accepts Unix timestamps in seconds and milliseconds', () => {
  for (const fullTimestamp of [(now+600000)/1000,String((now+600000)/1000),now+600000]) {
    const fullAt = resourceFullAt(value,{fullTimestamp,observedAt:now});
    assert.equal(fullAt,now+600000);
    assert.equal(resourceCountdown({value,fullAt},now),'Full in 10m');
  }
});
test('all four game connectors read their correct recovery fields', () => {
  const fixtures = [
    ['genshin',{current_resin:100,max_resin:200,resin_recovery_time:'600'}],
    ['hsr',{current_stamina:100,max_stamina:300,stamina_recover_time:600}],
    ['zzz',{energy:{progress:{current:100,max:240},restore:600}}]
  ];
  for (const [game,data] of fixtures) {
    const before = Date.now();
    const item = normalize(game,data).resources[0];
    assert.ok(item.fullAt >= before+600000);
    assert.ok(item.fullAt <= Date.now()+600000);
  }
  assert.equal(normalize('endfield',{dungeon:{curStamina:100,maxStamina:240,maxTs:(now+600000)/1000}}).resources[0].fullAt,now+600000);
});

test('daily reset uses each game server offset including combined Endfield regions', () => {
  const current = Date.parse('2026-10-16T00:00:00Z');
  const cases = [
    ['genshin','os_usa','2026-10-16T09:00:00Z'],
    ['genshin','os_euro','2026-10-16T03:00:00Z'],
    ['genshin','os_asia','2026-10-16T20:00:00Z'],
    ['genshin','os_cht','2026-10-16T20:00:00Z'],
    ['hsr','prod_official_usa','2026-10-16T09:00:00Z'],
    ['hsr','prod_official_eur','2026-10-16T03:00:00Z'],
    ['hsr','prod_official_asia','2026-10-16T20:00:00Z'],
    ['zzz','prod_gf_us','2026-10-16T09:00:00Z'],
    ['zzz','prod_gf_eu','2026-10-16T03:00:00Z'],
    ['zzz','prod_gf_jp','2026-10-16T20:00:00Z'],
    ['zzz','prod_gf_sg','2026-10-16T20:00:00Z'],
    ['endfield','Asia','2026-10-16T20:00:00Z'],
    ['endfield','Americas / Europe','2026-10-16T09:00:00Z'],
    ['endfield','3','2026-10-16T09:00:00Z'],
    ['endfield','Europe','2026-10-16T09:00:00Z']
  ];
  for (const [game,region,expected] of cases) assert.equal(dailyResetInfo(game,region,current).nextResetAt,Date.parse(expected),`${game}: ${region}`);
});
test('daily reset rolls into the next day exactly at reset', () => {
  const at = Date.parse('2026-10-16T09:00:00Z');
  assert.equal(dailyResetCountdown('genshin','os_usa',at-1000),'Daily reset in <1m');
  assert.equal(dailyResetCountdown('genshin','os_usa',at),'Daily reset in 24h 00m');
  assert.equal(dailyResetInfo('genshin','os_usa',at).nextResetAt,at+86400000);
  const asiaReset = Date.parse('2026-10-16T20:00:00Z');
  assert.equal(dailyResetInfo('endfield','Asia',asiaReset).nextResetAt,asiaReset+86400000);
});
test('server reset offsets remain fixed around daylight saving transitions', () => {
  for (const date of ['2026-03-08','2026-03-29','2026-10-25','2026-11-01']) {
    const current = Date.parse(`${date}T00:00:00Z`);
    assert.equal(dailyResetInfo('genshin','os_usa',current).nextResetAt,Date.parse(`${date}T09:00:00Z`));
    assert.equal(dailyResetInfo('hsr','prod_official_eur',current).nextResetAt,Date.parse(`${date}T03:00:00Z`));
  }
});
test('unknown and missing regions do not silently assume a server', () => {
  assert.equal(dailyResetInfo('zzz','unknown',now),null);
  assert.equal(dailyResetInfo('endfield','',now),null);
  assert.equal(dailyResetCountdown('genshin',null,now),'Daily reset: server unavailable');
});

test('weekly resets use Monday in the account server timezone for all games', () => {
  const current = Date.parse('2026-10-16T00:00:00Z');
  const cases = [
    ['genshin','os_usa','2026-10-19T09:00:00Z'],
    ['genshin','os_euro','2026-10-19T03:00:00Z'],
    ['hsr','prod_official_usa','2026-10-19T09:00:00Z'],
    ['hsr','prod_official_eur','2026-10-19T03:00:00Z'],
    ['zzz','prod_gf_us','2026-10-19T09:00:00Z'],
    ['zzz','prod_gf_sg','2026-10-18T20:00:00Z'],
    ['endfield','Asia','2026-10-18T20:00:00Z'],
    ['endfield','Americas / Europe','2026-10-19T09:00:00Z']
  ];
  for (const [game,region,expected] of cases) assert.equal(weeklyResetInfo(game,region,current).nextResetAt,Date.parse(expected),`${game}: ${region}`);
});
test('weekly reset stays on this Monday before 04:00, and rolls a week at 04:00', () => {
  const mondayReset = Date.parse('2026-10-19T09:00:00Z');
  assert.equal(weeklyResetCountdown('genshin','os_usa',mondayReset-1000),'Weekly reset in <1m');
  assert.equal(weeklyResetCountdown('genshin','os_usa',mondayReset),'Weekly reset in 7d 0h 00m');
  assert.equal(weeklyResetInfo('genshin','os_usa',mondayReset).nextResetAt,mondayReset+7*86400000);
  const asiaReset = Date.parse('2026-10-18T20:00:00Z');
  assert.equal(weeklyResetInfo('endfield','Asia',asiaReset-1000).nextResetAt,asiaReset);
  assert.equal(weeklyResetInfo('endfield','Asia',asiaReset).nextResetAt,asiaReset+7*86400000);
});
test('weekly schedules handle year boundaries, DST dates and unknown regions', () => {
  assert.equal(weeklyResetInfo('zzz','prod_gf_us',Date.parse('2026-12-31T12:00:00Z')).nextResetAt,Date.parse('2027-01-04T09:00:00Z'));
  assert.equal(weeklyResetInfo('genshin','os_euro',Date.parse('2026-03-29T12:00:00Z')).nextResetAt,Date.parse('2026-03-30T03:00:00Z'));
  assert.equal(weeklyResetInfo('hsr','prod_official_usa',Date.parse('2026-11-01T12:00:00Z')).nextResetAt,Date.parse('2026-11-02T09:00:00Z'));
  assert.equal(weeklyResetInfo('endfield','unknown',now),null);
  assert.equal(weeklyResetCountdown('hsr',null,now),'Weekly reset: server unavailable');
});

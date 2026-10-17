import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, skportSignature, fetchHoyo } from './collector.mjs';

test('Genshin daily and weekly progress use source fields', () => {
  const data = normalize('genshin',{finished_task_num:3,total_task_num:4,is_extra_task_reward_received:false,current_resin:120,max_resin:200,resin_discount_num_limit:3,remain_resin_discount_num:1});
  assert.deepEqual(data.daily[0].value,{current:3,total:4});
  assert.deepEqual(data.weekly[0].value,{current:2,total:3});
  assert.deepEqual(data.resources[0].value,{current:120,total:200});
});
test('missing values stay unavailable', () => {
  const data = normalize('zzz',{energy:{progress:{current:80}}});
  assert.equal(data.daily[0].value,null);
  assert.equal(data.weekly[0].value,null);
  assert.equal(data.resources[0].value,null);
});
test('Endfield daily and weekly fields are separate', () => {
  const data = normalize('endfield',{dailyMission:{dailyActivation:80,maxDailyActivation:100},weeklyMission:{score:450,total:600},dungeon:{curStamina:50,maxStamina:240}});
  assert.deepEqual(data.daily[0].value,{current:80,total:100});
  assert.deepEqual(data.weekly[0].value,{current:450,total:600});
});
test('SKPORT signature is stable for fixed inputs', () => {
  const a=skportSignature('secret','/path','','1000');
  const b=skportSignature('secret','/path','','1000');
  assert.deepEqual(a,b);
  assert.match(a.sign,/^[a-f0-9]{32}$/);
});

test('Star Rail reads the API training and universe score fields including zero', () => {
  const data = normalize('hsr', { current_train_score:0, max_train_score:500, current_rogue_score:14000, max_rogue_score:14000, current_stamina:120, max_stamina:300 });
  assert.deepEqual(data.daily[0].value, { current:0, total:500 });
  assert.deepEqual(data.weekly[0].value, { current:14000, total:14000 });
});

test('ZZZ reads vitality, bounty count and weekly activity separately', () => {
  const data = normalize('zzz', { vitality:{current:400,max:400}, bounty_commission:{num:2,total:4}, weekly_task:{cur_point:700,max_point:1000}, energy:{progress:{current:240,max:240}} });
  assert.deepEqual(data.daily[0].value, { current:400, total:400 });
  assert.deepEqual(data.weekly[0].value, { current:2, total:4 });
  assert.deepEqual(data.weekly[1].value, { current:700, total:1000 });
  assert.deepEqual(data.resources[0].value, { current:240, total:240 });
  assert.deepEqual(normalize('zzz',{hollow_zero:{bounty_commission:{num:0,total:4}}}).weekly[0].value, {current:0,total:4});
});

test('game requests use the HSR host and correctly sign its request', async t => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    urls.push(String(url));
    let data;
    if (String(url).includes('getGameRecordCard')) data = {list:[
      {game_id:2,game_role_id:'100',region:'os_usa'},
      {game_id:6,game_role_id:'200',region:'prod_official_usa'},
      {game_id:8,game_role_id:'300',region:'prod_gf_us'}
    ]};
    else if (String(url).includes('/hkrpg/')) {
      const parsed = new URL(url);
      assert.equal(parsed.origin, 'https://bbs-api-os.hoyolab.com');
      assert.equal(parsed.pathname, '/game_record/hkrpg/api/note');
      assert.equal(parsed.searchParams.get('role_id'),'200');
      assert.equal(parsed.searchParams.get('server'),'prod_official_usa');
      assert.match(options.headers.DS,/^\d+,[A-Za-z]{6},[a-f0-9]{32}$/);
      data = {current_train_score:500,max_train_score:500};
    } else if (String(url).includes('/zzz/')) data = {vitality:{current:400,max:400}};
    else data = {};
    return new Response(JSON.stringify({retcode:0,data}));
  });
  const data = await fetchHoyo({hoyolabCookie:'ltoken_v2=example; ltuid_v2=123'});
  assert.equal(urls.length,4);
  assert.deepEqual(data.hsr.daily[0].value,{current:500,total:500});
  assert.deepEqual(data.zzz.daily[0].value,{current:400,total:400});
});

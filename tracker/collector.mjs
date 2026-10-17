import crypto from 'node:crypto';
import { resourceFullAt } from './resource-time.mjs';

const HOYO_BASE = 'https://sg-act-public-api.hoyolab.com';
const SKPORT_BASE = 'https://zonai.skport.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function ratio(current, total) {
  const c = num(current),
    t = num(total);
  return c === null || t === null || t <= 0 ? null : { current: c, total: t };
}
function first(...values) {
  return values.find((v) => v !== undefined && v !== null) ?? null;
}
function get(obj, path) {
  return path.split('.').reduce((v, k) => v?.[k], obj);
}
function pickRatio(obj, pairs) {
  for (const [a, b] of pairs) {
    const r = ratio(get(obj, a), get(obj, b));
    if (r) return r;
  }
  return null;
}
function metric(label, value, unit = '') {
  return { label, value, unit };
}
function refillingMetric(label, value, unit, recoverySeconds, fullTimestamp) {
  return {
    ...metric(label, value, unit),
    fullAt: resourceFullAt(value, { recoverySeconds, fullTimestamp }),
  };
}
function progress(label, value) {
  return { label, value };
}
export function normalize(game, data, identity = {}) {
  if (game === 'genshin')
    return {
      game,
      name: 'Genshin Impact',
      identity,
      daily: [
        progress('Daily commissions', ratio(data.finished_task_num, data.total_task_num)),
        progress(
          'Extra commission reward',
          typeof data.is_extra_task_reward_received === 'boolean'
            ? ratio(Number(data.is_extra_task_reward_received), 1)
            : null,
        ),
      ],
      weekly: [
        progress(
          'Weekly boss discount used',
          ratio(
            num(data.resin_discount_num_limit) === null ||
              num(data.remain_resin_discount_num) === null
              ? null
              : Number(data.resin_discount_num_limit) - Number(data.remain_resin_discount_num),
            data.resin_discount_num_limit,
          ),
        ),
      ],
      resources: [
        refillingMetric(
          'Original Resin',
          ratio(data.current_resin, data.max_resin),
          'resin',
          data.resin_recovery_time,
        ),
      ],
    };
  if (game === 'hsr')
    return {
      game,
      name: 'Honkai: Star Rail',
      identity,
      daily: [
        progress(
          'Daily training',
          pickRatio(data, [
            ['current_train_score', 'max_train_score'],
            ['daily_training.current', 'daily_training.max'],
            ['daily_training.score', 'daily_training.max_score'],
            ['daily_active_score', 'daily_active_max_score'],
          ]),
        ),
      ],
      weekly: [
        progress(
          'Universe weekly points',
          pickRatio(data, [
            ['current_rogue_score', 'max_rogue_score'],
            ['rogue_score', 'rogue_max_score'],
            ['rogue_score.score', 'rogue_score.max_score'],
            ['weekly_rogue_score', 'weekly_rogue_max_score'],
          ]),
        ),
      ],
      resources: [
        refillingMetric(
          'Trailblaze Power',
          ratio(data.current_stamina, data.max_stamina),
          'power',
          data.stamina_recover_time,
        ),
        metric('Reserved Power', num(data.current_reserve_stamina), 'power'),
      ],
    };
  if (game === 'zzz')
    return {
      game,
      name: 'Zenless Zone Zero',
      identity,
      daily: [
        progress(
          'Daily engagement',
          pickRatio(data, [
            ['vitality.current', 'vitality.max'],
            ['engagement.current', 'engagement.total'],
            ['engagement.current', 'engagement.max'],
            ['daily_task.current', 'daily_task.total'],
            ['daily_task.score', 'daily_task.max_score'],
          ]),
        ),
      ],
      weekly: [
        progress(
          'Bounty Commissions',
          pickRatio(data, [
            ['bounty_commission.num', 'bounty_commission.total'],
            ['hollow_zero.bounty_commission.num', 'hollow_zero.bounty_commission.total'],
            ['bounty_commission.current', 'bounty_commission.total'],
            ['bounty_commission.score', 'bounty_commission.max_score'],
          ]),
        ),
        progress(
          'Ridu Weekly',
          pickRatio(data, [
            ['weekly_task.cur_point', 'weekly_task.max_point'],
            ['weekly_task.current', 'weekly_task.total'],
          ]),
        ),
      ],
      resources: [
        refillingMetric(
          'Battery Charge',
          pickRatio(data, [
            ['energy.progress.current', 'energy.progress.max'],
            ['energy.progress.current', 'energy.progress.total'],
            ['energy.current', 'energy.max'],
          ]),
          'battery',
          data.energy?.restore,
        ),
      ],
    };
  if (game === 'endfield')
    return {
      game,
      name: 'Arknights: Endfield',
      identity,
      daily: [
        progress(
          'Daily activity',
          ratio(data.dailyMission?.dailyActivation, data.dailyMission?.maxDailyActivation),
        ),
      ],
      weekly: [
        progress('Weekly routine', ratio(data.weeklyMission?.score, data.weeklyMission?.total)),
      ],
      resources: [
        refillingMetric(
          'Sanity',
          ratio(data.dungeon?.curStamina, data.dungeon?.maxStamina),
          'sanity',
          null,
          data.dungeon?.maxTs,
        ),
      ],
    };
  throw new Error(`Unknown game: ${game}`);
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${response.status}: non-JSON response`);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.message || 'request failed'}`);
  return body;
}
function checkedHoyo(body) {
  if (body.retcode !== 0)
    throw new Error(`HoYoLAB ${body.retcode}: ${body.message || 'request failed'}`);
  return body.data;
}
function checkedSkport(body) {
  if (body.code !== 0 && body.status !== 0)
    throw new Error(
      `SKPORT ${body.code ?? body.status}: ${body.message || body.msg || 'request failed'}`,
    );
  return body.data;
}
function ds() {
  const t = Math.floor(Date.now() / 1000),
    alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const r = Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  const salt = '6s25p5ox5y14umn1p61aqyyvbvvl3lrt';
  const hash = crypto.createHash('md5').update(`salt=${salt}&t=${t}&r=${r}`).digest('hex');
  return `${t},${r},${hash}`;
}
export function hoyoHeaders(cookie, signed = false) {
  return {
    Cookie: cookie,
    Accept: 'application/json',
    'x-rpc-client_type': '5',
    'x-rpc-language': 'en-us',
    'x-rpc-lang': 'en-us',
    Origin: 'https://act.hoyolab.com',
    Referer: 'https://act.hoyolab.com/',
    'User-Agent': UA,
    ...(signed ? { 'x-rpc-app_version': '1.5.0', DS: ds() } : {}),
  };
}
function cookieUid(cookie) {
  return /(?:^|;\s*)(?:ltuid_v2|ltuid)=([^;]+)/.exec(cookie)?.[1] || '';
}
export async function fetchHoyo(config) {
  const cookie = String(config.hoyolabCookie || '').trim();
  if (!cookie)
    return {
      genshin: { error: 'Connect HoYoLAB in Settings' },
      hsr: { error: 'Connect HoYoLAB in Settings' },
      zzz: { error: 'Connect HoYoLAB in Settings' },
    };
  const uid = String(config.hoyolabUid || cookieUid(cookie));
  if (!uid) throw new Error('HoYoLAB UID missing; enter it in Settings');
  const cardUrl = `${HOYO_BASE}/game_record/card/wapi/getGameRecordCard?uid=${encodeURIComponent(uid)}`;
  const cards =
    checkedHoyo(await jsonRequest(cardUrl, { headers: hoyoHeaders(cookie) })).list || [];
  const definitions = [
    ['genshin', 2, `${HOYO_BASE}/event/game_record/genshin/api/dailyNote`, false],
    ['hsr', 6, 'https://bbs-api-os.hoyolab.com/game_record/hkrpg/api/note', true],
    ['zzz', 8, `${HOYO_BASE}/event/game_record_zzz/api/zzz/note`, false],
  ];
  const out = {};
  for (const [game, id, endpoint, signed] of definitions) {
    const card = cards.find((c) => Number(c.game_id) === id);
    if (!card?.game_role_id || !card?.region) {
      out[game] = { error: 'No linked game role found in HoYoLAB' };
      continue;
    }
    try {
      const url = `${endpoint}?server=${encodeURIComponent(card.region)}&role_id=${encodeURIComponent(card.game_role_id)}`;
      const data = checkedHoyo(await jsonRequest(url, { headers: hoyoHeaders(cookie, signed) }));
      out[game] = normalize(game, data, {
        nickname: card.nickname || '',
        uid: card.game_role_id,
        region: card.region,
      });
    } catch (error) {
      out[game] = { error: error.message };
    }
  }
  return out;
}

export function skportSignature(
  salt,
  path,
  body = '',
  timestamp = String(Math.floor(Date.now() / 1000)),
) {
  const header = JSON.stringify({ platform: '3', timestamp, dId: '', vName: '1.0.0' });
  const hmac = crypto
    .createHmac('sha256', salt)
    .update(path + body + timestamp + header)
    .digest('hex');
  return { timestamp, sign: crypto.createHash('md5').update(hmac).digest('hex') };
}
export function skportHeaders(cred, salt, path, role = '') {
  const { timestamp, sign } = skportSignature(salt, path);
  return {
    cred,
    timestamp,
    sign,
    platform: '3',
    vName: '1.0.0',
    'sk-language': 'en',
    'Content-Type': 'application/json',
    'User-Agent': UA,
    ...(role ? { 'sk-game-role': role } : {}),
  };
}
export async function getSkportContext(config, request = jsonRequest) {
  let token = String(config.skportToken || '').trim();
  if (!token) throw new Error('Connect SKPORT in Settings');
  if (token.startsWith('{')) {
    try {
      token = JSON.parse(token)?.data?.content || token;
    } catch {
      /* Use the pasted token as-is. */
    }
  }
  const grant = checkedSkport(
    await request('https://as.gryphline.com/user/oauth2/v2/grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ appCode: '6eb76d4e13aa36e6', token, type: 0 }),
    }),
  );
  const auth = checkedSkport(
    await request(`${SKPORT_BASE}/web/v1/user/auth/generate_cred_by_code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ code: grant.code, kind: 1 }),
    }),
  );
  const bindingPath = '/api/v1/game/player/binding';
  const binding = checkedSkport(
    await request(`${SKPORT_BASE}${bindingPath}`, {
      headers: skportHeaders(auth.cred, auth.token, bindingPath),
    }),
  );
  const app = binding.list?.find((item) => item.appCode === 'endfield');
  const roleGroup = app?.bindingList?.[0];
  const role = roleGroup?.defaultRole || roleGroup?.roles?.[0];
  if (!role) throw new Error('No linked Endfield role found in SKPORT');
  const roleKey = `3_${role.roleId}_${role.serverId}`;
  return { cred: auth.cred, salt: auth.token, role, roleKey };
}
export async function fetchEndfield(config) {
  if (!config.skportToken) return { error: 'Connect SKPORT in Settings' };
  const { cred, salt, role, roleKey } = await getSkportContext(config);
  const detailPath = '/api/v1/game/endfield/card/detail';
  const detailData = checkedSkport(
    await jsonRequest(`${SKPORT_BASE}${detailPath}`, {
      headers: skportHeaders(cred, salt, detailPath, roleKey),
    }),
  );
  return normalize('endfield', detailData.detail, {
    nickname: role.nickname || '',
    uid: role.roleId,
    region: role.serverName || '',
  });
}

export async function collect(config) {
  const result = { at: new Date().toISOString(), games: {} };
  try {
    Object.assign(result.games, await fetchHoyo(config));
  } catch (error) {
    for (const game of ['genshin', 'hsr', 'zzz']) result.games[game] = { error: error.message };
  }
  try {
    result.games.endfield = await fetchEndfield(config);
  } catch (error) {
    result.games.endfield = { error: error.message };
  }
  return result;
}

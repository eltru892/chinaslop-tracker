function numeric(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function resourceFullAt(value, { recoverySeconds, fullTimestamp, observedAt = Date.now() } = {}) {
  if (!value || numeric(value.current) === null || !(numeric(value.total) > 0)) return null;
  if (Number(value.current) >= Number(value.total)) return observedAt;
  const seconds = numeric(recoverySeconds);
  if (seconds > 0) {
    const deadline = observedAt + seconds * 1000;
    return Number.isFinite(deadline) ? deadline : null;
  }
  const timestamp = numeric(fullTimestamp);
  if (timestamp > 0) return timestamp < 1e12 ? timestamp * 1000 : timestamp;
  return null;
}

export function resourceCountdown(item, now = Date.now()) {
  const value = item.value;
  if (value && numeric(value.total) > 0 && numeric(value.current) !== null && Number(value.current) >= Number(value.total)) return 'Full';
  if (!Object.hasOwn(item,'fullAt')) return 'Refresh to load full time';
  const fullAt = numeric(item.fullAt);
  if (fullAt === null || fullAt <= 0) return 'Full time unavailable';
  const remaining = Math.max(0, Math.ceil((fullAt - now) / 1000));
  if (remaining === 0) return 'Full (estimated)';
  if (remaining < 60) return 'Full in <1m';
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor(remaining % 3600 / 60);
  const parts = [];
  if (hours) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return `Full in ${parts.join(' ')}`;
}

// Game servers use fixed UTC offsets, independently of the player's local DST.
export function dailyResetInfo(game, region, now = Date.now()) {
  const code = String(region || '').trim().toLowerCase().replace(/\s+server$/, '').replace(/\s*\/\s*/g, '/');
  const offsets = {
    genshin:{os_usa:-5,os_euro:1,os_asia:8,os_cht:8,cn_gf01:8,cn_qd01:8},
    hsr:{prod_official_usa:-5,prod_official_eur:1,prod_official_euro:1,prod_official_asia:8,prod_official_cht:8,prod_gf_cn:8,prod_qd_cn:8},
    zzz:{prod_gf_us:-5,prod_gf_eu:1,prod_gf_jp:8,prod_gf_sg:8,prod_gf_cn:8},
    endfield:{'2':8,'3':-5,asia:8,america:-5,americas:-5,europe:-5,'america/europe':-5,'americas/europe':-5,'america and europe':-5,'americas and europe':-5}
  };
  const names = {america:-5,americas:-5,europe:1,asia:8,'tw/hk/mo':8,china:8,'china (bilibili)':8};
  const offset = offsets[game]?.[code] ?? (game !== 'endfield' && offsets[game] ? names[code] : undefined);
  if (offset === undefined || !Number.isFinite(now)) return null;
  const serverNow = new Date(now + offset * 3600000);
  let nextResetAt = Date.UTC(serverNow.getUTCFullYear(),serverNow.getUTCMonth(),serverNow.getUTCDate(),4) - offset * 3600000;
  if (nextResetAt <= now) nextResetAt += 86400000;
  return {nextResetAt,utcOffsetHours:offset,resetHour:4};
}

export function dailyResetCountdown(game, region, now = Date.now()) {
  const reset = dailyResetInfo(game,region,now);
  if (!reset) return 'Daily reset: server unavailable';
  const seconds = Math.ceil((reset.nextResetAt - now) / 1000);
  if (seconds < 60) return 'Daily reset in <1m';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  return `Daily reset in ${hours}h ${String(minutes).padStart(2,'0')}m`;
}

export function weeklyResetInfo(game, region, now = Date.now()) {
  const daily = dailyResetInfo(game,region,now);
  if (!daily) return null;
  const offset = daily.utcOffsetHours * 3600000;
  const serverNow = new Date(now + offset);
  const daysToMonday = (8 - serverNow.getUTCDay()) % 7;
  let nextResetAt = Date.UTC(serverNow.getUTCFullYear(),serverNow.getUTCMonth(),serverNow.getUTCDate()+daysToMonday,4) - offset;
  if (nextResetAt <= now) nextResetAt += 7 * 86400000;
  return {nextResetAt,utcOffsetHours:daily.utcOffsetHours,resetHour:4,resetWeekday:1};
}

export function weeklyResetCountdown(game, region, now = Date.now()) {
  const reset = weeklyResetInfo(game,region,now);
  if (!reset) return 'Weekly reset: server unavailable';
  const seconds = Math.ceil((reset.nextResetAt - now) / 1000);
  if (seconds < 60) return 'Weekly reset in <1m';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  return `Weekly reset in ${days ? `${days}d ` : ''}${hours}h ${String(minutes).padStart(2,'0')}m`;
}

export function eventCountdown(endAt,now = Date.now()) {
  if (endAt == null) return 'No scheduled end';
  const difference = endAt-now;
  if (difference <= 0) return 'Ended';
  if (difference < 60000) return 'Ends in <1m';
  const minutes = Math.ceil(difference/60000);
  const days = Math.floor(minutes/1440);
  const hours = Math.floor(minutes%1440/60);
  return `Ends in ${days ? days+'d ' : ''}${hours ? hours+'h ' : ''}${minutes%60}m`;
}

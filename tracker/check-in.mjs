import { hoyoHeaders, getSkportContext, skportHeaders } from './collector.mjs';

// Official global daily check-in services. Separate from the game progress APIs.
export const checkInGames = ['genshin', 'hsr', 'zzz', 'endfield'];
const definitions = {
  genshin: {
    base: 'https://sg-hk4e-api.hoyolab.com/event/sol',
    act: 'e202102251931481',
    signgame: 'gi',
    link: 'https://act.hoyolab.com/ys/event/signin-sea-v3/index.html?act_id=e202102251931481',
  },
  hsr: {
    base: 'https://sg-public-api.hoyolab.com/event/luna/os',
    act: 'e202303301540311',
    signgame: 'hsr',
    link: 'https://act.hoyolab.com/bbs/event/signin/hkrpg/index.html?act_id=e202303301540311',
  },
  zzz: {
    base: 'https://sg-act-nap-api.hoyolab.com/event/luna/zzz/os',
    act: 'e202406031448091',
    signgame: 'zzz',
    link: 'https://act.hoyolab.com/bbs/event/signin/zzz/e202406031448091.html',
  },
};
async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('Check-in service unavailable');
  return response.json();
}
const result = (status, message, link) => ({ status, message, link });
function hoyoError(body, link) {
  const risk = body.data?.gt_result || body.data || {};
  if (
    Number(risk.risk_code || 0) !== 0 ||
    risk.gt ||
    risk.challenge ||
    /captcha|verification/i.test(body.message || '')
  ) {
    return result(
      'verification',
      'Complete verification on the official check-in page, then try again.',
      link,
    );
  }
  if ([-100, 10001, -10001].includes(Number(body.retcode)))
    return result(
      'error',
      'HoYoLAB session expired or not accepted. Update your saved cookie in Settings.',
      link,
    );
  return result(
    'error',
    `HoYoLAB could not complete check-in (code ${Number(body.retcode) || 'unknown'}). Open the official page to check your account.`,
    link,
  );
}
async function hoyo(game, config, claim, fetchJSON) {
  const def = definitions[game];
  if (!config.hoyolabCookie)
    return result('not-connected', 'Connect HoYoLAB in Settings.', def.link);
  const headers = {
    ...hoyoHeaders(config.hoyolabCookie),
    'Content-Type': 'application/json',
    'x-rpc-signgame': def.signgame,
  };
  const query = new URLSearchParams({ act_id: def.act, lang: 'en-us' });
  const status = await fetchJSON(`${def.base}/info?${query}`, { headers });
  if (status.retcode !== 0) return hoyoError(status, def.link);
  if (status.data?.is_sign === true)
    return result('already', 'Already checked in today.', def.link);
  if (status.data?.is_sign !== false)
    return result(
      'error',
      'The service did not return a check-in status. Open the official page.',
      def.link,
    );
  if (!claim) return result('available', 'Ready to check in.', def.link);
  const response = await fetchJSON(`${def.base}/sign?${query}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ act_id: def.act, lang: 'en-us' }),
  });
  if (response.retcode === -5003) return result('already', 'Already checked in today.', def.link);
  const risk = response.data?.gt_result || response.data || {};
  if (response.retcode !== 0 || Number(risk.risk_code || 0) !== 0 || risk.gt || risk.challenge)
    return hoyoError(response, def.link);
  // Confirm on the server before reporting success, including ambiguous risk responses.
  const confirmed = await fetchJSON(`${def.base}/info?${query}`, { headers });
  return confirmed.retcode === 0 && confirmed.data?.is_sign === true
    ? result('success', 'Checked in successfully.', def.link)
    : result(
        'error',
        'Check-in was sent, but completion could not be confirmed. Check the official page before trying again.',
        def.link,
      );
}
async function endfield(config, claim, fetchJSON) {
  const link = 'https://game.skport.com/endfield/sign-in';
  if (!config.skportToken) return result('not-connected', 'Connect SKPORT in Settings.', link);
  const { cred, salt, roleKey } = await getSkportContext(config, fetchJSON);
  const path = '/web/v1/game/endfield/attendance';
  const headers = () => ({
    ...skportHeaders(cred, salt, path, roleKey),
    Origin: 'https://game.skport.com',
    Referer: 'https://game.skport.com/',
  });
  const status = await fetchJSON(`https://zonai.skport.com${path}`, { headers: headers() });
  if (status.code !== 0)
    return result(
      'error',
      `SKPORT could not read check-in status (code ${Number(status.code) || 'unknown'}). Update your token or open SKPORT.`,
      link,
    );
  if (status.data?.hasToday === true) return result('already', 'Already checked in today.', link);
  if (status.data?.hasToday !== false)
    return result(
      'error',
      'SKPORT did not return a check-in status. Open the official page.',
      link,
    );
  if (!claim) return result('available', 'Ready to check in.', link);
  // SKPORT attendance signs the path and headers; its POST has no request body.
  const response = await fetchJSON(`https://zonai.skport.com${path}`, {
    method: 'POST',
    headers: headers(),
  });
  const confirmed = await fetchJSON(`https://zonai.skport.com${path}`, { headers: headers() });
  if (confirmed.code === 0 && confirmed.data?.hasToday === true)
    return result(
      response.code === 0 ? 'success' : 'already',
      response.code === 0 ? 'Checked in successfully.' : 'Already checked in today.',
      link,
    );
  return result(
    'error',
    `SKPORT did not confirm check-in (code ${Number(response.code) || 'unknown'}). Open the official page.`,
    link,
  );
}
export function createCheckInService(fetchJSON = request) {
  let active = null;
  return (config, claim = false) => {
    // Share an in-flight claim across tabs to prevent duplicate submissions.
    if (active) return active;
    const run = async () => {
      const entries = await Promise.all(
        checkInGames.map(async (game) => {
          try {
            return [
              game,
              await (game === 'endfield'
                ? endfield(config, claim, fetchJSON)
                : hoyo(game, config, claim, fetchJSON)),
            ];
          } catch {
            return [
              game,
              result(
                'error',
                'Could not reach or authenticate with the check-in service. Check your connection and saved credentials.',
                definitions[game]?.link || 'https://game.skport.com/',
              ),
            ];
          }
        }),
      );
      return { at: new Date().toISOString(), games: Object.fromEntries(entries) };
    };
    if (!claim) return run();
    active = run().finally(() => {
      active = null;
    });
    return active;
  };
}

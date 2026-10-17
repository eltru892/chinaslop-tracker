export function cookieAccountId(cookie = '') {
  return /(?:^|;\s*)(?:ltuid_v2|ltuid)\s*=\s*([^;]+)/.exec(cookie)?.[1]?.trim() || '';
}

// Blank fields retain saved values. Raw token values are formatted only on the server.
export function updateHoyoSettings(saved, input) {
  const next = { ...saved };
  const idInput = String(input.hoyolabUid || '').trim().replace(/^ltuid_v2\s*=\s*/, '');
  const rawToken = String(input.hoyolabToken || '').trim();
  const cookieLine = String(input.hoyolabCookie || '').trim();
  const token = rawToken || cookieLine;
  const isCookieLine = /^(?:ltoken_v2|ltuid_v2|ltoken|ltuid|account_id_v2|cookie_token_v2)\s*=/.test(token);
  const id = idInput || (isCookieLine ? cookieAccountId(token) : '') || next.hoyolabUid || cookieAccountId(next.hoyolabCookie);
  if (idInput && !/^\d+$/.test(idInput)) throw new Error('Paste only the numeric ltuid_v2 cookie value into HoYoLAB account ID value.');
  if (token) {
    if (isCookieLine) next.hoyolabCookie = token;
    else {
      if (!id) throw new Error('Paste the ltuid_v2 cookie value into HoYoLAB account ID value when connecting your account.');
      if (/[;\r\n]/.test(token)) throw new Error('Paste only the ltoken_v2 cookie value into HoYoLAB token value.');
      next.hoyolabCookie = `ltoken_v2=${token}; ltuid_v2=${id}`;
    }
  }
  if (idInput && next.hoyolabCookie) {
    const pieces = next.hoyolabCookie.split(';').map(piece => piece.trim()).filter(Boolean);
    const key = /(?:^|;\s*)ltuid_v2\s*=/.test(next.hoyolabCookie) ? 'ltuid_v2' : /(?:^|;\s*)ltuid\s*=/.test(next.hoyolabCookie) ? 'ltuid' : 'ltuid_v2';
    next.hoyolabCookie = [...pieces.filter(piece => !/^(?:ltuid_v2|ltuid)\s*=/.test(piece)), `${key}=${idInput}`].join('; ');
  }
  if (id) next.hoyolabUid = id;
  if (input.removeHoyo === true) { next.hoyolabCookie = ''; delete next.hoyolabUid; }
  return next;
}

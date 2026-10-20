import http from 'node:http';
import { openHistoryStore, mergeSnapshot, HISTORY_GAMES } from './history.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect } from './collector.mjs';
import { createCheckInService } from './check-in.mjs';
import { createAutoCheckInScheduler } from './auto-check-in.mjs';
const checkIn = createCheckInService();
import { createEventService } from './events.mjs';
import { createEventImageLoader } from './event-images.mjs';
const loadEventImage = createEventImageLoader();
const getEventCalendars = createEventService();
import { encryptSecrets, decryptSecrets, writeEncryptedFile } from './secrets.mjs';
import { cookieAccountId, updateHoyoSettings } from './hoyolab-settings.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const storageRoot = process.env.TRACKER_DATA_DIR
  ? path.resolve(process.env.TRACKER_DATA_DIR)
  : root;
await fs.mkdir(storageRoot, { recursive: true });
const configPath = path.join(storageRoot, 'config.local.json');
const secretsPath = path.join(storageRoot, 'secrets.enc.json');
const historyStore = await openHistoryStore(path.join(storageRoot, 'data'));
let credentialRevision = 0;
const port = Number(process.env.PORT || 4317);
const host = '127.0.0.1';
const accessKey = process.env.TRACKER_ACCESS_KEY || '';
function hasLocalAccess(req) {
  if (!accessKey) return true;
  const cookie = /(?:^|;\s*)tracker_session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  return (req.headers['x-tracker-key'] || cookie) === accessKey;
}
let listeningPort = port;
function validRefreshMinutes(value) {
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440;
}
function refreshMinutes(value) {
  const minutes = Number(value);
  return validRefreshMinutes(minutes) ? minutes : 30;
}
let latest = null;
let syncing = false;
let lastError = null;
let timer = null;
let nextRefreshAt = null;
let encryptedEnvelope = null;
let unlockedSecrets = null;
let unlockPassword = null;
const autoCheckIn = createAutoCheckInScheduler({
  run: () => checkIn({ ...unlockedSecrets }, true),
});
async function scheduleAutoCheckIn() {
  const config = await readConfig();
  autoCheckIn.configure(
    config.autoCheckIn === true &&
      !!unlockedSecrets &&
      !!(unlockedSecrets.hoyolabCookie || unlockedSecrets.skportToken),
  );
}

async function readConfig() {
  try {
    return JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}
async function writeConfig(config) {
  const { hoyolabCookie, skportToken, hoyolabUid, ...safeConfig } = config;
  const body = JSON.stringify(safeConfig, null, 2) + '\n';
  await fs.writeFile(configPath + '.tmp', body, { mode: 0o600 });
  await fs.chmod(configPath + '.tmp', 0o600);
  await fs.rename(configPath + '.tmp', configPath);
}
async function readEncryptedFile() {
  try {
    return JSON.parse(await fs.readFile(secretsPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
async function unlock(passphrase) {
  if (typeof passphrase !== 'string' || !passphrase)
    throw new Error('Enter an encryption password');
  const config = await readConfig();
  if (encryptedEnvelope) {
    let values = decryptSecrets(encryptedEnvelope, passphrase);
    // Move account IDs from older plain-text settings into encrypted storage.
    if (config.hoyolabUid || (!values.hoyolabUid && cookieAccountId(values.hoyolabCookie))) {
      values = updateHoyoSettings(values, {
        hoyolabUid: values.hoyolabUid || config.hoyolabUid || cookieAccountId(values.hoyolabCookie),
      });
      const envelope = encryptSecrets(values, passphrase);
      await writeEncryptedFile(secretsPath, envelope);
      decryptSecrets(envelope, passphrase);
      encryptedEnvelope = envelope;
    }
    // A previous migration may have written the encrypted file before cleaning the old config.
    if (config.hoyolabCookie || config.skportToken || config.hoyolabUid) await writeConfig(config);
    unlockedSecrets = values;
  } else {
    const values = updateHoyoSettings(
      {
        hoyolabCookie: String(config.hoyolabCookie || ''),
        skportToken: String(config.skportToken || ''),
      },
      { hoyolabUid: config.hoyolabUid },
    );
    const envelope = encryptSecrets(values, passphrase);
    await writeEncryptedFile(secretsPath, envelope);
    decryptSecrets(envelope, passphrase); // Verify before removing the plain-text copy.
    await writeConfig(config);
    encryptedEnvelope = envelope;
    unlockedSecrets = values;
  }
  unlockPassword = passphrase;
  await schedule();
  await scheduleAutoCheckIn();
  if (unlockedSecrets.hoyolabCookie || unlockedSecrets.skportToken) sync();
}
async function sync() {
  if (syncing || !unlockedSecrets) return;
  syncing = true;
  const revision = credentialRevision;
  const credentials = { ...unlockedSecrets };
  try {
    const incoming = await collect({ ...(await readConfig()), ...credentials });
    // A response started before a connection change must never restore the previous account.
    if (revision !== credentialRevision) return;
    for (const game of HISTORY_GAMES) {
      if (!(game === 'endfield' ? credentials.skportToken : credentials.hoyolabCookie)) {
        incoming.games[game] = {
          error: `Connect ${game === 'endfield' ? 'SKPORT' : 'HoYoLAB'} in Settings`,
          disconnected: true,
        };
      }
    }
    const snapshot = mergeSnapshot(latest, incoming);
    historyStore.record(snapshot);
    latest = snapshot;
    lastError = null;
  } catch (error) {
    lastError = error.message;
  } finally {
    syncing = false;
    if (revision !== credentialRevision) void sync();
  }
}
async function schedule() {
  if (timer) clearInterval(timer);
  timer = null;
  nextRefreshAt = null;
  if (!unlockedSecrets || (!unlockedSecrets.hoyolabCookie && !unlockedSecrets.skportToken)) return;
  const config = await readConfig();
  const minutes = refreshMinutes(config.pollMinutes);
  const interval = minutes * 60_000;
  nextRefreshAt = Date.now() + interval;
  timer = setInterval(() => {
    nextRefreshAt = Date.now() + interval;
    sync();
  }, interval);
  timer.unref();
}
function send(res, status, data, type = 'application/json; charset=utf-8', headers = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob: data: https://upload-os-bbs.hoyolab.com https://act-webstatic.hoyolab.com https://act-webstatic.hoyoverse.com https://act-webstatic.mihoyo.com https://web-static.hg-cdn.com; object-src 'none'; frame-ancestors 'none'",
    ...headers,
  });
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}
async function bodyJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 100_000) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function allowedOrigin(req) {
  const origin = req.headers.origin;
  return !origin || origin === `http://${host}:${listeningPort}`;
}
const server = http.createServer(async (req, res) => {
  try {
    if (!hasLocalAccess(req))
      return send(res, 403, { error: 'Open the tracker from its app window' });
    const url = new URL(req.url, `http://${host}:${port}`);
    if (url.pathname === '/api/health' && req.method === 'GET') return send(res, 200, { ok: true });
    if (req.method === 'POST' && !allowedOrigin(req))
      return send(res, 403, { error: 'Origin denied' });
    if (url.pathname === '/api/event-image' && req.method === 'GET') {
      const image = await loadEventImage(url.searchParams.get('url') || '');
      return send(res, 200, image.bytes, image.type, { 'Cache-Control': 'private, max-age=3600' });
    }
    if (url.pathname === '/api/events' && req.method === 'GET')
      return send(
        res,
        200,
        await getEventCalendars(
          unlockedSecrets || {},
          latest,
          Object.fromEntries(
            ['genshin', 'hsr', 'zzz', 'endfield'].map((game) => [
              game,
              url.searchParams.get(game) || '',
            ]),
          ),
        ),
      );
    if (url.pathname === '/api/check-in' && ['GET', 'POST'].includes(req.method)) {
      if (!unlockedSecrets) return send(res, 423, { error: 'Unlock encrypted storage first' });
      return send(res, 200, await checkIn({ ...unlockedSecrets }, req.method === 'POST'));
    }
    if (url.pathname === '/api/state' && req.method === 'GET') {
      const config = await readConfig();
      return send(res, 200, {
        latest,
        syncing,
        lastError,
        nextRefreshAt,
        serverTime: Date.now(),
        autoCheckIn: { enabled: config.autoCheckIn === true, ...autoCheckIn.state() },
        configured: {
          hoyolab: unlockedSecrets
            ? !!unlockedSecrets.hoyolabCookie
            : !!(encryptedEnvelope?.hasHoyo || config.hoyolabCookie),
          skport: unlockedSecrets
            ? !!unlockedSecrets.skportToken
            : !!(encryptedEnvelope?.hasSkport || config.skportToken),
          hoyolabUidSaved: unlockedSecrets
            ? !!(unlockedSecrets.hoyolabUid || cookieAccountId(unlockedSecrets.hoyolabCookie))
            : !!(encryptedEnvelope?.hasHoyo || config.hoyolabUid),
          pollMinutes: refreshMinutes(config.pollMinutes),
        },
        security: {
          encrypted: !!encryptedEnvelope,
          locked: !unlockedSecrets,
          legacyUnencrypted: !!(config.hoyolabCookie || config.skportToken),
        },
      });
    }
    if (url.pathname === '/api/history/accounts' && req.method === 'GET')
      return send(res, 200, { accounts: historyStore.accounts(), current: historyStore.current() });
    if (url.pathname === '/api/history' && req.method === 'GET') {
      try {
        const accounts = Object.fromEntries(
          HISTORY_GAMES.filter((game) => url.searchParams.has(game)).map((game) => [
            game,
            url.searchParams.get(game),
          ]),
        );
        return send(
          res,
          200,
          historyStore.page({
            kind: url.searchParams.get('kind') || 'daily',
            page: url.searchParams.get('page') || 0,
            size: url.searchParams.get('size') || 10,
            timeZone: url.searchParams.get('timeZone') || 'UTC',
            accounts,
          }),
        );
      } catch (error) {
        return send(res, 400, { error: error.message });
      }
    }
    if (url.pathname === '/api/sync' && req.method === 'POST') {
      if (!unlockedSecrets) return send(res, 423, { error: 'Unlock encrypted storage first' });
      await schedule();
      if (syncing) return send(res, 202, { syncing: true });
      await sync();
      return send(res, 200, { latest, lastError });
    }
    if (url.pathname === '/api/unlock' && req.method === 'POST') {
      const input = await bodyJson(req);
      await unlock(input.passphrase);
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/password' && req.method === 'POST') {
      if (!unlockedSecrets) return send(res, 423, { error: 'Unlock encrypted storage first' });
      const input = await bodyJson(req);
      if (typeof input.currentPassword !== 'string' || !input.currentPassword)
        return send(res, 400, { error: 'Enter your current password' });
      if (typeof input.newPassword !== 'string' || !input.newPassword)
        return send(res, 400, { error: 'Enter a new password' });
      if (input.newPassword !== input.confirmPassword)
        return send(res, 400, { error: 'New passwords do not match' });
      try {
        decryptSecrets(encryptedEnvelope, input.currentPassword);
      } catch {
        return send(res, 403, { error: 'Current password is incorrect' });
      }
      const envelope = encryptSecrets(unlockedSecrets, input.newPassword);
      decryptSecrets(envelope, input.newPassword);
      await writeEncryptedFile(secretsPath, envelope);
      encryptedEnvelope = envelope;
      unlockPassword = input.newPassword;
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/settings' && req.method === 'POST') {
      if (!unlockedSecrets) return send(res, 423, { error: 'Unlock encrypted storage first' });
      const input = await bodyJson(req);
      if (input.pollMinutes !== undefined && !validRefreshMinutes(input.pollMinutes)) {
        return send(res, 400, { error: 'Enter a whole number of minutes from 1 to 1,440.' });
      }
      if (input.autoCheckIn !== undefined && typeof input.autoCheckIn !== 'boolean')
        return send(res, 400, { error: 'Automatic check-in must be on or off' });
      const config = await readConfig();
      const updatedSecrets = updateHoyoSettings(unlockedSecrets, input);
      if (typeof input.skportToken === 'string' && input.skportToken.trim())
        updatedSecrets.skportToken = input.skportToken.trim();
      if (input.removeSkport === true) updatedSecrets.skportToken = '';
      if (input.autoCheckIn !== undefined) config.autoCheckIn = input.autoCheckIn;
      if (input.pollMinutes !== undefined) config.pollMinutes = refreshMinutes(input.pollMinutes);
      const envelope = encryptSecrets(updatedSecrets, unlockPassword);
      await writeEncryptedFile(secretsPath, envelope);
      encryptedEnvelope = envelope;
      const hoyoChanged =
        updatedSecrets.hoyolabCookie !== unlockedSecrets.hoyolabCookie ||
        updatedSecrets.hoyolabUid !== unlockedSecrets.hoyolabUid;
      const skportChanged = updatedSecrets.skportToken !== unlockedSecrets.skportToken;
      const changedGames = [
        ...(hoyoChanged ? ['genshin', 'hsr', 'zzz'] : []),
        ...(skportChanged ? ['endfield'] : []),
      ];
      if (changedGames.length) {
        credentialRevision++;
        for (const game of changedGames)
          historyStore.clearCurrent(
            [game],
            (game === 'endfield' ? updatedSecrets.skportToken : updatedSecrets.hoyolabCookie)
              ? 'Loading connected account…'
              : `Connect ${game === 'endfield' ? 'SKPORT' : 'HoYoLAB'} in Settings`,
          );
        latest = historyStore.latest();
      }
      unlockedSecrets = updatedSecrets;
      await writeConfig(config);
      await schedule();
      await scheduleAutoCheckIn();
      if (changedGames.length) void sync();
      return send(res, 200, { ok: true });
    }
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
    const files = {
      '/': 'index.html',
      '/index.html': 'index.html',
      '/app.js': 'app.js',
      '/resource-time.mjs': 'resource-time.mjs',
      '/history-dates.mjs': 'history-dates.mjs',
      '/style.css': 'style.css',
      '/logo.png': 'logo.png',
      '/assets/genshin-logo.png': 'assets/genshin-logo.png',
      '/assets/hsr-logo.png': 'assets/hsr-logo.png',
      '/assets/zzz-logo.png': 'assets/zzz-logo.png',
      '/assets/endfield-logo.png': 'assets/endfield-logo.png',
    };
    const name =
      files[url.pathname] ||
      (/^\/assets\/endfield-backgrounds\/\d+(?:-thumb)?\.webp$/.test(url.pathname)
        ? url.pathname.slice(1)
        : null);
    if (!name) return send(res, 404, { error: 'Not found' });
    const type = name.endsWith('.webp')
      ? 'image/webp'
      : name.endsWith('.png')
        ? 'image/png'
        : name.endsWith('.svg')
          ? 'image/svg+xml'
          : /\.m?js$/.test(name)
            ? 'text/javascript; charset=utf-8'
            : name.endsWith('.css')
              ? 'text/css; charset=utf-8'
              : 'text/html; charset=utf-8';
    return send(
      res,
      200,
      await fs.readFile(path.join(root, name), /\.(png|webp)$/.test(name) ? undefined : 'utf8'),
      type,
    );
  } catch (error) {
    return send(res, 500, { error: error.message });
  }
});

latest = historyStore.latest();
encryptedEnvelope = await readEncryptedFile();
const initialConfig = await readConfig();
const disconnectedGames = HISTORY_GAMES.filter((game) =>
  game === 'endfield'
    ? !(encryptedEnvelope?.hasSkport || initialConfig.skportToken)
    : !(encryptedEnvelope?.hasHoyo || initialConfig.hoyolabCookie),
);
if (disconnectedGames.length && latest) {
  historyStore.clearCurrent(disconnectedGames, 'Account disconnected. Connect in Settings.');
  latest = historyStore.latest();
}
await schedule();
server.listen(port, host, async () => {
  listeningPort = server.address().port;
  console.log(`Game Progress Tracker: http://${host}:${listeningPort}`);
  process.send?.({ type: 'ready', port: listeningPort });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readDataLiteral,
  hoyoPageArtwork,
  endfieldPageArtwork,
  matchPageArtwork,
  createOfficialArtwork,
} from './official-art.mjs';
const host = 'https://act-webstatic.hoyoverse.com/';
const slide = {
  children: [
    {
      name: '@puzzle/text',
      options: { text: 'Localized title' },
      otherOptions: { mi18n: { text: { customKey: 'event-name1' } } },
    },
    {
      name: '@puzzle/image',
      boxStyle: { width: '9rem', height: '5rem' },
      options: { src: host + 'new-patch-art.png' },
    },
    {
      name: '@puzzle/image',
      boxStyle: { width: '2rem', height: '2rem' },
      options: { src: host + 'reward-icon.png' },
    },
  ],
};
test('data-only parser reads minified configuration and rejects executable content', () => {
  const parsed = readDataLiteral(
    `{ready:!0,disabled:!1,opacity:.7,empty:null,items:['a\\x20b','it\\'s',"\\u0041",],}`,
  );
  assert.equal(parsed.value.ready, true);
  assert.equal(parsed.value.opacity, 0.7);
  assert.equal(parsed.value.empty, null);
  assert.deepEqual(parsed.value.items, ['a b', "it's", 'A']);
  assert.throws(() => readDataLiteral('{x:fetch("https://bad.example")}'), /Unsupported/);
  assert.throws(() => readDataLiteral('{x:(()=>1)()}'), /Unsupported/);
});
test('future HSR event title maps to its own slide illustration rather than reward icons', () => {
  const images = hoyoPageArtwork({ slides: [slide] }, { 'event-name1': 'Future Event' });
  assert.equal(images[0].name, 'Future Event');
  assert.equal(images[0].imageUrl, host + 'new-patch-art.png');
  const events = matchPageArtwork(
    [{ name: 'Future Event' }, { name: 'Unrelated Event' }],
    images,
    'https://hsr.hoyoverse.com/en-us/',
  );
  assert.equal(events[0].imageSourceUrl, 'https://hsr.hoyoverse.com/en-us/');
  assert.equal(events[1].imageUrl, undefined);
});
test('future Endfield version guide resolves current asset keys without hardcoded version names', () => {
  const script = `n.p="https://web-static.hg-cdn.com/endfield/new-version/";const assets={"gameplay.9.thumbnail":n.p+"art/new.jpg"};const data=JSON.parse('{"events":[{"name":{"en-us":"Future Guide Event"},"thumbnail":{"assetKey":"gameplay.9.thumbnail"}}]}');`;
  const images = endfieldPageArtwork(script);
  assert.equal(
    images[0].imageUrl,
    'https://web-static.hg-cdn.com/endfield/new-version/art/new.jpg',
  );
  assert.equal(
    matchPageArtwork(
      [{ name: '[Future Guide Event] Challenge Event' }],
      images,
      'https://endfield.gryphline.com/',
    )[0].imageUrl,
    images[0].imageUrl,
  );
});
test('live discovery follows the currently published script and translation key, caches, and isolates failures', async () => {
  let now = 0,
    failed = false;
  const requests = [];
  const config = { baseInfo: { mi18n: { key: 'mFutureVersion' } }, slides: [slide] };
  // Deliberately use a different key and script URL than the current live patch.
  const script =
    'window.CONFIG={baseInfo:' +
    JSON.stringify(config.baseInfo) +
    ',slides:' +
    JSON.stringify(config.slides) +
    '};';
  const fetcher = async (url, options) => {
    requests.push(url);
    assert.equal(options.headers.Cookie, undefined);
    assert.equal(options.headers.cred, undefined);
    if (failed) return new Response('', { status: 503 });
    if (url === 'https://hsr.hoyoverse.com/en-us/')
      return new Response(
        '<script src="https://act.hoyoverse.com/future/config.changed.js"></script>',
      );
    if (url.endsWith('config.changed.js')) return new Response(script);
    if (url.includes('/mFutureVersion/')) return Response.json({ 'event-name1': 'Future Event' });
    throw new Error('Unexpected destination');
  };
  const discover = createOfficialArtwork({ fetcher, clock: () => now, ttl: 1000 }),
    events = [{ name: 'Future Event' }];
  assert.ok((await discover('hsr', events))[0].imageUrl);
  assert.equal(requests.length, 3);
  await discover('hsr', events);
  assert.equal(requests.length, 3);
  now = 2000;
  failed = true;
  assert.deepEqual(await discover('hsr', events), events);
});

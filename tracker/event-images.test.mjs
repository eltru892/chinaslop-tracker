import test from 'node:test';import assert from 'node:assert/strict';import {createEventImageLoader} from './event-images.mjs';
test('image loader only fetches official HTTPS raster images and never forwards credentials',async()=>{
 let calls=0;const load=createEventImageLoader({fetcher:async(url,options)=>{calls++;assert.equal(options.redirect,'error');assert.equal(options.headers.Cookie,undefined);return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/png'}});}});
 for(const url of ['http://upload-os-bbs.hoyolab.com/a.png','https://localhost/a.png','https://upload-os-bbs.hoyolab.com.evil.test/a.png','https://user:secret@upload-os-bbs.hoyolab.com/a.png'])await assert.rejects(load(url));
 assert.equal(calls,0);const url='https://upload-os-bbs.hoyolab.com/art.png';await load(url);await load(url);assert.equal(calls,1);
});
test('image loader rejects HTML and oversized streams',async()=>{
 const html=createEventImageLoader({fetcher:async()=>new Response('<html>',{headers:{'content-type':'text/html'}})});await assert.rejects(html('https://web-static.hg-cdn.com/a'),/unavailable/);
 const big=createEventImageLoader({maxBytes:2,fetcher:async()=>new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/png'}})});await assert.rejects(big('https://web-static.hg-cdn.com/a'),/size limit/);
});

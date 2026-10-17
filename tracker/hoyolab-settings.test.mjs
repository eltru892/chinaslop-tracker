import test from 'node:test';
import assert from 'node:assert/strict';
import { updateHoyoSettings } from './hoyolab-settings.mjs';

const saved = {hoyolabCookie:'ltoken_v2=old; ltuid_v2=123',hoyolabUid:'123',skportToken:'example'};

test('blank account inputs retain saved credentials', () => {
  assert.deepEqual(updateHoyoSettings(saved,{hoyolabToken:'',hoyolabUid:''}),saved);
});
test('new token reuses the saved ID without revealing it to the browser', () => {
  const next = updateHoyoSettings(saved,{hoyolabToken:'new=='});
  assert.equal(next.hoyolabCookie,'ltoken_v2=new==; ltuid_v2=123');
  assert.equal(next.hoyolabUid,'123');
});
test('legacy cookies supply their saved account ID', () => {
  const next = updateHoyoSettings({hoyolabCookie:saved.hoyolabCookie},{hoyolabToken:'new'});
  assert.equal(next.hoyolabUid,'123');
});
test('changing ID updates the matching cookie and removing HoYo clears its ID', () => {
  const next = updateHoyoSettings(saved,{hoyolabUid:'456'});
  assert.equal(next.hoyolabCookie,'ltoken_v2=old; ltuid_v2=456');
  assert.equal(next.hoyolabUid,'456');
  const removed = updateHoyoSettings(next,{removeHoyo:true});
  assert.equal(removed.hoyolabCookie,'');
  assert.equal(removed.hoyolabUid,undefined);
});
test('connecting still requires an account ID and rejects invalid input', () => {
  assert.throws(()=>updateHoyoSettings({}, {hoyolabToken:'new'}),/account ID value/);
  assert.throws(()=>updateHoyoSettings(saved,{hoyolabUid:'invalid'}),/numeric/);
  assert.throws(()=>updateHoyoSettings(saved,{hoyolabToken:'new; extra=x'}),/only the ltoken_v2/);
});

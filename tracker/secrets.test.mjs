import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecrets, decryptSecrets } from './secrets.mjs';

test('encrypted values round-trip without appearing in the file', () => {
  const secrets = { hoyolabCookie:'ltoken_v2=example-secret', skportToken:'example-account-token' };
  const password = 'long-test-password';
  const envelope = encryptSecrets(secrets, password);
  assert.deepEqual(decryptSecrets(envelope, password), secrets);
  assert.equal(JSON.stringify(envelope).includes('example-secret'), false);
  assert.equal(JSON.stringify(envelope).includes('example-account-token'), false);
});
test('wrong password cannot decrypt', () => {
  const envelope = encryptSecrets({ hoyolabCookie:'secret', skportToken:'' }, 'correct-password');
  assert.throws(() => decryptSecrets(envelope, 'incorrect-password'));
});

test('short passwords can encrypt and decrypt while empty passwords are rejected', () => {
  const secrets = { hoyolabCookie:'test-value', skportToken:'' };
  const envelope = encryptSecrets(secrets, 'a');
  assert.deepEqual(decryptSecrets(envelope, 'a'), secrets);
  assert.throws(() => encryptSecrets(secrets, ''), /Enter an encryption password/);
});

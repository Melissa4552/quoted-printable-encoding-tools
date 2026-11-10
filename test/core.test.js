import test from 'node:test';
import assert from 'node:assert/strict';

import { encode, decode, encodeToBytes, decodeFromBytes } from '../src/index.js';

test('round-trips ASCII text unchanged except for line breaks', () => {
  const input = 'Hello, world!';
  assert.equal(encode(input), 'Hello, world!');
  assert.equal(decode(encode(input)), input);
});

test('escapes non-ASCII characters as UTF-8 bytes', () => {
  assert.equal(encode('é'), '=C3=A9');
  assert.equal(decode('=C3=A9'), 'é');
});

test('escapes the equals sign itself', () => {
  assert.equal(encode('a=b'), 'a=3Db');
  assert.equal(decode('a=3Db'), 'a=b');
});

test('escapes a trailing space but not an interior one', () => {
  assert.equal(encode('a b '), 'a b=20');
  assert.equal(decode('a b=20'), 'a b ');
});

test('escapes a trailing tab but not an interior one', () => {
  assert.equal(encode('a\tb\t'), 'a\tb=09');
  assert.equal(decode('a\tb=09'), 'a\tb\t');
});

test('normalises bare LF to CRLF', () => {
  assert.equal(encode('a\nb'), 'a\r\nb');
  assert.equal(decode('a\r\nb'), 'a\nb');
});

test('preserves CRLF input', () => {
  assert.equal(encode('a\r\nb'), 'a\r\nb');
  assert.equal(decode('a\r\nb'), 'a\nb');
});

test('inserts soft line breaks at the 76-character boundary', () => {
  const input = 'x'.repeat(80);
  const encoded = encode(input);
  assert.equal(encoded, 'x'.repeat(76) + '=\r\n' + 'x'.repeat(4));
  assert.equal(decode(encoded), input);
});

test('soft break accounting counts escape sequences as three characters', () => {
  // 25 escapes are 75 characters; the 26th would reach 78, so a break is due.
  const bytes = new Uint8Array(26).fill(0x80);
  const encoded = encodeToBytes(bytes);
  const expectedFirstLine = '=80'.repeat(25);
  assert.equal(encoded, expectedFirstLine + '=\r\n=80');
  assert.deepEqual(decodeFromBytes(encoded), bytes);
});

test('rejects lowercase hex escapes', () => {
  assert.throws(() => decode('=c3=a9'), /invalid quoted-printable escape/);
});

test('rejects a truncated escape', () => {
  assert.throws(() => decode('=C'), /invalid quoted-printable escape/);
});

test('rejects a non-hex character inside an escape', () => {
  assert.throws(() => decode('=ZZ'), /invalid quoted-printable escape/);
});

test('decodeFromBytes returns raw bytes without UTF-8 interpretation', () => {
  const bytes = decodeFromBytes('=FF=00');
  assert.deepEqual(bytes, new Uint8Array([0xff, 0x00]));
});

test('encodeToBytes accepts arbitrary binary input', () => {
  const bytes = new Uint8Array([0x00, 0x01, 0x7f, 0x80, 0xff]);
  const encoded = encodeToBytes(bytes);
  assert.equal(encoded, '=00=01=7F=80=FF');
  assert.deepEqual(decodeFromBytes(encoded), bytes);
});

test('rejects non-string arguments', () => {
  assert.throws(() => encode(123), TypeError);
  assert.throws(() => decode(null), TypeError);
  assert.throws(() => encodeToBytes('nope'), TypeError);
});

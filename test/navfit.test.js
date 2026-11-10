import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitNav } from '../client/src/lib/navfit.js';

const wide = [120, 120, 120, 120];
const tight = [100, 100, 100, 100];
const base = { wide, tight, more: 80, gap: 0 };

test('all links keep full spacing when there is room', () => {
  assert.deepEqual(fitNav({ ...base, room: 480 }), { compact: false, shown: [0, 1, 2, 3] });
});

test('links move closer together before any leave the bar', () => {
  assert.deepEqual(fitNav({ ...base, room: 400 }), { compact: true, shown: [0, 1, 2, 3] });
});

test('links that cannot fit leave room for the More menu', () => {
  assert.deepEqual(fitNav({ ...base, room: 390, active: 0 }).shown, [0, 1, 2]);
});

test('the current page stays in the bar', () => {
  assert.deepEqual(fitNav({ ...base, room: 290, active: 3 }).shown, [0, 3]);
});

test('a very narrow bar still shows the current page', () => {
  assert.deepEqual(fitNav({ ...base, room: 10, active: 2 }).shown, [2]);
});

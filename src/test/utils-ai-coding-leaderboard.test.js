import test from 'node:test';
import assert from 'node:assert/strict';
import { getAiCodingLeaderboard, rankTrend } from '../utils/aiCodingLeaderboard.js';

test('AI coding leaderboard has stable ranks and explicit trends', () => {
  const entries = getAiCodingLeaderboard();
  assert.equal(entries.length, 10);
  assert.deepEqual(entries.map(entry => entry.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(entries.every((entry, index) => index === 0 || entries[index - 1].score >= entry.score));
  assert.deepEqual(rankTrend(2, 5), { direction: 'up', change: 3, label: 'UP 3' });
  assert.deepEqual(rankTrend(5, 2), { direction: 'down', change: -3, label: 'DOWN 3' });
  assert.deepEqual(rankTrend(2, 2), { direction: 'same', change: 0, label: 'SAME' });
  assert.deepEqual(rankTrend(2, null), { direction: 'new', change: null, label: 'NEW' });
});

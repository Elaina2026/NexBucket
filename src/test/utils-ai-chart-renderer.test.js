import test from 'node:test';
import assert from 'node:assert/strict';
import { loadImage } from '@napi-rs/canvas';
import { AI_CODING_SOURCE, getAiCodingLeaderboard } from '../utils/aiCodingLeaderboard.js';
import { renderAiCodingChart, selectCodingLeaders } from '../utils/aiChartRenderer.js';

test('coding leaders are deterministic, bounded, and do not mutate input', () => {
  const entries = [
    { model: 'B', score: 70, trend: { direction: 'same', label: 'SAME' } },
    { model: 'A', score: 70, trend: { direction: 'new', label: 'NEW' } },
    { model: 'Invalid', score: null },
  ];
  const snapshot = structuredClone(entries);
  assert.deepEqual(selectCodingLeaders(entries, 2).map(entry => entry.model), ['A', 'B']);
  assert.deepEqual(entries, snapshot);
  assert.equal(selectCodingLeaders(Array.from({ length: 15 }, (_, index) => ({ model: String(index), score: index }))).length, 10);
});

test('AI coding chart renders as a 1200 by 720 PNG', async () => {
  const png = renderAiCodingChart(getAiCodingLeaderboard(), AI_CODING_SOURCE);
  assert.ok(Buffer.isBuffer(png));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const image = await loadImage(png);
  assert.equal(image.width, 1200);
  assert.equal(image.height, 720);
});

test('AI coding chart rejects empty rankings', () => {
  assert.throws(() => renderAiCodingChart([], AI_CODING_SOURCE), /No AI coding leaderboard/);
});

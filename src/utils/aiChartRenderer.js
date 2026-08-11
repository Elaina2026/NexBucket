import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';

const WIDTH = 1200;
const HEIGHT = 720;
const FONT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'gg sans Bold.ttf');
GlobalFonts.registerFromPath(FONT_PATH, 'AiChartFont');

function fitText(ctx, value, maxWidth) {
  const text = String(value || 'Unknown').replace(/[\r\n]+/g, ' ').trim() || 'Unknown';
  if (ctx.measureText(text).width <= maxWidth) return text;
  let end = text.length;
  while (end > 1 && ctx.measureText(`${text.slice(0, end)}…`).width > maxWidth) end--;
  return `${text.slice(0, end)}…`;
}

function trendColor(direction) {
  if (direction === 'up') return '#4ade80';
  if (direction === 'down') return '#fb7185';
  if (direction === 'new') return '#38bdf8';
  return '#94a3b8';
}

export function selectCodingLeaders(entries, limit = 10) {
  if (!Array.isArray(entries)) return [];
  const safeLimit = Math.max(0, Math.min(10, Number.isInteger(limit) ? limit : 10));
  return entries
    .filter(entry => entry && typeof entry.model === 'string' && Number.isFinite(entry.score))
    .slice()
    .sort((left, right) => right.score - left.score || left.model.localeCompare(right.model))
    .slice(0, safeLimit)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export function renderAiCodingChart(entries, source) {
  const leaders = selectCodingLeaders(entries);
  if (leaders.length === 0) throw new Error('No AI coding leaderboard entries are available');

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  gradient.addColorStop(0, '#111827');
  gradient.addColorStop(1, '#20233a');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = '#ffffff';
  ctx.font = '34px "AiChartFont", sans-serif';
  ctx.fillText('AI Coding Leaderboard', 42, 52);
  ctx.fillStyle = '#a5b4fc';
  ctx.font = '15px "AiChartFont", sans-serif';
  ctx.fillText(`${source.benchmark} • ${source.view}`, 44, 78);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#94a3b8';
  ctx.font = '13px "AiChartFont", sans-serif';
  ctx.fillText(`Updated ${source.updatedAt}`, WIDTH - 42, 51);
  ctx.textAlign = 'left';

  const rowX = 42;
  const rowWidth = WIDTH - 84;
  const rowHeight = 54;
  const firstRowY = 125;
  ctx.fillStyle = '#64748b';
  ctx.font = '12px "AiChartFont", sans-serif';
  ctx.fillText('RANK', 54, 111);
  ctx.fillText('MODEL / PROVIDER', 112, 111);
  ctx.fillText('SWE-BENCH VERIFIED', 535, 111);
  ctx.fillText('TREND', 745, 111);
  ctx.fillText('STRENGTH', 875, 111);

  leaders.forEach((entry, index) => {
    const y = firstRowY + index * rowHeight;
    ctx.fillStyle = index % 2 === 0 ? '#ffffff0d' : '#ffffff05';
    ctx.fillRect(rowX, y, rowWidth, rowHeight - 4);

    ctx.fillStyle = index < 3 ? ['#fbbf24', '#cbd5e1', '#fb923c'][index] : '#818cf8';
    ctx.font = '20px "AiChartFont", sans-serif';
    ctx.fillText(String(index + 1).padStart(2, '0'), 54, y + 31);

    ctx.fillStyle = '#f8fafc';
    ctx.font = '17px "AiChartFont", sans-serif';
    ctx.fillText(fitText(ctx, entry.model, 380), 112, y + 22);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px "AiChartFont", sans-serif';
    ctx.fillText(fitText(ctx, entry.provider, 380), 112, y + 40);

    ctx.fillStyle = '#f8fafc';
    ctx.font = '18px "AiChartFont", sans-serif';
    ctx.fillText(`${entry.score.toFixed(1)}%`, 535, y + 31);
    ctx.fillStyle = trendColor(entry.trend?.direction);
    ctx.font = '14px "AiChartFont", sans-serif';
    ctx.fillText(entry.trend?.label || 'SAME', 745, y + 31);
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(fitText(ctx, entry.strength, 270), 875, y + 31);
  });

  ctx.fillStyle = '#64748b';
  ctx.font = '12px "AiChartFont", sans-serif';
  ctx.fillText(`Model-only comparison in one shared mini-SWE-agent harness • Previous snapshot ${source.previousSnapshotAt}`, 44, HEIGHT - 22);
  return canvas.toBuffer('image/png');
}

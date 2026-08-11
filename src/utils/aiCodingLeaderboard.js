export const AI_CODING_SOURCE = {
  benchmark: 'SWE-bench Verified',
  view: 'Bash Only (mini-SWE-agent)',
  url: 'https://www.swebench.com/verified.html',
  updatedAt: '2026-02-26',
  previousSnapshotAt: '2025-11-24',
};

const CURRENT = [
  { model: 'Claude 4.5 Opus', provider: 'Anthropic', score: 76.8, previousRank: 1, strength: 'Repository reasoning' },
  { model: 'Gemini 3 Flash', provider: 'Google DeepMind', score: 75.8, previousRank: null, strength: 'Fast iteration' },
  { model: 'MiniMax M2.5', provider: 'MiniMax', score: 75.8, previousRank: null, strength: 'Efficient coding' },
  { model: 'Claude 4.6 Opus', provider: 'Anthropic', score: 75.6, previousRank: null, strength: 'Agentic debugging' },
  { model: 'Gemini 3 Pro Preview', provider: 'Google DeepMind', score: 74.2, previousRank: 2, strength: 'Large codebases' },
  { model: 'GLM 5', provider: 'Z-AI', score: 72.8, previousRank: null, strength: 'Tool execution' },
  { model: 'GPT 5.2', provider: 'OpenAI', score: 72.8, previousRank: null, strength: 'General coding' },
  { model: 'GPT 5.2 Codex', provider: 'OpenAI', score: 72.8, previousRank: null, strength: 'Code editing' },
  { model: 'Claude 4.5 Sonnet', provider: 'Anthropic', score: 71.4, previousRank: 3, strength: 'Balanced agent' },
  { model: 'Kimi K2.5', provider: 'Moonshot AI', score: 70.8, previousRank: null, strength: 'Cost efficiency' },
];

export function rankTrend(rank, previousRank) {
  if (!Number.isInteger(previousRank)) return { direction: 'new', change: null, label: 'NEW' };
  const change = previousRank - rank;
  if (change > 0) return { direction: 'up', change, label: `UP ${change}` };
  if (change < 0) return { direction: 'down', change, label: `DOWN ${Math.abs(change)}` };
  return { direction: 'same', change: 0, label: 'SAME' };
}

export function getAiCodingLeaderboard() {
  return CURRENT.map((entry, index) => ({
    ...entry,
    rank: index + 1,
    trend: rankTrend(index + 1, entry.previousRank),
  }));
}

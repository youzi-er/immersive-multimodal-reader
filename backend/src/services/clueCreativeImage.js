import { ensureBookStyle } from './bookImageStyle.js';
import { generateImage } from './minimax.js';

const MAX_USER_PROMPT_CHARS = 800;
const MAX_FINAL_PROMPT_CHARS = 1400;

const VARIATION_DIRECTIONS = [
  'clear evidence-first composition, restrained centered framing, tactile material detail',
  'cinematic asymmetrical composition, stronger environmental context, investigative point of view'
];

function clueAspectRatio(clueType) {
  return clueType === '人物' ? '3:4' : '4:3';
}

function compact(value, maxLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length <= maxLength ? text : text.slice(0, maxLength).trim();
}

export function buildClueCreativePrompt({ userPrompt, clue, occurrence, style, variationIndex = 0 }) {
  const normalizedPrompt = compact(userPrompt, MAX_USER_PROMPT_CHARS);
  if (normalizedPrompt.length < 5) {
    throw new Error('证物创作提示词至少需要 5 个字');
  }
  const sourceFact = compact(occurrence?.selectedText || clue?.surfaceDescription || '', 220);
  const variation = VARIATION_DIRECTIONS[variationIndex % VARIATION_DIRECTIONS.length];
  const lockedStyle = compact(style?.global_style_prompt, 360);
  const lockedNegative = compact(style?.global_negative_prompt, 220);
  const prompt = [
    normalizedPrompt,
    `Subject: ${clue.label}. Type: ${clue.type}. Source fact: ${sourceFact}.`,
    `Composition variation: ${variation}.`,
    lockedStyle,
    `Avoid: ${lockedNegative}, text, captions, logo, watermark, modern objects, duplicated subjects, distorted anatomy.`
  ].filter(Boolean).join(' ');
  if (prompt.length > MAX_FINAL_PROMPT_CHARS) {
    throw new Error('证物创作提示词过长，请缩短后重试');
  }
  return prompt;
}

export async function generateClueImageCandidates({ userPrompt, clue, occurrence }) {
  const { style } = await ensureBookStyle();
  const aspectRatio = clueAspectRatio(clue.type);
  const candidates = [];
  for (let variationIndex = 0; variationIndex < 2; variationIndex += 1) {
    const prompt = buildClueCreativePrompt({ userPrompt, clue, occurrence, style, variationIndex });
    const generated = await generateImage({ prompt, aspectRatio, promptOptimizer: false });
    candidates.push({
      ...generated,
      prompt,
      aspectRatio,
      model: process.env.MINIMAX_IMAGE_MODEL || 'image-01',
      variationIndex
    });
  }
  return candidates;
}

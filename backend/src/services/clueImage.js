import crypto from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bookMeta, getClueReaderContext } from '../data.js';
import { callMessagesApiForJson, generateImageFromRequest } from './minimax.js';
import { ensureBookStyle } from './bookImageStyle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = path.resolve(__dirname, '../prompts/clue-image-system.md');
const DEBUG_LOG_PATH = path.resolve(__dirname, '../../../debug-d022cd.log');
const MAX_PROMPT_CHARS = 1400;
const MAX_SCENE_PROMPT_CHARS = 600;
const MAX_AVOID_CHARS = 100;
const MAX_PLANNING_ATTEMPTS = 3;
export const CLUE_IMAGE_PLANNER_VERSION = 'clue-image-planner-v1';

const VALID_CLUE_TYPES = new Set(['character', 'location', 'evidence']);
const VALID_IMAGE_MODES = new Set([
  'character_portrait',
  'location_still',
  'evidence_contextual_closeup',
  'evidence_tabletop',
  'evidence_environmental_closeup',
  'evidence_structural_focus'
]);

const DEFAULT_IMAGE_SETTINGS = {
  model: process.env.MINIMAX_IMAGE_MODEL || 'image-01',
  response_format: 'url',
  n: 1,
  prompt_optimizer: false,
  aigc_watermark: false
};

function debugLog(message, data, hypothesisId) {
  const payload = {
    sessionId: 'd022cd',
    runId: 'image-trace',
    location: 'clueImage.js',
    message,
    data,
    hypothesisId,
    timestamp: Date.now()
  };
  appendFile(DEBUG_LOG_PATH, `${JSON.stringify(payload)}\n`).catch(() => {});
}

function requireText(value, field) {
  if (!String(value || '').trim()) throw new Error(`自动规划缺少 ${field}`);
}

function requireStringArray(value, field) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`自动规划的 ${field} 必须是字符串数组`);
  }
}

function fixedPromptLength(style, withExtraAvoid = true) {
  const suffix = withExtraAvoid ? ', .' : '.';
  return `. ${style.global_style_prompt}. Avoid: ${style.global_negative_prompt}${suffix}`.length;
}

export function promptLimitsForStyle(style) {
  const scenePromptMax = Math.max(
    80,
    Math.min(
      MAX_SCENE_PROMPT_CHARS,
      MAX_PROMPT_CHARS - 1 - fixedPromptLength(style, true) - MAX_AVOID_CHARS
    )
  );
  return {
    scene_prompt_en_max: scenePromptMax,
    avoid_en_max: MAX_AVOID_CHARS,
    final_prompt_max: MAX_PROMPT_CHARS
  };
}

export function validateAutomaticPlan(rawPlan, style) {
  if (!rawPlan || typeof rawPlan !== 'object' || !rawPlan._meta || typeof rawPlan._meta !== 'object') {
    throw new Error('自动规划结果必须是包含 _meta 的 JSON 对象');
  }
  const meta = rawPlan._meta;
  if (rawPlan.decision === 'skip') {
    if (meta.clue_type !== 'nonvisual' || meta.image_mode !== 'skip') {
      throw new Error('skip 结果必须标记为 nonvisual / skip');
    }
    requireText(meta.subject, '_meta.subject');
    requireText(meta.reason_cn, '_meta.reason_cn');
    return rawPlan;
  }

  if (rawPlan.decision !== 'generate') throw new Error('decision 只能是 generate 或 skip');
  if (!VALID_CLUE_TYPES.has(meta.clue_type)) throw new Error('自动规划返回了未知线索类型');
  if (!VALID_IMAGE_MODES.has(meta.image_mode)) throw new Error('自动规划返回了未知图像模式');

  const modeMatchesType =
    (meta.clue_type === 'character' && meta.image_mode === 'character_portrait') ||
    (meta.clue_type === 'location' && meta.image_mode === 'location_still') ||
    (meta.clue_type === 'evidence' && meta.image_mode.startsWith('evidence_'));
  if (!modeMatchesType) throw new Error('线索类型与图像模式不一致');

  requireText(rawPlan.scene_prompt_en, 'scene_prompt_en');
  if (typeof rawPlan.avoid_en !== 'string') throw new Error('avoid_en 必须是字符串');
  requireText(meta.subject, '_meta.subject');
  requireText(meta.visual_focus_cn, '_meta.visual_focus_cn');
  if (meta.clue_type !== 'character') requireText(meta.scene_anchor_cn, '_meta.scene_anchor_cn');
  requireStringArray(meta.visual_facts_cn, '_meta.visual_facts_cn');
  requireStringArray(meta.ambiguity_notes_cn, '_meta.ambiguity_notes_cn');

  if (rawPlan.scene_prompt_en.length > MAX_SCENE_PROMPT_CHARS) {
    throw new Error(`scene_prompt_en 长度 ${rawPlan.scene_prompt_en.length}，硬限制 <= ${MAX_SCENE_PROMPT_CHARS}`);
  }
  if (rawPlan.avoid_en.length > MAX_AVOID_CHARS) {
    throw new Error(`avoid_en 长度 ${rawPlan.avoid_en.length}，目标 <= ${MAX_AVOID_CHARS}`);
  }
  if (rawPlan.scene_prompt_en.includes(style.global_style_prompt) || rawPlan.scene_prompt_en.includes('Avoid:')) {
    throw new Error('scene_prompt_en 不得重复锁定风格或 Avoid 段');
  }
  if (rawPlan.scene_prompt_en.includes(style.global_negative_prompt)) {
    throw new Error('scene_prompt_en 不得重复锁定负向词');
  }

  const expectedAspectRatio = meta.image_mode === 'character_portrait' ? '3:4' : '4:3';
  if (rawPlan.aspect_ratio !== expectedAspectRatio) {
    throw new Error(`${meta.image_mode} 必须使用 ${expectedAspectRatio} 画幅`);
  }
  return rawPlan;
}

export function buildLockedImageRequest(plan, style) {
  const scenePrompt = plan.scene_prompt_en.trim().replace(/[.,;:\s]+$/, '');
  const extraAvoid = plan.avoid_en.trim().replace(/^[,\s]+|[,\s.]+$/g, '');
  const prompt = `${scenePrompt}. ${style.global_style_prompt}. Avoid: ${style.global_negative_prompt}${
    extraAvoid ? `, ${extraAvoid}` : ''
  }.`;
  if (prompt.length >= MAX_PROMPT_CHARS) {
    throw new Error(`最终 prompt 长度 ${prompt.length}，目标 < ${MAX_PROMPT_CHARS}`);
  }
  if (!prompt.includes(style.global_style_prompt) || !prompt.includes(style.global_negative_prompt)) {
    throw new Error('最终 prompt 未原样包含锁定风格或负向词');
  }
  return { ...DEFAULT_IMAGE_SETTINGS, prompt, aspect_ratio: plan.aspect_ratio };
}

function trimAtWordBoundary(value, maxChars) {
  const text = String(value || '').trim();
  if (text.length <= maxChars) return text;
  const candidate = text.slice(0, maxChars + 1);
  const lastSpace = candidate.lastIndexOf(' ');
  return candidate.slice(0, lastSpace >= Math.floor(maxChars * 0.7) ? lastSpace : maxChars).trim();
}

export function compactPlanToBudget(plan, style) {
  const compacted = {
    ...plan,
    scene_prompt_en: trimAtWordBoundary(plan.scene_prompt_en, MAX_SCENE_PROMPT_CHARS),
    avoid_en: trimAtWordBoundary(plan.avoid_en, MAX_AVOID_CHARS)
  };

  const avoidParts = compacted.avoid_en.split(/,\s*/).filter(Boolean);
  while (true) {
    compacted.avoid_en = avoidParts.join(', ');
    const fixedLength = fixedPromptLength(style, avoidParts.length > 0);
    const availableSceneChars = Math.max(
      1,
      MAX_PROMPT_CHARS - 1 - fixedLength - compacted.avoid_en.length
    );
    if (availableSceneChars >= 80 || avoidParts.length === 0) {
      compacted.scene_prompt_en = trimAtWordBoundary(compacted.scene_prompt_en, availableSceneChars);
      buildLockedImageRequest(compacted, style);
      return compacted;
    }
    avoidParts.pop();
  }
}

function generationFingerprint({ clue, occurrence, style, system }) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        plannerVersion: CLUE_IMAGE_PLANNER_VERSION,
        clueId: clue.id,
        occurrenceId: occurrence.id,
        style,
        system,
        textModel: process.env.MINIMAX_TEXT_MODEL || 'MiniMax-M3',
        imageModel: process.env.MINIMAX_IMAGE_MODEL || 'image-01'
      })
    )
    .digest('hex');
}

export async function prepareClueImage({ clueId, occurrenceId }) {
  const context = getClueReaderContext({ clueId, occurrenceId, contextChars: 1200 });
  if (!context) throw new Error('未知线索或线索出现位置');

  const [{ style, initializedNow }, system] = await Promise.all([
    ensureBookStyle(),
    readFile(PROMPT_PATH, 'utf8')
  ]);
  return {
    ...context,
    style,
    system,
    initializedNow,
    fingerprint: generationFingerprint({ ...context, style, system })
  };
}

async function planClueImage(prepared) {
  const limits = promptLimitsForStyle(prepared.style);
  const input = {
    selected_text: prepared.occurrence.selectedText,
    source_context: prepared.sourceContext,
    reader_context: prepared.readerContext,
    locked_style_prompt: prepared.style.global_style_prompt,
    locked_negative_prompt: prepared.style.global_negative_prompt,
    prompt_limits: limits,
    default_image_settings: DEFAULT_IMAGE_SETTINGS
  };
  const attempts = [];
  let lastError = '';

  for (let attempt = 1; attempt <= MAX_PLANNING_ATTEMPTS; attempt += 1) {
    const userPayload =
      attempt === 1
        ? input
        : {
            ...input,
            _retry_instruction: `第 ${attempt} 次自动规划。上次未通过：${lastError}。请从原始输入重新输出完整 JSON；scene_prompt_en <= ${limits.scene_prompt_en_max}，avoid_en <= ${limits.avoid_en_max}，最终 prompt < ${limits.final_prompt_max}。`
          };
    const rawPlan = await callMessagesApiForJson({
      system: prepared.system,
      user: JSON.stringify(userPayload, null, 2),
      temperature: attempt === 1 ? 0.35 : 0.2,
      maxTokens: 1800
    });

    try {
      const plan = validateAutomaticPlan(rawPlan, prepared.style);
      if (plan.decision === 'generate' && plan.scene_prompt_en.length > limits.scene_prompt_en_max) {
        throw new Error(
          `scene_prompt_en 长度 ${plan.scene_prompt_en.length}，目标 <= ${limits.scene_prompt_en_max}`
        );
      }
      const imageRequest = plan.decision === 'generate' ? buildLockedImageRequest(plan, prepared.style) : null;
      attempts.push({ attempt, valid: true, sceneLength: plan.scene_prompt_en?.length || 0, avoidLength: plan.avoid_en?.length || 0 });
      return { plan, imageRequest, input, attempts };
    } catch (error) {
      lastError = error.message;
      attempts.push({ attempt, valid: false, error: lastError });
      debugLog(
        'clue image planning validation failed',
        { clueId: prepared.clue.id, occurrenceId: prepared.occurrence.id, attempt, error: lastError },
        'CI-plan-error'
      );
      if (attempt === MAX_PLANNING_ATTEMPTS) {
        if (rawPlan?.decision === 'generate') {
          const compactedPlan = compactPlanToBudget(rawPlan, prepared.style);
          validateAutomaticPlan(compactedPlan, prepared.style);
          const imageRequest = buildLockedImageRequest(compactedPlan, prepared.style);
          attempts.push({
            attempt: 'automatic-compaction',
            valid: true,
            sceneLength: compactedPlan.scene_prompt_en.length,
            avoidLength: compactedPlan.avoid_en.length,
            finalPromptLength: imageRequest.prompt.length
          });
          return { plan: compactedPlan, imageRequest, input, attempts };
        }
        throw new Error(`${MAX_PLANNING_ATTEMPTS} 次自动规划后仍未通过校验：${lastError}`);
      }
    }
  }
  throw new Error('自动规划失败');
}

export async function generatePreparedClueImage(prepared) {
  debugLog(
    'image generation started',
    {
      generationType: 'clue-image',
      clueId: prepared.clue.id,
      occurrenceId: prepared.occurrence.id,
      targetSegment: prepared.occurrence.selectedText,
      chapterId: prepared.occurrence.chapterId,
      paragraphIndex: prepared.occurrence.paragraphIndex
    },
    'CI-entry'
  );
  const planning = await planClueImage(prepared);
  if (planning.plan.decision === 'skip') {
    return {
      skipped: true,
      reason: planning.plan._meta.reason_cn,
      clueType: 'nonvisual',
      imageMode: 'skip',
      subject: planning.plan._meta.subject,
      plan: planning.plan,
      planningAttempts: planning.attempts,
      fingerprint: prepared.fingerprint
    };
  }

  debugLog(
    'clue image prompt assembled',
    {
      clueId: prepared.clue.id,
      occurrenceId: prepared.occurrence.id,
      scenePromptLength: planning.plan.scene_prompt_en.length,
      avoidLength: planning.plan.avoid_en.length,
      finalPromptLength: planning.imageRequest.prompt.length,
      imageMode: planning.plan._meta.image_mode
    },
    'CI-prompt'
  );
  const image = await generateImageFromRequest(planning.imageRequest);
  debugLog(
    'clue image response received',
    {
      clueId: prepared.clue.id,
      occurrenceId: prepared.occurrence.id,
      traceId: image.traceId,
      imageUrlPresent: Boolean(image.imageUrl)
    },
    'CI-response'
  );
  return {
    ...image,
    prompt: planning.imageRequest.prompt,
    promptCharCount: planning.imageRequest.prompt.length,
    clueType: planning.plan._meta.clue_type,
    imageMode: planning.plan._meta.image_mode,
    subject: planning.plan._meta.subject,
    plan: planning.plan,
    plannerInput: planning.input,
    planningAttempts: planning.attempts,
    fingerprint: prepared.fingerprint,
    plannerVersion: CLUE_IMAGE_PLANNER_VERSION,
    styleInitializedNow: prepared.initializedNow,
    model: DEFAULT_IMAGE_SETTINGS.model,
    articleId: bookMeta.id
  };
}

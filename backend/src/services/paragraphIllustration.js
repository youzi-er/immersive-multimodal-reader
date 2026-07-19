import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getParagraphContext } from '../data.js';
import {
  callMessagesApiForJson,
  generateImageFromRequest,
  toImageGenerationBody
} from './minimax.js';
import {
  ensureBookStyle,
  imageStyleDebugCache,
  loadBookStyleFromDisk,
  regenerateBookStyle as regenerateSharedBookStyle
} from './bookImageStyle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.resolve(__dirname, '../prompts');
const DEBUG_LOG_PATH = path.resolve(__dirname, '../../../debug-d022cd.log');

const MAX_PROMPT_CHARS = 1400;
const MAX_SCENE_PROMPT_CHARS = 600;
const MAX_AVOID_CHARS = 100;
const MAX_PHASE2_ATTEMPTS = 3;
const VALID_COMPONENT_TYPES = new Set([
  'single_character_keyframe',
  'emotional_closeup',
  'two_character_relation',
  'action_scene',
  'environment_establishing',
  'object_detail'
]);
const VALID_ASPECT_RATIOS = new Set(['16:9']);

const DEFAULT_IMAGE_SETTINGS = {
  model: process.env.MINIMAX_IMAGE_MODEL || 'image-01',
  aspect_ratio: '16:9',
  response_format: 'url',
  n: 1,
  prompt_optimizer: false,
  aigc_watermark: false
};

async function loadPrompt(name) {
  return readFile(path.join(PROMPTS_DIR, name), 'utf8');
}

function debugLog(location, message, data, hypothesisId, runId = 'image-trace') {
  const payload = {
    sessionId: 'd022cd',
    runId,
    location,
    message,
    data,
    hypothesisId,
    timestamp: Date.now()
  };
  appendFile(DEBUG_LOG_PATH, `${JSON.stringify(payload)}\n`).catch(() => {});
}


function requireText(value, field) {
  if (!String(value || '').trim()) throw new Error(`阶段二规划缺少 ${field}`);
}

function fixedPromptLength(style, withExtraAvoid = true) {
  const extraAvoidSuffix = withExtraAvoid ? ', .' : '.';
  return `. ${style.global_style_prompt}. Avoid: ${style.global_negative_prompt}${extraAvoidSuffix}`.length;
}

export function paragraphPromptLimitsForStyle(style) {
  const available = MAX_PROMPT_CHARS - 1 - fixedPromptLength(style, true) - MAX_AVOID_CHARS;
  return {
    scene_prompt_en_max: Math.max(1, Math.min(MAX_SCENE_PROMPT_CHARS, available)),
    avoid_en_max: MAX_AVOID_CHARS,
    final_prompt_max: MAX_PROMPT_CHARS
  };
}

export function validateParagraphPlan(plan, style) {
  if (!plan || typeof plan !== 'object' || !plan._meta || typeof plan._meta !== 'object') {
    throw new Error('阶段二规划必须是包含 _meta 的 JSON 对象');
  }
  requireText(plan.scene_prompt_en, 'scene_prompt_en');
  if (typeof plan.avoid_en !== 'string') throw new Error('阶段二规划的 avoid_en 必须是字符串');
  requireText(plan.aspect_ratio, 'aspect_ratio');
  requireText(plan._meta.component_type, '_meta.component_type');
  requireText(plan._meta.scene_summary_cn, '_meta.scene_summary_cn');

  if (!VALID_COMPONENT_TYPES.has(plan._meta.component_type)) {
    throw new Error(`未知 component_type：${plan._meta.component_type}`);
  }
  if (!VALID_ASPECT_RATIOS.has(plan.aspect_ratio)) {
    throw new Error(`无效 aspect_ratio：${plan.aspect_ratio}`);
  }
  if (plan.scene_prompt_en.length > MAX_SCENE_PROMPT_CHARS) {
    throw new Error(
      `scene_prompt_en 长度 ${plan.scene_prompt_en.length}，硬限制 <= ${MAX_SCENE_PROMPT_CHARS}`
    );
  }
  if (plan.avoid_en.length > MAX_AVOID_CHARS) {
    throw new Error(`avoid_en 长度 ${plan.avoid_en.length}，目标 <= ${MAX_AVOID_CHARS}`);
  }
  if (
    plan.scene_prompt_en.includes(style.global_style_prompt) ||
    plan.scene_prompt_en.includes(style.global_negative_prompt) ||
    plan.scene_prompt_en.includes('Avoid:')
  ) {
    throw new Error('scene_prompt_en 不得重复锁定风格、锁定负向词或 Avoid 段');
  }
  return plan;
}

export function buildParagraphImageRequest(plan, style) {
  const scenePrompt = plan.scene_prompt_en.trim().replace(/[.,;:\s]+$/, '');
  const extraAvoid = plan.avoid_en.trim().replace(/^[,\s]+|[,\s.]+$/g, '');
  const prompt = `${scenePrompt}. ${style.global_style_prompt}. Avoid: ${style.global_negative_prompt}${
    extraAvoid ? `, ${extraAvoid}` : ''
  }.`;

  if (prompt.length >= MAX_PROMPT_CHARS) {
    throw new Error(`最终 prompt 长度 ${prompt.length}，目标 < ${MAX_PROMPT_CHARS}`);
  }
  if (!prompt.includes(style.global_style_prompt) || !prompt.includes(style.global_negative_prompt)) {
    throw new Error('最终 prompt 未原样包含锁定风格或全局负向词');
  }

  return {
    ...DEFAULT_IMAGE_SETTINGS,
    prompt,
    aspect_ratio: '16:9',
    _meta: {
      component_type: plan._meta.component_type,
      scene_summary_cn: plan._meta.scene_summary_cn,
      prompt_char_count: prompt.length
    }
  };
}

function trimAtWordBoundary(value, maxChars) {
  const text = String(value || '').trim();
  if (text.length <= maxChars) return text;
  const candidate = text.slice(0, maxChars + 1);
  const lastSpace = candidate.lastIndexOf(' ');
  return candidate.slice(0, lastSpace >= Math.floor(maxChars * 0.7) ? lastSpace : maxChars).trim();
}

export function compactParagraphPlanToBudget(plan, style) {
  const compacted = {
    ...plan,
    scene_prompt_en: trimAtWordBoundary(plan.scene_prompt_en, MAX_SCENE_PROMPT_CHARS),
    avoid_en: trimAtWordBoundary(plan.avoid_en, MAX_AVOID_CHARS)
  };
  const avoidParts = compacted.avoid_en.split(/,\s*/).filter(Boolean);

  while (true) {
    compacted.avoid_en = avoidParts.join(', ');
    const availableSceneChars =
      MAX_PROMPT_CHARS -
      1 -
      fixedPromptLength(style, avoidParts.length > 0) -
      compacted.avoid_en.length;
    if (availableSceneChars < 1) {
      if (avoidParts.length > 0) {
        avoidParts.pop();
        continue;
      }
      throw new Error('锁定风格和全局负向词本身已超过最终 prompt 长度预算');
    }

    compacted.scene_prompt_en = trimAtWordBoundary(compacted.scene_prompt_en, availableSceneChars);
    requireText(compacted.scene_prompt_en, 'scene_prompt_en');
    buildParagraphImageRequest(compacted, style);
    return compacted;
  }
}

function redactDebugValue(key, value) {
  if (key === 'imageUrl' || key === 'base64' || key === 'audioHex' || key === 'audioUrl') {
    return undefined;
  }

  if (/api[_-]?key|authorization/i.test(key)) {
    return '[redacted]';
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeDebugPayload(item))
      .filter((item) => item !== undefined);
  }

  if (value && typeof value === 'object') {
    return sanitizeDebugPayload(value);
  }

  return value;
}

function sanitizeDebugPayload(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeDebugPayload(item))
      .filter((item) => item !== undefined);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entryValue]) => [key, redactDebugValue(key, entryValue)])
      .filter(([, entryValue]) => entryValue !== undefined)
  );
}

async function readImageDebugEvents() {
  let logText = '';
  try {
    logText = await readFile(DEBUG_LOG_PATH, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  return logText
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((event) => event && event.runId === 'image-trace')
    .sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0))
    .map((event) => ({
      timestamp: event.timestamp,
      runId: event.runId,
      location: event.location,
      message: event.message,
      hypothesisId: event.hypothesisId,
      data: sanitizeDebugPayload(event.data)
    }));
}

function summarizeImageRecord(events, index) {
  const start = events.find((event) => event.message === 'image generation started');
  const normalized = events.find((event) => event.message === 'image phase2 normalized request');
  const cluePrompt = events.find((event) => event.message === 'clue image prompt assembled');
  const response = events.find(
    (event) => event.message === 'image response received' || event.message === 'clue image response received'
  );

  return {
    id: `${start?.timestamp ?? events[0]?.timestamp ?? Date.now()}-${index}`,
    startedAt: start?.timestamp ?? events[0]?.timestamp ?? null,
    targetSegment: start?.data?.targetSegment ?? '',
    chapterId: start?.data?.chapterId ?? '',
    paragraphIndex: start?.data?.paragraphIndex ?? null,
    generationType: start?.data?.generationType ?? 'paragraph-image',
    clueId: start?.data?.clueId ?? '',
    occurrenceId: start?.data?.occurrenceId ?? '',
    componentType: normalized?.data?.componentType ?? cluePrompt?.data?.imageMode ?? '',
    promptCharCount: normalized?.data?.promptCharCount ?? cluePrompt?.data?.finalPromptLength ?? null,
    traceId: response?.data?.traceId ?? null,
    events
  };
}

function groupImageDebugRecords(events, limit) {
  const records = [];
  let current = null;

  for (const event of events) {
    if (event.message === 'image generation started') {
      if (current?.length) {
        records.push(current);
      }
      current = [event];
      continue;
    }

    if (!current) {
      current = [event];
    } else {
      current.push(event);
    }
  }

  if (current?.length) {
    records.push(current);
  }

  return records
    .slice(-limit)
    .map((recordEvents, index) => summarizeImageRecord(recordEvents, index))
    .reverse();
}

export async function regenerateBookStyle() {
  return regenerateSharedBookStyle();
}

export async function getImageDebugInfo({ limit = 20 } = {}) {
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
  const style = await loadBookStyleFromDisk();
  const [phase1SystemPrompt, phase2SystemPrompt, events] = await Promise.all([
    loadPrompt('phase1-system.md'),
    loadPrompt('phase2-system.md'),
    readImageDebugEvents()
  ]);

  return {
    cache: imageStyleDebugCache(style),
    prompts: {
      phase1System: phase1SystemPrompt,
      phase2System: phase2SystemPrompt
    },
    records: groupImageDebugRecords(events, safeLimit),
    eventCount: events.length
  };
}

function buildRetryUserMessage(baseInput, attempt, lastError) {
  if (attempt === 1) {
    return JSON.stringify(baseInput, null, 2);
  }

  return JSON.stringify(
    {
      ...baseInput,
      _retry_instruction: `第 ${attempt} 次自动规划。上次未通过：${lastError}。请从原始输入重新输出完整规划 JSON；scene_prompt_en <= ${baseInput.prompt_limits.scene_prompt_en_max}，avoid_en <= ${baseInput.prompt_limits.avoid_en_max}，最终 prompt < ${baseInput.prompt_limits.final_prompt_max}。不要输出或复制锁定风格和全局负向词。`
    },
    null,
    2
  );
}

async function runPhase2({ context, targetSegment, style }) {
  const system = await loadPrompt('phase2-system.md');
  const promptLimits = paragraphPromptLimitsForStyle(style);
  const llmInput = {
    context: context.trim(),
    target_segment: targetSegment.trim(),
    locked_style_prompt: style.global_style_prompt,
    locked_negative_prompt: style.global_negative_prompt,
    default_image_settings: DEFAULT_IMAGE_SETTINGS,
    allowed_aspect_ratios: [...VALID_ASPECT_RATIOS],
    prompt_limits: promptLimits,
    style_profile_cn: style.style_profile_cn || null,
    usage_notes: style.usage_notes || null
  };

  let lastError = '';
  for (let attempt = 1; attempt <= MAX_PHASE2_ATTEMPTS; attempt += 1) {
    const user = buildRetryUserMessage(llmInput, attempt, lastError);
    debugLog(
      'paragraphIllustration.js:runPhase2',
      'image phase2 prompt sent',
      { attempt, systemPrompt: system, userPayload: llmInput, userJsonLength: user.length },
      'I2-send'
    );
    const raw = await callMessagesApiForJson({
      system,
      user,
      temperature: attempt === 1 ? 0.7 : 0.3,
      maxTokens: 1800
    });
    debugLog(
      'paragraphIllustration.js:runPhase2',
      'image phase2 raw response',
      { attempt, raw },
      'I2-recv'
    );
    try {
      const plan = validateParagraphPlan(raw, style);
      if (plan.scene_prompt_en.length > promptLimits.scene_prompt_en_max) {
        throw new Error(
          `scene_prompt_en 长度 ${plan.scene_prompt_en.length}，当前风格预算 <= ${promptLimits.scene_prompt_en_max}`
        );
      }
      const result = buildParagraphImageRequest(plan, style);
      debugLog(
        'paragraphIllustration.js:runPhase2',
        'image phase2 normalized request',
        {
          attempt,
          componentType: result._meta.component_type,
          sceneSummaryCn: result._meta.scene_summary_cn,
          promptCharCount: result.prompt.length,
          imageRequest: result
        },
        'I2-normalized'
      );
      return result;
    } catch (error) {
      lastError = error.message;
      debugLog(
        'paragraphIllustration.js:runPhase2',
        'image phase2 validation failed',
        {
          attempt,
          error: lastError,
          scenePromptLength: raw?.scene_prompt_en?.length ?? 0,
          avoidLength: raw?.avoid_en?.length ?? 0,
          scenePromptTarget: promptLimits.scene_prompt_en_max,
          avoidTarget: promptLimits.avoid_en_max,
          finalPromptTarget: promptLimits.final_prompt_max
        },
        'I2-error'
      );
      if (attempt === MAX_PHASE2_ATTEMPTS) {
        if (raw?.scene_prompt_en && typeof raw.avoid_en === 'string' && raw?._meta) {
          try {
            const compactedPlan = compactParagraphPlanToBudget(raw, style);
            validateParagraphPlan(compactedPlan, style);
            const result = buildParagraphImageRequest(compactedPlan, style);
            debugLog(
              'paragraphIllustration.js:runPhase2',
              'image phase2 normalized request',
              {
                attempt: 'automatic-compaction',
                componentType: result._meta.component_type,
                sceneSummaryCn: result._meta.scene_summary_cn,
                promptCharCount: result.prompt.length,
                imageRequest: result
              },
              'I2-normalized'
            );
            return result;
          } catch (compactionError) {
            lastError = compactionError.message;
          }
        }
        throw new Error(`${MAX_PHASE2_ATTEMPTS} 次自动规划后仍未通过校验：${lastError}`);
      }
    }
  }

  throw new Error('阶段二生成失败');
}

export function resolveParagraphIllustrationTarget({ chapterId, paragraphIndex, targetSegment }) {
  const paragraphContext = getParagraphContext({ chapterId, paragraphIndex, contextChars: 1000 });
  if (!paragraphContext) {
    const error = new Error('未找到目标段落');
    error.statusCode = 404;
    throw error;
  }

  const safeTarget = String(targetSegment || paragraphContext.originalTarget).trim();
  if (!safeTarget) {
    throw new Error('目标段落不能为空');
  }

  if (safeTarget !== paragraphContext.originalTarget.trim()) {
    const error = new Error('段落插图必须绑定当前标准段落的完整原文');
    error.statusCode = 400;
    throw error;
  }

  return { paragraphContext, safeTarget };
}

export async function generateParagraphIllustration({ chapterId, paragraphIndex, targetSegment }) {
  const { paragraphContext, safeTarget } = resolveParagraphIllustrationTarget({
    chapterId,
    paragraphIndex,
    targetSegment
  });

  debugLog(
    'paragraphIllustration.js:generateParagraphIllustration',
    'image generation started',
    {
      chapterId,
      paragraphIndex,
      targetSegment: safeTarget,
      contextPreview: paragraphContext.context.slice(0, 500)
    },
    'I-entry'
  );

  const { style, initializedNow } = await ensureBookStyle();
  const phase2Output = await runPhase2({
    context: paragraphContext.context,
    targetSegment: safeTarget,
    style
  });
  const imageRequest = toImageGenerationBody(phase2Output);
  debugLog(
    'paragraphIllustration.js:generateParagraphIllustration',
    'image request sent',
    { imageRequest },
    'I-send'
  );
  const image = await generateImageFromRequest(imageRequest);
  debugLog(
    'paragraphIllustration.js:generateParagraphIllustration',
    'image response received',
    { traceId: image.traceId, imageUrlPresent: Boolean(image.imageUrl) },
    'I-recv'
  );

  return {
    ...image,
    prompt: phase2Output.prompt,
    sceneSummaryCn: phase2Output._meta.scene_summary_cn,
    componentType: phase2Output._meta.component_type,
    promptCharCount: phase2Output._meta.prompt_char_count,
    styleInitializedNow: initializedNow,
    context: {
      chapterId: paragraphContext.chapterId,
      chapterTitle: paragraphContext.chapterTitle,
      paragraphIndex: paragraphContext.paragraphIndex,
      originalTarget: paragraphContext.originalTarget
    }
  };
}

export async function generateDiyParagraphIllustration({ finalPrompt }) {
  const prompt = String(finalPrompt ?? '');
  if (!prompt.trim()) {
    const error = new Error('Illustration prompt is required');
    error.statusCode = 400;
    throw error;
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    const error = new Error(`Illustration prompt cannot exceed ${MAX_PROMPT_CHARS} characters`);
    error.statusCode = 400;
    throw error;
  }

  const image = await generateImageFromRequest({
    ...DEFAULT_IMAGE_SETTINGS,
    prompt,
    aspect_ratio: '16:9',
    n: 1
  });
  return {
    ...image,
    prompt,
    aspectRatio: '16:9',
    model: DEFAULT_IMAGE_SETTINGS.model
  };
}

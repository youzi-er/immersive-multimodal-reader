import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getParagraphContext } from '../data.js';
import {
  assertRequiredFields,
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
const MAX_PHASE2_ATTEMPTS = 3;
const MINIMAL_AVOID =
  'bad anatomy, extra fingers, deformed hands, watermark, text, modern clothing, anime, cartoon, blurry';

const IMAGE_REQUEST_REQUIRED = ['model', 'prompt', 'aspect_ratio', 'response_format'];
const META_REQUIRED = ['component_type', 'scene_summary_cn', 'prompt_char_count'];
const VALID_COMPONENT_TYPES = new Set([
  'single_character_keyframe',
  'emotional_closeup',
  'two_character_relation',
  'action_scene',
  'environment_establishing',
  'object_detail'
]);

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


function compressPrompt(prompt, lockedStylePrompt, maxChars = MAX_PROMPT_CHARS) {
  if (prompt.length < maxChars) return prompt;

  const avoidMarker = '. Avoid:';
  const avoidIdx = prompt.indexOf(avoidMarker);
  let positive = avoidIdx >= 0 ? prompt.slice(0, avoidIdx + 1).trimEnd() : prompt;
  let avoid = avoidIdx >= 0 ? prompt.slice(avoidIdx + avoidMarker.length).trim() : '';

  if (!positive.includes(lockedStylePrompt)) {
    positive = `${positive.replace(/\s+$/, '')} ${lockedStylePrompt}`.trim();
  }

  const build = (pos, av) => (av ? `${pos.replace(/\.\s*$/, '')}. Avoid: ${av}` : pos);

  let candidate = build(positive, avoid);
  if (candidate.length < maxChars) return candidate;

  const avoidWords = (avoid || MINIMAL_AVOID).split(/,\s*/).filter(Boolean);
  while (avoidWords.length > 4) {
    avoidWords.pop();
    candidate = build(positive, avoidWords.join(', '));
    if (candidate.length < maxChars) return candidate;
  }

  candidate = build(positive, MINIMAL_AVOID);
  if (candidate.length < maxChars) return candidate;

  const lockedIdx = positive.lastIndexOf(lockedStylePrompt);
  if (lockedIdx > 0) {
    const scenePart = positive.slice(0, lockedIdx).trim();
    const lockedPart = positive.slice(lockedIdx);
    const words = scenePart.split(/\s+/);
    while (words.length > 20) {
      words.pop();
      candidate = build(`${words.join(' ')} ${lockedPart}`.trim(), MINIMAL_AVOID);
      if (candidate.length < maxChars) return candidate;
    }
  }

  return candidate.slice(0, maxChars - 1);
}

function normalizePhase2Result(data, lockedStylePrompt) {
  const normalized = { ...data };
  if (normalized.prompt?.length >= MAX_PROMPT_CHARS) {
    normalized.prompt = compressPrompt(normalized.prompt, lockedStylePrompt);
  }
  if (normalized._meta) {
    normalized._meta = {
      ...normalized._meta,
      prompt_char_count: normalized.prompt.length
    };
  }
  return normalized;
}

function validatePhase2Output(data, lockedStylePrompt) {
  assertRequiredFields(data, IMAGE_REQUEST_REQUIRED, '阶段二输出');
  if (!data._meta || typeof data._meta !== 'object') {
    throw new Error('阶段二输出缺少 _meta 对象');
  }
  assertRequiredFields(data._meta, META_REQUIRED, '阶段二输出 _meta');

  if (data.prompt.length >= MAX_PROMPT_CHARS) {
    throw new Error(`prompt 长度 ${data.prompt.length} 字符，超过限制 ${MAX_PROMPT_CHARS - 1}`);
  }
  if (data._meta.prompt_char_count >= MAX_PROMPT_CHARS) {
    throw new Error(`_meta.prompt_char_count (${data._meta.prompt_char_count}) 必须 < ${MAX_PROMPT_CHARS}`);
  }
  if (!VALID_COMPONENT_TYPES.has(data._meta.component_type)) {
    data._meta.component_type = 'environment_establishing';
  }
  if (!data.prompt.includes(lockedStylePrompt)) {
    throw new Error('阶段二输出 prompt 未包含 locked_style_prompt 完整子串');
  }
  if (!data.prompt.includes('Avoid:')) {
    throw new Error('阶段二输出 prompt 未包含 Avoid: 负向词段');
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

function buildRetryUserMessage(baseInput, attempt, lastPromptLength) {
  if (attempt === 1) {
    return JSON.stringify(baseInput, null, 2);
  }

  return JSON.stringify(
    {
      ...baseInput,
      _retry_instruction: `第 ${attempt} 次生成：上次 prompt 长度为 ${lastPromptLength} 字符，已超过限制。请重新输出完整生图请求体 JSON。prompt 必须严格小于 ${MAX_PROMPT_CHARS} 字符。输出前在脑中自检 3 遍字符数。优先压缩 Avoid 段和冗余修饰，保留 locked_style_prompt 原文与核心画面。`
    },
    null,
    2
  );
}

async function runPhase2({ context, targetSegment, style }) {
  const system = await loadPrompt('phase2-system.md');
  const llmInput = {
    context: context.trim(),
    target_segment: targetSegment.trim(),
    locked_style_prompt: style.global_style_prompt,
    locked_negative_prompt: style.global_negative_prompt,
    default_image_settings: DEFAULT_IMAGE_SETTINGS,
    style_profile_cn: style.style_profile_cn || null,
    usage_notes: style.usage_notes || null
  };

  let lastPromptLength = 0;
  for (let attempt = 1; attempt <= MAX_PHASE2_ATTEMPTS; attempt += 1) {
    const user = buildRetryUserMessage(llmInput, attempt, lastPromptLength);
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
    const result = normalizePhase2Result(raw, llmInput.locked_style_prompt);
    lastPromptLength = result.prompt?.length ?? 0;

    try {
      validatePhase2Output(result, llmInput.locked_style_prompt);
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
      return {
        ...result,
        _meta: {
          ...result._meta,
          prompt_char_count: result.prompt.length
        },
        book_id: bookMeta.id,
        created_at: new Date().toISOString()
      };
    } catch (error) {
      debugLog(
        'paragraphIllustration.js:runPhase2',
        'image phase2 validation failed',
        { attempt, error: error.message, promptLength: lastPromptLength },
        'I2-error'
      );
      if (attempt === MAX_PHASE2_ATTEMPTS) {
        throw new Error(`${MAX_PHASE2_ATTEMPTS} 次尝试后仍不满足要求：${error.message}`);
      }
    }
  }

  throw new Error('阶段二生成失败');
}

export async function generateParagraphIllustration({ chapterId, paragraphIndex, targetSegment }) {
  const paragraphContext = getParagraphContext({ chapterId, paragraphIndex, contextChars: 1000 });
  if (!paragraphContext) {
    throw new Error('未找到目标段落');
  }

  const safeTarget = String(targetSegment || paragraphContext.originalTarget).trim();
  if (!safeTarget) {
    throw new Error('目标段落不能为空');
  }

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

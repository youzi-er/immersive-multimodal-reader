const MINIMAX_API_BASE = (process.env.MINIMAX_API_BASE || 'https://api.minimaxi.com').replace(/\/$/, '');
const MINIMAX_TIMEOUT_MS = Number(process.env.MINIMAX_TIMEOUT_MS || 45000);
const MAX_API_PROMPT_CHARS = 1500;
const RETRYABLE_STATUS_CODES = new Set([1002]);
const VALID_IMAGE_MODELS = new Set(['image-01', 'image-01-live']);
const VALID_ASPECT_RATIOS = new Set(['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9']);
const VALID_RESPONSE_FORMATS = new Set(['url', 'base64']);

function getApiKey() {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    throw new Error('MINIMAX_API_KEY is not configured');
  }
  return apiKey;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseMiniMaxError(data, httpStatus) {
  const statusCode = data?.base_resp?.status_code;
  const statusMsg = data?.base_resp?.status_msg || data?.error?.message || data?.message;
  const err = new Error(statusMsg || `MiniMax request failed: ${httpStatus}`);
  err.statusCode = statusCode;
  err.httpStatus = httpStatus;
  err.retryable = RETRYABLE_STATUS_CODES.has(statusCode);
  return err;
}

async function requestMiniMax(path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MINIMAX_TIMEOUT_MS);
  let response;

  try {
    response = await fetch(`${MINIMAX_API_BASE}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`MiniMax request timed out after ${MINIMAX_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw parseMiniMaxError(data, response.status);
  }

  if (data?.base_resp && data.base_resp.status_code !== 0) {
    throw parseMiniMaxError(data, response.status);
  }

  return data;
}

async function requestMiniMaxWithRetry(path, body, maxRetries = 3) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      return await requestMiniMax(path, body);
    } catch (error) {
      lastError = error;
      if (!error.retryable || attempt === maxRetries) {
        throw error;
      }
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }

  throw lastError;
}

function hexToDataUrl(hex, format = 'mp3') {
  const cleanHex = String(hex || '').trim();
  if (!cleanHex) {
    throw new Error('MiniMax returned empty audio');
  }

  const buffer = Buffer.from(cleanHex, 'hex');
  return `data:audio/${format};base64,${buffer.toString('base64')}`;
}

export function extractJsonFromText(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('LLM 返回内容为空');
  }

  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`无法从 LLM 回复中定位 JSON 对象。原文前 500 字：\n${trimmed.slice(0, 500)}`);
  }

  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (error) {
    throw new Error(`JSON 解析失败：${error.message}\n原文前 500 字：\n${trimmed.slice(0, 500)}`);
  }
}

export function assertRequiredFields(obj, fields, label = '输出') {
  const missing = fields.filter((key) => {
    const value = obj?.[key];
    if (value === undefined || value === null) return true;
    if (typeof value === 'string' && value.trim() === '') return true;
    return false;
  });

  if (missing.length > 0) {
    throw new Error(`${label} 缺少必填字段：${missing.join(', ')}`);
  }
}

function contentToText(content) {
  return (Array.isArray(content) ? content : [])
    .map((item) => (typeof item === 'string' ? item : item?.text || ''))
    .join('')
    .trim();
}

export async function callMessagesApi({ system, user, temperature = 0.7, maxTokens = 1600 }) {
  const data = await requestMiniMax('/anthropic/v1/messages', {
    model: process.env.MINIMAX_TEXT_MODEL || 'MiniMax-M3',
    max_tokens: maxTokens,
    temperature,
    system,
    messages: [
      {
        role: 'user',
        content: user
      }
    ]
  });

  return contentToText(data.content);
}

export async function callMessagesApiForJson(options) {
  return extractJsonFromText(await callMessagesApi(options));
}

export async function callMessagesApiForJsonWithRetry(options) {
  try {
    return await callMessagesApiForJson(options);
  } catch (firstError) {
    try {
      return await callMessagesApiForJson({ ...options, temperature: 0.2 });
    } catch (secondError) {
      throw new Error(`${firstError.message}\n重试后仍失败：${secondError.message}`);
    }
  }
}

function validateImageRequestBody(body) {
  if (!body || typeof body !== 'object') {
    throw new Error('生图请求体必须是对象');
  }
  if (!body.model || !VALID_IMAGE_MODELS.has(body.model)) {
    throw new Error(`model 必须是 ${[...VALID_IMAGE_MODELS].join(' 或 ')}`);
  }
  if (!body.prompt?.trim()) {
    throw new Error('prompt 不能为空');
  }
  if (body.prompt.length > MAX_API_PROMPT_CHARS) {
    throw new Error(`prompt 长度 ${body.prompt.length} 超过 API 上限 ${MAX_API_PROMPT_CHARS}`);
  }
  if (body.aspect_ratio && !VALID_ASPECT_RATIOS.has(body.aspect_ratio)) {
    throw new Error(`无效的 aspect_ratio：${body.aspect_ratio}`);
  }
  if (body.response_format && !VALID_RESPONSE_FORMATS.has(body.response_format)) {
    throw new Error(`无效的 response_format：${body.response_format}`);
  }
  if (body.n != null && (body.n < 1 || body.n > 9)) {
    throw new Error('n 必须在 1-9 之间');
  }
  if (body.model === 'image-01' && body.style) {
    throw new Error('model 为 image-01 时不应包含 style 字段');
  }
}

export function toImageGenerationBody(phase2Output) {
  const {
    model,
    prompt,
    aspect_ratio: aspectRatio,
    response_format: responseFormat,
    n,
    prompt_optimizer: promptOptimizer,
    aigc_watermark: aigcWatermark,
    style,
    width,
    height,
    seed
  } = phase2Output;

  const body = {
    model,
    prompt,
    aspect_ratio: aspectRatio,
    response_format: responseFormat,
    n,
    prompt_optimizer: promptOptimizer,
    aigc_watermark: aigcWatermark
  };

  if (style) body.style = style;
  if (width) body.width = width;
  if (height) body.height = height;
  if (seed != null) body.seed = seed;

  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined && value !== null));
}

export async function chatWithMiniMax({ question, chapterTitle, context, collectedClues = [] }) {
  const systemPrompt = [
    '你是一个面向探案小说阅读网站的案情助手。',
    '你只能基于用户当前章节、当前段落和已收集线索回答。',
    '不要剧透后续情节；如果问题涉及后续真相，只能提示“当前信息还不足”。',
    '回答要简洁、清楚，适合普通读者理解。'
  ].join('\n');

  const userPrompt = [
    `当前作品：《斑点带子案》`,
    chapterTitle ? `当前章节：${chapterTitle}` : '',
    context ? `当前上下文：${context}` : '',
    collectedClues.length ? `已收集线索：${collectedClues.join('、')}` : '已收集线索：暂无',
    `读者问题：${question}`
  ]
    .filter(Boolean)
    .join('\n');

  const answer = await callMessagesApi({
    system: systemPrompt,
    user: userPrompt,
    maxTokens: 800
  });

  return answer || '当前没有生成有效回答，请稍后再试。';
}

const VALID_TTS_EMOTIONS = new Set([
  'happy',
  'sad',
  'angry',
  'fearful',
  'disgusted',
  'surprised',
  'calm',
  'fluent',
  'whisper'
]);

const SPEECH_28_UNSUPPORTED_EMOTIONS = new Set(['whisper', 'fluent']);

function isSpeech28Model(model) {
  return /^speech-2\.8/i.test(String(model || ''));
}

function normalizeTtsBody(body) {
  if (!body || typeof body !== 'object') {
    throw new Error('TTS 请求体必须是对象');
  }

  const voiceId = body.voice_setting?.voice_id;
  if (!voiceId?.trim()) {
    throw new Error('TTS 请求体缺少 voice_setting.voice_id');
  }

  if (!body.text?.trim()) {
    throw new Error('TTS 请求体缺少 text');
  }

  const emotion = body.voice_setting?.emotion;
  if (emotion && !VALID_TTS_EMOTIONS.has(emotion)) {
    throw new Error(`无效的 emotion：${emotion}`);
  }

  const model = String(body.model || '');
  if (isSpeech28Model(model) && emotion && SPEECH_28_UNSUPPORTED_EMOTIONS.has(emotion)) {
    delete body.voice_setting.emotion;
  }

  return body;
}

function parseTtsResponse(data) {
  const audioHex = data?.data?.audio;
  const format = data?.extra_info?.audio_format || 'mp3';

  return {
    audioHex,
    audioUrl: hexToDataUrl(audioHex, format),
    durationMs: data?.extra_info?.audio_length ?? null,
    traceId: data?.trace_id ?? null,
    audioFormat: format
  };
}

export async function synthesizeSpeechFromBody(body) {
  const normalized = normalizeTtsBody(body);
  const data = await requestMiniMaxWithRetry('/v1/t2a_v2', normalized);
  return parseTtsResponse(data);
}

export async function synthesizeSpeech({ text, voiceId, speed = 1, pitch = 0, emotion = 'calm' }) {
  return synthesizeSpeechFromBody({
    model: process.env.MINIMAX_TTS_MODEL || 'speech-2.8-hd',
    text,
    stream: false,
    language_boost: 'Chinese',
    voice_setting: {
      voice_id: voiceId || process.env.MINIMAX_DEFAULT_VOICE_ID || 'Chinese (Mandarin)_Lyrical_Voice',
      speed,
      vol: 1,
      pitch,
      emotion
    },
    audio_setting: {
      sample_rate: 32000,
      bitrate: 128000,
      format: 'mp3',
      channel: 1
    },
    subtitle_enable: false,
    output_format: 'hex',
    aigc_watermark: false
  });
}

export async function generateImage({ prompt, aspectRatio = '16:9' }) {
  return generateImageFromRequest({
    model: process.env.MINIMAX_IMAGE_MODEL || 'image-01',
    prompt,
    aspect_ratio: aspectRatio,
    response_format: 'url',
    n: 1
  });
}

export async function generateImageFromRequest(body) {
  validateImageRequestBody(body);
  const data = await requestMiniMaxWithRetry('/v1/image_generation', body);

  const imageUrl = data?.data?.image_urls?.[0];
  if (!imageUrl) {
    throw new Error('MiniMax returned no image URL');
  }

  return {
    imageUrl,
    traceId: data?.trace_id ?? null
  };
}

export async function designVoice({ prompt, previewText, voiceId }) {
  const body = {
    prompt,
    preview_text: previewText
  };

  if (voiceId) {
    body.voice_id = voiceId;
  }

  const data = await requestMiniMax('/v1/voice_design', body);

  return {
    voiceId: data?.voice_id,
    trialAudioUrl: data?.trial_audio ? hexToDataUrl(data.trial_audio, 'mp3') : null
  };
}

export function buildSherlockImagePrompt({ chapterTitle, scenePrompt, mood }) {
  return [
    'cinematic realistic novel illustration, Victorian London detective mystery, restrained and elegant art direction,',
    'natural human proportions, real fabric texture, atmospheric depth, soft volumetric light, muted brown blue gray palette,',
    'gaslight and candlelight accents, calm but tense composition, film still feeling, high detail, clean readable scene design,',
    `scene: ${chapterTitle}. ${scenePrompt}. mood: ${mood}.`,
    'no text, no watermark, no logo, no modern objects, no extra characters, no distorted hands'
  ].join(' ');
}

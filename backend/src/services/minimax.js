const MINIMAX_API_BASE = process.env.MINIMAX_API_BASE || 'https://api.minimaxi.com';

function getApiKey() {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    throw new Error('MINIMAX_API_KEY is not configured');
  }
  return apiKey;
}

async function requestMiniMax(path, body) {
  const response = await fetch(`${MINIMAX_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.base_resp?.status_msg || data?.error?.message || `MiniMax request failed: ${response.status}`);
  }

  if (data?.base_resp && data.base_resp.status_code !== 0) {
    throw new Error(data.base_resp.status_msg || `MiniMax error code: ${data.base_resp.status_code}`);
  }

  return data;
}

function hexToDataUrl(hex, format = 'mp3') {
  const cleanHex = String(hex || '').trim();
  if (!cleanHex) {
    throw new Error('MiniMax returned empty audio');
  }

  const buffer = Buffer.from(cleanHex, 'hex');
  return `data:audio/${format};base64,${buffer.toString('base64')}`;
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

  const data = await requestMiniMax('/anthropic/v1/messages', {
    model: process.env.MINIMAX_TEXT_MODEL || 'MiniMax-M3',
    max_tokens: 800,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: userPrompt
      }
    ]
  });

  const content = Array.isArray(data.content) ? data.content : [];
  const answer = content
    .map((item) => (typeof item === 'string' ? item : item?.text || ''))
    .join('')
    .trim();

  return answer || '当前没有生成有效回答，请稍后再试。';
}

export async function synthesizeSpeech({ text, voiceId, speed = 1, pitch = 0, emotion = 'calm' }) {
  const data = await requestMiniMax('/v1/t2a_v2', {
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

  const audioHex = data?.data?.audio;
  return {
    audioUrl: hexToDataUrl(audioHex, data?.extra_info?.audio_format || 'mp3'),
    durationMs: data?.extra_info?.audio_length ?? null,
    traceId: data?.trace_id ?? null
  };
}

export async function generateImage({ prompt, aspectRatio = '16:9' }) {
  const data = await requestMiniMax('/v1/image_generation', {
    model: process.env.MINIMAX_IMAGE_MODEL || 'image-01',
    prompt,
    aspect_ratio: aspectRatio,
    response_format: 'url',
    n: 1
  });

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

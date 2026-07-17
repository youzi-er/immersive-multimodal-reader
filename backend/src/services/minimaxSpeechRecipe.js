const MODELS = [
  'speech-2.8-hd',
  'speech-2.8-turbo',
  'speech-2.6-hd',
  'speech-2.6-turbo',
  'speech-02-hd',
  'speech-02-turbo',
  'speech-01-hd',
  'speech-01-turbo'
];
const VOCAL_TAG_MODELS = ['speech-2.8-hd', 'speech-2.8-turbo'];

const EMOTIONS = [
  { value: '', label: '自动' },
  { value: 'happy', label: '高兴' },
  { value: 'sad', label: '悲伤' },
  { value: 'angry', label: '愤怒' },
  { value: 'fearful', label: '害怕' },
  { value: 'disgusted', label: '厌恶' },
  { value: 'surprised', label: '惊讶' },
  { value: 'calm', label: '平静' }
];

const VOCAL_TAGS = [
  ['laughs', '笑声'],
  ['chuckle', '轻笑'],
  ['coughs', '咳嗽'],
  ['clear-throat', '清嗓子'],
  ['groans', '呻吟'],
  ['breath', '换气'],
  ['pant', '喘气'],
  ['inhale', '吸气'],
  ['exhale', '呼气'],
  ['gasps', '倒吸气'],
  ['sniffs', '吸鼻子'],
  ['sighs', '叹气'],
  ['snorts', '喷鼻息'],
  ['burps', '打嗝'],
  ['lip-smacking', '咂嘴'],
  ['humming', '哼唱'],
  ['hissing', '嘶声'],
  ['emm', '嗯'],
  ['sneezes', '喷嚏']
].map(([value, label]) => ({ value, label }));

const SOUND_EFFECTS = [
  { value: '', label: '无' },
  { value: 'spacious_echo', label: '空旷回音' },
  { value: 'auditorium_echo', label: '礼堂广播' },
  { value: 'lofi_telephone', label: '电话失真' },
  { value: 'robotic', label: '机械音' }
];

const LANGUAGES = [
  'Chinese', 'Chinese,Yue', 'English', 'Arabic', 'Russian', 'Spanish', 'French',
  'Portuguese', 'German', 'Turkish', 'Dutch', 'Ukrainian', 'Vietnamese',
  'Indonesian', 'Japanese', 'Italian', 'Korean', 'Thai', 'Polish', 'Romanian',
  'Greek', 'Czech', 'Finnish', 'Hindi', 'Bulgarian', 'Danish', 'Hebrew', 'Malay',
  'Persian', 'Slovak', 'Swedish', 'Croatian', 'Filipino', 'Hungarian', 'Norwegian',
  'Slovenian', 'Catalan', 'Nynorsk', 'Tamil', 'Afrikaans', 'auto'
];

const RANGE = {
  speed: { min: 0.5, max: 2, step: 0.05, default: 1 },
  volume: { min: 0.1, max: 10, step: 0.1, default: 1 },
  pitch: { min: -12, max: 12, step: 1, default: 0 },
  pause: { min: 0.01, max: 99.99, step: 0.05, default: 0.35 },
  effect: { min: -100, max: 100, step: 1, default: 0 },
  weight: { min: 1, max: 100, step: 1, default: 50 }
};

const AUDIO = {
  sampleRates: [8000, 16000, 22050, 24000, 32000, 44100],
  bitrates: [32000, 64000, 128000, 256000],
  formats: ['mp3', 'pcm', 'flac', 'wav'],
  channels: [1, 2]
};

function numberInRange(value, range, label, { integer = false } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < range.min || number > range.max || (integer && !Number.isInteger(number))) {
    throw new Error(`${label}必须在 ${range.min}–${range.max} 之间${integer ? '且为整数' : ''}`);
  }
  return number;
}

function enumValue(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new Error(`${label}不受支持：${value}`);
  }
  return value;
}

export function getMiniMaxSpeechCapabilities() {
  return {
    provider: 'minimax',
    schemaVersion: 1,
    models: [...MODELS],
    emotions: EMOTIONS.map((item) => ({ ...item })),
    vocalTags: VOCAL_TAGS.map((item) => ({ ...item })),
    vocalTagModels: [...VOCAL_TAG_MODELS],
    soundEffects: SOUND_EFFECTS.map((item) => ({ ...item })),
    languages: [...LANGUAGES],
    ranges: structuredClone(RANGE),
    audio: structuredClone(AUDIO),
    subtitleTypes: ['sentence', 'word', 'word_streaming'],
    outputFormats: ['hex', 'url'],
    maxTimbreWeights: 4
  };
}

export function createMiniMaxGenerationSettings(overrides = {}) {
  const audio = overrides.audioSetting || {};
  return {
    schemaVersion: 1,
    provider: 'minimax',
    model: overrides.model || process.env.MINIMAX_TTS_MODEL || 'speech-2.8-hd',
    stream: Boolean(overrides.stream),
    streamOptions: {
      excludeAggregatedAudio: Boolean(overrides.streamOptions?.excludeAggregatedAudio)
    },
    languageBoost: overrides.languageBoost || 'Chinese',
    audioSetting: {
      sampleRate: Number(audio.sampleRate ?? 32000),
      bitrate: Number(audio.bitrate ?? 128000),
      format: audio.format || 'mp3',
      channel: Number(audio.channel ?? 1)
    },
    subtitle: {
      enabled: overrides.subtitle?.enabled ?? true,
      type: overrides.subtitle?.type || 'word'
    },
    outputFormat: overrides.outputFormat || 'hex',
    aigcWatermark: Boolean(overrides.aigcWatermark)
  };
}

export function validateMiniMaxGenerationSettings(input) {
  const settings = createMiniMaxGenerationSettings(input);
  enumValue(settings.model, MODELS, '语音模型');
  enumValue(settings.languageBoost, LANGUAGES, '语言增强');
  enumValue(settings.audioSetting.sampleRate, AUDIO.sampleRates, '采样率');
  enumValue(settings.audioSetting.bitrate, AUDIO.bitrates, '比特率');
  enumValue(settings.audioSetting.format, AUDIO.formats, '音频格式');
  enumValue(settings.audioSetting.channel, AUDIO.channels, '声道');
  enumValue(settings.subtitle.type, ['sentence', 'word', 'word_streaming'], '字幕粒度');
  enumValue(settings.outputFormat, ['hex', 'url'], '输出形式');
  if (settings.stream && settings.audioSetting.format !== 'mp3') {
    throw new Error('流式预览仅支持 mp3 格式');
  }
  if (settings.stream && settings.outputFormat !== 'hex') {
    throw new Error('流式预览仅支持 hex 输出');
  }
  return settings;
}

export function createMiniMaxSegmentRecipe(overrides = {}) {
  const voiceSetting = overrides.voiceSetting || {};
  const voiceModify = overrides.voiceModify || {};
  const voiceSource = overrides.voiceSource || {};
  return {
    schemaVersion: 1,
    provider: 'minimax',
    annotations: Array.isArray(overrides.annotations) ? overrides.annotations.map((item) => ({ ...item })) : [],
    pronunciation: Array.isArray(overrides.pronunciation) ? [...overrides.pronunciation] : [],
    voiceSource: {
      mode: voiceSource.mode || 'default',
      voiceId: voiceSource.voiceId || '',
      timbreWeights: Array.isArray(voiceSource.timbreWeights)
        ? voiceSource.timbreWeights.map((item) => ({ voiceId: String(item.voiceId || ''), weight: Number(item.weight) }))
        : []
    },
    voiceSetting: {
      speed: Number(voiceSetting.speed ?? RANGE.speed.default),
      volume: Number(voiceSetting.volume ?? RANGE.volume.default),
      pitch: Number(voiceSetting.pitch ?? RANGE.pitch.default),
      emotion: String(voiceSetting.emotion || ''),
      latexRead: Boolean(voiceSetting.latexRead),
      englishNormalization: Boolean(voiceSetting.englishNormalization)
    },
    voiceModify: {
      pitch: Number(voiceModify.pitch ?? 0),
      intensity: Number(voiceModify.intensity ?? 0),
      timbre: Number(voiceModify.timbre ?? 0),
      soundEffects: String(voiceModify.soundEffects || '')
    }
  };
}

function validateAnnotations(annotations, text) {
  const ids = new Set();
  const pauseOffsets = new Set();
  for (const annotation of annotations) {
    const id = String(annotation.id || '');
    if (!id || ids.has(id)) throw new Error('台词标记 id 缺失或重复');
    ids.add(id);
    const offset = numberInRange(annotation.offset, { min: 0, max: text.length }, '标记位置', { integer: true });
    if (offset > 0 && offset < text.length) {
      const previous = text.charCodeAt(offset - 1);
      const current = text.charCodeAt(offset);
      if (previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff) {
        throw new Error('标记不能插入到 Unicode 字符内部');
      }
    }
    if (annotation.type === 'pause') {
      if (offset === 0 || offset === text.length) throw new Error('停顿必须位于两个可发音文本之间');
      if (pauseOffsets.has(offset)) throw new Error('同一位置不能连续添加多个停顿');
      pauseOffsets.add(offset);
      numberInRange(annotation.durationSeconds, RANGE.pause, '停顿秒数');
    } else if (annotation.type === 'vocal') {
      enumValue(annotation.value, VOCAL_TAGS.map((item) => item.value), '语气词');
    } else {
      throw new Error(`未知台词标记类型：${annotation.type}`);
    }
  }
}

export function validateMiniMaxSegmentRecipe(input, text) {
  const recipe = createMiniMaxSegmentRecipe(input);
  validateAnnotations(recipe.annotations, text);
  numberInRange(recipe.voiceSetting.speed, RANGE.speed, '语速');
  numberInRange(recipe.voiceSetting.volume, RANGE.volume, '音量');
  numberInRange(recipe.voiceSetting.pitch, RANGE.pitch, '基础音调', { integer: true });
  enumValue(recipe.voiceSetting.emotion, EMOTIONS.map((item) => item.value), '情绪');
  numberInRange(recipe.voiceModify.pitch, RANGE.effect, '效果器音高', { integer: true });
  numberInRange(recipe.voiceModify.intensity, RANGE.effect, '声音力度', { integer: true });
  numberInRange(recipe.voiceModify.timbre, RANGE.effect, '音色质感', { integer: true });
  enumValue(recipe.voiceModify.soundEffects, SOUND_EFFECTS.map((item) => item.value), '声音效果');

  const { mode, voiceId, timbreWeights } = recipe.voiceSource;
  enumValue(mode, ['default', 'voiceId', 'blend'], '音色来源');
  if (mode === 'voiceId' && !voiceId.trim()) throw new Error('自定义音色来源缺少 voice_id');
  if (mode === 'blend') {
    if (timbreWeights.length < 2 || timbreWeights.length > 4) throw new Error('混合音色必须包含 2–4 个音色');
    const seen = new Set();
    for (const item of timbreWeights) {
      if (!item.voiceId.trim() || seen.has(item.voiceId)) throw new Error('混合音色 ID 缺失或重复');
      seen.add(item.voiceId);
      numberInRange(item.weight, RANGE.weight, '混合音色权重', { integer: true });
    }
  }

  for (const entry of recipe.pronunciation) {
    const [term, reading] = String(entry).split('/', 2).map((item) => item?.trim());
    if (!term || !reading || !text.includes(term)) throw new Error(`发音修正无效：${entry}`);
  }
  return recipe;
}

function markerFor(annotation) {
  if (annotation.type === 'pause') {
    const seconds = Number(annotation.durationSeconds).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    return `<#${seconds}#>`;
  }
  return `(${annotation.value})`;
}

export function compileMiniMaxAnnotatedText(text, annotations = []) {
  validateAnnotations(annotations, text);
  const byOffset = new Map();
  for (const annotation of annotations) {
    const list = byOffset.get(annotation.offset) || [];
    list.push(annotation);
    byOffset.set(annotation.offset, list);
  }
  let output = '';
  for (let offset = 0; offset <= text.length; offset += 1) {
    const markers = byOffset.get(offset) || [];
    output += markers.map(markerFor).join('');
    if (offset < text.length) output += text[offset];
  }
  return output;
}

export function applyMiniMaxRecipeToBody({ body, recipeInput, generationSettingsInput, defaultVoiceId }) {
  const recipe = validateMiniMaxSegmentRecipe(recipeInput, body.text);
  const settings = validateMiniMaxGenerationSettings(generationSettingsInput);
  if (recipe.annotations.some((item) => item.type === 'vocal') && !VOCAL_TAG_MODELS.includes(settings.model)) {
    throw new Error(`模型 ${settings.model} 不支持语气词标签`);
  }
  const text = compileMiniMaxAnnotatedText(body.text, recipe.annotations);
  const result = {
    model: settings.model,
    text,
    stream: settings.stream,
    language_boost: settings.languageBoost,
    voice_setting: {
      speed: recipe.voiceSetting.speed,
      vol: recipe.voiceSetting.volume,
      pitch: recipe.voiceSetting.pitch
    },
    audio_setting: {
      sample_rate: settings.audioSetting.sampleRate,
      bitrate: settings.audioSetting.bitrate,
      format: settings.audioSetting.format,
      channel: settings.audioSetting.channel
    },
    subtitle_enable: settings.subtitle.enabled,
    output_format: settings.outputFormat,
    aigc_watermark: settings.aigcWatermark
  };

  if (settings.stream) {
    result.stream_options = { exclude_aggregated_audio: settings.streamOptions.excludeAggregatedAudio };
  }
  if (settings.subtitle.enabled) result.subtitle_type = settings.subtitle.type;
  if (recipe.voiceSetting.latexRead) result.voice_setting.latex_read = true;
  if (recipe.voiceSetting.englishNormalization) result.voice_setting.english_normalization = true;
  if (recipe.voiceSetting.emotion) result.voice_setting.emotion = recipe.voiceSetting.emotion;
  if (recipe.voiceSource.mode === 'blend') {
    result.timbre_weights = recipe.voiceSource.timbreWeights.map((item) => ({
      voice_id: item.voiceId,
      weight: item.weight
    }));
  } else {
    result.voice_setting.voice_id = recipe.voiceSource.mode === 'voiceId' ? recipe.voiceSource.voiceId : defaultVoiceId;
  }
  if (
    recipe.voiceModify.pitch !== 0 || recipe.voiceModify.intensity !== 0 ||
    recipe.voiceModify.timbre !== 0 || recipe.voiceModify.soundEffects
  ) {
    result.voice_modify = {
      pitch: recipe.voiceModify.pitch,
      intensity: recipe.voiceModify.intensity,
      timbre: recipe.voiceModify.timbre
    };
    if (recipe.voiceModify.soundEffects) result.voice_modify.sound_effects = recipe.voiceModify.soundEffects;
  }
  if (recipe.pronunciation.length) result.pronunciation_dict = { tone: [...recipe.pronunciation] };
  return result;
}

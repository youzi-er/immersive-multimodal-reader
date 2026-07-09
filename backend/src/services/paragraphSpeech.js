import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bookMeta, getBookText, getParagraphContext } from '../data.js';
import { concatMp3Hex, hexToAudioDataUrl, sumDurationMs } from './audioConcat.js';
import {
  assertRequiredFields,
  callMessagesApiForJson,
  callMessagesApiForJsonWithRetry,
  designVoice,
  synthesizeSpeechFromBody
} from './minimax.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.resolve(__dirname, '../prompts');
const CACHE_DIR = path.resolve(__dirname, '../../cache');

const MAX_PHASE3A_ATTEMPTS = 3;
const TTS_CONCURRENCY = Number(process.env.SPEECH_TTS_CONCURRENCY) || 3;
const SKIP_VOICE_DESIGN = process.env.SPEECH_SKIP_VOICE_DESIGN === 'true';
const DEFAULT_SPEECH_SPEED_LIFT = Number(process.env.SPEECH_SPEED_LIFT) || 1.08;

const DEFAULT_PERFORMANCE_ELASTICITY = {
  允许情绪峰值: true,
  峰值场景: ['发现真相', '危险逼近', '质问', '惊吓', '死亡现场', '推理揭示'],
  允许手段: ['短促加快', '压低但加重', '句内短停', '吸气/倒吸气', '关键词重读'],
  禁止手段: ['长时间嘶吼', '综艺化惊叫', '现代夸张腔', '过度哭腔']
};

// #region agent log
const DEBUG_LOG_PATH = path.resolve(__dirname, '../../../debug-d022cd.log');
function debugLog(location, message, data, hypothesisId, runId = 'speech-trace') {
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
  fetch('http://127.0.0.1:7888/ingest/ce4fcfb1-6269-452c-a0af-db68c9da7571', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'd022cd' },
    body: JSON.stringify(payload)
  }).catch(() => {});
}
// #endregion

const ATMOSPHERE_REQUIRED = [
  '题材类型',
  '叙事视角',
  '整体氛围',
  '旁白基调',
  '节奏倾向',
  '情绪外放度',
  '禁忌听感',
  '默认合成设置'
];

const SYSTEM_VOICE_PRESETS = {
  narrator: 'Chinese (Mandarin)_Lyrical_Voice',
  char_holmes: 'Chinese (Mandarin)_Reliable_Executive',
  char_watson: 'Chinese (Mandarin)_Warm_Gentleman',
  char_helen: 'Chinese (Mandarin)_Warm_Girl',
  char_royllott: 'Chinese (Mandarin)_Unrestrained_Young_Man',
  tpl_male_young: 'Chinese (Mandarin)_Unrestrained_Young_Man',
  tpl_male_middle: 'Chinese (Mandarin)_Reliable_Executive',
  tpl_female_young: 'Chinese (Mandarin)_Warm_Girl',
  tpl_female_middle: 'Chinese (Mandarin)_IntellectualGirl'
};

const EMOTION_MAP = {
  愤怒克制: 'angry',
  悲伤克制: 'sad',
  压低警告: 'angry',
  惊惧: 'fearful',
  震惊: 'surprised',
  急促: 'fearful',
  紧张: 'fearful',
  恐惧: 'fearful',
  愤怒: 'angry',
  悲伤: 'sad',
  惊讶: 'surprised',
  疑惑: 'surprised',
  安抚: 'calm',
  思索: 'calm',
  冷峻: 'calm',
  平静: 'calm',
  压低: 'calm',
  低语: 'whisper',
  克制: 'calm',
  高兴: 'happy',
  流畅: 'fluent'
};

const SPEED_MAP = {
  略慢: 1.0,
  慢: 0.96,
  略快: 1.14,
  快: 1.22,
  正常: 1.08
};

const VALID_VOCAL_TAGS = new Set([
  '(breath)',
  '(inhale)',
  '(exhale)',
  '(gasps)'
]);

const FIXED_PRONUNCIATION_TONES = [
  '福尔摩斯/(fu2)(er3)(mo2)(si1)',
  '歇洛克/(xie1)(luo4)(ke4)',
  '华生/(hua4)(sheng1)',
  '罗伊洛特/(luo2)(yi1)(luo4)(te4)',
  '斯托纳/(si1)(tuo1)(na4)',
  '斯托克莫兰/(si1)(tuo1)(ke4)(mo4)(lan2)'
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

let voiceCache = null;
let voicePromise = null;

function defaultVoiceId() {
  return process.env.MINIMAX_DEFAULT_VOICE_ID || 'Chinese (Mandarin)_Lyrical_Voice';
}

function voiceCachePath() {
  return path.join(CACHE_DIR, `${bookMeta.id}-voices.json`);
}

async function loadPrompt(name) {
  return readFile(path.join(PROMPTS_DIR, name), 'utf8');
}

function enrichAtmosphereConfig(atmosphere = {}) {
  return {
    ...atmosphere,
    局部表演弹性: atmosphere.局部表演弹性 || DEFAULT_PERFORMANCE_ELASTICITY
  };
}

function validatePhase1Output(data) {
  assertRequiredFields(data, ['氛围配置', '选角方案'], '阶段一输出');
  assertRequiredFields(data.氛围配置, ATMOSPHERE_REQUIRED, '氛围配置');

  const cast = data.选角方案;
  if (!Array.isArray(cast.角色音色列表) || cast.角色音色列表.length === 0) {
    throw new Error('选角方案.角色音色列表 不能为空');
  }

  if (!cast.角色音色列表.some((role) => role.说话人代号 === 'narrator')) {
    throw new Error('选角方案必须包含 narrator 旁白');
  }

  if (!cast.模板声音池 || typeof cast.模板声音池 !== 'object') {
    throw new Error('选角方案.模板声音池 必须是对象');
  }

  for (const role of cast.角色音色列表) {
    if (role.voice_id != null) {
      throw new Error(`阶段一输出中 ${role.说话人代号} 的 voice_id 必须为 null`);
    }
    if (role.声音来源 === '独立声音') {
      assertRequiredFields(role.声音设计参数 || {}, ['prompt', 'preview_text'], `${role.说话人代号} 声音设计参数`);
    }
  }

  for (const [key, template] of Object.entries(cast.模板声音池)) {
    if (template?.voice_id != null) {
      throw new Error(`阶段一模板 ${key} 的 voice_id 必须为 null`);
    }
  }
}

function isNarratorSegment(segment) {
  return segment.说话人代号 === 'narrator' && !segment.模板代号;
}

function stripNarratorSegments(segments) {
  return segments.filter((segment) => !isNarratorSegment(segment));
}

function validatePhase3aOutput(data) {
  assertRequiredFields(data, ['片段列表'], '阶段三 3a 输出');

  if (!Array.isArray(data.片段列表)) {
    throw new Error('片段列表必须是数组');
  }

  for (const segment of data.片段列表) {
    assertRequiredFields(segment, ['片段编号', '配音文本', '导演判断', '演绎提示'], '配音片段');
    if (!segment.配音文本?.trim()) {
      throw new Error(`片段 ${segment.片段编号} 的配音文本不能为空`);
    }

    if (isNarratorSegment(segment)) {
      throw new Error(`片段 ${segment.片段编号} 为旁白，不应出现在配音剧本中`);
    }

    if (!segment.说话人代号 && !segment.模板代号) {
      throw new Error(`片段 ${segment.片段编号} 必须指定说话人代号或模板代号`);
    }

    if (!segment.导演判断 || typeof segment.导演判断 !== 'object') {
      throw new Error(`片段 ${segment.片段编号} 必须包含导演判断对象`);
    }

    const hints = segment.演绎提示;
    assertRequiredFields(
      hints,
      ['语速', '情绪', '强度', '停顿', '节奏', '重读词', '语气词标签'],
      `片段 ${segment.片段编号} 演绎提示`
    );

    if (!Array.isArray(hints.重读词)) {
      throw new Error(`片段 ${segment.片段编号} 的重读词必须是数组`);
    }

    const vocalTags = hints.语气词标签;
    if (!vocalTags || typeof vocalTags !== 'object') {
      throw new Error(`片段 ${segment.片段编号} 的语气词标签必须是对象`);
    }
  }
}

async function buildSpeechCast() {
  const novelText = getBookText();
  if (!novelText) {
    throw new Error('小说全文未加载，无法初始化语音选角');
  }

  const system = await loadPrompt('speech-phase1-system.md');
  const result = await callMessagesApiForJsonWithRetry({
    system,
    user: novelText,
    maxTokens: 2400
  });
  validatePhase1Output(result);

  return {
    ...result,
    book_id: bookMeta.id,
    created_at: new Date().toISOString(),
    source_novel: 'speckled-band.txt'
  };
}

function resolvePresetVoiceId(speakerCode, templateCode) {
  if (speakerCode && SYSTEM_VOICE_PRESETS[speakerCode]) {
    return SYSTEM_VOICE_PRESETS[speakerCode];
  }
  if (templateCode && SYSTEM_VOICE_PRESETS[templateCode]) {
    return SYSTEM_VOICE_PRESETS[templateCode];
  }
  return defaultVoiceId();
}

async function lockSpeechVoices(phase1) {
  const cast = phase1.选角方案;
  const lockedRoles = [];

  for (const role of cast.角色音色列表) {
    const isIndependent = role.声音来源 === '独立声音' || role.角色分级 === '旁白' || role.角色分级 === '关键人物';
    let voiceId;

    if (SKIP_VOICE_DESIGN || !isIndependent) {
      voiceId = resolvePresetVoiceId(role.说话人代号, null);
    } else {
      const design = role.声音设计参数 || {};
      const result = await designVoice({
        prompt: design.prompt,
        previewText: design.preview_text
      });
      voiceId = result.voiceId || resolvePresetVoiceId(role.说话人代号, null);
    }

    lockedRoles.push({
      说话人代号: role.说话人代号,
      显示名称: role.显示名称,
      角色分级: role.角色分级,
      voice_id: voiceId,
      默认声音参数: role.默认声音参数 || { speed: 1.0, vol: 1.0, pitch: 0 }
    });
  }

  const lockedTemplates = {};
  for (const [key, template] of Object.entries(cast.模板声音池 || {})) {
    lockedTemplates[key] = {
      标签: template.标签,
      voice_id: resolvePresetVoiceId(null, key),
      默认声音参数: template.默认声音参数 || { speed: 1.0, vol: 1.0, pitch: 0 }
    };
  }

  return {
    产物类型: '已锁定音色表',
    氛围配置: enrichAtmosphereConfig(phase1.氛围配置),
    角色音色列表: lockedRoles,
    模板声音池: lockedTemplates,
    发音字典: cast.发音字典 || { tone: [] },
    状态: '可合成',
    book_id: bookMeta.id,
    created_at: new Date().toISOString(),
    skip_voice_design: SKIP_VOICE_DESIGN
  };
}

async function loadVoiceCacheFromDisk() {
  try {
    const raw = await readFile(voiceCachePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.状态 === '可合成' && Array.isArray(parsed.角色音色列表)) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

async function saveVoiceCacheToDisk(voices) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(voiceCachePath(), JSON.stringify(voices, null, 2), 'utf8');
}

async function initializeSpeechVoices() {
  const cached = await loadVoiceCacheFromDisk();
  if (cached) {
    voiceCache = cached;
    return { voices: cached, initializedNow: false };
  }

  const phase1 = await buildSpeechCast();
  const voices = await lockSpeechVoices(phase1);
  voiceCache = voices;
  await saveVoiceCacheToDisk(voices);
  return { voices, initializedNow: true };
}

async function ensureSpeechVoices() {
  if (voiceCache) {
    return { voices: voiceCache, initializedNow: false };
  }

  if (!voicePromise) {
    voicePromise = initializeSpeechVoices().finally(() => {
      voicePromise = null;
    });
  }

  return voicePromise;
}

function buildVoiceLookup(voices) {
  const roleMap = new Map();
  for (const role of voices.角色音色列表) {
    roleMap.set(role.说话人代号, role);
  }

  const templateMap = new Map(Object.entries(voices.模板声音池 || {}));
  return { roleMap, templateMap };
}

function resolveSegmentVoice(segment, voices) {
  const { roleMap, templateMap } = buildVoiceLookup(voices);
  const speakerCode = segment.说话人代号;
  const templateCode = segment.模板代号;

  if (speakerCode && roleMap.has(speakerCode)) {
    const role = roleMap.get(speakerCode);
    const resolved = {
      voiceId: role.voice_id,
      displayName: role.显示名称,
      defaultParams: role.默认声音参数 || { speed: 1.0, vol: 1.0, pitch: 0 },
      resolvePath: 'roleMap'
    };
    return resolved;
  }

  if (templateCode && templateMap.has(templateCode)) {
    const template = templateMap.get(templateCode);
    const resolved = {
      voiceId: template.voice_id,
      displayName: template.标签,
      defaultParams: template.默认声音参数 || { speed: 1.0, vol: 1.0, pitch: 0 },
      resolvePath: 'templateMap'
    };
    return resolved;
  }

  const narrator = roleMap.get('narrator');
  const resolved = {
    voiceId: narrator?.voice_id || defaultVoiceId(),
    displayName: '旁白',
    defaultParams: narrator?.默认声音参数 || { speed: 1.0, vol: 1.0, pitch: 0 },
    resolvePath: 'narratorFallback'
  };
  return resolved;
}

function isSpeech28Model(model) {
  return /^speech-2\.8/i.test(String(model || ''));
}

const SPEECH_28_UNSUPPORTED_EMOTIONS = new Set(['whisper', 'fluent']);

function collectPerformanceSignal(segment = {}, hints = {}) {
  const director = segment.导演判断 && typeof segment.导演判断 === 'object' ? segment.导演判断 : {};
  return [
    segment.配音文本,
    hints.情绪,
    hints.节奏,
    ...(Array.isArray(hints.重读词) ? hints.重读词 : []),
    director.场景压力,
    director.表演意图
  ]
    .filter(Boolean)
    .join(' ');
}

function hasFearSignal(signal) {
  return /害怕|恐惧|惊惧|惊恐|恐慌|惊慌|不安|颤抖|发抖|濒临崩溃|崩溃边缘/.test(signal || '');
}

function hasAngerSignal(signal) {
  return /愤怒|恼怒|压迫|威胁|警告|质问|逼问|命令|呵斥|怒|吼|咆哮/.test(signal || '');
}

function hasSurpriseSignal(signal) {
  return /震惊|惊讶|惊吓|突然|发现|真相|线索|意识到|倒吸|惊呼/.test(signal || '');
}

function hasUrgencySignal(signal) {
  return /急促|短促|危险|逼近|立刻|马上|快|逃|别动|小心/.test(signal || '');
}

function mapEmotion(hint, model, hints = {}, segment = {}) {
  let emotion;
  const emotionHint = String(hint || '');
  const signal = collectPerformanceSignal(segment, hints);
  const intensity = coerceIntensity(hints.强度);

  if (intensity >= 3 && hasFearSignal(signal) && /压低|低语|紧张|恐惧|惊惧/.test(signal)) {
    emotion = 'fearful';
  }

  if (!emotion && intensity >= 4 && hasAngerSignal(signal)) {
    emotion = 'angry';
  }

  if (!emotion && intensity >= 4 && hasSurpriseSignal(signal)) {
    emotion = 'surprised';
  }

  if (!emotion && intensity >= 4 && hasUrgencySignal(signal)) {
    emotion = 'fearful';
  }

  for (const [key, value] of Object.entries(EMOTION_MAP)) {
    if (!emotion && emotionHint.includes(key)) {
      emotion = value;
      break;
    }
  }

  if (!emotion) {
    return undefined;
  }

  if (isSpeech28Model(model) && SPEECH_28_UNSUPPORTED_EMOTIONS.has(emotion)) {
    return undefined;
  }

  return emotion;
}

function ensureLowVoiceVocalTags(hints, segment = {}) {
  const source = hints.语气词标签 && typeof hints.语气词标签 === 'object' ? hints.语气词标签 : {};
  const tags = {
    前: Array.isArray(source.前) ? [...source.前] : [],
    后: Array.isArray(source.后) ? [...source.后] : [],
    句内: Array.isArray(source.句内) ? [...source.句内] : []
  };

  const signal = collectPerformanceSignal(segment, hints);
  const intensity = coerceIntensity(hints.强度);

  if (intensity >= 3 && hasFearSignal(signal)) {
    if (tags.前.length === 0) {
      tags.前.push('(inhale)');
    } else if (tags.前.length === 1 && tags.前[0] === '(breath)') {
      tags.前[0] = '(inhale)';
    }
  }

  if (/低语|压低/.test(hints.情绪 || '') && tags.前.length === 0) {
    tags.前.push('(breath)');
  }

  if (/惊惧|震惊|恐惧|紧张/.test(hints.情绪 || '') && Number(hints.强度) >= 4 && tags.前.length === 0) {
    tags.前.push('(inhale)');
  }

  return tags;
}

function coerceIntensity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 2;
  }
  return clamp(number, 1, 5);
}

function mapSpeed(hint, baseSpeed = 1, hints = {}, segment = {}) {
  let multiplier = DEFAULT_SPEECH_SPEED_LIFT;
  const speedHint = String(hint || '');

  for (const [key, value] of Object.entries(SPEED_MAP)) {
    if (speedHint.includes(key)) {
      multiplier = value;
      break;
    }
  }

  const emotion = hints.情绪 || '';
  const rhythm = hints.节奏 || '';
  const intensity = coerceIntensity(hints.强度);
  const signal = collectPerformanceSignal(segment, hints);
  const fearSignal = hasFearSignal(signal);

  if (/急促/.test(emotion) || /急促|短促/.test(rhythm) || hasUrgencySignal(signal)) {
    multiplier *= 1.06;
  }

  if (intensity >= 3 && fearSignal && !/慢/.test(speedHint)) {
    multiplier *= 1.06;
  }

  if (/低语|压低/.test(emotion) && !fearSignal && !/略快|快/.test(hint || '')) {
    multiplier *= 0.96;
  }

  if (intensity >= 3 && fearSignal && /慢/.test(speedHint)) {
    multiplier = Math.max(multiplier, DEFAULT_SPEECH_SPEED_LIFT * 1.04);
  }

  if (intensity >= 4 && /惊惧|震惊|恐惧|愤怒/.test(emotion) && !/慢/.test(speedHint)) {
    multiplier *= 1.05;
  }

  if (intensity >= 4 && (hasAngerSignal(signal) || hasSurpriseSignal(signal))) {
    multiplier *= 1.03;
  }

  return Number(clamp(baseSpeed * multiplier, 0.92, 1.3).toFixed(2));
}

function mapVolume(baseVol = 1, hints = {}, segment = {}, resolvedEmotion) {
  const intensity = coerceIntensity(hints.强度);
  const emotion = hints.情绪 || '';
  const signal = collectPerformanceSignal(segment, hints);
  const fearSignal = resolvedEmotion === 'fearful' || hasFearSignal(signal) || /惊惧|恐惧|紧张/.test(emotion);

  if (intensity >= 3 && fearSignal) {
    return Number(clamp(baseVol * (1.04 + Math.max(0, intensity - 3) * 0.03), 0.95, 1.16).toFixed(2));
  }

  if (/低语/.test(emotion)) {
    return Number(clamp(baseVol * 0.96, 0.85, 1.08).toFixed(2));
  }

  if (/压低/.test(emotion)) {
    return Number(clamp(baseVol, 0.85, 1.1).toFixed(2));
  }

  return Number(clamp(baseVol * (1 + Math.max(0, intensity - 2) * 0.04), 0.85, 1.18).toFixed(2));
}

function mapPitch(basePitch = 0, hints = {}, segment = {}) {
  const emotion = hints.情绪 || '';
  const intensity = coerceIntensity(hints.强度);
  const signal = collectPerformanceSignal(segment, hints);
  let shift = 0;

  if (intensity >= 4 && (/震惊|惊惧|恐惧|紧张/.test(emotion) || hasSurpriseSignal(signal))) {
    shift += 1;
  }

  if (/压低|低语|冷峻|愤怒|警告/.test(emotion) || hasAngerSignal(signal)) {
    shift -= intensity >= 4 ? 1 : 0;
  }

  return clamp(Math.round(basePitch + shift), -3, 3);
}

function normalizeVocalTagList(value) {
  if (!value) {
    return [];
  }

  const list = Array.isArray(value) ? value : [value];
  return list
    .map((tag) => String(tag).trim())
    .filter((tag) => VALID_VOCAL_TAGS.has(tag));
}

function insertVocalTagAfterNthPunctuation(text, punctuation, nth, tag) {
  if (nth < 1) {
    return text;
  }

  let count = 0;
  let output = '';

  for (const char of text) {
    output += char;
    if (char === punctuation) {
      count += 1;
      if (count === nth) {
        output += tag;
      }
    }
  }

  return output;
}

function shouldKeepInlineVocalTag(tag, hints) {
  const emotion = hints.情绪 || '';

  if (tag === '(breath)') {
    return /低语|压低|紧张|惊惧|恐惧/.test(emotion);
  }

  if (tag === '(inhale)' || tag === '(exhale)' || tag === '(gasps)') {
    return /紧张|惊惧|恐惧|震惊|低语|压低/.test(emotion);
  }

  return false;
}

function applyVocalTags(text, vocalTagsHint, hints = {}) {
  if (!vocalTagsHint || typeof vocalTagsHint !== 'object') {
    return text;
  }

  let result = text;
  const intensity = coerceIntensity(hints.强度);
  const maxInlineTags = text.length > 80 || intensity >= 4 ? 2 : 1;
  const inlineItems = (Array.isArray(vocalTagsHint.句内) ? [...vocalTagsHint.句内] : [])
    .filter((item) => shouldKeepInlineVocalTag(String(item?.标签 ?? '').trim(), hints))
    .slice(0, maxInlineTags);

  inlineItems.sort((left, right) => (right.序号 ?? 1) - (left.序号 ?? 1));

  for (const item of inlineItems) {
    const tag = String(item?.标签 ?? '').trim();
    if (!VALID_VOCAL_TAGS.has(tag)) {
      continue;
    }

    result = insertVocalTagAfterNthPunctuation(
      result,
      item.标点 || '，',
      Number(item.序号) || 1,
      tag
    );
  }

  const prefix = normalizeVocalTagList(vocalTagsHint.前).join('');
  const suffix = normalizeVocalTagList(vocalTagsHint.后).join('');
  return `${prefix}${result}${suffix}`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeEmphasisWords(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((word) => String(word).trim())
    .filter((word) => word.length >= 2 && word.length <= 8)
    .slice(0, 3);
}

function applyEmphasisMarkers(text, hints) {
  const words = normalizeEmphasisWords(hints.重读词);
  if (words.length === 0) {
    return text;
  }

  const intensity = coerceIntensity(hints.强度);
  const signal = [hints.情绪, hints.节奏, ...words].filter(Boolean).join(' ');
  if (
    intensity < 4 &&
    !(hasFearSignal(signal) || hasAngerSignal(signal) || hasSurpriseSignal(signal) || hasUrgencySignal(signal))
  ) {
    return text;
  }

  let result = text;
  const beforePause = intensity >= 5 ? '<#0.05#>' : '<#0.035#>';
  const maxMarkedWords = intensity >= 5 ? 2 : 1;

  for (const word of words.slice(0, maxMarkedWords)) {
    let replaced = false;
    const pattern = new RegExp(escapeRegExp(word));
    result = result.replace(pattern, (match, offset) => {
      if (replaced) {
        return match;
      }
      replaced = true;

      const before = offset > 0 ? beforePause : '';
      return `${before}${match}`;
    });
  }

  return result;
}

function applyPauseMarkers(text, pauseHint, hints = {}) {
  if (!pauseHint || pauseHint === '无') {
    return text;
  }

  const isShortLine = text.replace(/<#[\d.]+#>/g, '').length <= 18;
  const intensity = coerceIntensity(hints.强度);

  if (pauseHint.includes('关键处')) {
    if (intensity >= 5 && isShortLine) {
      return text.replace(/([！？])$/, '$1<#0.06#>');
    }
    if (intensity >= 5) {
      return text.replace(/([，；：、])/, '$1<#0.045#>');
    }
    return text;
  }

  if (pauseHint.includes('短停')) {
    if (intensity >= 4) {
      return `${text}<#${isShortLine ? '0.055' : '0.04'}#>`;
    }
    return text;
  }

  if (pauseHint.includes('句间')) {
    return text;
  }

  if (pauseHint.includes('句尾')) {
    if (intensity >= 4) {
      return `${text}<#${isShortLine ? '0.06' : '0.04'}#>`;
    }
    return text;
  }

  return text;
}

function pronunciationTerm(entry) {
  return String(entry || '').split('/')[0]?.trim();
}

function mergePronunciationTones(...toneLists) {
  const merged = new Map();

  for (const toneList of toneLists) {
    for (const entry of toneList || []) {
      const term = pronunciationTerm(entry);
      if (!term) {
        continue;
      }
      merged.set(term, entry);
    }
  }

  return [...merged.values()];
}

function buildTtsBody(segment, voices) {
  const { voiceId, defaultParams } = resolveSegmentVoice(segment, voices);
  const hints = segment.演绎提示 || {};
  const atmosphere = voices.氛围配置?.默认合成设置 || {};
  const baseSpeed = defaultParams.speed ?? 1;
  const basePitch = defaultParams.pitch ?? 0;
  const baseVol = defaultParams.vol ?? 1;

  let text = segment.配音文本.trim();
  const model = atmosphere.model || process.env.MINIMAX_TTS_MODEL || 'speech-2.8-hd';
  text = applyEmphasisMarkers(text, hints);
  text = applyVocalTags(text, ensureLowVoiceVocalTags(hints, segment), hints);
  text = applyPauseMarkers(text, hints.停顿, hints);
  const emotion = mapEmotion(hints.情绪, model, hints, segment);

  const body = {
    model,
    text,
    stream: atmosphere.stream ?? false,
    language_boost: atmosphere.language_boost || 'Chinese',
    voice_setting: {
      voice_id: voiceId,
      speed: mapSpeed(hints.语速, baseSpeed, hints, segment),
      vol: mapVolume(baseVol, hints, segment, emotion),
      pitch: mapPitch(basePitch, hints, segment)
    },
    audio_setting: atmosphere.audio_setting || {
      sample_rate: 32000,
      bitrate: 128000,
      format: 'mp3',
      channel: 1
    },
    subtitle_enable: atmosphere.subtitle_enable ?? false,
    output_format: atmosphere.output_format || 'hex',
    aigc_watermark: atmosphere.aigc_watermark ?? false
  };

  if (emotion) {
    body.voice_setting.emotion = emotion;
  }

  const pronunciationTone = mergePronunciationTones(
    voices.发音字典?.tone || [],
    segment.追加发音 || [],
    FIXED_PRONUNCIATION_TONES
  );

  if (pronunciationTone.length > 0) {
    body.pronunciation_dict = { tone: pronunciationTone };
  }

  return body;
}

function buildVoiceSummary(voices) {
  return {
    status: voices.状态,
    bookId: voices.book_id,
    createdAt: voices.created_at,
    skipVoiceDesign: voices.skip_voice_design ?? false,
    roles: voices.角色音色列表.map((role) => ({
      code: role.说话人代号,
      label: role.显示名称,
      tier: role.角色分级,
      voiceId: role.voice_id
    })),
    templates: Object.entries(voices.模板声音池 || {}).map(([code, template]) => ({
      code,
      label: template.标签,
      voiceId: template.voice_id
    }))
  };
}

function redactDebugValue(key, value) {
  if (key === 'audioHex' || key === 'audioUrl' || key === 'trialAudioUrl') {
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
      .map(([key, entryValue]) => [
        key === 'audioHexLength' ? 'audioDataLength' : key,
        redactDebugValue(key, entryValue)
      ])
      .filter(([, entryValue]) => entryValue !== undefined)
  );
}

function buildVoiceDebugCache(voices) {
  if (!voices) {
    return {
      initialized: false,
      bookId: bookMeta.id,
      status: '未初始化',
      atmosphere: null,
      roles: [],
      templates: [],
      pronunciationToneCount: 0
    };
  }

  return {
    initialized: true,
    ...buildVoiceSummary(voices),
    atmosphere: {
      题材类型: voices.氛围配置?.题材类型,
      叙事视角: voices.氛围配置?.叙事视角,
      整体氛围: voices.氛围配置?.整体氛围,
      旁白基调: voices.氛围配置?.旁白基调,
      节奏倾向: voices.氛围配置?.节奏倾向,
      情绪外放度: voices.氛围配置?.情绪外放度,
      局部表演弹性: enrichAtmosphereConfig(voices.氛围配置).局部表演弹性,
      禁忌听感: voices.氛围配置?.禁忌听感,
      默认合成设置: voices.氛围配置?.默认合成设置
    },
    pronunciationToneCount: voices.发音字典?.tone?.length ?? 0
  };
}

async function readSpeechDebugEvents() {
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
    .filter((event) => event && event.runId === 'speech-trace')
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

function summarizeSpeechRecord(events, index) {
  const start = events.find((event) => event.message === 'speech generation started');
  const refined = events.find((event) => event.message === 'phase3a refined script');
  const ttsRequests = events.filter((event) => event.message === 'tts request sent');
  const ttsResponses = events.filter((event) => event.message === 'tts response received');
  const traceIds = ttsResponses.map((event) => event.data?.traceId).filter(Boolean);

  return {
    id: `${start?.timestamp ?? events[0]?.timestamp ?? Date.now()}-${index}`,
    startedAt: start?.timestamp ?? events[0]?.timestamp ?? null,
    targetSegment: start?.data?.targetSegment ?? '',
    chapterId: start?.data?.chapterId ?? '',
    paragraphIndex: start?.data?.paragraphIndex ?? null,
    segmentCount: refined?.data?.segmentCount ?? ttsRequests.length,
    traceIds,
    events
  };
}

function groupSpeechDebugRecords(events, limit) {
  const records = [];
  let current = null;

  for (const event of events) {
    if (event.message === 'speech generation started') {
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
    .map((recordEvents, index) => summarizeSpeechRecord(recordEvents, index))
    .reverse();
}

const ATTRIBUTION_SPEAKER_ALIASES = {
  char_holmes: ['歇洛克·福尔摩斯', '歇洛克', '福尔摩斯', '霍尔摩斯'],
  char_watson: ['华生医生', '华生'],
  char_helen: ['海伦·斯托纳', '海伦', '斯托纳'],
  char_royllott: ['罗伊洛特医生', '罗伊洛特']
};

function buildAttributionSpeakerMap(voices) {
  const map = new Map();

  for (const role of voices.角色音色列表 || []) {
    map.set(role.显示名称, role.说话人代号);
    for (const [code, aliases] of Object.entries(ATTRIBUTION_SPEAKER_ALIASES)) {
      if (role.说话人代号 !== code) {
        continue;
      }
      aliases.forEach((alias) => map.set(alias, code));
    }
  }

  return map;
}

function inferSpeakerFromAttribution(label, context, targetSegment, dialogueText, speakerMap) {
  if (speakerMap.has(label)) {
    return speakerMap.get(label);
  }

  if (label === '他') {
    if (/华生/.test(dialogueText || targetSegment) && !/罗伊洛特/.test(targetSegment)) {
      return 'char_holmes';
    }

    const targetIndex = context.indexOf(targetSegment.slice(0, Math.min(24, targetSegment.length)));
    const localWindow =
      targetIndex >= 0
        ? context.slice(Math.max(0, targetIndex - 320), targetIndex + targetSegment.length + 120)
        : targetSegment;

    if (/福尔摩斯|歇洛克/.test(localWindow)) {
      return 'char_holmes';
    }
    if (/罗伊洛特/.test(localWindow) && !/福尔摩斯|歇洛克/.test(localWindow)) {
      return 'char_royllott';
    }
    return 'char_holmes';
  }

  if (label === '她') {
    const localWindow = targetSegment + context.slice(0, 400);
    if (/海伦|斯托纳/.test(localWindow)) {
      return speakerMap.get('海伦') || 'char_helen';
    }
  }

  return null;
}

function parseAttributionFromGlue(glueText, context, targetSegment, speakerMap, dialogueText = '') {
  const match = glueText.match(/(歇洛克·福尔摩斯|福尔摩斯|华生医生|华生|海伦·斯托纳|海伦|罗伊洛特医生|罗伊洛特|他|她)说/);
  if (!match) {
    return { speakerCode: null, narrationText: glueText.trim() };
  }

  const speakerCode = inferSpeakerFromAttribution(
    match[1],
    context,
    targetSegment,
    dialogueText,
    speakerMap
  );
  const narrationText = glueText
    .replace(/[，,]?\s*(歇洛克·福尔摩斯|福尔摩斯|华生医生|华生|海伦·斯托纳|海伦|罗伊洛特医生|罗伊洛特|他|她)说[，,]?\s*/g, '')
    .trim();

  return { speakerCode, narrationText };
}

function cloneSegmentTemplate(segment) {
  return {
    片段编号: segment.片段编号,
    说话人代号: segment.说话人代号,
    模板代号: segment.模板代号 ?? null,
    配音文本: segment.配音文本,
    导演判断: segment.导演判断 || { 场景压力: '未标注', 表演意图: '按上下文自然表达', 避免: '避免夸张' },
    演绎提示: segment.演绎提示
      ? { ...segment.演绎提示 }
      : {
          语速: '正常',
          情绪: '平静',
          强度: 2,
          停顿: '无',
          节奏: '平稳陈述',
          重读词: [],
          语气词标签: { 前: [], 后: [], 句内: [] }
        },
    追加发音: Array.isArray(segment.追加发音) ? [...segment.追加发音] : []
  };
}

function createDialogueSegment(template, speakerCode, dialogueText) {
  const segment = cloneSegmentTemplate(template);
  segment.说话人代号 = speakerCode;
  segment.模板代号 = null;
  segment.配音文本 = dialogueText.trim();
  return segment;
}

function splitNarratorSegmentWithQuotes(segment, context, targetSegment, speakerMap) {
  const text = segment.配音文本;
  const pieces = [];
  const pattern = /「([^」]*)」|([^「」]+)/g;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match[1] !== undefined) {
      pieces.push({ type: 'quote', text: match[1] });
    } else {
      pieces.push({ type: 'glue', text: match[2] });
    }
  }

  if (pieces.length === 0) {
    return [];
  }

  const output = [];
  let activeSpeaker = null;

  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index];

    if (piece.type === 'quote') {
      let speakerCode = activeSpeaker;

      if (!speakerCode && pieces[index + 1]?.type === 'glue') {
        const parsed = parseAttributionFromGlue(
          pieces[index + 1].text,
          context,
          targetSegment,
          speakerMap,
          piece.text
        );
        speakerCode = parsed.speakerCode;
      }

      if (!speakerCode) {
        speakerCode =
          inferSpeakerFromAttribution('他', context, targetSegment, piece.text, speakerMap) ||
          'char_holmes';
      }

      activeSpeaker = speakerCode;
      output.push(createDialogueSegment(segment, speakerCode, piece.text));
      continue;
    }

    const parsed = parseAttributionFromGlue(piece.text, context, targetSegment, speakerMap);
    if (parsed.speakerCode) {
      activeSpeaker = parsed.speakerCode;
    } else {
      activeSpeaker = null;
    }
  }

  return output;
}

function shouldResplitNarratorSegment(segment) {
  return (
    segment.说话人代号 === 'narrator' &&
    !segment.模板代号 &&
    /「[^」]+」/.test(segment.配音文本)
  );
}

function renumberScriptSegments(segments) {
  return segments.map((segment, index) => ({
    ...segment,
    片段编号: `s${String(index + 1).padStart(3, '0')}`
  }));
}

function refinePhase3aScript(script, context, targetSegment, voices) {
  const speakerMap = buildAttributionSpeakerMap(voices);
  const refined = [];

  for (const segment of script.片段列表) {
    if (shouldResplitNarratorSegment(segment)) {
      refined.push(...splitNarratorSegmentWithQuotes(segment, context, targetSegment, speakerMap));
    } else {
      refined.push(segment);
    }
  }

  const renumbered = renumberScriptSegments(stripNarratorSegments(refined));

  return {
    ...script,
    片段列表: renumbered
  };
}

async function runPhase3a({ context, targetSegment, voices }) {
  const system = await loadPrompt('speech-phase3a-system.md');
  const llmInput = {
    上下文: context.trim(),
    目标片段: targetSegment.trim(),
    氛围配置: enrichAtmosphereConfig(voices.氛围配置),
    已锁定音色表: {
      角色音色列表: voices.角色音色列表.map((role) => ({
        说话人代号: role.说话人代号,
        显示名称: role.显示名称,
        角色分级: role.角色分级
      })),
      模板声音池: Object.fromEntries(
        Object.entries(voices.模板声音池 || {}).map(([key, value]) => [key, { 标签: value.标签 }])
      )
    }
  };

  for (let attempt = 1; attempt <= MAX_PHASE3A_ATTEMPTS; attempt += 1) {
    const userPayload =
      attempt === 1
        ? llmInput
        : {
            ...llmInput,
              _retry_instruction: `第 ${attempt} 次生成：只输出角色对白片段，不要输出 narrator 旁白片段；若无对白则返回空数组；每个片段须有非空配音文本、导演判断与完整演绎提示（语速/情绪/强度/停顿/节奏/重读词/语气词标签）；语气词标签不得写入配音文本。不要把全局克制误解成平静慢读，也不要用停顿把普通句子切碎；普通陈述的停顿填“无”。`
          };
    const userJson = JSON.stringify(userPayload, null, 2);

    // #region agent log
    debugLog(
      'paragraphSpeech.js:runPhase3a',
      'phase3a prompt sent',
      {
        attempt,
        systemPrompt: system,
        userPayload,
        userJsonLength: userJson.length
      },
      'P-send'
    );
    // #endregion

    const raw = await callMessagesApiForJson({
      system,
      user: userJson,
      temperature: attempt === 1 ? 0.5 : 0.2,
      maxTokens: 2400
    });

    // #region agent log
    debugLog(
      'paragraphSpeech.js:runPhase3a',
      'phase3a raw response',
      { attempt, raw },
      'P-recv'
    );
    // #endregion

    try {
      validatePhase3aOutput(raw);
      const refined = refinePhase3aScript(raw, context, targetSegment, voices);

      // #region agent log
      debugLog(
        'paragraphSpeech.js:runPhase3a',
        'phase3a refined script',
        {
          attempt,
          segmentCount: refined.片段列表.length,
          segments: refined.片段列表.map((seg) => ({
            id: seg.片段编号,
            speakerCode: seg.说话人代号,
            templateCode: seg.模板代号,
            text: seg.配音文本,
            director: seg.导演判断,
            hints: seg.演绎提示
          }))
        },
        'P-refine'
      );
      // #endregion

      return refined;
    } catch (error) {
      // #region agent log
      debugLog(
        'paragraphSpeech.js:runPhase3a',
        'phase3a validation failed',
        { attempt, error: error.message },
        'P-error'
      );
      // #endregion

      if (attempt === MAX_PHASE3A_ATTEMPTS) {
        throw new Error(`${MAX_PHASE3A_ATTEMPTS} 次尝试后仍不满足要求：${error.message}`);
      }
    }
  }

  throw new Error('阶段三 3a 生成失败');
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await worker(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

async function synthesizeScriptSegments(script, voices) {
  const segments = stripNarratorSegments(script.片段列表);

  if (segments.length === 0) {
    throw new Error('所选片段没有对白，无需生成配音');
  }

  return runWithConcurrency(segments, TTS_CONCURRENCY, async (segment) => {
    const body = buildTtsBody(segment, voices);
    const voice = resolveSegmentVoice(segment, voices);

    // #region agent log
    debugLog(
      'paragraphSpeech.js:synthesizeScriptSegments',
      'tts request sent',
      {
        segmentId: segment.片段编号,
        speakerCode: segment.说话人代号,
        displayName: voice.displayName,
        ttsBody: body
      },
      'T-send'
    );
    // #endregion

    const result = await synthesizeSpeechFromBody(body);

    // #region agent log
    debugLog(
      'paragraphSpeech.js:synthesizeScriptSegments',
      'tts response received',
      {
        segmentId: segment.片段编号,
        speakerCode: segment.说话人代号,
        displayName: voice.displayName,
        text: segment.配音文本,
        durationMs: result.durationMs,
        traceId: result.traceId,
        audioHexLength: result.audioHex?.length ?? 0
      },
      'T-recv'
    );
    // #endregion

    return {
      segmentId: segment.片段编号,
      speakerCode: segment.说话人代号,
      templateCode: segment.模板代号,
      displayName: voice.displayName,
      text: segment.配音文本,
      audioHex: result.audioHex,
      durationMs: result.durationMs,
      traceId: result.traceId
    };
  });
}

export async function getSpeechVoicesStatus() {
  if (voiceCache) {
    return { initialized: true, ...buildVoiceSummary(voiceCache) };
  }

  const cached = await loadVoiceCacheFromDisk();
  if (cached) {
    voiceCache = cached;
    return { initialized: true, ...buildVoiceSummary(cached) };
  }

  return {
    initialized: false,
    bookId: bookMeta.id,
    status: '未初始化',
    roles: [],
    templates: []
  };
}

export async function getSpeechDebugInfo({ limit = 20 } = {}) {
  const safeLimit = clamp(Number(limit) || 20, 1, 50);
  const voices = voiceCache || (await loadVoiceCacheFromDisk());
  const [phase1SystemPrompt, phase3aSystemPrompt, events] = await Promise.all([
    loadPrompt('speech-phase1-system.md'),
    loadPrompt('speech-phase3a-system.md'),
    readSpeechDebugEvents()
  ]);

  return {
    cache: buildVoiceDebugCache(voices),
    prompts: {
      phase1System: phase1SystemPrompt,
      phase3aSystem: phase3aSystemPrompt
    },
    records: groupSpeechDebugRecords(events, safeLimit),
    eventCount: events.length
  };
}

export async function regenerateSpeechVoices() {
  const phase1 = await buildSpeechCast();
  const voices = await lockSpeechVoices(phase1);
  voiceCache = voices;
  await saveVoiceCacheToDisk(voices);
  return { initialized: true, ...buildVoiceSummary(voices) };
}

export async function generateParagraphSpeech({ chapterId, paragraphIndex, targetSegment }) {
  const paragraphContext = getParagraphContext({ chapterId, paragraphIndex, contextChars: 1000 });
  if (!paragraphContext) {
    throw new Error('未找到目标段落');
  }

  const safeTarget = String(targetSegment || paragraphContext.originalTarget).trim();
  if (!safeTarget) {
    throw new Error('目标段落不能为空');
  }

  // #region agent log
  debugLog(
    'paragraphSpeech.js:generateParagraphSpeech',
    'speech generation started',
    {
      chapterId,
      paragraphIndex,
      targetSegment: safeTarget,
      contextPreview: paragraphContext.context.slice(0, 500)
    },
    'P-entry'
  );
  // #endregion

  const { voices, initializedNow } = await ensureSpeechVoices();

  const script = await runPhase3a({
    context: paragraphContext.context,
    targetSegment: safeTarget,
    voices
  });

  const synthesized = await synthesizeScriptSegments(script, voices);
  const combinedHex = concatMp3Hex(synthesized.map((item) => item.audioHex));
  const durationMs = sumDurationMs(synthesized.map((item) => item.durationMs));
  const traceIds = synthesized.map((item) => item.traceId).filter(Boolean);

  return {
    audioUrl: hexToAudioDataUrl(combinedHex, 'mp3'),
    durationMs: durationMs || null,
    segmentCount: synthesized.length,
    script: synthesized.map((item) => ({
      segmentId: item.segmentId,
      speakerCode: item.speakerCode,
      templateCode: item.templateCode,
      displayName: item.displayName,
      text: item.text,
      durationMs: item.durationMs
    })),
    voicesInitializedNow: initializedNow,
    traceId: traceIds[0] ?? null,
    context: {
      chapterId: paragraphContext.chapterId,
      chapterTitle: paragraphContext.chapterTitle,
      paragraphIndex: paragraphContext.paragraphIndex,
      originalTarget: paragraphContext.originalTarget
    }
  };
}

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
  平静: 'calm',
  压低: 'calm',
  克制: 'calm',
  紧张: 'fearful',
  恐惧: 'fearful',
  愤怒: 'angry',
  悲伤: 'sad',
  惊讶: 'surprised',
  低语: 'whisper',
  高兴: 'happy',
  流畅: 'fluent'
};

const SPEED_MAP = {
  略慢: 0.92,
  慢: 0.88,
  略快: 1.08,
  快: 1.12,
  正常: 1.0
};

const VALID_VOCAL_TAGS = new Set([
  '(laughs)',
  '(chuckle)',
  '(coughs)',
  '(clear-throat)',
  '(groans)',
  '(breath)',
  '(pant)',
  '(inhale)',
  '(exhale)',
  '(gasps)',
  '(sniffs)',
  '(sighs)',
  '(snorts)',
  '(burps)',
  '(lip-smacking)',
  '(humming)',
  '(hissing)',
  '(emm)',
  '(sneezes)'
]);

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
    assertRequiredFields(segment, ['片段编号', '配音文本'], '配音片段');
    if (!segment.配音文本?.trim()) {
      throw new Error(`片段 ${segment.片段编号} 的配音文本不能为空`);
    }

    if (isNarratorSegment(segment)) {
      throw new Error(`片段 ${segment.片段编号} 为旁白，不应出现在配音剧本中`);
    }

    if (!segment.说话人代号 && !segment.模板代号) {
      throw new Error(`片段 ${segment.片段编号} 必须指定说话人代号或模板代号`);
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
    氛围配置: phase1.氛围配置,
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

function mapEmotion(hint, model) {
  if (!hint) return undefined;

  let emotion;
  for (const [key, value] of Object.entries(EMOTION_MAP)) {
    if (hint.includes(key)) {
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

function ensureLowVoiceVocalTags(hints) {
  const source = hints.语气词标签 && typeof hints.语气词标签 === 'object' ? hints.语气词标签 : {};
  const tags = {
    前: Array.isArray(source.前) ? [...source.前] : [],
    后: Array.isArray(source.后) ? [...source.后] : [],
    句内: Array.isArray(source.句内) ? [...source.句内] : []
  };

  if (/低语|压低/.test(hints.情绪 || '') && tags.前.length === 0) {
    tags.前.push('(breath)');
  }

  return tags;
}

function mapSpeed(hint, baseSpeed = 1) {
  if (!hint) return baseSpeed;

  for (const [key, value] of Object.entries(SPEED_MAP)) {
    if (hint.includes(key)) {
      return value;
    }
  }

  return baseSpeed;
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

function applyVocalTags(text, vocalTagsHint) {
  if (!vocalTagsHint || typeof vocalTagsHint !== 'object') {
    return text;
  }

  let result = text;
  const inlineItems = Array.isArray(vocalTagsHint.句内) ? [...vocalTagsHint.句内] : [];

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

function applyPauseMarkers(text, pauseHint) {
  if (!pauseHint || pauseHint === '无') {
    return text;
  }

  if (pauseHint.includes('句间')) {
    return text.replace(/([。！？])/g, '$1<#0.4#>');
  }

  if (pauseHint.includes('句尾')) {
    return `${text}<#0.5#>`;
  }

  return text;
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
  text = applyVocalTags(text, ensureLowVoiceVocalTags(hints));
  text = applyPauseMarkers(text, hints.停顿);

  const body = {
    model,
    text,
    stream: atmosphere.stream ?? false,
    language_boost: atmosphere.language_boost || 'Chinese',
    voice_setting: {
      voice_id: voiceId,
      speed: mapSpeed(hints.语速, baseSpeed),
      vol: baseVol,
      pitch: basePitch
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

  const emotion = mapEmotion(hints.情绪, model);
  if (emotion) {
    body.voice_setting.emotion = emotion;
  }

  const pronunciationTone = [
    ...(voices.发音字典?.tone || []),
    ...(segment.追加发音 || [])
  ].filter(Boolean);

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
    演绎提示: segment.演绎提示
      ? { ...segment.演绎提示 }
      : { 语速: '正常', 情绪: '平静', 停顿: '无', 语气词标签: { 前: [], 后: [], 句内: [] } },
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
    氛围配置: voices.氛围配置,
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
              _retry_instruction: `第 ${attempt} 次生成：只输出角色对白片段，不要输出 narrator 旁白片段；若无对白则返回空数组；每个片段须有非空配音文本与完整演绎提示（含语气词标签，无则前/后/句内为空数组）；语气词标签不得写入配音文本。`
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

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLAN_PATH = path.resolve(__dirname, '../content/dubbing-plans/speckled-band.v1.json');
const QUOTE_MARKS = new Set(['“', '”', '「', '」', '『', '』', '"']);
const ROLE_CODES = new Set(['char_holmes', 'char_watson', 'char_helen', 'char_royllott']);
const TEMPLATE_CODES = new Set(['tpl_male_young', 'tpl_male_middle', 'tpl_female_young', 'tpl_female_middle']);

let manifestCache;

export function splitDialogueAndNarration(sourceText) {
  const source = String(sourceText || '');
  const dialogue = [];
  const narration = [];
  let insideDialogue = false;
  let cursor = 0;

  for (let index = 0; index < source.length; index += 1) {
    if (!QUOTE_MARKS.has(source[index])) continue;
    const text = source.slice(cursor, index).trim();
    if (text) (insideDialogue ? dialogue : narration).push(text);
    insideDialogue = !insideDialogue;
    cursor = index + 1;
  }

  const tail = source.slice(cursor).trim();
  if (tail) (insideDialogue ? dialogue : narration).push(tail);
  return { dialogue, narration };
}

function attributionSpeaker(narrationText) {
  const narration = String(narrationText || '');
  const speechVerb = '(?:说|说道|问|问道|答|回答|叫|叫道|喊|喊道|嚷|低声|继续说|补充道)';
  if (new RegExp(`(?:罗伊洛特|格里姆斯比).{0,16}${speechVerb}`).test(narration)) {
    return { speakerCode: 'char_royllott', templateCode: null };
  }
  if (new RegExp(`(?:福尔摩斯|歇洛克).{0,16}${speechVerb}`).test(narration)) {
    return { speakerCode: 'char_holmes', templateCode: null };
  }
  if (new RegExp(`(?:海伦|斯托纳|那个女人|年轻的女士|姑娘|她).{0,12}${speechVerb}`).test(narration)) {
    return { speakerCode: 'char_helen', templateCode: null };
  }
  if (new RegExp(`华生.{0,16}${speechVerb}`).test(narration) || /我(?:说|问|答|叫|喊|补充|解释|回答|说道|问道)/.test(narration)) {
    return { speakerCode: 'char_watson', templateCode: null };
  }
  if (/太太|女仆|老妇|女人|女士/.test(narration)) return { speakerCode: null, templateCode: 'tpl_female_middle' };
  if (/小姐|少女|姐姐|妹妹/.test(narration)) return { speakerCode: null, templateCode: 'tpl_female_young' };
  if (/男孩|青年|小伙/.test(narration)) return { speakerCode: null, templateCode: 'tpl_male_young' };
  if (/车夫|店主|警察|仆人|男人|老人/.test(narration)) return { speakerCode: null, templateCode: 'tpl_male_middle' };
  return null;
}

export function inferPreparedSpeaker({ narration, dialogue, previousSpeaker = null, nextSpeaker = null }) {
  const explicit = attributionSpeaker((narration || []).join(' '));
  if (explicit) return explicit;

  const spoken = (dialogue || []).join(' ');
  if (/华生/.test(spoken)) return { speakerCode: 'char_holmes', templateCode: null };
  if (/福尔摩斯先生|歇洛克/.test(spoken) && previousSpeaker && previousSpeaker !== 'char_holmes') {
    return { speakerCode: previousSpeaker, templateCode: null };
  }
  if (previousSpeaker && nextSpeaker && previousSpeaker === nextSpeaker) {
    if (previousSpeaker === 'char_holmes') return { speakerCode: 'char_watson', templateCode: null };
    return { speakerCode: 'char_holmes', templateCode: null };
  }
  if (previousSpeaker === 'char_holmes' && nextSpeaker) return { speakerCode: nextSpeaker, templateCode: null };
  if (nextSpeaker === 'char_holmes' && previousSpeaker) return { speakerCode: previousSpeaker, templateCode: null };
  if (previousSpeaker === 'char_helen' || previousSpeaker === 'char_royllott') {
    return { speakerCode: 'char_holmes', templateCode: null };
  }
  if (previousSpeaker === 'char_holmes') return { speakerCode: 'char_watson', templateCode: null };
  return { speakerCode: null, templateCode: 'tpl_male_middle' };
}

function performanceForText(text, sourceText) {
  const signal = `${text} ${sourceText}`;
  if (/害怕|恐惧|发抖|惊恐|尖叫|救命/.test(signal)) {
    return { 语速: '正常', 情绪: '恐惧', 强度: 4, 停顿: '关键处短停', 节奏: '短促紧张，关键词加重', 重读词: [], 语气词标签: { 前: ['(inhale)'], 后: [], 句内: [] } };
  }
  if (/愤怒|怒吼|威胁|混蛋|滚开/.test(signal)) {
    return { 语速: '略快', 情绪: '愤怒克制', 强度: 4, 停顿: '无', 节奏: '压低并加重，避免拖长', 重读词: [], 语气词标签: { 前: [], 后: [], 句内: [] } };
  }
  if (/[？！?!]/.test(text)) {
    return { 语速: '正常', 情绪: '疑惑', 强度: 2, 停顿: '无', 节奏: '疑问尾音自然上扬', 重读词: [], 语气词标签: { 前: [], 后: [], 句内: [] } };
  }
  return { 语速: '正常', 情绪: '克制', 强度: 2, 停顿: '无', 节奏: '语流自然，不人为切碎', 重读词: [], 语气词标签: { 前: [], 后: [], 句内: [] } };
}

export function createPreparedSegments({ sourceText, speakerCode = null, templateCode = null }) {
  const { dialogue } = splitDialogueAndNarration(sourceText);
  return dialogue.map((text, index) => ({
    segmentId: `s${String(index + 1).padStart(3, '0')}`,
    speakerCode,
    templateCode,
    text,
    director: {
      场景压力: '编辑部预制对白方案',
      表演意图: '忠实原文并根据标点自然表达',
      避免: '不要添加原文不存在的台词，不要夸张表演'
    },
    performance: performanceForText(text, sourceText),
    pronunciation: []
  }));
}

function readManifest() {
  if (manifestCache !== undefined) return manifestCache;
  try {
    const parsed = JSON.parse(fs.readFileSync(PLAN_PATH, 'utf8'));
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    manifestCache = {
      ...parsed,
      entriesByUnitId: new Map(entries.map((entry) => [entry.unitId, entry]))
    };
  } catch (error) {
    console.warn(`[dubbing-plans] Prepared manifest unavailable: ${error.message}`);
    manifestCache = null;
  }
  return manifestCache;
}

function validAssignment(segment) {
  return (
    (segment.speakerCode && ROLE_CODES.has(segment.speakerCode) && !segment.templateCode) ||
    (segment.templateCode && TEMPLATE_CODES.has(segment.templateCode) && !segment.speakerCode)
  );
}

function validatePreparedEntry(entry, unit) {
  if (!entry || entry.sourceHash !== unit.sourceHash || !Array.isArray(entry.segments) || entry.segments.length === 0) {
    return false;
  }
  return entry.segments.every(
    (segment) =>
      validAssignment(segment) &&
      typeof segment.text === 'string' &&
      segment.text.trim() &&
      unit.sourceText.includes(segment.text)
  );
}

export function getPreparedDubbingPlan(unit) {
  const manifest = readManifest();
  const entry = manifest?.entriesByUnitId.get(unit.id);
  if (validatePreparedEntry(entry, unit)) {
    return {
      source: 'prepared-manifest',
      schemaVersion: manifest.schemaVersion,
      contentVersion: manifest.contentVersion,
      segments: structuredClone(entry.segments)
    };
  }

  const split = splitDialogueAndNarration(unit.sourceText);
  const assignment = inferPreparedSpeaker({ narration: split.narration, dialogue: split.dialogue });
  return {
    source: 'deterministic-fallback',
    schemaVersion: 1,
    contentVersion: unit.sourceHash,
    segments: createPreparedSegments({ sourceText: unit.sourceText, ...assignment })
  };
}

export function resetPreparedDubbingPlanCacheForTests() {
  manifestCache = undefined;
}

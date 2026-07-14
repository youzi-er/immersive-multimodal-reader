import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bookMeta, getBookText } from '../data.js';
import { assertRequiredFields, callMessagesApiForJsonWithRetry } from './minimax.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.resolve(__dirname, '../prompts');
const CACHE_DIR = path.resolve(__dirname, '../../cache');
const DEBUG_LOG_PATH = path.resolve(__dirname, '../../../debug-d022cd.log');
const PHASE1_REQUIRED = ['global_style_prompt', 'global_negative_prompt', 'style_profile_cn', 'usage_notes'];
const STYLE_PROFILE_KEYS = [
  '世界观美术基调',
  '时代与空间',
  '画风',
  '镜头语言',
  '光影',
  '色彩',
  '材质细节',
  '氛围关键词'
];

let styleCache = null;
let stylePromise = null;

function styleCachePath() {
  return path.join(CACHE_DIR, `${bookMeta.id}-style.json`);
}

function debugLog(message, data, hypothesisId) {
  const payload = {
    sessionId: 'd022cd',
    runId: 'image-trace',
    location: 'bookImageStyle.js:buildBookStyle',
    message,
    data,
    hypothesisId,
    timestamp: Date.now()
  };
  appendFile(DEBUG_LOG_PATH, `${JSON.stringify(payload)}\n`).catch(() => {});
}

export async function loadBookStyleFromDisk() {
  try {
    return JSON.parse(await readFile(styleCachePath(), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function saveBookStyleToDisk(style) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(styleCachePath(), JSON.stringify(style, null, 2), 'utf8');
}

function validatePhase1Output(data) {
  assertRequiredFields(data, PHASE1_REQUIRED, '阶段一输出');
  if (typeof data.style_profile_cn !== 'object' || data.style_profile_cn === null) {
    throw new Error('阶段一输出 style_profile_cn 必须是对象');
  }
  const missing = STYLE_PROFILE_KEYS.filter((key) => !data.style_profile_cn[key]?.trim?.());
  if (missing.length > 0) {
    throw new Error(`style_profile_cn 缺少字段：${missing.join(', ')}`);
  }
}

async function buildBookStyle() {
  const novelText = getBookText();
  if (!novelText) throw new Error('小说全文未加载，无法初始化插图风格');

  const system = await readFile(path.join(PROMPTS_DIR, 'phase1-system.md'), 'utf8');
  debugLog('image phase1 prompt sent', { systemPrompt: system, novelTextLength: novelText.length }, 'I1-send');
  const result = await callMessagesApiForJsonWithRetry({ system, user: novelText, maxTokens: 1600 });
  debugLog('image phase1 raw response', { raw: result }, 'I1-recv');
  validatePhase1Output(result);
  return {
    ...result,
    book_id: bookMeta.id,
    created_at: new Date().toISOString(),
    source_novel: 'speckled-band.txt'
  };
}

export async function ensureBookStyle() {
  if (styleCache) return { style: styleCache, initializedNow: false };

  const cached = await loadBookStyleFromDisk();
  if (cached) {
    styleCache = cached;
    return { style: cached, initializedNow: false };
  }

  if (!stylePromise) {
    stylePromise = buildBookStyle()
      .then(async (style) => {
        styleCache = style;
        await saveBookStyleToDisk(style);
        return style;
      })
      .finally(() => {
        stylePromise = null;
      });
  }

  return { style: await stylePromise, initializedNow: true };
}

export function imageStyleDebugCache(style) {
  if (!style) {
    return { initialized: false, bookId: bookMeta.id, status: '未初始化', style: null };
  }
  return {
    initialized: true,
    bookId: style.book_id,
    createdAt: style.created_at,
    sourceNovel: style.source_novel,
    status: '可生成',
    style: {
      global_style_prompt: style.global_style_prompt,
      global_negative_prompt: style.global_negative_prompt,
      style_profile_cn: style.style_profile_cn,
      usage_notes: style.usage_notes
    }
  };
}

export async function regenerateBookStyle() {
  const style = await buildBookStyle();
  styleCache = style;
  await saveBookStyleToDisk(style);
  return imageStyleDebugCache(style);
}

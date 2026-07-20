import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findClueOccurrence,
  createRuntimeClueIndex,
  loadClueIndex,
  segmentParagraphWithClues,
  validateClueManifest
} from './clue-index.js';
import { getOfficialClueRecommendation } from './official-clue-curation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const bookPath = path.resolve(__dirname, '../content/speckled-band.txt');

const RAW_BOOK_TEXT = fs.existsSync(bookPath)
  ? fs.readFileSync(bookPath, 'utf8')
  : '';

function normalizeBookText(text) {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function splitParagraphs(text) {
  return normalizeBookText(text)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n+/g, '\n').trim())
    .filter(Boolean);
}

const BOOK_PARAGRAPHS = splitParagraphs(RAW_BOOK_TEXT);
const PARAGRAPHS_PER_CHAPTER = 18;
let clueIndex = loadClueIndex({
  bookText: RAW_BOOK_TEXT,
  paragraphs: BOOK_PARAGRAPHS,
  paragraphsPerChapter: PARAGRAPHS_PER_CHAPTER
});

if (clueIndex.warning) {
  console.warn(`[clue-index] ${clueIndex.warning}. 正文将不显示线索下划线。`);
}

export let clues = clueIndex.clues;
export let clueIndexStatus = {
  status: clueIndex.status,
  warning: clueIndex.warning,
  clueCount: clueIndex.clues.length
};

function segmentParagraph(paragraph, globalParagraphIndex, runtimeIndex = clueIndex) {
  return segmentParagraphWithClues(paragraph, globalParagraphIndex, runtimeIndex);
}

function buildSceneForChapter(index, title) {
  const scenes = [
    {
      title: '贝克街清晨会面',
      imagePrompt: '维多利亚时代伦敦，贝克街侦探公寓，清晨薄雾、壁炉、紧张的委托人，暗色写实风格。',
      mood: '冷雾、压迫、理性推理开始前的紧张',
      soundscape: '壁炉轻响、远处马车、清晨街道脚步声'
    },
    {
      title: '委托人的回忆',
      imagePrompt: '年轻女士讲述姐姐死亡前的异常经历，室内低光，人物神情恐惧，福尔摩斯冷静倾听。',
      mood: '恐惧、回忆、疑点逐渐浮现',
      soundscape: '低声叙述、壁炉声、纸张摩擦'
    },
    {
      title: '斯托克莫兰庄园',
      imagePrompt: '老旧英国庄园外观，荒凉乡间、厚重石墙、阴沉天空，悬疑推理氛围。',
      mood: '荒凉、封闭、危险逼近',
      soundscape: '风声、远处鸟鸣、马车轮声'
    },
    {
      title: '异常的卧室',
      imagePrompt: '老旧英国庄园卧室，固定床、无效拉铃绳、墙上通风口，细节清楚可读。',
      mood: '安静、诡异、线索正在连接',
      soundscape: '木地板轻响、风穿过窗缝、远处犬吠'
    },
    {
      title: '夜间守候',
      imagePrompt: '夜晚庄园卧室，侦探和医生隐藏在黑暗里，火柴微光照亮危险线索。',
      mood: '高度紧张、危险、真相揭晓前一秒',
      soundscape: '低哨声、金属摩擦、急促呼吸'
    },
    {
      title: '真相揭示',
      imagePrompt: '维多利亚时代侦探故事结尾，福尔摩斯解释案情，室内阴影和冷静推理氛围。',
      mood: '真相落定、克制、余悸',
      soundscape: '低声解释、窗外风声、沉默停顿'
    }
  ];

  return scenes[Math.min(index, scenes.length - 1)] ?? {
    title,
    imagePrompt: '维多利亚时代英国侦探小说场景，写实电影感，克制悬疑氛围。',
    mood: '悬疑、冷静、推理',
    soundscape: '低环境音、脚步声、纸张声'
  };
}

function buildChaptersFromBook(text, runtimeIndex = clueIndex) {
  const paragraphs = BOOK_PARAGRAPHS;
  const paragraphsPerChapter = PARAGRAPHS_PER_CHAPTER;
  const totalChapters = Math.max(1, Math.ceil(paragraphs.length / paragraphsPerChapter));

  return Array.from({ length: totalChapters }, (_, index) => {
    const start = index * paragraphsPerChapter;
    const chunk = paragraphs.slice(start, start + paragraphsPerChapter);
    const progress = Math.min(100, Math.round(((index + 1) / totalChapters) * 100));
    const title = index === 0 ? '斑点带子案：开端' : `斑点带子案：第 ${index + 1} 节`;

    return {
      id: `speckled-band-${index + 1}`,
      title,
      subtitle: index === 0 ? '贝克街的清晨委托' : `原文第 ${start + 1}-${start + chunk.length} 段`,
      progress,
      paragraphs: chunk.map((paragraph, paragraphIndex) =>
        segmentParagraph(paragraph, start + paragraphIndex, runtimeIndex)
      ),
      scene: buildSceneForChapter(index, title)
    };
  });
}

export let chapters = RAW_BOOK_TEXT
  ? buildChaptersFromBook(RAW_BOOK_TEXT)
  : [
      {
        id: 'speckled-band-1',
        title: '斑点带子案',
        subtitle: '全文文件未加载',
        progress: 100,
        paragraphs: [[{ type: 'narration', text: '未找到 backend/content/speckled-band.txt。' }]],
        scene: buildSceneForChapter(0, '斑点带子案')
      }
    ];

export function applyClueManifest(manifest) {
  const normalizedManifest = {
    ...manifest,
    clues: manifest.clues.map((clue) => {
      const recommendation = getOfficialClueRecommendation(clue.id);
      return recommendation
        ? {
            ...clue,
            label: recommendation.label
          }
        : clue;
    })
  };
  const validated = validateClueManifest(normalizedManifest, {
    bookText: RAW_BOOK_TEXT,
    paragraphs: BOOK_PARAGRAPHS,
    paragraphsPerChapter: PARAGRAPHS_PER_CHAPTER
  });
  const nextIndex = createRuntimeClueIndex(validated);
  const nextChapters = RAW_BOOK_TEXT ? buildChaptersFromBook(RAW_BOOK_TEXT, nextIndex) : chapters;
  clueIndex = nextIndex;
  clues = nextIndex.clues;
  clueIndexStatus = { status: 'ready', warning: '', clueCount: clues.length };
  chapters = nextChapters;
  return { clues, chapters };
}

function paragraphToPlainText(paragraph) {
  return paragraph.map((segment) => segment.text).join('');
}

export const bookParagraphIndex = chapters.flatMap((chapter) =>
  chapter.paragraphs.map((paragraph, paragraphIndex) => ({
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    paragraphIndex,
    text: paragraphToPlainText(paragraph)
  }))
);

const linearBookText = bookParagraphIndex.map((paragraph) => paragraph.text).join('\n\n');

const paragraphOffsets = [];
let paragraphOffset = 0;
for (const paragraph of bookParagraphIndex) {
  paragraphOffsets.push({
    ...paragraph,
    start: paragraphOffset,
    end: paragraphOffset + paragraph.text.length
  });
  paragraphOffset += paragraph.text.length + 2;
}

export function getBookText() {
  return normalizeBookText(RAW_BOOK_TEXT);
}

export function getParagraphContext({ chapterId, paragraphIndex, contextChars = 1000 }) {
  const target = paragraphOffsets.find(
    (paragraph) => paragraph.chapterId === chapterId && paragraph.paragraphIndex === paragraphIndex
  );

  if (!target) {
    return null;
  }

  const before = linearBookText.slice(Math.max(0, target.start - contextChars), target.start).trim();
  const after = linearBookText.slice(target.end, target.end + contextChars).trim();

  return {
    chapterId: target.chapterId,
    chapterTitle: target.chapterTitle,
    paragraphIndex: target.paragraphIndex,
    originalTarget: target.text,
    context: [before, target.text, after].filter(Boolean).join('\n\n'),
    before,
    after
  };
}

export function getClueOccurrence(clueId, occurrenceId) {
  return findClueOccurrence(clueIndex, clueId, occurrenceId);
}

export function getClueReaderContext({ clueId, occurrenceId, contextChars = 1200 }) {
  const entry = getClueOccurrence(clueId, occurrenceId);
  if (!entry) {
    return null;
  }

  const target = paragraphOffsets[entry.occurrence.globalParagraphIndex];
  if (!target) {
    return null;
  }

  const before = linearBookText.slice(Math.max(0, target.start - contextChars), target.start).trim();
  return {
    clue: entry.clue,
    occurrence: entry.occurrence,
    sourceContext: target.text,
    readerContext: [before, target.text].filter(Boolean).join('\n\n'),
    before
  };
}

export const bookMeta = {
  id: 'speckled-band',
  title: '斑点带子案',
  author: '阿瑟·柯南·道尔',
  paragraphCount: BOOK_PARAGRAPHS.length,
  chapterCount: chapters.length
};

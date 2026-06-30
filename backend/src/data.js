import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const bookPath = path.resolve(__dirname, '../content/speckled-band.txt');

const RAW_BOOK_TEXT = fs.existsSync(bookPath)
  ? fs.readFileSync(bookPath, 'utf8')
  : '';

export const clues = [
  {
    id: 'clue-bell-rope',
    label: '无效的拉铃绳',
    type: '线索',
    keywords: ['拉铃绳', '铃绳', '铃'],
    description: '看似用于叫仆人，实际没有连接任何铃铛，位置却正好垂在床边。'
  },
  {
    id: 'clue-ventilator',
    label: '异常通风口',
    type: '线索',
    keywords: ['通风口', '通气孔'],
    description: '通风口没有通向室外，而是连接到隔壁房间，说明它可能不是为了通风。'
  },
  {
    id: 'clue-fixed-bed',
    label: '固定在地板上的床',
    type: '线索',
    keywords: ['床', '固定'],
    description: '床不能移动，意味着受害者每晚都会处在同一个固定位置。'
  },
  {
    id: 'clue-whistle',
    label: '夜间短哨声',
    type: '线索',
    keywords: ['哨声', '口哨'],
    description: '短促的哨声反复出现在深夜，像是某种训练信号。'
  },
  {
    id: 'clue-speckled-band',
    label: '斑点带子',
    type: '线索',
    keywords: ['斑点带子', '带子'],
    description: '死者临终前留下的关键词，是案件中最重要也最容易误读的线索。'
  },
  {
    id: 'place-stoke-moran',
    label: '斯托克莫兰庄园',
    type: '地点',
    keywords: ['斯托克莫兰', '庄园', '罗伊洛特'],
    description: '案件发生地，老旧、封闭，房间结构隐藏了关键作案路径。'
  },
  {
    id: 'person-holmes',
    label: '夏洛克·福尔摩斯',
    type: '人物',
    keywords: ['福尔摩斯', '歇洛克'],
    description: '通过观察物理细节和异常设计，逐步还原案件真相。'
  }
];

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

function inferSpeaker(beforeText, quoteText) {
  const scope = `${beforeText} ${quoteText}`;

  if (/福尔摩斯|歇洛克/.test(scope)) return '福尔摩斯';
  if (/华生|我/.test(scope)) return '华生';
  if (/斯托纳|小姐|女士|她/.test(scope)) return '海伦·斯托纳';
  if (/罗伊洛特|医生|继父/.test(scope)) return '罗伊洛特医生';

  return '角色对白';
}

function clueForText(text) {
  return clues.find((clue) =>
    clue.keywords?.some((keyword) => text.includes(keyword))
  );
}

function segmentParagraph(paragraph) {
  const segments = [];
  const quotePattern = /“([^”]+)”/g;
  let lastIndex = 0;
  let match;

  while ((match = quotePattern.exec(paragraph)) !== null) {
    const before = paragraph.slice(lastIndex, match.index);
    if (before) {
      const clue = clueForText(before);
      segments.push(
        clue
          ? { type: 'clue', clueId: clue.id, text: before }
          : { type: 'narration', text: before }
      );
    }

    segments.push({
      type: 'dialogue',
      speaker: inferSpeaker(paragraph.slice(0, match.index), match[1]),
      text: match[1],
      voice: { pitch: 0.95, rate: 0.95 }
    });

    lastIndex = match.index + match[0].length;
  }

  const after = paragraph.slice(lastIndex);
  if (after) {
    const clue = clueForText(after);
    segments.push(
      clue
        ? { type: 'clue', clueId: clue.id, text: after }
        : { type: 'narration', text: after }
    );
  }

  if (segments.length === 0) {
    const clue = clueForText(paragraph);
    segments.push(
      clue
        ? { type: 'clue', clueId: clue.id, text: paragraph }
        : { type: 'narration', text: paragraph }
    );
  }

  return segments;
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

function buildChaptersFromBook(text) {
  const paragraphs = splitParagraphs(text);
  const bodyParagraphs = paragraphs.filter((paragraph) => paragraph.length > 8);
  const paragraphsPerChapter = 18;
  const totalChapters = Math.max(1, Math.ceil(bodyParagraphs.length / paragraphsPerChapter));

  return Array.from({ length: totalChapters }, (_, index) => {
    const start = index * paragraphsPerChapter;
    const chunk = bodyParagraphs.slice(start, start + paragraphsPerChapter);
    const progress = Math.min(100, Math.round(((index + 1) / totalChapters) * 100));
    const title = index === 0 ? '斑点带子案：开端' : `斑点带子案：第 ${index + 1} 节`;

    return {
      id: `speckled-band-${index + 1}`,
      title,
      subtitle: index === 0 ? '贝克街的清晨委托' : `原文第 ${start + 1}-${start + chunk.length} 段`,
      progress,
      paragraphs: chunk.map(segmentParagraph),
      scene: buildSceneForChapter(index, title)
    };
  });
}

export const chapters = RAW_BOOK_TEXT
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

export const bookMeta = {
  id: 'speckled-band',
  title: '斑点带子案',
  author: '阿瑟·柯南·道尔',
  paragraphCount: splitParagraphs(RAW_BOOK_TEXT).length,
  chapterCount: chapters.length
};

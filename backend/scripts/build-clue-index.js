import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { callMessagesApiForJson } from '../src/services/minimax.js';
import { normalizeSourceText, sourceSha256, splitSourceParagraphs } from '../src/clue-index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.resolve(backendRoot, '../.env') });
dotenv.config({ path: path.resolve(backendRoot, '.env') });

const sourcePath = path.resolve(backendRoot, 'content/speckled-band.txt');
const outputPath = path.resolve(backendRoot, 'content/speckled-band-clues.json');
const promptPath = path.resolve(backendRoot, 'src/prompts/clue-index-system.md');
const paragraphsPerChapter = 18;
const validTypes = new Set(['人物', '地点', '物证']);

function sentenceAround(paragraph, startOffset, endOffset) {
  const left = Math.max(
    paragraph.lastIndexOf('。', Math.max(0, startOffset - 1)),
    paragraph.lastIndexOf('！', Math.max(0, startOffset - 1)),
    paragraph.lastIndexOf('？', Math.max(0, startOffset - 1)),
    paragraph.lastIndexOf('\n', Math.max(0, startOffset - 1))
  );
  const rightCandidates = ['。', '！', '？', '\n']
    .map((mark) => paragraph.indexOf(mark, endOffset))
    .filter((index) => index >= 0);
  const right = rightCandidates.length ? Math.min(...rightCandidates) + 1 : paragraph.length;
  const sentence = paragraph.slice(left + 1, right).trim();
  return sentence.length <= 150 ? sentence : `${sentence.slice(0, 147)}...`;
}

function stableOccurrenceId(candidate) {
  const digest = crypto
    .createHash('sha256')
    .update(
      `${candidate.canonicalKey}|${candidate.globalParagraphIndex}|${candidate.startOffset}|${candidate.endOffset}|${candidate.selectedText}`
    )
    .digest('hex')
    .slice(0, 12);
  return `occ-${digest}`;
}

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function validateCandidate(raw, paragraphs, occupiedRanges) {
  const globalParagraphIndex = Number(raw?.global_paragraph_index);
  const suggestedStartOffset = Number(raw?.start_offset);
  const selectedText = String(raw?.selected_text || '');
  const canonicalKey = normalizeKey(raw?.canonical_key);
  const canonicalLabel = String(raw?.canonical_label || '').trim();
  const type = String(raw?.type || '').trim();
  const paragraph = paragraphs[globalParagraphIndex];

  if (
    !Number.isInteger(globalParagraphIndex) ||
    !paragraph ||
    !selectedText ||
    !canonicalKey ||
    !canonicalLabel ||
    !validTypes.has(type)
  ) {
    return null;
  }

  const paragraphRanges = occupiedRanges.get(globalParagraphIndex) || [];
  const possibleStarts = [];
  let cursor = 0;
  while (cursor <= paragraph.length - selectedText.length) {
    const index = paragraph.indexOf(selectedText, cursor);
    if (index < 0) break;
    possibleStarts.push(index);
    cursor = index + 1;
  }
  possibleStarts.sort((left, right) => {
    if (!Number.isInteger(suggestedStartOffset)) return left - right;
    return Math.abs(left - suggestedStartOffset) - Math.abs(right - suggestedStartOffset);
  });
  const startOffset = possibleStarts.find((start) => {
    const end = start + selectedText.length;
    return !paragraphRanges.some((range) => start < range.end && end > range.start);
  });
  if (!Number.isInteger(startOffset)) return null;
  const endOffset = startOffset + selectedText.length;

  paragraphRanges.push({ start: startOffset, end: endOffset });
  occupiedRanges.set(globalParagraphIndex, paragraphRanges);

  return {
    globalParagraphIndex,
    startOffset,
    endOffset,
    selectedText,
    canonicalKey,
    canonicalLabel,
    type
  };
}

async function extractCandidates(paragraphs, system) {
  const occupiedRanges = new Map();
  const candidates = [];

  for (let start = 0; start < paragraphs.length; start += paragraphsPerChapter) {
    const batch = paragraphs.slice(start, start + paragraphsPerChapter).map((text, offset) => ({
      global_paragraph_index: start + offset,
      paragraph: text
    }));
    const result = await callMessagesApiForJson({
      system,
      user: JSON.stringify({ paragraphs: batch }, null, 2),
      temperature: 0.2,
      maxTokens: 3600
    });
    const rawCandidates = Array.isArray(result?.candidates) ? result.candidates : [];
    for (const raw of rawCandidates) {
      const candidate = validateCandidate(raw, paragraphs, occupiedRanges);
      if (candidate) candidates.push(candidate);
    }
    console.log(`线索筛选：${Math.min(start + paragraphsPerChapter, paragraphs.length)}/${paragraphs.length}`);
  }

  return candidates.sort(
    (left, right) => left.globalParagraphIndex - right.globalParagraphIndex || left.startOffset - right.startOffset
  );
}

function buildManifest(bookText, paragraphs, candidates) {
  const clueMap = new Map();
  for (const candidate of candidates) {
    const groupKey = `${candidate.type}:${candidate.canonicalKey}`;
    let clue = clueMap.get(groupKey);
    if (!clue) {
      clue = {
        id: `clue-${candidate.canonicalKey}`,
        label: candidate.canonicalLabel,
        type: candidate.type,
        surfaceDescription: sentenceAround(
          paragraphs[candidate.globalParagraphIndex],
          candidate.startOffset,
          candidate.endOffset
        ),
        occurrences: []
      };
      clueMap.set(groupKey, clue);
    }

    const chapterIndex = Math.floor(candidate.globalParagraphIndex / paragraphsPerChapter);
    clue.occurrences.push({
      id: stableOccurrenceId(candidate),
      globalParagraphIndex: candidate.globalParagraphIndex,
      chapterId: `speckled-band-${chapterIndex + 1}`,
      paragraphIndex: candidate.globalParagraphIndex % paragraphsPerChapter,
      selectedText: candidate.selectedText,
      startOffset: candidate.startOffset,
      endOffset: candidate.endOffset
    });
  }

  return {
    version: 1,
    articleId: 'speckled-band',
    sourceSha256: sourceSha256(bookText),
    generatedAt: new Date().toISOString(),
    generator: {
      protocol: 'visual-clue-index-v1',
      model: process.env.MINIMAX_TEXT_MODEL || 'MiniMax-M3'
    },
    clues: [...clueMap.values()]
  };
}

const dryRun = process.argv.includes('--dry-run');
const bookText = normalizeSourceText(await fs.readFile(sourcePath, 'utf8'));
const paragraphs = splitSourceParagraphs(bookText);
const system = await fs.readFile(promptPath, 'utf8');
const candidates = await extractCandidates(paragraphs, system);
const manifest = buildManifest(bookText, paragraphs, candidates);

if (dryRun) {
  console.log(JSON.stringify({ clueCount: manifest.clues.length, occurrenceCount: candidates.length }, null, 2));
} else {
  await fs.writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`已写入 ${outputPath}：${manifest.clues.length} 条线索，${candidates.length} 个出现位置`);
}

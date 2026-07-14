import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MANIFEST_PATH = path.resolve(__dirname, '../content/speckled-band-clues.json');
const VALID_TYPES = new Set(['人物', '地点', '物证']);

export function normalizeSourceText(text) {
  return String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

export function splitSourceParagraphs(text) {
  return normalizeSourceText(text)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n+/g, '\n').trim())
    .filter(Boolean);
}

export function sourceSha256(text) {
  return crypto.createHash('sha256').update(normalizeSourceText(text)).digest('hex');
}

function emptyIndex(status, warning = '') {
  return {
    status,
    warning,
    clues: [],
    clueById: new Map(),
    occurrenceById: new Map(),
    occurrencesByParagraph: new Map()
  };
}

export function validateClueManifest(manifest, { bookText, paragraphs, paragraphsPerChapter = 18 }) {
  if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.clues)) {
    throw new Error('线索索引格式无效');
  }

  const expectedHash = sourceSha256(bookText);
  if (manifest.sourceSha256 !== expectedHash) {
    throw new Error('线索索引与当前原文不一致');
  }

  const clueIds = new Set();
  const occurrenceIds = new Set();
  const clues = [];

  for (const rawClue of manifest.clues) {
    const id = String(rawClue?.id || '').trim();
    const label = String(rawClue?.label || '').trim();
    const type = String(rawClue?.type || '').trim();
    const surfaceDescription = String(rawClue?.surfaceDescription || '').trim();

    if (!id || !label || !VALID_TYPES.has(type) || !surfaceDescription || clueIds.has(id)) {
      throw new Error(`线索定义无效：${id || '(missing id)'}`);
    }
    clueIds.add(id);

    const occurrences = [];
    for (const rawOccurrence of rawClue.occurrences || []) {
      const globalParagraphIndex = Number(rawOccurrence.globalParagraphIndex);
      const startOffset = Number(rawOccurrence.startOffset);
      const endOffset = Number(rawOccurrence.endOffset);
      const selectedText = String(rawOccurrence.selectedText || '');
      const occurrenceId = String(rawOccurrence.id || '').trim();
      const paragraph = paragraphs[globalParagraphIndex];
      const expectedChapterIndex = Math.floor(globalParagraphIndex / paragraphsPerChapter);
      const expectedChapterId = `speckled-band-${expectedChapterIndex + 1}`;
      const expectedParagraphIndex = globalParagraphIndex % paragraphsPerChapter;

      if (
        !occurrenceId ||
        occurrenceIds.has(occurrenceId) ||
        !Number.isInteger(globalParagraphIndex) ||
        !Number.isInteger(startOffset) ||
        !Number.isInteger(endOffset) ||
        !paragraph ||
        startOffset < 0 ||
        endOffset <= startOffset ||
        paragraph.slice(startOffset, endOffset) !== selectedText ||
        rawOccurrence.chapterId !== expectedChapterId ||
        rawOccurrence.paragraphIndex !== expectedParagraphIndex
      ) {
        throw new Error(`线索出现位置无效：${occurrenceId || id}`);
      }

      occurrenceIds.add(occurrenceId);
      occurrences.push({
        id: occurrenceId,
        clueId: id,
        globalParagraphIndex,
        chapterId: expectedChapterId,
        paragraphIndex: expectedParagraphIndex,
        selectedText,
        startOffset,
        endOffset
      });
    }

    if (occurrences.length === 0) {
      throw new Error(`线索没有有效出现位置：${id}`);
    }

    occurrences.sort(
      (left, right) =>
        left.globalParagraphIndex - right.globalParagraphIndex || left.startOffset - right.startOffset
    );
    clues.push({ id, label, type, surfaceDescription, occurrences });
  }

  return { ...manifest, clues };
}

export function createRuntimeClueIndex(manifest) {
  const runtime = emptyIndex('ready');
  runtime.clues = manifest.clues;

  for (const clue of runtime.clues) {
    runtime.clueById.set(clue.id, clue);
    for (const occurrence of clue.occurrences) {
      runtime.occurrenceById.set(occurrence.id, { clue, occurrence });
      const list = runtime.occurrencesByParagraph.get(occurrence.globalParagraphIndex) || [];
      list.push(occurrence);
      runtime.occurrencesByParagraph.set(occurrence.globalParagraphIndex, list);
    }
  }

  for (const list of runtime.occurrencesByParagraph.values()) {
    list.sort((left, right) => left.startOffset - right.startOffset || right.endOffset - left.endOffset);
    let lastEnd = -1;
    for (const occurrence of list) {
      if (occurrence.startOffset < lastEnd) {
        throw new Error(`线索出现位置重叠：${occurrence.id}`);
      }
      lastEnd = occurrence.endOffset;
    }
  }

  return runtime;
}

export function loadClueIndex({ bookText, paragraphs, paragraphsPerChapter = 18, manifestPath } = {}) {
  const resolvedPath = manifestPath || DEFAULT_MANIFEST_PATH;
  if (!fs.existsSync(resolvedPath)) {
    return emptyIndex('missing', `未找到线索索引：${resolvedPath}`);
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
    const validated = validateClueManifest(manifest, { bookText, paragraphs, paragraphsPerChapter });
    return createRuntimeClueIndex(validated);
  } catch (error) {
    return emptyIndex('stale', error.message || '线索索引不可用');
  }
}

export function segmentParagraphWithClues(paragraph, globalParagraphIndex, runtimeIndex) {
  const occurrences = runtimeIndex.occurrencesByParagraph.get(globalParagraphIndex) || [];
  if (occurrences.length === 0) {
    return [{ type: 'narration', text: paragraph }];
  }

  const segments = [];
  let cursor = 0;
  for (const occurrence of occurrences) {
    if (occurrence.startOffset > cursor) {
      segments.push({ type: 'narration', text: paragraph.slice(cursor, occurrence.startOffset) });
    }
    segments.push({
      type: 'clue',
      clueId: occurrence.clueId,
      occurrenceId: occurrence.id,
      startOffset: occurrence.startOffset,
      endOffset: occurrence.endOffset,
      text: occurrence.selectedText
    });
    cursor = occurrence.endOffset;
  }

  if (cursor < paragraph.length) {
    segments.push({ type: 'narration', text: paragraph.slice(cursor) });
  }
  return segments;
}

export function findClueOccurrence(runtimeIndex, clueId, occurrenceId) {
  const entry = runtimeIndex.occurrenceById.get(String(occurrenceId || ''));
  if (!entry || entry.clue.id !== String(clueId || '')) {
    return null;
  }
  return entry;
}

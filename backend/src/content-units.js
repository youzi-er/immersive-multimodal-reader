import crypto from 'node:crypto';
import { bookMeta, chapters } from './data.js';

const CONTENT_UNIT_KIND = 'paragraph-dialogue';

function paragraphToText(paragraph) {
  return paragraph.map((segment) => segment.text).join('');
}

function stableUnitId(articleId, chapterId, paragraphIndex) {
  const identity = `${articleId}\u0000${chapterId}\u0000${paragraphIndex}`;
  return `cu_${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24)}`;
}

function contentHash(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function containsDialogue(text) {
  return /[“”「」『』\"]/.test(text);
}

function buildContentUnits() {
  return chapters.flatMap((chapter) =>
    chapter.paragraphs.map((paragraph, paragraphIndex) => {
      const sourceText = paragraphToText(paragraph);
      return Object.freeze({
        id: stableUnitId(bookMeta.id, chapter.id, paragraphIndex),
        kind: CONTENT_UNIT_KIND,
        articleId: bookMeta.id,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        paragraphIndex,
        sourceText,
        sourceHash: contentHash(sourceText),
        hasDialogue: containsDialogue(sourceText),
        range: Object.freeze({
          startParagraphIndex: paragraphIndex,
          startOffset: 0,
          endParagraphIndex: paragraphIndex,
          endOffset: sourceText.length
        })
      });
    })
  );
}

const contentUnits = buildContentUnits();
const contentUnitsById = new Map(contentUnits.map((unit) => [unit.id, unit]));
const contentUnitsByPosition = new Map(
  contentUnits.map((unit) => [`${unit.articleId}\u0000${unit.chapterId}\u0000${unit.paragraphIndex}`, unit])
);

export function getContentUnit(unitId) {
  return contentUnitsById.get(String(unitId || '')) || null;
}

export function getContentUnitByPosition({ articleId = bookMeta.id, chapterId, paragraphIndex }) {
  if (!chapterId || !Number.isInteger(Number(paragraphIndex))) {
    return null;
  }
  return (
    contentUnitsByPosition.get(`${articleId}\u0000${chapterId}\u0000${Number(paragraphIndex)}`) || null
  );
}

export function listContentUnits({ articleId = bookMeta.id, chapterId } = {}) {
  return contentUnits.filter(
    (unit) => unit.articleId === articleId && (!chapterId || unit.chapterId === chapterId)
  );
}

export function toPublicContentUnit(unit) {
  if (!unit) {
    return null;
  }
  return {
    id: unit.id,
    kind: unit.kind,
    articleId: unit.articleId,
    chapterId: unit.chapterId,
    chapterTitle: unit.chapterTitle,
    paragraphIndex: unit.paragraphIndex,
    sourceText: unit.sourceText,
    sourceHash: unit.sourceHash,
    hasDialogue: unit.hasDialogue,
    range: unit.range
  };
}


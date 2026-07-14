import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { callMessagesApiForJson } from '../src/services/minimax.js';
import { splitSourceParagraphs } from '../src/clue-index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.resolve(backendRoot, '../.env') });
dotenv.config({ path: path.resolve(backendRoot, '.env') });

const sourcePath = path.resolve(backendRoot, 'content/speckled-band.txt');
const manifestPath = path.resolve(backendRoot, 'content/speckled-band-clues.json');
const promptPath = path.resolve(backendRoot, 'src/prompts/clue-index-review-system.md');
const paragraphsPerChapter = 18;

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

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

const [bookText, manifestText, system] = await Promise.all([
  fs.readFile(sourcePath, 'utf8'),
  fs.readFile(manifestPath, 'utf8'),
  fs.readFile(promptPath, 'utf8')
]);
const paragraphs = splitSourceParagraphs(bookText);
const manifest = JSON.parse(manifestText);
const occurrenceEntries = manifest.clues.flatMap((clue) =>
  clue.occurrences.map((occurrence) => ({ clue, occurrence }))
);
const selected = new Map();

function rejectGenericCandidate(candidate) {
  const text = candidate.selected_text.trim();
  if (!text || /^(我|我们|姐姐|妹妹|那位女士|那位小姐|房门|床边)$/.test(text)) return true;
  if (candidate.type === '物证' && /(声音|哨声|口哨|烟味|气味|香味|听到|闻到)/.test(text)) return true;
  if (candidate.type === '物证' && /只有.+才会/.test(text)) return true;
  return false;
}

for (let chapterIndex = 0; chapterIndex < Math.ceil(paragraphs.length / paragraphsPerChapter); chapterIndex += 1) {
  const start = chapterIndex * paragraphsPerChapter;
  const end = start + paragraphsPerChapter;
  const candidates = occurrenceEntries
    .filter(({ occurrence }) => occurrence.globalParagraphIndex >= start && occurrence.globalParagraphIndex < end)
    .map(({ clue, occurrence }) => ({
      occurrence_id: occurrence.id,
      paragraph_index: occurrence.globalParagraphIndex,
      selected_text: occurrence.selectedText,
      canonical_label: clue.label,
      type: clue.type,
      source_sentence: sentenceAround(
        paragraphs[occurrence.globalParagraphIndex],
        occurrence.startOffset,
        occurrence.endOffset
      )
    }));

  if (candidates.length === 0) continue;
  const result = await callMessagesApiForJson({
    system,
    user: JSON.stringify({ chapter_index: chapterIndex + 1, candidates }, null, 2),
    temperature: 0.2,
    maxTokens: 1800
  });
  const eligibleSelections = (Array.isArray(result?.selections) ? result.selections : [])
    .filter((selection) => {
      const candidate = candidates.find((item) => item.occurrence_id === String(selection?.occurrence_id || ''));
      return candidate && !rejectGenericCandidate(candidate);
    })
    .slice(0, 8);
  for (const selection of eligibleSelections) {
    const occurrenceId = String(selection?.occurrence_id || '');
    const canonicalKey = normalizeKey(selection?.canonical_key);
    if (canonicalKey && candidates.some((candidate) => candidate.occurrence_id === occurrenceId)) {
      selected.set(occurrenceId, canonicalKey);
    }
  }
  console.log(`线索复审：${Math.min(end, paragraphs.length)}/${paragraphs.length}`);
}

const typePrefix = { 人物: 'person', 地点: 'place', 物证: 'evidence' };
const grouped = new Map();
for (const { clue, occurrence } of occurrenceEntries) {
  const canonicalKey = selected.get(occurrence.id);
  if (!canonicalKey) continue;
  const groupKey = `${clue.type}:${canonicalKey}`;
  let group = grouped.get(groupKey);
  if (!group) {
    group = {
      id: `clue-${typePrefix[clue.type] || 'visual'}-${canonicalKey}`,
      label: clue.label,
      type: clue.type,
      surfaceDescription: sentenceAround(
        paragraphs[occurrence.globalParagraphIndex],
        occurrence.startOffset,
        occurrence.endOffset
      ),
      occurrences: []
    };
    grouped.set(groupKey, group);
  }
  group.occurrences.push(occurrence);
}

const reviewedManifest = {
  ...manifest,
  generatedAt: new Date().toISOString(),
  generator: {
    ...manifest.generator,
    reviewProtocol: 'visual-clue-review-v1'
  },
  clues: [...grouped.values()]
};
await fs.writeFile(manifestPath, `${JSON.stringify(reviewedManifest, null, 2)}\n`, 'utf8');
console.log(
  `复审完成：${reviewedManifest.clues.length} 条线索，${reviewedManifest.clues.reduce(
    (count, clue) => count + clue.occurrences.length,
    0
  )} 个出现位置`
);

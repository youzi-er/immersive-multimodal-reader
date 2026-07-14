import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.resolve(__dirname, '../content/speckled-band-clues.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const grouped = new Map();

for (const clue of manifest.clues) {
  const normalizedLabel = String(clue.label || '').trim().replace(/\s+/g, '');
  const key = `${clue.type}:${normalizedLabel}`;
  let target = grouped.get(key);
  if (!target) {
    target = { ...clue, occurrences: [] };
    grouped.set(key, target);
  }
  const knownIds = new Set(target.occurrences.map((occurrence) => occurrence.id));
  for (const occurrence of clue.occurrences) {
    if (!knownIds.has(occurrence.id)) {
      target.occurrences.push(occurrence);
      knownIds.add(occurrence.id);
    }
  }
}

const clues = [...grouped.values()];
for (const clue of clues) {
  clue.occurrences.sort(
    (left, right) =>
      left.globalParagraphIndex - right.globalParagraphIndex || left.startOffset - right.startOffset
  );
}
clues.sort(
  (left, right) =>
    left.occurrences[0].globalParagraphIndex - right.occurrences[0].globalParagraphIndex ||
    left.occurrences[0].startOffset - right.occurrences[0].startOffset
);

const merged = {
  ...manifest,
  generatedAt: new Date().toISOString(),
  generator: { ...manifest.generator, mergeProtocol: 'same-type-label-v1' },
  clues
};
await fs.writeFile(manifestPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
console.log(
  `归并完成：${clues.length} 条线索，${clues.reduce((count, clue) => count + clue.occurrences.length, 0)} 个出现位置`
);

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getContentUnitByPosition } from './content-units.js';
import { illustrationStore } from './illustration-store.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.resolve(currentDirectory, '../content/official-illustration-selections.json');

export const officialIllustrationSelections = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

export function buildBundledOfficialIllustrationSlots(
  manifest = officialIllustrationSelections,
  resolveUnit = getContentUnitByPosition
) {
  return manifest.selections.map((selection) => {
    const unit = resolveUnit({
      articleId: manifest.articleId,
      chapterId: selection.chapterId,
      paragraphIndex: selection.paragraphIndex
    });
    if (!unit || !unit.sourceText.includes(selection.locatorText)) {
      throw new Error(`Official selection ${selection.id} no longer matches the source paragraph`);
    }
    if (!String(selection.imageUrl || '').startsWith('/assets/official-illustrations/')) {
      throw new Error(`Official selection ${selection.id} is missing its bundled image`);
    }
    return {
      id: selection.id,
      unitId: unit.id,
      articleId: unit.articleId,
      chapterId: unit.chapterId,
      paragraphIndex: unit.paragraphIndex,
      imageUrl: selection.imageUrl,
      mediaAssetId: null,
      promptExcerpt: selection.promptExcerpt,
      sourceText: unit.sourceText,
      sourceHash: unit.sourceHash
    };
  });
}

let bundledSlotsPromise;

export function ensureBundledOfficialIllustrationSlots({ store = illustrationStore, cache = true } = {}) {
  const seed = async () => {
    const bundledSlots = buildBundledOfficialIllustrationSlots();
    const existingSlots = await store.listOfficialSlots({
      articleId: officialIllustrationSelections.articleId
    });
    const existingIds = new Set(existingSlots.map((slot) => slot.id));
    for (const slot of bundledSlots) {
      if (!existingIds.has(slot.id)) {
        await store.upsertOfficialSlot(slot);
      }
    }
    return bundledSlots;
  };
  if (!cache || store !== illustrationStore) return seed();
  bundledSlotsPromise ||= seed();
  return bundledSlotsPromise;
}

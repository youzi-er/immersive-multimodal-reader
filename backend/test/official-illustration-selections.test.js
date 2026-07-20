import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { getContentUnitByPosition } from '../src/content-units.js';
import {
  buildBundledOfficialIllustrationSlots,
  ensureBundledOfficialIllustrationSlots
} from '../src/official-illustration-slots.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.resolve(
  currentDirectory,
  '../content/official-illustration-selections.json'
);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

test('official illustration selections resolve excerpts to complete paragraphs', () => {
  assert.equal(manifest.articleId, 'speckled-band');
  assert.equal(manifest.placementRule, 'after-paragraph');
  assert.equal(manifest.selections.length, 9);

  const positions = new Set();
  for (const selection of manifest.selections) {
    const position = `${selection.chapterId}:${selection.paragraphIndex}`;
    assert.equal(positions.has(position), false, `duplicate placement ${position}`);
    positions.add(position);

    const unit = getContentUnitByPosition({
      articleId: manifest.articleId,
      chapterId: selection.chapterId,
      paragraphIndex: selection.paragraphIndex
    });
    assert.ok(unit, `missing complete paragraph for ${selection.id}`);
    assert.equal(unit.articleId, manifest.articleId);
    assert.ok(unit.sourceText.includes(selection.locatorText), `locator mismatch for ${selection.id}`);
    assert.ok(selection.promptExcerpt.trim().length > 0, `missing prompt excerpt for ${selection.id}`);
    assert.equal(
      selection.imageUrl,
      `/assets/official-illustrations/${selection.id}.jpg`,
      `unexpected bundled image URL for ${selection.id}`
    );
    const imagePath = path.resolve(currentDirectory, '../../frontend/public', selection.imageUrl.slice(1));
    assert.ok(fs.existsSync(imagePath), `missing bundled image for ${selection.id}`);
    assert.ok(fs.statSync(imagePath).size > 1000, `bundled image is empty for ${selection.id}`);
  }
});

test('fresh databases receive every missing bundled official illustration', async () => {
  const bundled = buildBundledOfficialIllustrationSlots();
  const existing = bundled[0];
  const inserted = [];
  const store = {
    listOfficialSlots: async () => [existing],
    upsertOfficialSlot: async (slot) => {
      inserted.push(slot);
      return slot;
    }
  };

  await ensureBundledOfficialIllustrationSlots({ store, cache: false });
  assert.equal(inserted.length, bundled.length - 1);
  assert.equal(inserted.some((slot) => slot.id === existing.id), false);
  assert.equal(inserted.every((slot) => slot.mediaAssetId === null), true);
});

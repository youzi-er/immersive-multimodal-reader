import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { getContentUnitByPosition } from '../src/content-units.js';

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
  }
});

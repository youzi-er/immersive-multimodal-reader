import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getContentUnit,
  getContentUnitByPosition,
  listContentUnits
} from '../src/content-units.js';

test('content units are stable paragraph-level identities', () => {
  const units = listContentUnits({ articleId: 'speckled-band', chapterId: 'speckled-band-1' });
  assert.ok(units.length > 0);
  const first = units[0];
  assert.match(first.id, /^cu_[a-f0-9]{24}$/);
  assert.equal(getContentUnit(first.id), first);
  assert.equal(
    getContentUnitByPosition({
      articleId: first.articleId,
      chapterId: first.chapterId,
      paragraphIndex: first.paragraphIndex
    }),
    first
  );
  assert.equal(first.range.startOffset, 0);
  assert.equal(first.range.endOffset, first.sourceText.length);
  assert.equal(first.sourceHash.length, 64);
});


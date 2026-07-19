import test from 'node:test';
import assert from 'node:assert/strict';
import { getContentUnitByPosition, listContentUnits } from '../src/content-units.js';
import {
  getPreparedDubbingPlan,
  splitDialogueAndNarration
} from '../src/prepared-dubbing-plans.js';

test('splits malformed legacy quotation marks into dialogue without narrator glue', () => {
  const source = '“早上好，小姐，“福尔摩斯说道，“我的名字是歇洛克·福尔摩斯。”';
  assert.deepEqual(splitDialogueAndNarration(source), {
    dialogue: ['早上好，小姐，', '我的名字是歇洛克·福尔摩斯。'],
    narration: ['福尔摩斯说道，']
  });
});

test('versioned manifest covers every dialogue content unit with source-bound segments', () => {
  const dialogueUnits = listContentUnits({ articleId: 'speckled-band' }).filter((unit) => unit.hasDialogue);
  assert.equal(dialogueUnits.length, 212);

  for (const unit of dialogueUnits) {
    const prepared = getPreparedDubbingPlan(unit);
    assert.equal(prepared.source, 'prepared-manifest', `${unit.chapterId}:${unit.paragraphIndex}`);
    assert.ok(prepared.contentVersion);
    assert.ok(prepared.segments.length > 0);
    for (const segment of prepared.segments) {
      assert.ok(unit.sourceText.includes(segment.text));
      assert.ok(Boolean(segment.speakerCode) !== Boolean(segment.templateCode));
    }
  }
});

test('reviewed first-chapter plan keeps speakers and removes attribution narration', () => {
  const unit = getContentUnitByPosition({
    articleId: 'speckled-band',
    chapterId: 'speckled-band-1',
    paragraphIndex: 9
  });
  const prepared = getPreparedDubbingPlan(unit);

  assert.equal(prepared.segments.length, 2);
  assert.ok(prepared.segments.every((segment) => segment.speakerCode === 'char_holmes'));
  assert.ok(prepared.segments.every((segment) => !segment.text.includes('福尔摩斯愉快地说道')));
});

test('source hash mismatch never serves a stale manifest entry', () => {
  const unit = getContentUnitByPosition({
    articleId: 'speckled-band',
    chapterId: 'speckled-band-1',
    paragraphIndex: 7
  });
  const prepared = getPreparedDubbingPlan({ ...unit, sourceHash: 'changed-source-hash' });
  assert.equal(prepared.source, 'deterministic-fallback');
  assert.ok(prepared.segments.length > 0);
});

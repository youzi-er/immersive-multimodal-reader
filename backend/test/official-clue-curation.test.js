import test from 'node:test';
import assert from 'node:assert/strict';

import { applyClueManifest, chapters, clues } from '../src/data.js';
import {
  buildPublishedClueManifest,
  clueDraftSummary,
  createSuggestedClueDraft,
  getOfficialClueSourceManifest,
  upgradeClueDraftToCurrentRecommendations,
  validateClueDraft
} from '../src/official-clue-curation.js';

test('suggested official clue draft merges duplicates into a publishable catalog', () => {
  const draft = createSuggestedClueDraft();
  const summary = clueDraftSummary(draft);
  assert.deepEqual(summary.decisions, { keep: 30, merge: 33, archive: 14 });
  assert.deepEqual(summary.retainedTypes, { 人物: 4, 地点: 7, 物证: 19 });
  assert.equal(summary.publishable, true);

  const published = buildPublishedClueManifest(draft);
  assert.equal(published.clues.length, 30);
  const bellRope = published.clues.find((clue) => clue.id === 'clue-evidence-bell-rope');
  const whip = published.clues.find((clue) => clue.id === 'clue-evidence-dog-whip-on-bedhead');
  assert.equal(bellRope.occurrences.length, 5);
  assert.equal(whip.occurrences.length, 5);

  const occurrenceIds = published.clues.flatMap((clue) => clue.occurrences.map((occurrence) => occurrence.id));
  assert.equal(new Set(occurrenceIds).size, occurrenceIds.length);
});

test('curation rejects invalid merge targets and out-of-range publication counts', () => {
  const invalidMerge = createSuggestedClueDraft();
  const mergedEntry = invalidMerge.entries.find((entry) => entry.decision === 'merge');
  mergedEntry.mergeTargetId = 'clue-does-not-exist';
  assert.throws(() => validateClueDraft(invalidMerge), /Merge target/);

  const tooSmall = createSuggestedClueDraft();
  let kept = 0;
  for (const entry of tooSmall.entries) {
    if (entry.decision === 'keep') {
      kept += 1;
      if (kept > 19) entry.decision = 'archive';
    } else if (entry.decision === 'merge') {
      entry.decision = 'archive';
      entry.mergeTargetId = null;
    }
  }
  assert.throws(() => buildPublishedClueManifest(tooSmall), /must retain 20-30 clues/);
});

test('draft recommendation upgrade adds only newly approved groups and preserves earlier edits', () => {
  const oldDraft = createSuggestedClueDraft();
  oldDraft.recommendationRevision = 1;
  const holmes = oldDraft.entries.find(
    (entry) => entry.sourceClueId === 'clue-person-holmes-fully-dressed-at-bedside'
  );
  holmes.decision = 'archive';
  holmes.mergeTargetId = null;
  const helen = oldDraft.entries.find((entry) => entry.sourceClueId === 'clue-person-helen-stoner');
  helen.label = '海伦·斯托纳（已人工修订）';

  const upgraded = upgradeClueDraftToCurrentRecommendations(oldDraft);
  assert.equal(upgraded.recommendationRevision, 2);
  assert.equal(
    upgraded.entries.find((entry) => entry.sourceClueId === holmes.sourceClueId).decision,
    'keep'
  );
  assert.equal(
    upgraded.entries.find((entry) => entry.sourceClueId === helen.sourceClueId).label,
    '海伦·斯托纳（已人工修订）'
  );
});

test('a published curation manifest immediately updates reader clue markers', () => {
  const source = getOfficialClueSourceManifest();
  try {
    const published = buildPublishedClueManifest(createSuggestedClueDraft());
    applyClueManifest(published);
    assert.equal(clues.length, 30);
    const knownIds = new Set(clues.map((clue) => clue.id));
    const markedSegments = chapters.flatMap((chapter) => chapter.paragraphs.flat()).filter(
      (segment) => segment.type === 'clue'
    );
    assert.ok(markedSegments.length > 0);
    assert.equal(markedSegments.every((segment) => knownIds.has(segment.clueId)), true);
  } finally {
    applyClueManifest(source);
  }
});

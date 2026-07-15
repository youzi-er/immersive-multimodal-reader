import assert from 'node:assert/strict';
import test from 'node:test';
import { selectLatestClueAssets } from '../src/services/clueMedia.js';

function asset(id, userId, createdAt, overrides = {}) {
  return {
    id,
    userId,
    createdAt,
    mediaType: 'image',
    metadata: {
      generationType: 'clue-image',
      plannerVersion: 'v1',
      fingerprint: 'fingerprint-1',
      clueId: 'clue-1',
      occurrenceId: 'occ-1',
      ...overrides
    }
  };
}

test('returns the newest version regardless of owner, fingerprint, or planner version', () => {
  const assets = [
    asset('old-shared', 'shared', '2026-01-01T00:00:00Z'),
    asset('old-personal', 'demo-user', '2026-01-02T00:00:00Z'),
    asset('newest', 'other-user', '2026-01-03T00:00:00Z', {
      plannerVersion: 'v2',
      fingerprint: 'fingerprint-after-upgrade'
    })
  ];

  const resolved = selectLatestClueAssets(assets, { clueId: 'clue-1' });

  assert.deepEqual(resolved.map((item) => item.id), ['newest']);
  assert.equal(assets.length, 3);
});

test('keeps one current image per clue across different occurrence positions', () => {
  const assets = [
    asset('first-occurrence', 'shared', '2026-01-01T00:00:00Z'),
    asset('regenerated-later', 'shared', '2026-01-02T00:00:00Z', {
      occurrenceId: 'occ-2'
    }),
    asset('other-clue', 'shared', '2026-01-03T00:00:00Z', {
      clueId: 'clue-2',
      occurrenceId: 'occ-3'
    })
  ];

  const resolved = selectLatestClueAssets(assets, { clueIds: new Set(['clue-1', 'clue-2']) });

  assert.deepEqual(resolved.map((item) => item.id), ['other-clue', 'regenerated-later']);
});

test('ignores paragraph images and clue assets outside the requested set', () => {
  const paragraphImage = asset('paragraph', 'shared', '2026-01-04T00:00:00Z');
  paragraphImage.metadata.generationType = 'paragraph-image';
  const assets = [
    paragraphImage,
    asset('clue-1', 'shared', '2026-01-03T00:00:00Z'),
    asset('clue-2', 'shared', '2026-01-02T00:00:00Z', { clueId: 'clue-2' })
  ];

  const resolved = selectLatestClueAssets(assets, { clueIds: ['clue-2'] });

  assert.deepEqual(resolved.map((item) => item.id), ['clue-2']);
});

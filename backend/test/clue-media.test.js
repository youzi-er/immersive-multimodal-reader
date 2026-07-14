import assert from 'node:assert/strict';
import test from 'node:test';
import { selectResolvedClueAssets } from '../src/services/clueMedia.js';

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

test('personal clue image overrides the shared default without exposing another user', () => {
  const assets = [
    asset('other', 'other-user', '2026-01-03'),
    asset('personal', 'demo-user', '2026-01-02'),
    asset('shared', 'shared', '2026-01-01')
  ];
  const resolved = selectResolvedClueAssets(assets, 'demo-user', {
    plannerVersion: 'v1',
    fingerprint: 'fingerprint-1'
  });
  assert.deepEqual(resolved.map((item) => item.id), ['personal']);
});

test('falls back to shared and rejects stale planner versions', () => {
  const assets = [
    asset('stale', 'shared', '2026-01-02', { plannerVersion: 'old' }),
    asset('shared', 'shared', '2026-01-01')
  ];
  const resolved = selectResolvedClueAssets(assets, 'demo-user', {
    plannerVersion: 'v1',
    fingerprint: 'fingerprint-1'
  });
  assert.deepEqual(resolved.map((item) => item.id), ['shared']);
});

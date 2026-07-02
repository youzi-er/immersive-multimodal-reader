import test from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3001';

test('GET /api/clues returns a non-empty clue list', async () => {
  const response = await fetch(`${BASE_URL}/api/clues`);
  const clues = await response.json();

  assert.equal(response.status, 200);
  assert.equal(Array.isArray(clues), true);
  assert.ok(clues.length > 0);

  const firstClue = clues[0];
  assert.ok(firstClue.id);
  assert.ok(firstClue.label);
  assert.ok(firstClue.type);
  assert.equal(Array.isArray(firstClue.keywords), true);
  assert.ok(firstClue.description);
});

import test from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3001';

test('GET /api/health returns backend service status', async () => {
  const response = await fetch(`${BASE_URL}/api/health`);
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.service, 'immersive-reader-backend');
});

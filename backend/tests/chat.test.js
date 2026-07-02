import test from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3001';

async function postChat(body) {
  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  return { response, data };
}

test('POST /api/chat returns an answer for a valid question', async () => {
  const chaptersResponse = await fetch(`${BASE_URL}/api/chapters`);
  const chapters = await chaptersResponse.json();
  const chapterId = chapters[0].id;

  const { response, data } = await postChat({
    question: 'What should I pay attention to?',
    chapterId
  });

  assert.equal(response.status, 200);
  assert.ok(data.answer);
  assert.equal(typeof data.answer, 'string');
});

test('POST /api/chat rejects missing question', async () => {
  const { response, data } = await postChat({
    chapterId: 'speckled-band-1'
  });

  assert.equal(response.status, 400);
  assert.equal(data.error, 'Question is required');
});

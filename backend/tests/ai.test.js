import test from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3001';
const RUN_AI_TESTS = process.env.RUN_AI_TESTS === 'true';

async function request(path, body) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  return { response, data };
}

test('POST /api/ai/chat rejects missing question', async () => {
  const { response, data } = await request('/api/ai/chat', {
    chapterId: 'speckled-band-1',
    collectedClueIds: []
  });

  assert.equal(response.status, 400);
  assert.equal(data.error, 'Question is required');
});

test('POST /api/ai/tts rejects missing text', async () => {
  const { response, data } = await request('/api/ai/tts', {
    speaker: 'Holmes'
  });

  assert.equal(response.status, 400);
  assert.equal(data.error, 'Text is required');
});

test('POST /api/ai/voice-design rejects missing prompt or previewText', async () => {
  const { response, data } = await request('/api/ai/voice-design', {
    prompt: 'A calm detective voice'
  });

  assert.equal(response.status, 400);
  assert.equal(data.error, 'Prompt and previewText are required');
});

test('POST /api/ai/image-prompt returns a scene prompt', async () => {
  const { response, data } = await request('/api/ai/image-prompt', {
    chapterId: 'speckled-band-1'
  });

  assert.equal(response.status, 200);
  assert.ok(data.prompt);
  assert.equal(typeof data.prompt, 'string');
});

test('POST /api/ai/chat returns real AI answer when RUN_AI_TESTS=true', { skip: !RUN_AI_TESTS }, async () => {
  const { response, data } = await request('/api/ai/chat', {
    question: '目前有哪些线索？',
    chapterId: 'speckled-band-1',
    collectedClueIds: []
  });

  assert.equal(response.status, 200);
  assert.ok(data.answer);
  assert.equal(typeof data.answer, 'string');
  assert.equal(data.answer.includes('后续这里可以接入真实大模型'), false);
});

test('POST /api/ai/tts returns audioUrl when RUN_AI_TESTS=true', { skip: !RUN_AI_TESTS }, async () => {
  const { response, data } = await request('/api/ai/tts', {
    text: '这是一次语音接口测试。',
    speaker: 'Holmes',
    speed: 1,
    pitch: 0
  });

  assert.equal(response.status, 200);
  assert.ok(data.audioUrl);
  assert.equal(typeof data.audioUrl, 'string');
});

test('POST /api/ai/image returns imageUrl when RUN_AI_TESTS=true', { skip: !RUN_AI_TESTS }, async () => {
  const { response, data } = await request('/api/ai/image', {
    chapterId: 'speckled-band-1'
  });

  assert.equal(response.status, 200);
  assert.ok(data.imageUrl);
  assert.equal(typeof data.imageUrl, 'string');
  assert.ok(data.prompt);
});

test('POST /api/ai/voice-design returns voice result when RUN_AI_TESTS=true', { skip: !RUN_AI_TESTS }, async () => {
  const { response, data } = await request('/api/ai/voice-design', {
    prompt: 'A calm and rational detective voice',
    previewText: 'The evidence must be observed carefully.'
  });

  assert.equal(response.status, 200);
  assert.ok(data.voiceId || data.trialAudioUrl);
});

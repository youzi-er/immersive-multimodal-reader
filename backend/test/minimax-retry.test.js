import assert from 'node:assert/strict';
import test from 'node:test';
import { callMessagesApi, isRetryableMiniMaxError } from '../src/services/minimax.js';

test('classifies overload and transient MiniMax responses as retryable', () => {
  assert.equal(isRetryableMiniMaxError(undefined, 529), true);
  assert.equal(isRetryableMiniMaxError(undefined, 503), true);
  assert.equal(isRetryableMiniMaxError(1002, 200), true);
  assert.equal(isRetryableMiniMaxError(1008, 400), false);
});

test('retries a 529 text-planning response and returns the recovered result', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.MINIMAX_API_KEY;
  let attempts = 0;

  process.env.MINIMAX_API_KEY = 'test-key';
  globalThis.fetch = async () => {
    attempts += 1;
    if (attempts === 1) {
      return new Response(
        JSON.stringify({ error: { type: 'overloaded_error', message: 'server overloaded' } }),
        { status: 529, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({ content: [{ type: 'text', text: 'recovered' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const result = await callMessagesApi({ system: 'system', user: 'user' });
    assert.equal(result, 'recovered');
    assert.equal(attempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.MINIMAX_API_KEY;
    } else {
      process.env.MINIMAX_API_KEY = originalApiKey;
    }
  }
});

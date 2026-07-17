import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { getMediaRoot, saveAndRegisterMedia } from '../src/media-store.js';

test('resolves MEDIA_STORAGE_ROOT when it is read at runtime', () => {
  const original = process.env.MEDIA_STORAGE_ROOT;
  try {
    process.env.MEDIA_STORAGE_ROOT = path.join('runtime', 'persistent-media');
    assert.equal(getMediaRoot(), path.resolve('runtime', 'persistent-media'));

    process.env.MEDIA_STORAGE_ROOT = path.join('runtime', 'different-media');
    assert.equal(getMediaRoot(), path.resolve('runtime', 'different-media'));
  } finally {
    if (original === undefined) {
      delete process.env.MEDIA_STORAGE_ROOT;
    } else {
      process.env.MEDIA_STORAGE_ROOT = original;
    }
  }
});

test('rolls back a saved file when media registration fails', async () => {
  const saved = { url: '/media/audio/test.mp3', filePath: '/tmp/test.mp3' };
  const cleanupCalls = [];
  const registrationError = new Error('database unavailable');

  await assert.rejects(
    saveAndRegisterMedia({
      save: async () => saved,
      register: async () => {
        throw registrationError;
      },
      cleanup: async (filePath) => cleanupCalls.push(filePath)
    }),
    registrationError
  );
  assert.deepEqual(cleanupCalls, [saved.filePath]);
});

test('does not register or clean up when saving the media file fails', async () => {
  let registerCalled = false;
  let cleanupCalled = false;
  const saveError = new Error('storage unavailable');

  await assert.rejects(
    saveAndRegisterMedia({
      save: async () => {
        throw saveError;
      },
      register: async () => {
        registerCalled = true;
      },
      cleanup: async () => {
        cleanupCalled = true;
      }
    }),
    saveError
  );
  assert.equal(registerCalled, false);
  assert.equal(cleanupCalled, false);
});

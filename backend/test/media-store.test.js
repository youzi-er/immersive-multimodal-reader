import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { getMediaRoot } from '../src/media-store.js';

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

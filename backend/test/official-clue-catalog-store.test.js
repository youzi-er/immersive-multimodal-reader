import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getPool } from '../src/db.js';
import { createOfficialClueCatalogStore } from '../src/official-clue-catalog-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

test('official clue catalog store keeps drafts and immutable published revisions', async (t) => {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
  const articleId = `clue-curation-${suffix}`;
  const store = createOfficialClueCatalogStore();
  const draft = { version: 1, articleId, entries: [{ id: 'candidate-1', decision: 'keep' }] };
  const published = { version: 1, articleId, clues: [{ id: 'clue-1' }] };

  try {
    const initial = await store.ensureDraft({
      articleId,
      sourceSha256: 'a'.repeat(64),
      draft,
      userId: 'demo-user'
    });
    assert.equal(initial.draftRevision, 1);
    assert.deepEqual(initial.draft, draft);

    const saved = await store.saveDraft({
      articleId,
      sourceSha256: 'a'.repeat(64),
      draft: { ...draft, note: 'reviewed' },
      userId: 'demo-user'
    });
    assert.equal(saved.draftRevision, 2);

    const firstPublish = await store.publish({
      articleId,
      sourceSha256: 'a'.repeat(64),
      draft: saved.draft,
      published,
      userId: 'demo-user'
    });
    const secondPublish = await store.publish({
      articleId,
      sourceSha256: 'a'.repeat(64),
      draft: saved.draft,
      published: { ...published, note: 'second revision' },
      userId: 'demo-user'
    });
    assert.equal(firstPublish.publishedRevision, 1);
    assert.equal(secondPublish.publishedRevision, 2);

    const [versions] = await getPool().execute(
      'SELECT revision FROM official_clue_catalog_versions WHERE article_id = :articleId ORDER BY revision',
      { articleId }
    );
    assert.deepEqual(versions.map((row) => Number(row.revision)), [1, 2]);
  } catch (error) {
    if (/ECONNREFUSED|not configured/.test(error.message || '')) {
      t.skip(`MySQL integration is unavailable: ${error.message}`);
      return;
    }
    throw error;
  } finally {
    await getPool().execute(
      'DELETE FROM official_clue_catalog_versions WHERE article_id = :articleId',
      { articleId }
    ).catch(() => {});
    await getPool().execute(
      'DELETE FROM official_clue_catalogs WHERE article_id = :articleId',
      { articleId }
    ).catch(() => {});
    await getPool().end().catch(() => {});
  }
});

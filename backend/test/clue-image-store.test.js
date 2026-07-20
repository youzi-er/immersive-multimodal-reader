import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClueImageStore } from '../src/clue-image-store.js';
import { ensureCommunitySchema } from '../src/community-schema.js';
import { createUser, getPool } from '../src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

test('clue image store supports two-candidate history, community and adopted withdrawals', async (t) => {
  try {
    await ensureCommunitySchema();
  } catch (error) {
    t.skip(`MySQL integration is unavailable: ${error.message}`);
    await getPool().end().catch(() => {});
    return;
  }

  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
  const authorId = `clue-author-${suffix}`;
  const readerId = `clue-reader-${suffix}`;
  const articleId = `clue-book-${suffix}`;
  const clueId = `clue-evidence-${suffix}`;
  const store = createClueImageStore();

  await createUser({
    id: authorId,
    username: `clue_author_${suffix}`,
    passwordHash: 'hash',
    passwordSalt: 'salt',
    displayName: 'Clue Author'
  });
  await createUser({
    id: readerId,
    username: `clue_reader_${suffix}`,
    passwordHash: 'hash',
    passwordSalt: 'salt',
    displayName: 'Clue Reader'
  });

  const base = {
    ownerUserId: authorId,
    articleId,
    clueId,
    occurrenceId: `occurrence-${suffix}`,
    chapterId: 'chapter-1',
    paragraphIndex: 4,
    clueLabel: 'Bent poker',
    clueType: '物证',
    imageUrl: '/media/images/clue.jpg',
    mediaAssetId: null,
    finalPrompt: 'A bent steel poker on a Victorian desk under cold top light.',
    aspectRatio: '4:3',
    model: 'test-image-model',
    sourceText: 'He bent the steel poker with his bare hands.'
  };

  try {
    const versions = [];
    for (let index = 0; index < 4; index += 1) {
      versions.push(await store.createVersion({ ...base, finalPrompt: `${base.finalPrompt} Version ${index + 1}.` }));
    }
    assert.deepEqual(versions.map((version) => version.versionNumber), [1, 2, 3, 4]);
    assert.equal((await store.listMyVersions({ ownerUserId: authorId, clueId })).length, 4);

    for (const version of versions.slice(0, 3)) {
      await store.setVersionStatus(version.id, authorId, 'public');
    }
    await assert.rejects(
      store.setVersionStatus(versions[3].id, authorId, 'public'),
      (error) => error.code === 'PUBLIC_CLUE_VERSION_LIMIT' && error.publicVersionIds.length === 3
    );

    await store.adoptVersion({ versionId: versions[0].id, userId: readerId, clueId });
    const replacement = await store.setVersionStatus(versions[3].id, authorId, 'public', versions[0].id);
    assert.equal(replacement.status, 'public');
    assert.equal((await store.getVersion(versions[0].id, readerId)).status, 'withdrawn');
    assert.equal((await store.listCommunityVersions({ articleId, clueId })).length, 3);
    assert.equal((await store.listAdoptedVersions({ userId: readerId, articleId }))[0].id, versions[0].id);
    await assert.rejects(
      store.setVersionStatus(versions[0].id, authorId, 'deleted'),
      (error) => error.code === 'CLUE_IMAGE_HAS_ADOPTERS'
    );

    const liked = await store.setLike(versions[1].id, readerId, true);
    assert.equal(liked.likeCount, 1);
    await assert.rejects(store.setLike(versions[1].id, authorId, true), /Creators cannot like their own clue image/);

    const report = await store.createReport({
      versionId: versions[1].id,
      reporterUserId: readerId,
      reason: 'Testing the clue moderation path.'
    });
    assert.equal(report.status, 'open');
    assert.equal(await store.clearAdoption({ userId: readerId, clueId }), true);
  } finally {
    await getPool().execute(
      'DELETE FROM clue_image_adoptions WHERE user_id IN (:authorId, :readerId)',
      { authorId, readerId }
    );
    await getPool().execute('DELETE FROM clue_image_projects WHERE owner_user_id = :authorId', { authorId });
    await getPool().execute('DELETE FROM users WHERE id IN (:authorId, :readerId)', { authorId, readerId });
    await getPool().end();
  }
});

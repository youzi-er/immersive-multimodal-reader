import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCoverStore } from '../src/cover-store.js';
import { ensureCommunitySchema } from '../src/community-schema.js';
import { createUser, getPool } from '../src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

test('cover store supports history, activation and community interactions', async (t) => {
  try {
    await ensureCommunitySchema();
  } catch (error) {
    t.skip(`MySQL integration is unavailable: ${error.message}`);
    await getPool().end().catch(() => {});
    return;
  }

  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
  const authorId = `cover-author-${suffix}`;
  const readerId = `cover-reader-${suffix}`;
  const articleId = `cover-book-${suffix}`;
  const store = createCoverStore();

  await createUser({
    id: authorId,
    username: `cover_author_${suffix}`,
    passwordHash: 'hash',
    passwordSalt: 'salt',
    displayName: 'Cover Author'
  });
  await createUser({
    id: readerId,
    username: `cover_reader_${suffix}`,
    passwordHash: 'hash',
    passwordSalt: 'salt',
    displayName: 'Cover Reader'
  });

  const base = {
    ownerUserId: authorId,
    articleId,
    status: 'private',
    imageUrl: '/media/images/cover.jpg',
    mediaAssetId: null,
    mode: 'guided',
    prompt: 'A mysterious Victorian manor',
    finalPrompt: 'A mysterious Victorian manor, cinematic poster, no text',
    mood: 'suspense',
    palette: 'green and gold',
    composition: 'central silhouette',
    parameters: {
      cast: '三人群像',
      storyBeat: '危险前一秒',
      shotSize: '中景群像'
    },
    bookTitle: 'Test Mystery',
    bookAuthor: 'Test Author',
    bookSubtitle: 'A Case'
  };

  try {
    const first = await store.createVersion(base);
    const second = await store.createVersion(base);
    assert.equal(first.versionNumber, 1);
    assert.equal(first.parameters.storyBeat, '危险前一秒');
    assert.equal(second.versionNumber, 2);
    assert.equal((await store.listHistory({ ownerUserId: authorId, articleId })).length, 2);

    const active = await store.setCurrentCover({ userId: authorId, articleId, versionId: first.id });
    assert.equal(active.id, first.id);
    assert.equal((await store.getCurrentCover({ userId: authorId, articleId })).activeByMe, true);
    await store.clearCurrentCover({ userId: authorId, articleId });
    assert.equal(await store.getCurrentCover({ userId: authorId, articleId }), null);

    const published = await store.setVersionStatus(first.id, authorId, 'public');
    assert.equal(published.status, 'public');
    const duplicateLikes = await Promise.all([
      store.setLike(first.id, readerId, true),
      store.setLike(first.id, readerId, true)
    ]);
    assert.equal(duplicateLikes[0].likeCount, 1);
    assert.equal(duplicateLikes[1].likeCount, 1);
    await assert.rejects(store.setLike(first.id, authorId, true), /Creators cannot like their own cover/);
    const collected = await store.setCollection(first.id, readerId, true);
    assert.equal(collected.collectionCount, 1);
    assert.equal(collected.collectedByMe, true);

    await store.createVersion({ ...base, remixedFromVersionId: first.id });
    const community = await store.listCommunityVersions({ articleId, currentUserId: readerId });
    assert.equal(community.length, 1);
    assert.equal(community[0].remixCount, 1);
    assert.equal(community[0].likedByMe, true);
    assert.equal(community[0].collectedByMe, true);

    const report = await store.createReport({
      versionId: first.id,
      reporterUserId: readerId,
      reason: 'Testing moderation flow'
    });
    assert.equal(report.status, 'open');
  } finally {
    await getPool().execute(
      'DELETE FROM active_book_covers WHERE user_id IN (:authorId, :readerId)',
      { authorId, readerId }
    );
    await getPool().execute(
      'DELETE FROM cover_projects WHERE owner_user_id IN (:authorId, :readerId)',
      { authorId, readerId }
    );
    await getPool().execute('DELETE FROM users WHERE id IN (:authorId, :readerId)', { authorId, readerId });
    await getPool().end();
  }
});

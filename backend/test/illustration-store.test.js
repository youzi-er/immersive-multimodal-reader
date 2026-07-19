import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIllustrationStore } from '../src/illustration-store.js';
import { ensureCommunitySchema } from '../src/community-schema.js';
import { createUser, getPool } from '../src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

test('illustration store preserves versions, public limits and adopted withdrawals', async (t) => {
  try {
    await ensureCommunitySchema();
  } catch (error) {
    t.skip(`MySQL integration is unavailable: ${error.message}`);
    await getPool().end().catch(() => {});
    return;
  }

  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
  const authorId = `illustration-author-${suffix}`;
  const readerId = `illustration-reader-${suffix}`;
  const articleId = `illustration-book-${suffix}`;
  const unitId = `illustration-unit-${suffix}`;
  const store = createIllustrationStore();

  await createUser({
    id: authorId,
    username: `illustration_author_${suffix}`,
    passwordHash: 'hash',
    passwordSalt: 'salt',
    displayName: 'Illustration Author'
  });
  await createUser({
    id: readerId,
    username: `illustration_reader_${suffix}`,
    passwordHash: 'hash',
    passwordSalt: 'salt',
    displayName: 'Illustration Reader'
  });

  try {
    const style = await store.ensureOfficialStyle({
      articleId,
      name: 'Official V1',
      globalStylePrompt: 'A coherent Victorian storybook illustration style',
      globalNegativePrompt: 'text, watermark',
      styleProfile: { medium: 'oil painting' },
      usageNotes: 'Keep recurring characters consistent.'
    });
    assert.equal(style.versionNumber, 1);
    assert.equal((await store.ensureOfficialStyle({ articleId, name: 'Ignored', globalStylePrompt: 'Ignored' })).id, style.id);

    const base = {
      ownerUserId: authorId,
      unitId,
      articleId,
      chapterId: 'chapter-1',
      paragraphIndex: 2,
      imageUrl: '/media/images/illustration.jpg',
      mediaAssetId: null,
      promptMode: 'official',
      finalPrompt: 'A detective examines a clue beside a rain-streaked window.',
      styleVersionId: style.id,
      model: 'test-image-model',
      sourceText: 'The detective examined the clue.',
      sourceHash: crypto.createHash('sha256').update('The detective examined the clue.').digest('hex')
    };

    const versions = [];
    for (let index = 0; index < 4; index += 1) {
      versions.push(await store.createVersion({ ...base, finalPrompt: `${base.finalPrompt} Version ${index + 1}.` }));
    }
    assert.deepEqual(versions.map((version) => version.versionNumber), [1, 2, 3, 4]);
    assert.equal(versions[0].aspectRatio, '16:9');
    assert.equal(versions[0].status, 'private');

    for (const version of versions.slice(0, 3)) {
      await store.setVersionStatus(version.id, authorId, 'public');
    }
    await assert.rejects(
      store.setVersionStatus(versions[3].id, authorId, 'public'),
      (error) => error.code === 'PUBLIC_VERSION_LIMIT' && error.publicVersionIds.length === 3
    );

    await store.adoptVersion({ versionId: versions[0].id, userId: readerId, unitId });
    const replacement = await store.setVersionStatus(
      versions[3].id,
      authorId,
      'public',
      versions[0].id
    );
    assert.equal(replacement.status, 'public');
    assert.equal((await store.getVersion(versions[0].id, readerId)).status, 'withdrawn');
    assert.equal((await store.listCommunityVersions({ articleId, unitId })).length, 3);
    assert.equal((await store.listAdoptedVersions({ userId: readerId, articleId }))[0].id, versions[0].id);

    const liked = await store.setLike(versions[1].id, readerId, true);
    assert.equal(liked.likeCount, 1);
    await assert.rejects(
      store.setLike(versions[1].id, authorId, true),
      /Creators cannot like their own illustration/
    );

    const comment = await store.createComment({
      versionId: versions[1].id,
      userId: readerId,
      content: 'The composition fits this paragraph well.'
    });
    assert.equal((await store.listComments(versions[1].id)).length, 1);
    assert.equal(await store.deleteComment({ commentId: comment.id, userId: authorId }), false);
    assert.equal(await store.deleteComment({ commentId: comment.id, userId: readerId }), true);

    const report = await store.createReport({
      versionId: versions[1].id,
      reporterUserId: readerId,
      reason: 'Testing the moderation path.'
    });
    assert.equal(report.status, 'open');
  } finally {
    await getPool().execute(
      'DELETE FROM illustration_adoptions WHERE user_id IN (:authorId, :readerId)',
      { authorId, readerId }
    );
    await getPool().execute(
      'DELETE FROM illustration_projects WHERE owner_user_id = :authorId',
      { authorId }
    );
    await getPool().execute(
      'DELETE FROM active_illustration_styles WHERE article_id = :articleId',
      { articleId }
    );
    await getPool().execute(
      'DELETE FROM illustration_style_versions WHERE article_id = :articleId',
      { articleId }
    );
    await getPool().execute(
      'DELETE FROM users WHERE id IN (:authorId, :readerId)',
      { authorId, readerId }
    );
    await getPool().end();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createCommunityStore } from '../src/community-store.js';
import { createUser, ensureSchema, getPool } from '../src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

async function ensureCommunitySchema() {
  await ensureSchema();
  const migration = await fs.readFile(path.resolve(__dirname, '../sql/002_community_dubbing.sql'), 'utf8');
  const statements = migration
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) await getPool().query(statement);
}

test('MySQL community store preserves immutable versions and adoption access', async (t) => {
  try {
    await ensureCommunitySchema();
  } catch (error) {
    t.skip(`MySQL integration is unavailable: ${error.message}`);
    await getPool().end().catch(() => {});
    return;
  }

  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
  const authorId = `test-author-${suffix}`;
  const readerId = `test-reader-${suffix}`;
  const articleId = `test-book-${suffix}`;
  const unitId = `test-unit-${suffix}`;
  const store = createCommunityStore();

  await createUser({
    id: authorId,
    username: `author_${suffix}`,
    passwordHash: 'hash',
    passwordSalt: 'salt',
    displayName: 'Author'
  });
  await createUser({
    id: readerId,
    username: `reader_${suffix}`,
    passwordHash: 'hash',
    passwordSalt: 'salt',
    displayName: 'Reader'
  });

  try {
    const baseVersion = {
      ownerUserId: authorId,
      unitId,
      articleId,
      chapterId: 'chapter',
      paragraphIndex: 2,
      kind: 'ai',
      status: 'public',
      audioUrl: '/media/audio/test.mp3',
      sourceText: 'Test dialogue.',
      sourceHash: 'hash',
      durationMs: 1200,
      promptSnapshot: { voicePrompt: 'calm' },
      segments: [{ text: 'Test dialogue.' }]
    };

    await t.test('published rows receive monotonically increasing immutable versions', async () => {
      const first = await store.createDubbingVersion(baseVersion);
      const second = await store.createDubbingVersion(baseVersion);
      assert.equal(first.versionNumber, 1);
      assert.equal(second.versionNumber, 2);
      assert.notEqual(first.id, second.id);
      assert.equal((await store.listVersionsForUnit(unitId, '')).length, 2);
    });

    await t.test('likes, adoptions and withdrawal preserve the adopting reader access', async () => {
      const version = await store.createDubbingVersion(baseVersion);
      const liked = await store.setLike(version.id, readerId, true);
      assert.equal(liked.likeCount, 1);
      const adopted = await store.adoptVersion(version.id, readerId);
      assert.equal(adopted.adoptedByMe, true);
      assert.equal(adopted.adoptionCount, 1);

      await store.setVersionStatus(version.id, authorId, 'withdrawn');
      const anonymousVersions = await store.listVersionsForUnit(unitId, '');
      assert.equal(anonymousVersions.some((item) => item.id === version.id), false);
      const readerVersions = await store.listVersionsForUnit(unitId, readerId);
      assert.equal(readerVersions.find((item) => item.id === version.id)?.status, 'withdrawn');
      const adoptedVersions = await store.listAdoptedVersions({ userId: readerId, articleId });
      assert.equal(adoptedVersions.some((item) => item.id === version.id), true);
    });

    await t.test('voice designs create immutable per-character versions', async () => {
      const input = {
        ownerUserId: authorId,
        articleId,
        characterCode: 'char_holmes',
        characterName: 'Holmes',
        prompt: 'A calm and precise adult voice',
        previewText: 'The facts are in front of us.',
        voiceId: 'voice-1'
      };
      const first = await store.createVoiceDesignVersion(input);
      const second = await store.createVoiceDesignVersion({ ...input, voiceId: 'voice-2' });
      assert.equal(first.designId, second.designId);
      assert.equal(first.versionNumber, 1);
      assert.equal(second.versionNumber, 2);
    });

    await t.test('published dubbing can share a voice without exposing it through unrelated private work', async () => {
      const voice = await store.createVoiceDesignVersion({
        ownerUserId: authorId,
        articleId: 'global',
        characterCode: `voice_${suffix}`,
        characterName: 'Global detective voice',
        prompt: 'A restrained, thoughtful adult voice',
        previewText: 'Every detail deserves a second look.',
        voiceId: 'provider-private-voice-id'
      });
      const privateVersion = await store.createDubbingVersion({
        ...baseVersion,
        status: 'private',
        sharedVoiceDesignVersionIds: [voice.id]
      });
      assert.equal((await store.listSharedVoiceDesignVersions()).some((item) => item.id === voice.id), false);

      await store.setVersionStatus(privateVersion.id, authorId, 'public');
      const shared = await store.listSharedVoiceDesignVersions({ excludeOwnerUserId: readerId });
      assert.equal(shared.some((item) => item.id === voice.id), true);
      assert.equal((await store.getUsableVoiceDesignVersion(voice.id, readerId))?.id, voice.id);
      assert.equal((await store.listCommunityVersions({ currentUserId: readerId })).some((item) => item.id === privateVersion.id), true);
    });
  } finally {
    await getPool().execute('DELETE FROM dubbing_adoptions WHERE user_id = :readerId', { readerId });
    await getPool().execute('DELETE FROM users WHERE id IN (:authorId, :readerId)', { authorId, readerId });
    await getPool().end();
  }
});

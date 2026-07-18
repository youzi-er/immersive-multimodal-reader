import crypto from 'node:crypto';
import { getPool } from './db.js';
import { ensureCommunitySchema } from './community-schema.js';

const VERSION_STATUSES = new Set(['private', 'public', 'withdrawn', 'moderated', 'deleted']);
const DUBBING_KINDS = new Set(['ai', 'human']);

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function booleanValue(value) {
  return Number(value || 0) > 0;
}

function sanitizeRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object') return recipe;
  const voiceSource = recipe.voiceSource && typeof recipe.voiceSource === 'object'
    ? {
        ...recipe.voiceSource,
        voiceId: recipe.voiceSource.voiceId ? '[private]' : '',
        timbreWeights: Array.isArray(recipe.voiceSource.timbreWeights)
          ? recipe.voiceSource.timbreWeights.map((item) => ({ ...item, voiceId: '[private]' }))
          : []
      }
    : recipe.voiceSource;
  return { ...recipe, voiceSource };
}

function sanitizeSegment(segment) {
  return segment && typeof segment === 'object'
    ? { ...segment, recipe: sanitizeRecipe(segment.recipe) }
    : segment;
}

function sanitizePromptSnapshot(value) {
  const snapshot = parseJson(value, null);
  if (!snapshot || typeof snapshot !== 'object') return null;
  return {
    ...snapshot,
    performanceSegments: Array.isArray(snapshot.performanceSegments)
      ? snapshot.performanceSegments.map(sanitizeSegment)
      : [],
    ttsRequests: undefined
  };
}

function mapVoiceDesignVersion(row) {
  if (!row) return null;
  return {
    id: row.version_id,
    designId: row.design_id,
    articleId: row.article_id,
    characterCode: row.character_code,
    characterName: row.character_name,
    ownerUserId: row.owner_user_id,
    versionNumber: Number(row.version_number),
    prompt: row.prompt,
    previewText: row.preview_text,
    voiceId: row.voice_id,
    previewAudioUrl: row.preview_audio_url,
    previewMediaAssetId: row.preview_media_asset_id,
    ownerUsername: row.owner_username || '',
    ownerDisplayName: row.owner_display_name || '',
    shared: booleanValue(row.shared),
    createdAt: row.created_at
  };
}

function mapDubbingVersion(row) {
  if (!row) return null;
  return {
    id: row.version_id,
    projectId: row.project_id,
    versionNumber: Number(row.version_number),
    ownerUserId: row.owner_user_id,
    username: row.username || '',
    displayName: row.display_name || '',
    unitId: row.unit_id,
    articleId: row.article_id,
    chapterId: row.chapter_id,
    paragraphIndex: Number(row.paragraph_index),
    kind: row.kind,
    status: row.status,
    audioUrl: row.audio_url,
    mediaAssetId: row.media_asset_id,
    sourceText: row.source_text,
    sourceHash: row.source_hash,
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    promptSnapshot: sanitizePromptSnapshot(row.prompt_snapshot_json),
    segments: parseJson(row.segments_json, []).map(sanitizeSegment),
    likeCount: Number(row.like_count || 0),
    adoptionCount: Number(row.adoption_count || 0),
    likedByMe: booleanValue(row.liked_by_me),
    adoptedByMe: booleanValue(row.adopted_by_me),
    ownedByMe: booleanValue(row.owned_by_me),
    createdAt: row.created_at,
    withdrawnAt: row.withdrawn_at,
    moderatedAt: row.moderated_at
  };
}

function assertKind(kind) {
  if (!DUBBING_KINDS.has(kind)) throw new Error(`Unsupported dubbing kind: ${kind}`);
}

function assertInitialStatus(status) {
  if (status !== 'private' && status !== 'public') {
    throw new Error(`New dubbing versions must be private or public, received: ${status}`);
  }
}

const versionSelect = `
  dv.id AS version_id,
  dv.project_id,
  dv.version_number,
  dv.owner_user_id,
  dv.unit_id,
  dv.article_id,
  dv.chapter_id,
  dv.paragraph_index,
  dv.kind,
  dv.status,
  dv.audio_url,
  dv.media_asset_id,
  dv.source_text,
  dv.source_hash,
  dv.duration_ms,
  dv.prompt_snapshot_json,
  dv.segments_json,
  dv.created_at,
  dv.withdrawn_at,
  dv.moderated_at,
  u.username,
  u.display_name,
  COALESCE(likes.like_count, 0) AS like_count,
  COALESCE(adoptions.adoption_count, 0) AS adoption_count,
  CASE WHEN my_like.user_id IS NULL THEN 0 ELSE 1 END AS liked_by_me,
  CASE WHEN my_adoption.user_id IS NULL THEN 0 ELSE 1 END AS adopted_by_me,
  CASE WHEN dv.owner_user_id = :currentUserId THEN 1 ELSE 0 END AS owned_by_me
`;

const versionJoins = `
  JOIN users u ON u.id = dv.owner_user_id
  LEFT JOIN (
    SELECT version_id, COUNT(*) AS like_count FROM dubbing_likes GROUP BY version_id
  ) likes ON likes.version_id = dv.id
  LEFT JOIN (
    SELECT version_id, COUNT(*) AS adoption_count FROM dubbing_adoptions GROUP BY version_id
  ) adoptions ON adoptions.version_id = dv.id
  LEFT JOIN dubbing_likes my_like
    ON my_like.version_id = dv.id AND my_like.user_id = :currentUserId
  LEFT JOIN dubbing_adoptions my_adoption
    ON my_adoption.version_id = dv.id AND my_adoption.user_id = :currentUserId
`;

async function inTransaction(pool, work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export function createCommunityStore({ pool, ensureReady = ensureCommunitySchema } = {}) {
  let activePool = pool;
  let readyPromise;
  const database = () => {
    activePool ||= getPool();
    return activePool;
  };
  const ready = () => {
    readyPromise ||= Promise.resolve().then(() => ensureReady());
    return readyPromise;
  };

  async function getVersion(versionId, currentUserId = '') {
    await ready();
    const [rows] = await database().execute(
      `SELECT ${versionSelect}
       FROM dubbing_versions dv
       ${versionJoins}
       WHERE dv.id = :versionId
       LIMIT 1`,
      { versionId, currentUserId }
    );
    return mapDubbingVersion(rows[0]);
  }

  async function listVersionsForUnit(unitId, currentUserId = '') {
    await ready();
    const [rows] = await database().execute(
      `SELECT ${versionSelect}
       FROM dubbing_versions dv
       ${versionJoins}
       WHERE dv.unit_id = :unitId
         AND (
           dv.status = 'public'
           OR (dv.owner_user_id = :currentUserId AND dv.status IN ('private', 'withdrawn'))
           OR (my_adoption.user_id IS NOT NULL AND dv.status = 'withdrawn')
         )
       ORDER BY
         adopted_by_me DESC,
         owned_by_me DESC,
         like_count DESC,
         adoption_count DESC,
         dv.created_at DESC,
         dv.id DESC`,
      { unitId, currentUserId }
    );
    return rows.map(mapDubbingVersion);
  }

  async function listCommunityVersions({ currentUserId = '', kind, sort = 'popular', limit = 60, offset = 0 } = {}) {
    await ready();
    const conditions = ["dv.status = 'public'"];
    const safeLimit = Math.min(Math.max(Math.trunc(Number(limit) || 60), 1), 100);
    const safeOffset = Math.max(Math.trunc(Number(offset) || 0), 0);
    const params = { currentUserId };
    if (DUBBING_KINDS.has(kind)) {
      conditions.push('dv.kind = :kind');
      params.kind = kind;
    }
    const orderBy = sort === 'newest'
      ? 'dv.created_at DESC, dv.id DESC'
      : 'like_count DESC, adoption_count DESC, dv.created_at DESC, dv.id DESC';
    const [rows] = await database().execute(
      `SELECT ${versionSelect}
       FROM dubbing_versions dv
       ${versionJoins}
       WHERE ${conditions.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params
    );
    return rows.map(mapDubbingVersion);
  }

  async function listAdoptedVersions({ userId, articleId, chapterId } = {}) {
    if (!userId) return [];
    await ready();
    const conditions = ["da.user_id = :userId", "dv.status IN ('public', 'withdrawn')"];
    const params = { userId, currentUserId: userId };
    if (articleId) {
      conditions.push('dv.article_id = :articleId');
      params.articleId = articleId;
    }
    if (chapterId) {
      conditions.push('dv.chapter_id = :chapterId');
      params.chapterId = chapterId;
    }
    const [rows] = await database().execute(
      `SELECT ${versionSelect}
       FROM dubbing_adoptions da
       JOIN dubbing_versions dv ON dv.id = da.version_id
       ${versionJoins}
       WHERE ${conditions.join(' AND ')}
       ORDER BY dv.chapter_id ASC, dv.paragraph_index ASC`,
      params
    );
    return rows.map(mapDubbingVersion);
  }

  async function createVoiceDesignVersion(input) {
    const { ownerUserId, articleId, characterCode, characterName, prompt, previewText, voiceId } = input;
    if (!ownerUserId || !articleId || !characterCode || !characterName || !prompt || !previewText || !voiceId) {
      throw new Error('Voice design version is missing required fields');
    }
    await ready();
    const versionId = crypto.randomUUID();
    await inTransaction(database(), async (connection) => {
      const designId = crypto.randomUUID();
      await connection.execute(
        `INSERT INTO character_voice_designs (
           id, owner_user_id, article_id, character_code, character_name
         ) VALUES (:id, :ownerUserId, :articleId, :characterCode, :characterName)
         ON DUPLICATE KEY UPDATE character_name = VALUES(character_name)`,
        { id: designId, ownerUserId, articleId, characterCode, characterName }
      );
      const [designRows] = await connection.execute(
        `SELECT id FROM character_voice_designs
         WHERE owner_user_id = :ownerUserId
           AND article_id = :articleId
           AND character_code = :characterCode
         FOR UPDATE`,
        { ownerUserId, articleId, characterCode }
      );
      const persistedDesignId = designRows[0].id;
      const [versionRows] = await connection.execute(
        `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
         FROM character_voice_design_versions
         WHERE design_id = :designId`,
        { designId: persistedDesignId }
      );
      await connection.execute(
        `INSERT INTO character_voice_design_versions (
           id, design_id, version_number, prompt, preview_text, voice_id,
           preview_audio_url, preview_media_asset_id
         ) VALUES (
           :id, :designId, :versionNumber, :prompt, :previewText, :voiceId,
           :previewAudioUrl, :previewMediaAssetId
         )`,
        {
          id: versionId,
          designId: persistedDesignId,
          versionNumber: Number(versionRows[0].next_version),
          prompt,
          previewText,
          voiceId,
          previewAudioUrl: input.previewAudioUrl || null,
          previewMediaAssetId: input.previewMediaAssetId || null
        }
      );
    });
    return getVoiceDesignVersion(versionId, ownerUserId);
  }

  async function getVoiceDesignVersion(versionId, ownerUserId = '') {
    await ready();
    const [rows] = await database().execute(
      `SELECT
         v.id AS version_id, v.design_id, v.version_number, v.prompt, v.preview_text,
         v.voice_id, v.preview_audio_url, v.preview_media_asset_id, v.created_at,
         d.owner_user_id, d.article_id, d.character_code, d.character_name,
         u.username AS owner_username, u.display_name AS owner_display_name,
         CASE WHEN EXISTS (
           SELECT 1 FROM dubbing_version_shared_voice_designs shared_voice
           JOIN dubbing_versions shared_dubbing ON shared_dubbing.id = shared_voice.dubbing_version_id
           WHERE shared_voice.voice_design_version_id = v.id AND shared_dubbing.status = 'public'
         ) THEN 1 ELSE 0 END AS shared
       FROM character_voice_design_versions v
       JOIN character_voice_designs d ON d.id = v.design_id
       JOIN users u ON u.id = d.owner_user_id
       WHERE v.id = :versionId
         AND (:ownerUserId = '' OR d.owner_user_id = :ownerUserId)
       LIMIT 1`,
      { versionId, ownerUserId }
    );
    return mapVoiceDesignVersion(rows[0]);
  }

  async function getUsableVoiceDesignVersion(versionId, userId) {
    const version = await getVoiceDesignVersion(versionId);
    if (!version) return null;
    return version.ownerUserId === userId || version.shared ? version : null;
  }

  async function listVoiceDesignVersions({ ownerUserId, articleId, characterCode } = {}) {
    await ready();
    const conditions = [];
    const params = {};
    if (ownerUserId) {
      conditions.push('d.owner_user_id = :ownerUserId');
      params.ownerUserId = ownerUserId;
    }
    if (articleId) {
      conditions.push('d.article_id = :articleId');
      params.articleId = articleId;
    }
    if (characterCode) {
      conditions.push('d.character_code = :characterCode');
      params.characterCode = characterCode;
    }
    const [rows] = await database().execute(
      `SELECT
         v.id AS version_id, v.design_id, v.version_number, v.prompt, v.preview_text,
         v.voice_id, v.preview_audio_url, v.preview_media_asset_id, v.created_at,
         d.owner_user_id, d.article_id, d.character_code, d.character_name,
         u.username AS owner_username, u.display_name AS owner_display_name,
         CASE WHEN EXISTS (
           SELECT 1 FROM dubbing_version_shared_voice_designs shared_voice
           JOIN dubbing_versions shared_dubbing ON shared_dubbing.id = shared_voice.dubbing_version_id
           WHERE shared_voice.voice_design_version_id = v.id AND shared_dubbing.status = 'public'
         ) THEN 1 ELSE 0 END AS shared
       FROM character_voice_design_versions v
       JOIN character_voice_designs d ON d.id = v.design_id
       JOIN users u ON u.id = d.owner_user_id
       ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
       ORDER BY d.character_name ASC, v.version_number DESC`,
      params
    );
    return rows.map(mapVoiceDesignVersion);
  }

  async function listSharedVoiceDesignVersions({ excludeOwnerUserId = '' } = {}) {
    await ready();
    const [rows] = await database().execute(
      `SELECT DISTINCT
         v.id AS version_id, v.design_id, v.version_number, v.prompt, v.preview_text,
         v.voice_id, v.preview_audio_url, v.preview_media_asset_id, v.created_at,
         d.owner_user_id, d.article_id, d.character_code, d.character_name,
         u.username AS owner_username, u.display_name AS owner_display_name,
         1 AS shared
       FROM dubbing_version_shared_voice_designs shared_voice
       JOIN dubbing_versions dv ON dv.id = shared_voice.dubbing_version_id AND dv.status = 'public'
       JOIN character_voice_design_versions v ON v.id = shared_voice.voice_design_version_id
       JOIN character_voice_designs d ON d.id = v.design_id
       JOIN users u ON u.id = d.owner_user_id
       WHERE (:excludeOwnerUserId = '' OR d.owner_user_id <> :excludeOwnerUserId)
       ORDER BY v.created_at DESC`,
      { excludeOwnerUserId }
    );
    return rows.map(mapVoiceDesignVersion);
  }

  async function createDubbingVersion(input) {
    assertKind(input.kind);
    assertInitialStatus(input.status);
    const required = ['ownerUserId', 'unitId', 'articleId', 'chapterId', 'sourceText', 'sourceHash', 'audioUrl'];
    if (required.some((key) => !input[key]) || !Number.isInteger(input.paragraphIndex)) {
      throw new Error('Dubbing version is missing required fields');
    }
    await ready();
    const versionId = crypto.randomUUID();
    await inTransaction(database(), async (connection) => {
      const projectId = crypto.randomUUID();
      await connection.execute(
        `INSERT INTO dubbing_projects (
           id, owner_user_id, unit_id, article_id, chapter_id, paragraph_index, kind
         ) VALUES (
           :id, :ownerUserId, :unitId, :articleId, :chapterId, :paragraphIndex, :kind
         ) ON DUPLICATE KEY UPDATE id = id`,
        { id: projectId, ...input }
      );
      const [projectRows] = await connection.execute(
        `SELECT id FROM dubbing_projects
         WHERE owner_user_id = :ownerUserId AND unit_id = :unitId AND kind = :kind
         FOR UPDATE`,
        input
      );
      const persistedProjectId = projectRows[0].id;
      const [versionRows] = await connection.execute(
        `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
         FROM dubbing_versions WHERE project_id = :projectId`,
        { projectId: persistedProjectId }
      );
      await connection.execute(
        `INSERT INTO dubbing_versions (
           id, project_id, version_number, owner_user_id, unit_id, article_id,
           chapter_id, paragraph_index, kind, status, audio_url, media_asset_id,
           source_text, source_hash, duration_ms, prompt_snapshot_json, segments_json
         ) VALUES (
           :id, :projectId, :versionNumber, :ownerUserId, :unitId, :articleId,
           :chapterId, :paragraphIndex, :kind, :status, :audioUrl, :mediaAssetId,
           :sourceText, :sourceHash, :durationMs, :promptSnapshotJson, :segmentsJson
         )`,
        {
          id: versionId,
          projectId: persistedProjectId,
          versionNumber: Number(versionRows[0].next_version),
          ...input,
          mediaAssetId: input.mediaAssetId || null,
          durationMs: Number.isFinite(input.durationMs) ? Math.round(input.durationMs) : null,
          promptSnapshotJson: JSON.stringify(input.promptSnapshot ?? null),
          segmentsJson: JSON.stringify(input.segments ?? [])
        }
      );
      for (const voiceDesignVersionId of input.sharedVoiceDesignVersionIds || []) {
        await connection.execute(
          `INSERT IGNORE INTO dubbing_version_shared_voice_designs (
             dubbing_version_id, voice_design_version_id
           ) VALUES (:dubbingVersionId, :voiceDesignVersionId)`,
          { dubbingVersionId: versionId, voiceDesignVersionId }
        );
      }
    });
    return getVersion(versionId, input.ownerUserId);
  }

  async function setVersionStatus(versionId, ownerUserId, nextStatus) {
    if (!VERSION_STATUSES.has(nextStatus)) {
      throw new Error(`Unsupported dubbing status: ${nextStatus}`);
    }
    await ready();
    const changed = await inTransaction(database(), async (connection) => {
      const [rows] = await connection.execute(
        `SELECT owner_user_id, status FROM dubbing_versions
         WHERE id = :versionId FOR UPDATE`,
        { versionId }
      );
      const version = rows[0];
      if (!version || version.owner_user_id !== ownerUserId) return false;
      const allowed =
        (version.status === 'private' && ['public', 'deleted'].includes(nextStatus)) ||
        (version.status === 'public' && nextStatus === 'withdrawn');
      if (!allowed) {
        throw new Error(`Cannot change dubbing version status from ${version.status} to ${nextStatus}`);
      }
      await connection.execute(
        `UPDATE dubbing_versions
         SET status = :nextStatus,
             withdrawn_at = CASE WHEN :nextStatus = 'withdrawn' THEN CURRENT_TIMESTAMP ELSE withdrawn_at END
         WHERE id = :versionId AND owner_user_id = :ownerUserId`,
        { nextStatus, versionId, ownerUserId }
      );
      return true;
    });
    return changed ? getVersion(versionId, ownerUserId) : null;
  }

  async function setLike(versionId, userId, liked) {
    const version = await getVersion(versionId, userId);
    if (!version || version.status !== 'public') return null;
    if (version.ownerUserId === userId) throw new Error('Creators cannot like their own dubbing version');
    if (liked) {
      await database().execute(
        `INSERT IGNORE INTO dubbing_likes (version_id, user_id)
         VALUES (:versionId, :userId)`,
        { versionId, userId }
      );
    } else {
      await database().execute(
        `DELETE FROM dubbing_likes WHERE version_id = :versionId AND user_id = :userId`,
        { versionId, userId }
      );
    }
    return getVersion(versionId, userId);
  }

  async function adoptVersion(versionId, userId) {
    const version = await getVersion(versionId, userId);
    if (!version || version.status !== 'public') return null;
    await database().execute(
      `INSERT INTO dubbing_adoptions (user_id, unit_id, version_id)
       VALUES (:userId, :unitId, :versionId)
       ON DUPLICATE KEY UPDATE
         version_id = VALUES(version_id), updated_at = CURRENT_TIMESTAMP`,
      { userId, unitId: version.unitId, versionId }
    );
    return getVersion(versionId, userId);
  }

  async function cancelAdoption(unitId, userId) {
    await ready();
    const [result] = await database().execute(
      `DELETE FROM dubbing_adoptions WHERE user_id = :userId AND unit_id = :unitId`,
      { userId, unitId }
    );
    return Number(result.affectedRows) > 0;
  }

  async function createReport({ versionId, reporterUserId, reason }) {
    const version = await getVersion(versionId, reporterUserId);
    if (!version || version.status !== 'public') return null;
    await database().execute(
      `INSERT INTO dubbing_reports (id, version_id, reporter_user_id, reason)
       VALUES (:id, :versionId, :reporterUserId, :reason)
       ON DUPLICATE KEY UPDATE
         reason = VALUES(reason), status = 'open', updated_at = CURRENT_TIMESTAMP`,
      { id: crypto.randomUUID(), versionId, reporterUserId, reason }
    );
    return { versionId, reporterUserId, reason, status: 'open' };
  }

  return {
    createVoiceDesignVersion,
    getVoiceDesignVersion,
    listVoiceDesignVersions,
    createDubbingVersion,
    getVersion,
    listVersionsForUnit,
    listCommunityVersions,
    listAdoptedVersions,
    getUsableVoiceDesignVersion,
    listSharedVoiceDesignVersions,
    setVersionStatus,
    setLike,
    adoptVersion,
    cancelAdoption,
    createReport
  };
}

export const communityStore = createCommunityStore();

import crypto from 'node:crypto';
import { getPool } from './db.js';
import { ensureCommunitySchema } from './community-schema.js';

const VERSION_STATUSES = new Set(['private', 'public', 'withdrawn', 'moderated', 'deleted']);
const PROMPT_MODES = new Set(['official', 'free']);
const PUBLIC_VERSION_LIMIT = 3;

function booleanValue(value) {
  return Number(value || 0) > 0;
}

function jsonValue(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function mapStyle(row) {
  if (!row) return null;
  return {
    id: row.id,
    articleId: row.article_id,
    versionNumber: Number(row.version_number),
    name: row.name,
    globalStylePrompt: row.global_style_prompt,
    globalNegativePrompt: row.global_negative_prompt || '',
    styleProfile: jsonValue(row.style_profile_json),
    usageNotes: row.usage_notes || '',
    createdAt: row.created_at
  };
}

function mapOfficialSlot(row) {
  if (!row) return null;
  return {
    id: row.id,
    unitId: row.unit_id,
    articleId: row.article_id,
    chapterId: row.chapter_id,
    paragraphIndex: Number(row.paragraph_index),
    imageUrl: row.image_url,
    mediaAssetId: row.media_asset_id || null,
    promptExcerpt: row.prompt_excerpt,
    sourceText: row.source_text,
    sourceHash: row.source_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapVersion(row) {
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
    status: row.status,
    imageUrl: row.image_url,
    mediaAssetId: row.media_asset_id || null,
    promptMode: row.prompt_mode,
    finalPrompt: row.final_prompt,
    styleVersionId: row.style_version_id || null,
    aspectRatio: row.aspect_ratio,
    model: row.model || '',
    sourceText: row.source_text,
    sourceHash: row.source_hash,
    likeCount: Number(row.like_count || 0),
    commentCount: Number(row.comment_count || 0),
    likedByMe: booleanValue(row.liked_by_me),
    adoptedByMe: booleanValue(row.adopted_by_me),
    ownedByMe: booleanValue(row.owned_by_me),
    createdAt: row.created_at,
    withdrawnAt: row.withdrawn_at,
    moderatedAt: row.moderated_at
  };
}

function mapComment(row) {
  if (!row) return null;
  return {
    id: row.id,
    versionId: row.version_id,
    userId: row.user_id,
    username: row.username || '',
    displayName: row.display_name || '',
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const versionSelect = `
  iv.id AS version_id,
  iv.project_id,
  iv.version_number,
  iv.owner_user_id,
  iv.unit_id,
  iv.article_id,
  iv.chapter_id,
  iv.paragraph_index,
  iv.status,
  iv.image_url,
  iv.media_asset_id,
  iv.prompt_mode,
  iv.final_prompt,
  iv.style_version_id,
  iv.aspect_ratio,
  iv.model,
  iv.source_text,
  iv.source_hash,
  iv.created_at,
  iv.withdrawn_at,
  iv.moderated_at,
  u.username,
  u.display_name,
  COALESCE(likes.like_count, 0) AS like_count,
  COALESCE(comments.comment_count, 0) AS comment_count,
  CASE WHEN my_like.user_id IS NULL THEN 0 ELSE 1 END AS liked_by_me,
  CASE WHEN my_adoption.user_id IS NULL THEN 0 ELSE 1 END AS adopted_by_me,
  CASE WHEN iv.owner_user_id = :currentUserId THEN 1 ELSE 0 END AS owned_by_me
`;

const versionJoins = `
  JOIN users u ON u.id = iv.owner_user_id
  LEFT JOIN (
    SELECT version_id, COUNT(*) AS like_count FROM illustration_likes GROUP BY version_id
  ) likes ON likes.version_id = iv.id
  LEFT JOIN (
    SELECT version_id, COUNT(*) AS comment_count FROM illustration_comments GROUP BY version_id
  ) comments ON comments.version_id = iv.id
  LEFT JOIN illustration_likes my_like
    ON my_like.version_id = iv.id AND my_like.user_id = :currentUserId
  LEFT JOIN illustration_adoptions my_adoption
    ON my_adoption.version_id = iv.id AND my_adoption.user_id = :currentUserId
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

function publicLimitError(publicVersionIds) {
  const error = new Error('Each paragraph can have at most three public illustrations');
  error.code = 'PUBLIC_VERSION_LIMIT';
  error.statusCode = 409;
  error.publicVersionIds = publicVersionIds;
  return error;
}

export function createIllustrationStore({ pool, ensureReady = ensureCommunitySchema } = {}) {
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

  async function getOfficialStyle(articleId) {
    await ready();
    const [rows] = await database().execute(
      `SELECT isv.*
       FROM active_illustration_styles ais
       JOIN illustration_style_versions isv ON isv.id = ais.style_version_id
       WHERE ais.article_id = :articleId
       LIMIT 1`,
      { articleId }
    );
    return mapStyle(rows[0]);
  }

  async function listOfficialSlots({ articleId, chapterId = '' } = {}) {
    await ready();
    const where = ['article_id = :articleId'];
    if (chapterId) where.push('chapter_id = :chapterId');
    const [rows] = await database().execute(
      `SELECT * FROM official_illustration_slots
       WHERE ${where.join(' AND ')}
       ORDER BY chapter_id ASC, paragraph_index ASC`,
      { articleId, chapterId }
    );
    return rows.map(mapOfficialSlot);
  }

  async function upsertOfficialSlot(input) {
    if (
      !input?.id || !input.unitId || !input.articleId || !input.chapterId ||
      !Number.isInteger(Number(input.paragraphIndex)) || !input.imageUrl ||
      !input.promptExcerpt || !input.sourceText || !input.sourceHash
    ) {
      throw new Error('Official illustration slot is missing required fields');
    }
    await ready();
    await database().execute(
      `INSERT INTO official_illustration_slots (
         id, unit_id, article_id, chapter_id, paragraph_index, image_url,
         media_asset_id, prompt_excerpt, source_text, source_hash
       ) VALUES (
         :id, :unitId, :articleId, :chapterId, :paragraphIndex, :imageUrl,
         :mediaAssetId, :promptExcerpt, :sourceText, :sourceHash
       ) ON DUPLICATE KEY UPDATE
         id = VALUES(id), image_url = VALUES(image_url),
         media_asset_id = VALUES(media_asset_id), prompt_excerpt = VALUES(prompt_excerpt),
         source_text = VALUES(source_text),
         source_hash = VALUES(source_hash), updated_at = CURRENT_TIMESTAMP`,
      { ...input, mediaAssetId: input.mediaAssetId || null }
    );
    const [rows] = await database().execute(
      'SELECT * FROM official_illustration_slots WHERE unit_id = :unitId LIMIT 1',
      { unitId: input.unitId }
    );
    return mapOfficialSlot(rows[0]);
  }

  async function isOfficialMediaAsset(mediaAssetId) {
    if (!mediaAssetId) return false;
    await ready();
    const [rows] = await database().execute(
      'SELECT COUNT(*) AS slot_count FROM official_illustration_slots WHERE media_asset_id = :mediaAssetId',
      { mediaAssetId }
    );
    return Number(rows[0]?.slot_count || 0) > 0;
  }

  async function getStyleVersion(styleVersionId) {
    await ready();
    const [rows] = await database().execute(
      'SELECT * FROM illustration_style_versions WHERE id = :styleVersionId LIMIT 1',
      { styleVersionId }
    );
    return mapStyle(rows[0]);
  }

  async function createOfficialStyleVersion(input) {
    const required = ['articleId', 'name', 'globalStylePrompt'];
    if (required.some((key) => !String(input[key] || '').trim())) {
      throw new Error('Official illustration style is missing required fields');
    }
    await ready();
    const styleId = crypto.randomUUID();
    await inTransaction(database(), async (connection) => {
      const [rows] = await connection.execute(
        `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
         FROM illustration_style_versions
         WHERE article_id = :articleId
         FOR UPDATE`,
        { articleId: input.articleId }
      );
      await connection.execute(
        `INSERT INTO illustration_style_versions (
           id, article_id, version_number, name, global_style_prompt,
           global_negative_prompt, style_profile_json, usage_notes
         ) VALUES (
           :id, :articleId, :versionNumber, :name, :globalStylePrompt,
           :globalNegativePrompt, :styleProfileJson, :usageNotes
         )`,
        {
          id: styleId,
          articleId: input.articleId,
          versionNumber: Number(rows[0].next_version),
          name: input.name,
          globalStylePrompt: input.globalStylePrompt,
          globalNegativePrompt: input.globalNegativePrompt || null,
          styleProfileJson: JSON.stringify(input.styleProfile || {}),
          usageNotes: input.usageNotes || null
        }
      );
      await connection.execute(
        `INSERT INTO active_illustration_styles (article_id, style_version_id)
         VALUES (:articleId, :styleId)
         ON DUPLICATE KEY UPDATE style_version_id = VALUES(style_version_id), updated_at = CURRENT_TIMESTAMP`,
        { articleId: input.articleId, styleId }
      );
    });
    return getOfficialStyle(input.articleId);
  }

  async function ensureOfficialStyle(input) {
    const existing = await getOfficialStyle(input.articleId);
    if (existing) return existing;
    try {
      return await createOfficialStyleVersion(input);
    } catch (error) {
      if (error?.code !== 'ER_DUP_ENTRY') throw error;
      const raced = await getOfficialStyle(input.articleId);
      if (raced) return raced;
      throw error;
    }
  }

  async function getVersion(versionId, currentUserId = '') {
    await ready();
    const [rows] = await database().execute(
      `SELECT ${versionSelect}
       FROM illustration_versions iv
       ${versionJoins}
       WHERE iv.id = :versionId
       LIMIT 1`,
      { versionId, currentUserId }
    );
    return mapVersion(rows[0]);
  }

  async function createVersion(input) {
    if (!PROMPT_MODES.has(input.promptMode)) {
      throw new Error(`Unsupported illustration prompt mode: ${input.promptMode}`);
    }
    const required = [
      'ownerUserId', 'unitId', 'articleId', 'chapterId', 'imageUrl',
      'finalPrompt', 'sourceText', 'sourceHash'
    ];
    if (required.some((key) => !String(input[key] ?? '').trim())) {
      throw new Error('Illustration version is missing required fields');
    }
    if (String(input.finalPrompt).trim().length > 1400) {
      throw new Error('Illustration prompt cannot exceed 1400 characters');
    }
    await ready();
    const versionId = crypto.randomUUID();
    await inTransaction(database(), async (connection) => {
      const projectId = crypto.randomUUID();
      await connection.execute(
        `INSERT INTO illustration_projects (
           id, owner_user_id, unit_id, article_id, chapter_id, paragraph_index
         ) VALUES (
           :id, :ownerUserId, :unitId, :articleId, :chapterId, :paragraphIndex
         ) ON DUPLICATE KEY UPDATE id = id`,
        { id: projectId, ...input }
      );
      const [projectRows] = await connection.execute(
        `SELECT id FROM illustration_projects
         WHERE owner_user_id = :ownerUserId AND unit_id = :unitId
         FOR UPDATE`,
        input
      );
      const persistedProjectId = projectRows[0].id;
      const [versionRows] = await connection.execute(
        `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
         FROM illustration_versions WHERE project_id = :projectId`,
        { projectId: persistedProjectId }
      );
      await connection.execute(
        `INSERT INTO illustration_versions (
           id, project_id, version_number, owner_user_id, unit_id, article_id,
           chapter_id, paragraph_index, status, image_url, media_asset_id,
           prompt_mode, final_prompt, style_version_id, aspect_ratio, model,
           source_text, source_hash
         ) VALUES (
           :id, :projectId, :versionNumber, :ownerUserId, :unitId, :articleId,
           :chapterId, :paragraphIndex, 'private', :imageUrl, :mediaAssetId,
           :promptMode, :finalPrompt, :styleVersionId, '16:9', :model,
           :sourceText, :sourceHash
         )`,
        {
          id: versionId,
          projectId: persistedProjectId,
          versionNumber: Number(versionRows[0].next_version),
          ...input,
          mediaAssetId: input.mediaAssetId || null,
          styleVersionId: input.promptMode === 'official' ? input.styleVersionId || null : null,
          model: input.model || null
        }
      );
    });
    return getVersion(versionId, input.ownerUserId);
  }

  async function listMyVersions({ ownerUserId, unitId }) {
    await ready();
    const [rows] = await database().execute(
      `SELECT ${versionSelect}
       FROM illustration_versions iv
       ${versionJoins}
       WHERE iv.owner_user_id = :ownerUserId
         AND iv.unit_id = :unitId
         AND iv.status <> 'deleted'
       ORDER BY iv.created_at DESC, iv.version_number DESC`,
      { ownerUserId, unitId, currentUserId: ownerUserId }
    );
    return rows.map(mapVersion);
  }

  async function listVersionsForUnit(unitId, currentUserId = '') {
    await ready();
    const access = currentUserId
      ? `(iv.status = 'public' OR iv.owner_user_id = :currentUserId OR my_adoption.user_id IS NOT NULL)`
      : `iv.status = 'public'`;
    const [rows] = await database().execute(
      `SELECT ${versionSelect}
       FROM illustration_versions iv
       ${versionJoins}
       WHERE iv.unit_id = :unitId
         AND iv.status NOT IN ('deleted', 'moderated')
         AND ${access}
       ORDER BY adopted_by_me DESC, owned_by_me DESC,
                (like_count + comment_count) DESC, iv.created_at DESC, iv.id DESC`,
      { unitId, currentUserId }
    );
    return rows.map(mapVersion);
  }

  async function listCommunityVersions({
    articleId = '',
    unitId = '',
    currentUserId = '',
    sort = 'popular',
    scope = 'all',
    limit = 60,
    offset = 0
  } = {}) {
    await ready();
    if (scope === 'mine' && !currentUserId) return [];
    const where = ["iv.status = 'public'"];
    const safeLimit = Math.min(Math.max(Number(limit) || 60, 1), 100);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    const params = { articleId, unitId, currentUserId };
    if (articleId) where.push('iv.article_id = :articleId');
    if (unitId) where.push('iv.unit_id = :unitId');
    if (scope === 'mine') where.push('iv.owner_user_id = :currentUserId');
    const orderBy = sort === 'newest'
      ? 'iv.created_at DESC, iv.id DESC'
      : '(like_count + comment_count) DESC, like_count DESC, comment_count DESC, iv.created_at DESC, iv.id DESC';
    const [rows] = await database().execute(
      `SELECT ${versionSelect}
       FROM illustration_versions iv
       ${versionJoins}
       WHERE ${where.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params
    );
    return rows.map(mapVersion);
  }

  async function setVersionStatus(versionId, ownerUserId, nextStatus, replaceVersionId = '') {
    if (!VERSION_STATUSES.has(nextStatus)) {
      throw new Error(`Unsupported illustration status: ${nextStatus}`);
    }
    await ready();
    const changed = await inTransaction(database(), async (connection) => {
      const [rows] = await connection.execute(
        `SELECT owner_user_id, unit_id, status
         FROM illustration_versions WHERE id = :versionId FOR UPDATE`,
        { versionId }
      );
      const version = rows[0];
      if (!version || version.owner_user_id !== ownerUserId) return false;
      if (version.status === nextStatus) return true;
      const allowed =
        (version.status === 'private' && ['public', 'deleted'].includes(nextStatus)) ||
        (version.status === 'public' && ['withdrawn', 'deleted'].includes(nextStatus)) ||
        (version.status === 'withdrawn' && ['public', 'deleted'].includes(nextStatus));
      if (!allowed) {
        throw new Error(`Cannot change illustration status from ${version.status} to ${nextStatus}`);
      }

      if (nextStatus === 'deleted') {
        const [adoptionRows] = await connection.execute(
          `SELECT COUNT(*) AS adoption_count
           FROM illustration_adoptions
           WHERE version_id = :versionId AND user_id <> :ownerUserId`,
          { versionId, ownerUserId }
        );
        if (Number(adoptionRows[0]?.adoption_count || 0) > 0) {
          const error = new Error('Withdrawn illustrations with existing adopters cannot be deleted');
          error.code = 'ILLUSTRATION_HAS_ADOPTERS';
          error.statusCode = 409;
          throw error;
        }
      }

      if (nextStatus === 'public') {
        const [publicRows] = await connection.execute(
          `SELECT id FROM illustration_versions
           WHERE owner_user_id = :ownerUserId AND unit_id = :unitId
             AND status = 'public' AND id <> :versionId
           ORDER BY created_at ASC
           FOR UPDATE`,
          { ownerUserId, unitId: version.unit_id, versionId }
        );
        if (publicRows.length >= PUBLIC_VERSION_LIMIT) {
          const replacement = publicRows.find((row) => row.id === replaceVersionId);
          if (!replacement) throw publicLimitError(publicRows.map((row) => row.id));
          await connection.execute(
            `UPDATE illustration_versions
             SET status = 'withdrawn', withdrawn_at = CURRENT_TIMESTAMP
             WHERE id = :replaceVersionId`,
            { replaceVersionId }
          );
        }
      }

      await connection.execute(
        `UPDATE illustration_versions
         SET status = :nextStatus,
             withdrawn_at = CASE
               WHEN :nextStatus = 'withdrawn' THEN CURRENT_TIMESTAMP
               WHEN :nextStatus = 'public' THEN NULL
               ELSE withdrawn_at
             END
         WHERE id = :versionId AND owner_user_id = :ownerUserId`,
        { nextStatus, versionId, ownerUserId }
      );
      if (nextStatus === 'deleted') {
        await connection.execute(
          'DELETE FROM illustration_adoptions WHERE version_id = :versionId AND user_id = :ownerUserId',
          { versionId, ownerUserId }
        );
      }
      return true;
    });
    return changed ? getVersion(versionId, ownerUserId) : null;
  }

  async function adoptVersion({ versionId, userId, unitId }) {
    await ready();
    const version = await getVersion(versionId, userId);
    if (!version || version.unitId !== unitId) return null;
    const ownVersion = version.ownerUserId === userId;
    if ((!ownVersion && version.status !== 'public') || ['deleted', 'moderated'].includes(version.status)) {
      return null;
    }
    await database().execute(
      `INSERT INTO illustration_adoptions (user_id, unit_id, version_id)
       VALUES (:userId, :unitId, :versionId)
       ON DUPLICATE KEY UPDATE version_id = VALUES(version_id), updated_at = CURRENT_TIMESTAMP`,
      { versionId, userId, unitId }
    );
    return getVersion(versionId, userId);
  }

  async function clearAdoption({ userId, unitId }) {
    await ready();
    const [result] = await database().execute(
      'DELETE FROM illustration_adoptions WHERE user_id = :userId AND unit_id = :unitId',
      { userId, unitId }
    );
    return Number(result.affectedRows) > 0;
  }

  async function listAdoptedVersions({ userId, articleId, chapterId = '' }) {
    if (!userId) return [];
    await ready();
    const where = [
      'ia.user_id = :userId',
      'iv.article_id = :articleId',
      "iv.status NOT IN ('deleted', 'moderated')"
    ];
    if (chapterId) where.push('iv.chapter_id = :chapterId');
    const [rows] = await database().execute(
      `SELECT ${versionSelect}
       FROM illustration_adoptions ia
       JOIN illustration_versions iv ON iv.id = ia.version_id
       ${versionJoins}
       WHERE ${where.join(' AND ')}
       ORDER BY ia.updated_at DESC`,
      { userId, articleId, chapterId, currentUserId: userId }
    );
    return rows.map(mapVersion);
  }

  async function setLike(versionId, userId, liked) {
    const version = await getVersion(versionId, userId);
    if (!version || version.status !== 'public') return null;
    if (version.ownerUserId === userId) {
      throw new Error('Creators cannot like their own illustration');
    }
    if (liked) {
      await database().execute(
        'INSERT IGNORE INTO illustration_likes (version_id, user_id) VALUES (:versionId, :userId)',
        { versionId, userId }
      );
    } else {
      await database().execute(
        'DELETE FROM illustration_likes WHERE version_id = :versionId AND user_id = :userId',
        { versionId, userId }
      );
    }
    return getVersion(versionId, userId);
  }

  async function listComments(versionId) {
    await ready();
    const [rows] = await database().execute(
      `SELECT ic.*, u.username, u.display_name
       FROM illustration_comments ic
       JOIN users u ON u.id = ic.user_id
       JOIN illustration_versions iv ON iv.id = ic.version_id
       WHERE ic.version_id = :versionId AND iv.status = 'public'
       ORDER BY ic.created_at ASC, ic.id ASC`,
      { versionId }
    );
    return rows.map(mapComment);
  }

  async function createComment({ versionId, userId, content }) {
    const normalizedContent = String(content || '').trim();
    if (!normalizedContent || normalizedContent.length > 1000) {
      throw new Error('Illustration comments must contain 1 to 1000 characters');
    }
    const version = await getVersion(versionId, userId);
    if (!version || version.status !== 'public') return null;
    const id = crypto.randomUUID();
    await database().execute(
      `INSERT INTO illustration_comments (id, version_id, user_id, content)
       VALUES (:id, :versionId, :userId, :content)`,
      { id, versionId, userId, content: normalizedContent }
    );
    const [rows] = await database().execute(
      `SELECT ic.*, u.username, u.display_name
       FROM illustration_comments ic
       JOIN users u ON u.id = ic.user_id
       WHERE ic.id = :id LIMIT 1`,
      { id }
    );
    return mapComment(rows[0]);
  }

  async function deleteComment({ commentId, userId }) {
    await ready();
    const [result] = await database().execute(
      'DELETE FROM illustration_comments WHERE id = :commentId AND user_id = :userId',
      { commentId, userId }
    );
    return Number(result.affectedRows) > 0;
  }

  async function createReport({ versionId, reporterUserId, reason }) {
    const normalizedReason = String(reason || '').trim();
    if (!normalizedReason || normalizedReason.length > 500) {
      throw new Error('Illustration report reason must contain 1 to 500 characters');
    }
    const version = await getVersion(versionId, reporterUserId);
    if (!version || version.status !== 'public' || version.ownerUserId === reporterUserId) return null;
    await database().execute(
      `INSERT INTO illustration_reports (id, version_id, reporter_user_id, reason)
       VALUES (:id, :versionId, :reporterUserId, :reason)
       ON DUPLICATE KEY UPDATE reason = VALUES(reason), status = 'open', updated_at = CURRENT_TIMESTAMP`,
      { id: crypto.randomUUID(), versionId, reporterUserId, reason: normalizedReason }
    );
    return { versionId, reporterUserId, reason: normalizedReason, status: 'open' };
  }

  return {
    getOfficialStyle,
    listOfficialSlots,
    upsertOfficialSlot,
    isOfficialMediaAsset,
    getStyleVersion,
    createOfficialStyleVersion,
    ensureOfficialStyle,
    getVersion,
    createVersion,
    listMyVersions,
    listVersionsForUnit,
    listCommunityVersions,
    setVersionStatus,
    adoptVersion,
    clearAdoption,
    listAdoptedVersions,
    setLike,
    listComments,
    createComment,
    deleteComment,
    createReport
  };
}

export const illustrationStore = createIllustrationStore();

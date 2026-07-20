import crypto from 'node:crypto';
import { getPool } from './db.js';
import { ensureCommunitySchema } from './community-schema.js';

const VERSION_STATUSES = new Set(['private', 'public', 'withdrawn', 'moderated', 'deleted']);
const PUBLIC_VERSION_LIMIT = 3;

function booleanValue(value) {
  return Number(value || 0) > 0;
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
    articleId: row.article_id,
    clueId: row.clue_id,
    occurrenceId: row.occurrence_id,
    chapterId: row.chapter_id,
    paragraphIndex: Number(row.paragraph_index),
    clueLabel: row.clue_label,
    clueType: row.clue_type,
    status: row.status,
    imageUrl: row.image_url,
    mediaAssetId: row.media_asset_id || null,
    finalPrompt: row.final_prompt,
    aspectRatio: row.aspect_ratio,
    model: row.model || '',
    sourceText: row.source_text,
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

const versionSelect = `
  civ.id AS version_id,
  civ.project_id,
  civ.version_number,
  civ.owner_user_id,
  civ.article_id,
  civ.clue_id,
  civ.occurrence_id,
  civ.chapter_id,
  civ.paragraph_index,
  civ.clue_label,
  civ.clue_type,
  civ.status,
  civ.image_url,
  civ.media_asset_id,
  civ.final_prompt,
  civ.aspect_ratio,
  civ.model,
  civ.source_text,
  civ.created_at,
  civ.withdrawn_at,
  civ.moderated_at,
  u.username,
  u.display_name,
  COALESCE(likes.like_count, 0) AS like_count,
  COALESCE(adoptions.adoption_count, 0) AS adoption_count,
  CASE WHEN my_like.user_id IS NULL THEN 0 ELSE 1 END AS liked_by_me,
  CASE WHEN my_adoption.user_id IS NULL THEN 0 ELSE 1 END AS adopted_by_me,
  CASE WHEN civ.owner_user_id = :currentUserId THEN 1 ELSE 0 END AS owned_by_me
`;

const versionJoins = `
  JOIN users u ON u.id = civ.owner_user_id
  LEFT JOIN (
    SELECT version_id, COUNT(*) AS like_count FROM clue_image_likes GROUP BY version_id
  ) likes ON likes.version_id = civ.id
  LEFT JOIN (
    SELECT version_id, COUNT(*) AS adoption_count FROM clue_image_adoptions GROUP BY version_id
  ) adoptions ON adoptions.version_id = civ.id
  LEFT JOIN clue_image_likes my_like
    ON my_like.version_id = civ.id AND my_like.user_id = :currentUserId
  LEFT JOIN clue_image_adoptions my_adoption
    ON my_adoption.version_id = civ.id AND my_adoption.user_id = :currentUserId
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
  const error = new Error('Each clue can have at most three public image versions');
  error.code = 'PUBLIC_CLUE_VERSION_LIMIT';
  error.statusCode = 409;
  error.publicVersionIds = publicVersionIds;
  return error;
}

export function createClueImageStore({ pool, ensureReady = ensureCommunitySchema } = {}) {
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
       FROM clue_image_versions civ
       ${versionJoins}
       WHERE civ.id = :versionId
       LIMIT 1`,
      { versionId, currentUserId }
    );
    return mapVersion(rows[0]);
  }

  async function createVersion(input) {
    const required = [
      'ownerUserId', 'articleId', 'clueId', 'occurrenceId', 'chapterId', 'paragraphIndex', 'clueLabel',
      'clueType', 'imageUrl', 'finalPrompt', 'aspectRatio', 'sourceText'
    ];
    if (required.some((key) => !String(input[key] ?? '').trim())) {
      throw new Error('Clue image version is missing required fields');
    }
    if (String(input.finalPrompt).trim().length > 1400) {
      throw new Error('Clue image prompt cannot exceed 1400 characters');
    }
    await ready();
    const versionId = crypto.randomUUID();
    await inTransaction(database(), async (connection) => {
      const projectId = crypto.randomUUID();
      await connection.execute(
        `INSERT INTO clue_image_projects (id, owner_user_id, article_id, clue_id)
         VALUES (:id, :ownerUserId, :articleId, :clueId)
         ON DUPLICATE KEY UPDATE id = id`,
        { id: projectId, ...input }
      );
      const [projectRows] = await connection.execute(
        `SELECT id FROM clue_image_projects
         WHERE owner_user_id = :ownerUserId AND clue_id = :clueId
         FOR UPDATE`,
        input
      );
      const persistedProjectId = projectRows[0].id;
      const [versionRows] = await connection.execute(
        `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
         FROM clue_image_versions WHERE project_id = :projectId`,
        { projectId: persistedProjectId }
      );
      await connection.execute(
        `INSERT INTO clue_image_versions (
           id, project_id, version_number, owner_user_id, article_id, clue_id,
           occurrence_id, chapter_id, paragraph_index, clue_label, clue_type, status, image_url, media_asset_id,
           final_prompt, aspect_ratio, model, source_text
         ) VALUES (
           :id, :projectId, :versionNumber, :ownerUserId, :articleId, :clueId,
           :occurrenceId, :chapterId, :paragraphIndex, :clueLabel, :clueType, 'private', :imageUrl, :mediaAssetId,
           :finalPrompt, :aspectRatio, :model, :sourceText
         )`,
        {
          id: versionId,
          projectId: persistedProjectId,
          versionNumber: Number(versionRows[0].next_version),
          ...input,
          mediaAssetId: input.mediaAssetId || null,
          model: input.model || null
        }
      );
    });
    return getVersion(versionId, input.ownerUserId);
  }

  async function listMyVersions({ ownerUserId, clueId }) {
    await ready();
    const [rows] = await database().execute(
      `SELECT ${versionSelect}
       FROM clue_image_versions civ
       ${versionJoins}
       WHERE civ.owner_user_id = :ownerUserId
         AND civ.clue_id = :clueId
         AND civ.status <> 'deleted'
       ORDER BY civ.created_at DESC, civ.version_number DESC`,
      { ownerUserId, clueId, currentUserId: ownerUserId }
    );
    return rows.map(mapVersion);
  }

  async function listVersionsForClue(clueId, currentUserId = '') {
    await ready();
    const access = currentUserId
      ? `(civ.status = 'public' OR civ.owner_user_id = :currentUserId OR my_adoption.user_id IS NOT NULL)`
      : `civ.status = 'public'`;
    const [rows] = await database().execute(
      `SELECT ${versionSelect}
       FROM clue_image_versions civ
       ${versionJoins}
       WHERE civ.clue_id = :clueId
         AND civ.status NOT IN ('deleted', 'moderated')
         AND ${access}
       ORDER BY adopted_by_me DESC, owned_by_me DESC,
                (like_count + adoption_count) DESC, civ.created_at DESC, civ.id DESC`,
      { clueId, currentUserId }
    );
    return rows.map(mapVersion);
  }

  async function listCommunityVersions({
    articleId = '', clueId = '', currentUserId = '', sort = 'popular', scope = 'all', limit = 60, offset = 0
  } = {}) {
    await ready();
    if (scope === 'mine' && !currentUserId) return [];
    const where = ["civ.status = 'public'"];
    const params = { articleId, clueId, currentUserId };
    if (articleId) where.push('civ.article_id = :articleId');
    if (clueId) where.push('civ.clue_id = :clueId');
    if (scope === 'mine') where.push('civ.owner_user_id = :currentUserId');
    const safeLimit = Math.min(Math.max(Number(limit) || 60, 1), 100);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    const orderBy = sort === 'newest'
      ? 'civ.created_at DESC, civ.id DESC'
      : '(like_count + adoption_count) DESC, like_count DESC, adoption_count DESC, civ.created_at DESC, civ.id DESC';
    const [rows] = await database().execute(
      `SELECT ${versionSelect}
       FROM clue_image_versions civ
       ${versionJoins}
       WHERE ${where.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params
    );
    return rows.map(mapVersion);
  }

  async function setVersionStatus(versionId, ownerUserId, nextStatus, replaceVersionId = '') {
    if (!VERSION_STATUSES.has(nextStatus)) throw new Error(`Unsupported clue image status: ${nextStatus}`);
    await ready();
    const changed = await inTransaction(database(), async (connection) => {
      const [rows] = await connection.execute(
        'SELECT owner_user_id, clue_id, status FROM clue_image_versions WHERE id = :versionId FOR UPDATE',
        { versionId }
      );
      const version = rows[0];
      if (!version || version.owner_user_id !== ownerUserId) return false;
      if (version.status === nextStatus) return true;
      const allowed =
        (version.status === 'private' && ['public', 'deleted'].includes(nextStatus)) ||
        (version.status === 'public' && ['withdrawn', 'deleted'].includes(nextStatus)) ||
        (version.status === 'withdrawn' && ['public', 'deleted'].includes(nextStatus));
      if (!allowed) throw new Error(`Cannot change clue image status from ${version.status} to ${nextStatus}`);

      if (nextStatus === 'deleted') {
        const [adoptionRows] = await connection.execute(
          `SELECT COUNT(*) AS adoption_count FROM clue_image_adoptions
           WHERE version_id = :versionId AND user_id <> :ownerUserId`,
          { versionId, ownerUserId }
        );
        if (Number(adoptionRows[0]?.adoption_count || 0) > 0) {
          const error = new Error('Clue images with existing adopters cannot be deleted');
          error.code = 'CLUE_IMAGE_HAS_ADOPTERS';
          error.statusCode = 409;
          throw error;
        }
      }

      if (nextStatus === 'public') {
        const [publicRows] = await connection.execute(
          `SELECT id FROM clue_image_versions
           WHERE owner_user_id = :ownerUserId AND clue_id = :clueId
             AND status = 'public' AND id <> :versionId
           ORDER BY created_at ASC FOR UPDATE`,
          { ownerUserId, clueId: version.clue_id, versionId }
        );
        if (publicRows.length >= PUBLIC_VERSION_LIMIT) {
          const replacement = publicRows.find((row) => row.id === replaceVersionId);
          if (!replacement) throw publicLimitError(publicRows.map((row) => row.id));
          await connection.execute(
            `UPDATE clue_image_versions SET status = 'withdrawn', withdrawn_at = CURRENT_TIMESTAMP
             WHERE id = :replaceVersionId`,
            { replaceVersionId }
          );
        }
      }

      await connection.execute(
        `UPDATE clue_image_versions
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
          'DELETE FROM clue_image_adoptions WHERE version_id = :versionId AND user_id = :ownerUserId',
          { versionId, ownerUserId }
        );
      }
      return true;
    });
    return changed ? getVersion(versionId, ownerUserId) : null;
  }

  async function adoptVersion({ versionId, userId, clueId }) {
    await ready();
    const version = await getVersion(versionId, userId);
    if (!version || version.clueId !== clueId) return null;
    const ownVersion = version.ownerUserId === userId;
    if ((!ownVersion && version.status !== 'public') || ['deleted', 'moderated'].includes(version.status)) return null;
    await database().execute(
      `INSERT INTO clue_image_adoptions (user_id, clue_id, version_id)
       VALUES (:userId, :clueId, :versionId)
       ON DUPLICATE KEY UPDATE version_id = VALUES(version_id), updated_at = CURRENT_TIMESTAMP`,
      { versionId, userId, clueId }
    );
    return getVersion(versionId, userId);
  }

  async function clearAdoption({ userId, clueId }) {
    await ready();
    const [result] = await database().execute(
      'DELETE FROM clue_image_adoptions WHERE user_id = :userId AND clue_id = :clueId',
      { userId, clueId }
    );
    return Number(result.affectedRows) > 0;
  }

  async function listAdoptedVersions({ userId, articleId = '' }) {
    if (!userId) return [];
    await ready();
    const where = ['cia.user_id = :userId', "civ.status NOT IN ('deleted', 'moderated')"];
    if (articleId) where.push('civ.article_id = :articleId');
    const [rows] = await database().execute(
      `SELECT ${versionSelect}
       FROM clue_image_adoptions cia
       JOIN clue_image_versions civ ON civ.id = cia.version_id
       ${versionJoins}
       WHERE ${where.join(' AND ')}
       ORDER BY cia.updated_at DESC`,
      { userId, articleId, currentUserId: userId }
    );
    return rows.map(mapVersion);
  }

  async function setLike(versionId, userId, liked) {
    const version = await getVersion(versionId, userId);
    if (!version || version.status !== 'public') return null;
    if (version.ownerUserId === userId) throw new Error('Creators cannot like their own clue image');
    if (liked) {
      await database().execute(
        'INSERT IGNORE INTO clue_image_likes (version_id, user_id) VALUES (:versionId, :userId)',
        { versionId, userId }
      );
    } else {
      await database().execute(
        'DELETE FROM clue_image_likes WHERE version_id = :versionId AND user_id = :userId',
        { versionId, userId }
      );
    }
    return getVersion(versionId, userId);
  }

  async function createReport({ versionId, reporterUserId, reason }) {
    const normalizedReason = String(reason || '').trim();
    if (!normalizedReason || normalizedReason.length > 500) {
      throw new Error('Clue image report reason must contain 1 to 500 characters');
    }
    const version = await getVersion(versionId, reporterUserId);
    if (!version || version.status !== 'public' || version.ownerUserId === reporterUserId) return null;
    await database().execute(
      `INSERT INTO clue_image_reports (id, version_id, reporter_user_id, reason)
       VALUES (:id, :versionId, :reporterUserId, :reason)
       ON DUPLICATE KEY UPDATE reason = VALUES(reason), status = 'open', updated_at = CURRENT_TIMESTAMP`,
      { id: crypto.randomUUID(), versionId, reporterUserId, reason: normalizedReason }
    );
    return { versionId, reporterUserId, reason: normalizedReason, status: 'open' };
  }

  return {
    getVersion,
    createVersion,
    listMyVersions,
    listVersionsForClue,
    listCommunityVersions,
    setVersionStatus,
    adoptVersion,
    clearAdoption,
    listAdoptedVersions,
    setLike,
    createReport
  };
}

export const clueImageStore = createClueImageStore();

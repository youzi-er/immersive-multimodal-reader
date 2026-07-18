import crypto from 'node:crypto';
import { getPool } from './db.js';
import { ensureCommunitySchema } from './community-schema.js';

const VERSION_STATUSES = new Set(['private', 'public', 'withdrawn', 'moderated', 'deleted']);
const COVER_MODES = new Set(['guided', 'advanced']);

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

function mapCoverVersion(row) {
  if (!row) return null;
  return {
    id: row.version_id,
    projectId: row.project_id,
    versionNumber: Number(row.version_number),
    ownerUserId: row.owner_user_id,
    username: row.username || '',
    displayName: row.display_name || '',
    articleId: row.article_id,
    status: row.status,
    imageUrl: row.image_url,
    mediaAssetId: row.media_asset_id,
    mode: row.mode,
    prompt: row.prompt,
    finalPrompt: row.final_prompt,
    mood: row.mood || '',
    palette: row.palette || '',
    composition: row.composition || '',
    parameters: jsonValue(row.parameters_json),
    bookTitle: row.book_title,
    bookAuthor: row.book_author,
    bookSubtitle: row.book_subtitle || '',
    remixedFromVersionId: row.remixed_from_version_id || null,
    likeCount: Number(row.like_count || 0),
    collectionCount: Number(row.collection_count || 0),
    remixCount: Number(row.remix_count || 0),
    likedByMe: booleanValue(row.liked_by_me),
    collectedByMe: booleanValue(row.collected_by_me),
    activeByMe: booleanValue(row.active_by_me),
    ownedByMe: booleanValue(row.owned_by_me),
    createdAt: row.created_at,
    withdrawnAt: row.withdrawn_at,
    moderatedAt: row.moderated_at
  };
}

const coverSelect = `
  cv.id AS version_id,
  cv.project_id,
  cv.version_number,
  cv.owner_user_id,
  cv.article_id,
  cv.status,
  cv.image_url,
  cv.media_asset_id,
  cv.mode,
  cv.prompt,
  cv.final_prompt,
  cv.mood,
  cv.palette,
  cv.composition,
  cv.parameters_json,
  cv.book_title,
  cv.book_author,
  cv.book_subtitle,
  cv.remixed_from_version_id,
  cv.created_at,
  cv.withdrawn_at,
  cv.moderated_at,
  u.username,
  u.display_name,
  COALESCE(likes.like_count, 0) AS like_count,
  COALESCE(collections.collection_count, 0) AS collection_count,
  COALESCE(remixes.remix_count, 0) AS remix_count,
  CASE WHEN my_like.user_id IS NULL THEN 0 ELSE 1 END AS liked_by_me,
  CASE WHEN my_collection.user_id IS NULL THEN 0 ELSE 1 END AS collected_by_me,
  CASE WHEN active_cover.user_id IS NULL THEN 0 ELSE 1 END AS active_by_me,
  CASE WHEN cv.owner_user_id = :currentUserId THEN 1 ELSE 0 END AS owned_by_me
`;

const coverJoins = `
  JOIN users u ON u.id = cv.owner_user_id
  LEFT JOIN (
    SELECT version_id, COUNT(*) AS like_count FROM cover_likes GROUP BY version_id
  ) likes ON likes.version_id = cv.id
  LEFT JOIN (
    SELECT version_id, COUNT(*) AS collection_count FROM cover_collections GROUP BY version_id
  ) collections ON collections.version_id = cv.id
  LEFT JOIN (
    SELECT remixed_from_version_id AS version_id, COUNT(*) AS remix_count
    FROM cover_versions
    WHERE remixed_from_version_id IS NOT NULL AND status <> 'deleted'
    GROUP BY remixed_from_version_id
  ) remixes ON remixes.version_id = cv.id
  LEFT JOIN cover_likes my_like
    ON my_like.version_id = cv.id AND my_like.user_id = :currentUserId
  LEFT JOIN cover_collections my_collection
    ON my_collection.version_id = cv.id AND my_collection.user_id = :currentUserId
  LEFT JOIN active_book_covers active_cover
    ON active_cover.version_id = cv.id AND active_cover.user_id = :currentUserId
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

export function createCoverStore({ pool, ensureReady = ensureCommunitySchema } = {}) {
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
      `SELECT ${coverSelect}
       FROM cover_versions cv
       ${coverJoins}
       WHERE cv.id = :versionId
       LIMIT 1`,
      { versionId, currentUserId }
    );
    return mapCoverVersion(rows[0]);
  }

  async function listHistory({ ownerUserId, articleId }) {
    await ready();
    const [rows] = await database().execute(
      `SELECT ${coverSelect}
       FROM cover_versions cv
       ${coverJoins}
       WHERE cv.owner_user_id = :ownerUserId
         AND cv.article_id = :articleId
         AND cv.status <> 'deleted'
       ORDER BY cv.created_at DESC, cv.version_number DESC`,
      { ownerUserId, articleId, currentUserId: ownerUserId }
    );
    return rows.map(mapCoverVersion);
  }

  async function listCommunityVersions({
    articleId = '',
    currentUserId = '',
    sort = 'popular',
    scope = 'all',
    limit = 60
  } = {}) {
    await ready();
    if ((scope === 'mine' || scope === 'collected') && !currentUserId) return [];
    const where = ["cv.status = 'public'"];
    const safeLimit = Math.min(Math.max(Number(limit) || 60, 1), 100);
    const params = { articleId, currentUserId };
    if (articleId) where.push('cv.article_id = :articleId');
    if (scope === 'mine') where.push('cv.owner_user_id = :currentUserId');
    if (scope === 'collected') where.push('my_collection.user_id IS NOT NULL');
    const orderBy = sort === 'newest'
      ? 'cv.created_at DESC, cv.id DESC'
      : 'like_count DESC, collection_count DESC, remix_count DESC, cv.created_at DESC, cv.id DESC';
    const [rows] = await database().execute(
      `SELECT ${coverSelect}
       FROM cover_versions cv
       ${coverJoins}
       WHERE ${where.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT ${safeLimit}`,
      params
    );
    return rows.map(mapCoverVersion);
  }

  async function createVersion(input) {
    if (!COVER_MODES.has(input.mode)) throw new Error(`Unsupported cover mode: ${input.mode}`);
    if (input.status !== 'private' && input.status !== 'public') {
      throw new Error('New cover versions must be private or public');
    }
    const required = [
      'ownerUserId', 'articleId', 'imageUrl', 'prompt', 'finalPrompt', 'bookTitle', 'bookAuthor'
    ];
    if (required.some((key) => !String(input[key] || '').trim())) {
      throw new Error('Cover version is missing required fields');
    }
    await ready();
    const versionId = crypto.randomUUID();
    await inTransaction(database(), async (connection) => {
      const projectId = crypto.randomUUID();
      await connection.execute(
        `INSERT INTO cover_projects (id, owner_user_id, article_id)
         VALUES (:id, :ownerUserId, :articleId)
         ON DUPLICATE KEY UPDATE id = id`,
        { id: projectId, ...input }
      );
      const [projectRows] = await connection.execute(
        `SELECT id FROM cover_projects
         WHERE owner_user_id = :ownerUserId AND article_id = :articleId
         FOR UPDATE`,
        input
      );
      const persistedProjectId = projectRows[0].id;
      const [versionRows] = await connection.execute(
        `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
         FROM cover_versions WHERE project_id = :projectId`,
        { projectId: persistedProjectId }
      );
      await connection.execute(
        `INSERT INTO cover_versions (
           id, project_id, version_number, owner_user_id, article_id, status,
           image_url, media_asset_id, mode, prompt, final_prompt, mood, palette,
           composition, parameters_json, book_title, book_author, book_subtitle, remixed_from_version_id
         ) VALUES (
           :id, :projectId, :versionNumber, :ownerUserId, :articleId, :status,
           :imageUrl, :mediaAssetId, :mode, :prompt, :finalPrompt, :mood, :palette,
           :composition, :parametersJson, :bookTitle, :bookAuthor, :bookSubtitle, :remixedFromVersionId
         )`,
        {
          id: versionId,
          projectId: persistedProjectId,
          versionNumber: Number(versionRows[0].next_version),
          ...input,
          mediaAssetId: input.mediaAssetId || null,
          mood: input.mood || null,
          palette: input.palette || null,
          composition: input.composition || null,
          parametersJson: JSON.stringify(input.parameters || {}),
          bookSubtitle: input.bookSubtitle || null,
          remixedFromVersionId: input.remixedFromVersionId || null
        }
      );
    });
    return getVersion(versionId, input.ownerUserId);
  }

  async function setVersionStatus(versionId, ownerUserId, nextStatus) {
    if (!VERSION_STATUSES.has(nextStatus)) throw new Error(`Unsupported cover status: ${nextStatus}`);
    await ready();
    const changed = await inTransaction(database(), async (connection) => {
      const [rows] = await connection.execute(
        `SELECT owner_user_id, status FROM cover_versions WHERE id = :versionId FOR UPDATE`,
        { versionId }
      );
      const version = rows[0];
      if (!version || version.owner_user_id !== ownerUserId) return false;
      if (version.status === nextStatus) return true;
      const allowed =
        (version.status === 'private' && ['public', 'deleted'].includes(nextStatus)) ||
        (version.status === 'public' && ['withdrawn', 'deleted'].includes(nextStatus)) ||
        (version.status === 'withdrawn' && ['public', 'deleted'].includes(nextStatus));
      if (!allowed) throw new Error(`Cannot change cover status from ${version.status} to ${nextStatus}`);
      await connection.execute(
        `UPDATE cover_versions
         SET status = :nextStatus,
             withdrawn_at = CASE WHEN :nextStatus = 'withdrawn' THEN CURRENT_TIMESTAMP ELSE withdrawn_at END
         WHERE id = :versionId AND owner_user_id = :ownerUserId`,
        { nextStatus, versionId, ownerUserId }
      );
      if (nextStatus === 'deleted') {
        await connection.execute('DELETE FROM active_book_covers WHERE version_id = :versionId', { versionId });
      }
      return true;
    });
    return changed ? getVersion(versionId, ownerUserId) : null;
  }

  async function getCurrentCover({ userId, articleId }) {
    if (!userId) return null;
    await ready();
    const [rows] = await database().execute(
      `SELECT ${coverSelect}
       FROM active_book_covers abc
       JOIN cover_versions cv ON cv.id = abc.version_id
       ${coverJoins}
       WHERE abc.user_id = :userId AND abc.article_id = :articleId
         AND cv.status NOT IN ('deleted', 'moderated')
       LIMIT 1`,
      { userId, articleId, currentUserId: userId }
    );
    return mapCoverVersion(rows[0]);
  }

  async function setCurrentCover({ userId, articleId, versionId }) {
    const version = await getVersion(versionId, userId);
    if (!version || version.ownerUserId !== userId || version.articleId !== articleId) return null;
    if (version.status === 'deleted' || version.status === 'moderated') return null;
    await database().execute(
      `INSERT INTO active_book_covers (user_id, article_id, version_id)
       VALUES (:userId, :articleId, :versionId)
       ON DUPLICATE KEY UPDATE version_id = VALUES(version_id), updated_at = CURRENT_TIMESTAMP`,
      { userId, articleId, versionId }
    );
    return getCurrentCover({ userId, articleId });
  }

  async function clearCurrentCover({ userId, articleId }) {
    await ready();
    const [result] = await database().execute(
      'DELETE FROM active_book_covers WHERE user_id = :userId AND article_id = :articleId',
      { userId, articleId }
    );
    return Number(result.affectedRows) > 0;
  }

  async function setLike(versionId, userId, liked) {
    const version = await getVersion(versionId, userId);
    if (!version || version.status !== 'public') return null;
    if (version.ownerUserId === userId) throw new Error('Creators cannot like their own cover');
    if (liked) {
      await database().execute(
        'INSERT IGNORE INTO cover_likes (version_id, user_id) VALUES (:versionId, :userId)',
        { versionId, userId }
      );
    } else {
      await database().execute(
        'DELETE FROM cover_likes WHERE version_id = :versionId AND user_id = :userId',
        { versionId, userId }
      );
    }
    return getVersion(versionId, userId);
  }

  async function setCollection(versionId, userId, collected) {
    const version = await getVersion(versionId, userId);
    if (!version || version.status !== 'public') return null;
    if (collected) {
      await database().execute(
        'INSERT IGNORE INTO cover_collections (version_id, user_id) VALUES (:versionId, :userId)',
        { versionId, userId }
      );
    } else {
      await database().execute(
        'DELETE FROM cover_collections WHERE version_id = :versionId AND user_id = :userId',
        { versionId, userId }
      );
    }
    return getVersion(versionId, userId);
  }

  async function createReport({ versionId, reporterUserId, reason }) {
    const version = await getVersion(versionId, reporterUserId);
    if (!version || version.status !== 'public' || version.ownerUserId === reporterUserId) return null;
    await database().execute(
      `INSERT INTO cover_reports (id, version_id, reporter_user_id, reason)
       VALUES (:id, :versionId, :reporterUserId, :reason)
       ON DUPLICATE KEY UPDATE reason = VALUES(reason), status = 'open', updated_at = CURRENT_TIMESTAMP`,
      { id: crypto.randomUUID(), versionId, reporterUserId, reason }
    );
    return { versionId, reporterUserId, reason, status: 'open' };
  }

  return {
    createVersion,
    getVersion,
    listHistory,
    listCommunityVersions,
    setVersionStatus,
    getCurrentCover,
    setCurrentCover,
    clearCurrentCover,
    setLike,
    setCollection,
    createReport
  };
}

export const coverStore = createCoverStore();

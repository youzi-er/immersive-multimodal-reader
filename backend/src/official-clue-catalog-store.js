import crypto from 'node:crypto';
import { getPool } from './db.js';
import { ensureCommunitySchema } from './community-schema.js';

function jsonValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  return JSON.parse(value);
}

function mapCatalog(row) {
  if (!row) return null;
  return {
    articleId: row.article_id,
    sourceSha256: row.source_sha256,
    draft: jsonValue(row.draft_json),
    published: jsonValue(row.published_json),
    draftRevision: Number(row.draft_revision),
    publishedRevision: Number(row.published_revision),
    draftUpdatedBy: row.draft_updated_by,
    publishedBy: row.published_by || null,
    draftUpdatedAt: row.draft_updated_at,
    publishedAt: row.published_at
  };
}

export function createOfficialClueCatalogStore({ database = getPool } = {}) {
  let readyPromise;
  const ready = () => {
    readyPromise ||= Promise.resolve().then(() => ensureCommunitySchema());
    return readyPromise;
  };

  async function getCatalog(articleId) {
    await ready();
    const [rows] = await database().execute(
      'SELECT * FROM official_clue_catalogs WHERE article_id = :articleId LIMIT 1',
      { articleId }
    );
    return mapCatalog(rows[0]);
  }

  async function ensureDraft({ articleId, sourceSha256, draft, userId }) {
    await ready();
    await database().execute(
      `INSERT INTO official_clue_catalogs (
        article_id, source_sha256, draft_json, draft_updated_by
      ) VALUES (:articleId, :sourceSha256, :draftJson, :userId)
      ON DUPLICATE KEY UPDATE article_id = article_id`,
      { articleId, sourceSha256, draftJson: JSON.stringify(draft), userId }
    );
    return getCatalog(articleId);
  }

  async function saveDraft({ articleId, sourceSha256, draft, userId }) {
    await ready();
    const [result] = await database().execute(
      `UPDATE official_clue_catalogs
       SET source_sha256 = :sourceSha256,
           draft_json = :draftJson,
           draft_revision = draft_revision + 1,
           draft_updated_by = :userId,
           draft_updated_at = CURRENT_TIMESTAMP
       WHERE article_id = :articleId`,
      { articleId, sourceSha256, draftJson: JSON.stringify(draft), userId }
    );
    if (result.affectedRows === 0) {
      return ensureDraft({ articleId, sourceSha256, draft, userId });
    }
    return getCatalog(articleId);
  }

  async function publish({ articleId, sourceSha256, draft, published, userId }) {
    await ready();
    const connection = await database().getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        'SELECT published_revision FROM official_clue_catalogs WHERE article_id = :articleId FOR UPDATE',
        { articleId }
      );
      const revision = Number(rows[0]?.published_revision || 0) + 1;
      if (rows.length === 0) {
        await connection.execute(
          `INSERT INTO official_clue_catalogs (
            article_id, source_sha256, draft_json, published_json,
            draft_revision, published_revision, draft_updated_by, published_by, published_at
          ) VALUES (
            :articleId, :sourceSha256, :draftJson, :publishedJson,
            1, :revision, :userId, :userId, CURRENT_TIMESTAMP
          )`,
          {
            articleId,
            sourceSha256,
            draftJson: JSON.stringify(draft),
            publishedJson: JSON.stringify(published),
            revision,
            userId
          }
        );
      } else {
        await connection.execute(
          `UPDATE official_clue_catalogs
           SET source_sha256 = :sourceSha256,
               draft_json = :draftJson,
               published_json = :publishedJson,
               draft_revision = draft_revision + 1,
               published_revision = :revision,
               draft_updated_by = :userId,
               published_by = :userId,
               draft_updated_at = CURRENT_TIMESTAMP,
               published_at = CURRENT_TIMESTAMP
           WHERE article_id = :articleId`,
          {
            articleId,
            sourceSha256,
            draftJson: JSON.stringify(draft),
            publishedJson: JSON.stringify(published),
            revision,
            userId
          }
        );
      }
      await connection.execute(
        `INSERT INTO official_clue_catalog_versions (
          id, article_id, revision, source_sha256, catalog_json, published_by
        ) VALUES (:id, :articleId, :revision, :sourceSha256, :catalogJson, :userId)`,
        {
          id: crypto.randomUUID(),
          articleId,
          revision,
          sourceSha256,
          catalogJson: JSON.stringify(published),
          userId
        }
      );
      await connection.commit();
      return getCatalog(articleId);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  return { getCatalog, ensureDraft, saveDraft, publish };
}

export const officialClueCatalogStore = createOfficialClueCatalogStore();

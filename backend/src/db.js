import mysql from 'mysql2/promise';

let pool;
let schemaReady = false;

function requireConfig(name, fallback) {
  const value = process.env[name] || fallback;

  if (!value) {
    throw new Error(`${name} is not configured`);
  }

  return value;
}

export function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: requireConfig('MYSQL_HOST', '127.0.0.1'),
      port: Number(process.env.MYSQL_PORT || 3306),
      user: requireConfig('MYSQL_USER'),
      password: process.env.MYSQL_PASSWORD || '',
      database: requireConfig('MYSQL_DATABASE'),
      waitForConnections: true,
      connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
      namedPlaceholders: true,
      charset: 'utf8mb4'
    });
  }

  return pool;
}

export async function ensureSchema() {
  if (schemaReady) {
    return;
  }

  await getPool().execute(`
    CREATE TABLE IF NOT EXISTS media_assets (
      id VARCHAR(64) PRIMARY KEY,
      article_id VARCHAR(128) NOT NULL,
      chapter_id VARCHAR(128) NULL,
      paragraph_index INT NULL,
      segment_index INT NULL,
      media_type ENUM('image', 'audio') NOT NULL,
      url VARCHAR(1024) NOT NULL,
      file_path VARCHAR(1024) NOT NULL,
      prompt TEXT NULL,
      source_text TEXT NULL,
      provider VARCHAR(64) NOT NULL DEFAULT 'minimax',
      model VARCHAR(128) NULL,
      user_id VARCHAR(128) NOT NULL,
      metadata_json JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_media_assets_position (article_id, chapter_id, paragraph_index, segment_index),
      INDEX idx_media_assets_user (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  schemaReady = true;
}

function toCamelAsset(row) {
  if (!row) {
    return null;
  }

  const metadata =
    typeof row.metadata_json === 'string'
      ? JSON.parse(row.metadata_json)
      : row.metadata_json || null;

  return {
    id: row.id,
    articleId: row.article_id,
    chapterId: row.chapter_id,
    paragraphIndex: row.paragraph_index,
    segmentIndex: row.segment_index,
    mediaType: row.media_type,
    url: row.url,
    filePath: row.file_path,
    prompt: row.prompt,
    sourceText: row.source_text,
    provider: row.provider,
    model: row.model,
    userId: row.user_id,
    metadata,
    createdAt: row.created_at
  };
}

export async function createMediaAsset(asset) {
  await ensureSchema();

  await getPool().execute(
    `
      INSERT INTO media_assets (
        id,
        article_id,
        chapter_id,
        paragraph_index,
        segment_index,
        media_type,
        url,
        file_path,
        prompt,
        source_text,
        provider,
        model,
        user_id,
        metadata_json
      )
      VALUES (
        :id,
        :articleId,
        :chapterId,
        :paragraphIndex,
        :segmentIndex,
        :mediaType,
        :url,
        :filePath,
        :prompt,
        :sourceText,
        :provider,
        :model,
        :userId,
        :metadataJson
      )
    `,
    {
      id: asset.id,
      articleId: asset.articleId,
      chapterId: asset.chapterId ?? null,
      paragraphIndex: Number.isInteger(asset.paragraphIndex) ? asset.paragraphIndex : null,
      segmentIndex: Number.isInteger(asset.segmentIndex) ? asset.segmentIndex : null,
      mediaType: asset.mediaType,
      url: asset.url,
      filePath: asset.filePath,
      prompt: asset.prompt ?? null,
      sourceText: asset.sourceText ?? null,
      provider: asset.provider ?? 'minimax',
      model: asset.model ?? null,
      userId: asset.userId,
      metadataJson: asset.metadata ? JSON.stringify(asset.metadata) : null
    }
  );

  return getMediaAsset(asset.id);
}

export async function listMediaAssets({ articleId, chapterId, mediaType }) {
  await ensureSchema();

  const where = [];
  const params = {};

  if (articleId) {
    where.push('article_id = :articleId');
    params.articleId = articleId;
  }

  if (chapterId) {
    where.push('chapter_id = :chapterId');
    params.chapterId = chapterId;
  }

  if (mediaType) {
    where.push('media_type = :mediaType');
    params.mediaType = mediaType;
  }

  const [rows] = await getPool().execute(
    `
      SELECT *
      FROM media_assets
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC
    `,
    params
  );

  return rows.map(toCamelAsset);
}

export async function getMediaAsset(id) {
  await ensureSchema();

  const [rows] = await getPool().execute('SELECT * FROM media_assets WHERE id = :id LIMIT 1', { id });
  return toCamelAsset(rows[0]);
}

export async function deleteMediaAsset(id) {
  await ensureSchema();

  const asset = await getMediaAsset(id);
  if (!asset) {
    return null;
  }

  await getPool().execute('DELETE FROM media_assets WHERE id = :id', { id });
  return asset;
}

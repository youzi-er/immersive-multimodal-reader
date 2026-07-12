import mysql from 'mysql2/promise';

let pool;
let schemaReady = false;

function readConfig(name, fallback = '') {
  const value = process.env[name] ?? fallback;
  return String(value);
}

function requireConfig(name, fallback = '') {
  const value = readConfig(name, fallback).trim();
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
      password: readConfig('MYSQL_PASSWORD'),
      database: requireConfig('MYSQL_DATABASE', 'immersive_reader'),
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
      range_start_paragraph_index INT NULL,
      range_start_offset INT NULL,
      range_end_paragraph_index INT NULL,
      range_end_offset INT NULL,
      media_type ENUM('image', 'audio') NOT NULL,
      url VARCHAR(2048) NOT NULL,
      source_url VARCHAR(2048) NULL,
      file_path VARCHAR(1024) NULL,
      prompt MEDIUMTEXT NULL,
      source_text MEDIUMTEXT NULL,
      provider VARCHAR(64) NOT NULL DEFAULT 'minimax',
      model VARCHAR(128) NULL,
      user_id VARCHAR(128) NOT NULL,
      metadata_json JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_media_assets_position (
        article_id,
        chapter_id,
        paragraph_index,
        range_start_paragraph_index,
        range_start_offset
      ),
      INDEX idx_media_assets_user (user_id, created_at),
      INDEX idx_media_assets_type (media_type, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  schemaReady = true;
}

function parseMetadata(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return JSON.parse(value);
  }

  return value;
}

function toCamelAsset(row) {
  if (!row) {
    return null;
  }

  const range =
    row.range_start_paragraph_index === null ||
    row.range_start_offset === null ||
    row.range_end_paragraph_index === null ||
    row.range_end_offset === null
      ? null
      : {
          startParagraphIndex: row.range_start_paragraph_index,
          startOffset: row.range_start_offset,
          endParagraphIndex: row.range_end_paragraph_index,
          endOffset: row.range_end_offset
        };

  return {
    id: row.id,
    articleId: row.article_id,
    chapterId: row.chapter_id,
    paragraphIndex: row.paragraph_index,
    mediaType: row.media_type,
    url: row.url,
    sourceUrl: row.source_url,
    filePath: row.file_path,
    prompt: row.prompt,
    sourceText: row.source_text,
    provider: row.provider,
    model: row.model,
    userId: row.user_id,
    range,
    metadata: parseMetadata(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeRange(range) {
  if (!range || typeof range !== 'object') {
    return {
      startParagraphIndex: null,
      startOffset: null,
      endParagraphIndex: null,
      endOffset: null
    };
  }

  return {
    startParagraphIndex: Number.isInteger(range.startParagraphIndex) ? range.startParagraphIndex : null,
    startOffset: Number.isInteger(range.startOffset) ? range.startOffset : null,
    endParagraphIndex: Number.isInteger(range.endParagraphIndex) ? range.endParagraphIndex : null,
    endOffset: Number.isInteger(range.endOffset) ? range.endOffset : null
  };
}

export async function createMediaAsset(asset) {
  await ensureSchema();

  const range = normalizeRange(asset.range);
  const metadataJson = asset.metadata ? JSON.stringify(asset.metadata) : null;

  await getPool().execute(
    `
      INSERT INTO media_assets (
        id,
        article_id,
        chapter_id,
        paragraph_index,
        range_start_paragraph_index,
        range_start_offset,
        range_end_paragraph_index,
        range_end_offset,
        media_type,
        url,
        source_url,
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
        :startParagraphIndex,
        :startOffset,
        :endParagraphIndex,
        :endOffset,
        :mediaType,
        :url,
        :sourceUrl,
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
      startParagraphIndex: range.startParagraphIndex,
      startOffset: range.startOffset,
      endParagraphIndex: range.endParagraphIndex,
      endOffset: range.endOffset,
      mediaType: asset.mediaType,
      url: asset.url,
      sourceUrl: asset.sourceUrl ?? null,
      filePath: asset.filePath ?? null,
      prompt: asset.prompt ?? null,
      sourceText: asset.sourceText ?? null,
      provider: asset.provider ?? 'minimax',
      model: asset.model ?? null,
      userId: asset.userId,
      metadataJson
    }
  );

  return getMediaAsset(asset.id);
}

export async function listMediaAssets({ articleId, chapterId, mediaType, userId } = {}) {
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

  if (userId) {
    where.push('user_id = :userId');
    params.userId = userId;
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

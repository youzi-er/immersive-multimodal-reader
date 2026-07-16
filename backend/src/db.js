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
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(64) PRIMARY KEY,
      username VARCHAR(64) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      password_salt VARCHAR(64) NOT NULL,
      display_name VARCHAR(128) NOT NULL,
      bio VARCHAR(512) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

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

  await getPool().execute(`
    CREATE TABLE IF NOT EXISTS voice_recordings (
      id VARCHAR(64) PRIMARY KEY,
      media_asset_id VARCHAR(64) NOT NULL,
      article_id VARCHAR(128) NOT NULL,
      chapter_id VARCHAR(128) NOT NULL,
      paragraph_index INT NOT NULL,
      range_start_paragraph_index INT NOT NULL,
      range_start_offset INT NOT NULL,
      range_end_paragraph_index INT NOT NULL,
      range_end_offset INT NOT NULL,
      source_text MEDIUMTEXT NOT NULL,
      user_id VARCHAR(64) NOT NULL,
      visibility ENUM('private', 'public') NOT NULL DEFAULT 'private',
      deleted_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_voice_recordings_position (
        article_id,
        chapter_id,
        range_start_paragraph_index,
        range_start_offset,
        range_end_paragraph_index,
        range_end_offset,
        visibility,
        deleted_at,
        created_at
      ),
      INDEX idx_voice_recordings_user (user_id, created_at),
      INDEX idx_voice_recordings_asset (media_asset_id),
      CONSTRAINT fk_voice_recordings_asset
        FOREIGN KEY (media_asset_id) REFERENCES media_assets(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await getPool().execute(`
    CREATE TABLE IF NOT EXISTS voice_recording_likes (
      recording_id VARCHAR(64) NOT NULL,
      user_id VARCHAR(64) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (recording_id, user_id),
      INDEX idx_voice_recording_likes_user (user_id, created_at),
      CONSTRAINT fk_voice_recording_likes_recording
        FOREIGN KEY (recording_id) REFERENCES voice_recordings(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await getPool().execute(`
    CREATE TABLE IF NOT EXISTS paragraph_comments (
      id VARCHAR(64) PRIMARY KEY,
      article_id VARCHAR(128) NOT NULL,
      chapter_id VARCHAR(128) NOT NULL,
      paragraph_index INT NOT NULL,
      user_id VARCHAR(64) NOT NULL,
      content VARCHAR(1000) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_paragraph_comments_position (article_id, chapter_id, paragraph_index, created_at),
      INDEX idx_paragraph_comments_user (user_id, created_at),
      CONSTRAINT fk_paragraph_comments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  schemaReady = true;
}

function toCamelUser(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    passwordSalt: row.password_salt,
    displayName: row.display_name,
    bio: row.bio,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
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

export async function createUser(user) {
  await ensureSchema();

  await getPool().execute(
    `
      INSERT INTO users (id, username, password_hash, password_salt, display_name, bio)
      VALUES (:id, :username, :passwordHash, :passwordSalt, :displayName, :bio)
    `,
    {
      id: user.id,
      username: user.username,
      passwordHash: user.passwordHash,
      passwordSalt: user.passwordSalt,
      displayName: user.displayName,
      bio: user.bio ?? null
    }
  );

  return getUserById(user.id);
}

export async function getUserById(id) {
  await ensureSchema();

  const [rows] = await getPool().execute('SELECT * FROM users WHERE id = :id LIMIT 1', { id });
  return toCamelUser(rows[0]);
}

export async function getUserByUsername(username) {
  await ensureSchema();

  const [rows] = await getPool().execute('SELECT * FROM users WHERE username = :username LIMIT 1', { username });
  return toCamelUser(rows[0]);
}

export async function ensureUser(user) {
  await ensureSchema();

  const existing = await getUserByUsername(user.username);
  if (existing) {
    return existing;
  }

  return createUser(user);
}

function recordingRangeParams(recording) {
  const range = normalizeRange(recording.range);

  if (
    range.startParagraphIndex === null ||
    range.startOffset === null ||
    range.endParagraphIndex === null ||
    range.endOffset === null
  ) {
    throw new Error('Voice recording range is required');
  }

  return range;
}

function toCamelVoiceRecording(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.recording_id,
    mediaAssetId: row.media_asset_id,
    articleId: row.article_id,
    chapterId: row.chapter_id,
    paragraphIndex: row.paragraph_index,
    range: {
      startParagraphIndex: row.range_start_paragraph_index,
      startOffset: row.range_start_offset,
      endParagraphIndex: row.range_end_paragraph_index,
      endOffset: row.range_end_offset
    },
    sourceText: row.source_text,
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    visibility: row.visibility,
    audioUrl: row.url,
    mediaAsset: toCamelAsset(row),
    likeCount: Number(row.like_count || 0),
    likedByMe: Boolean(row.liked_by_me),
    createdAt: row.recording_created_at,
    updatedAt: row.recording_updated_at
  };
}

const voiceRecordingSelect = `
  vr.id AS recording_id,
  vr.media_asset_id,
  vr.article_id,
  vr.chapter_id,
  vr.paragraph_index,
  vr.range_start_paragraph_index,
  vr.range_start_offset,
  vr.range_end_paragraph_index,
  vr.range_end_offset,
  vr.source_text,
  vr.user_id,
  vr.visibility,
  vr.created_at AS recording_created_at,
  vr.updated_at AS recording_updated_at,
  ma.id,
  ma.media_type,
  ma.url,
  ma.source_url,
  ma.file_path,
  ma.prompt,
  ma.provider,
  ma.model,
  ma.metadata_json,
  ma.created_at,
  ma.updated_at,
  u.username,
  u.display_name,
  COALESCE(likes.like_count, 0) AS like_count,
  CASE WHEN my_like.user_id IS NULL THEN 0 ELSE 1 END AS liked_by_me
`;

export async function createVoiceRecording(recording) {
  await ensureSchema();

  const range = recordingRangeParams(recording);
  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();
    await connection.execute(
      `
        UPDATE voice_recordings
        SET deleted_at = CURRENT_TIMESTAMP
        WHERE user_id = :userId
          AND article_id = :articleId
          AND chapter_id = :chapterId
          AND range_start_paragraph_index = :startParagraphIndex
          AND range_start_offset = :startOffset
          AND range_end_paragraph_index = :endParagraphIndex
          AND range_end_offset = :endOffset
          AND deleted_at IS NULL
      `,
      {
        userId: recording.userId,
        articleId: recording.articleId,
        chapterId: recording.chapterId,
        startParagraphIndex: range.startParagraphIndex,
        startOffset: range.startOffset,
        endParagraphIndex: range.endParagraphIndex,
        endOffset: range.endOffset
      }
    );

    await connection.execute(
      `
        INSERT INTO voice_recordings (
          id,
          media_asset_id,
          article_id,
          chapter_id,
          paragraph_index,
          range_start_paragraph_index,
          range_start_offset,
          range_end_paragraph_index,
          range_end_offset,
          source_text,
          user_id,
          visibility
        )
        VALUES (
          :id,
          :mediaAssetId,
          :articleId,
          :chapterId,
          :paragraphIndex,
          :startParagraphIndex,
          :startOffset,
          :endParagraphIndex,
          :endOffset,
          :sourceText,
          :userId,
          :visibility
        )
      `,
      {
        id: recording.id,
        mediaAssetId: recording.mediaAssetId,
        articleId: recording.articleId,
        chapterId: recording.chapterId,
        paragraphIndex: recording.paragraphIndex,
        startParagraphIndex: range.startParagraphIndex,
        startOffset: range.startOffset,
        endParagraphIndex: range.endParagraphIndex,
        endOffset: range.endOffset,
        sourceText: recording.sourceText,
        userId: recording.userId,
        visibility: recording.visibility || 'private'
      }
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return getVoiceRecording(recording.id, recording.userId);
}

export async function getVoiceRecording(id, currentUserId = null) {
  await ensureSchema();

  const [rows] = await getPool().execute(
    `
      SELECT
        ${voiceRecordingSelect}
      FROM voice_recordings vr
      JOIN media_assets ma ON ma.id = vr.media_asset_id
      JOIN users u ON u.id = vr.user_id
      LEFT JOIN (
        SELECT recording_id, COUNT(*) AS like_count
        FROM voice_recording_likes
        GROUP BY recording_id
      ) likes ON likes.recording_id = vr.id
      LEFT JOIN voice_recording_likes my_like
        ON my_like.recording_id = vr.id AND my_like.user_id = :currentUserId
      WHERE vr.id = :id
      LIMIT 1
    `,
    { id, currentUserId }
  );

  return toCamelVoiceRecording(rows[0]);
}

export async function listVoiceRecordings({ articleId, chapterId, range, currentUserId }) {
  await ensureSchema();

  const normalizedRange = recordingRangeParams({ range });
  const [rows] = await getPool().execute(
    `
      SELECT
        ${voiceRecordingSelect}
      FROM voice_recordings vr
      JOIN media_assets ma ON ma.id = vr.media_asset_id
      JOIN users u ON u.id = vr.user_id
      LEFT JOIN (
        SELECT recording_id, COUNT(*) AS like_count
        FROM voice_recording_likes
        GROUP BY recording_id
      ) likes ON likes.recording_id = vr.id
      LEFT JOIN voice_recording_likes my_like
        ON my_like.recording_id = vr.id AND my_like.user_id = :currentUserId
      WHERE vr.article_id = :articleId
        AND vr.chapter_id = :chapterId
        AND vr.range_start_paragraph_index = :startParagraphIndex
        AND vr.range_start_offset = :startOffset
        AND vr.range_end_paragraph_index = :endParagraphIndex
        AND vr.range_end_offset = :endOffset
        AND vr.deleted_at IS NULL
        AND (vr.visibility = 'public' OR vr.user_id = :currentUserId)
      ORDER BY
        CASE WHEN vr.user_id = :currentUserId THEN 0 ELSE 1 END,
        like_count DESC,
        vr.created_at DESC
    `,
    {
      articleId,
      chapterId,
      currentUserId,
      startParagraphIndex: normalizedRange.startParagraphIndex,
      startOffset: normalizedRange.startOffset,
      endParagraphIndex: normalizedRange.endParagraphIndex,
      endOffset: normalizedRange.endOffset
    }
  );

  return rows.map(toCamelVoiceRecording);
}

export async function updateVoiceRecordingVisibility(id, userId, visibility) {
  await ensureSchema();

  await getPool().execute(
    `
      UPDATE voice_recordings
      SET visibility = :visibility
      WHERE id = :id AND user_id = :userId AND deleted_at IS NULL
    `,
    { id, userId, visibility }
  );

  return getVoiceRecording(id, userId);
}

export async function deleteVoiceRecording(id, userId) {
  await ensureSchema();

  const recording = await getVoiceRecording(id, userId);
  if (!recording || recording.userId !== userId) {
    return null;
  }

  await getPool().execute(
    `
      UPDATE voice_recordings
      SET deleted_at = CURRENT_TIMESTAMP
      WHERE id = :id AND user_id = :userId
    `,
    { id, userId }
  );

  return recording;
}

export async function setVoiceRecordingLike(id, userId, liked) {
  await ensureSchema();

  if (liked) {
    await getPool().execute(
      `
        INSERT IGNORE INTO voice_recording_likes (recording_id, user_id)
        VALUES (:id, :userId)
      `,
      { id, userId }
    );
  } else {
    await getPool().execute(
      `
        DELETE FROM voice_recording_likes
        WHERE recording_id = :id AND user_id = :userId
      `,
      { id, userId }
    );
  }

  return getVoiceRecording(id, userId);
}

function toCamelParagraphComment(row) {
  return {
    id: row.id, articleId: row.article_id, chapterId: row.chapter_id,
    paragraphIndex: row.paragraph_index, userId: row.user_id,
    username: row.username, displayName: row.display_name, content: row.content,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

export async function listParagraphComments({ articleId, chapterId }) {
  await ensureSchema();
  const [rows] = await getPool().execute(
    `SELECT pc.*, u.username, u.display_name FROM paragraph_comments pc
     JOIN users u ON u.id = pc.user_id
     WHERE pc.article_id = :articleId AND pc.chapter_id = :chapterId
     ORDER BY pc.paragraph_index ASC, pc.created_at ASC`,
    { articleId, chapterId }
  );
  return rows.map(toCamelParagraphComment);
}

export async function createParagraphComment(comment) {
  await ensureSchema();
  await getPool().execute(
    `INSERT INTO paragraph_comments (id, article_id, chapter_id, paragraph_index, user_id, content)
     VALUES (:id, :articleId, :chapterId, :paragraphIndex, :userId, :content)`,
    comment
  );
  const [rows] = await getPool().execute(
    `SELECT pc.*, u.username, u.display_name FROM paragraph_comments pc
     JOIN users u ON u.id = pc.user_id WHERE pc.id = :id LIMIT 1`,
    { id: comment.id }
  );
  return toCamelParagraphComment(rows[0]);
}

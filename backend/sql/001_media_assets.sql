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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  password_salt VARCHAR(64) NOT NULL,
  display_name VARCHAR(128) NOT NULL,
  bio VARCHAR(512) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS voice_recording_likes (
  recording_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (recording_id, user_id),
  INDEX idx_voice_recording_likes_user (user_id, created_at),
  CONSTRAINT fk_voice_recording_likes_recording
    FOREIGN KEY (recording_id) REFERENCES voice_recordings(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

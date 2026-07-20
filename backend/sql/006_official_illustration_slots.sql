CREATE TABLE IF NOT EXISTS official_illustration_slots (
  id VARCHAR(64) PRIMARY KEY,
  unit_id VARCHAR(128) NOT NULL,
  article_id VARCHAR(128) NOT NULL,
  chapter_id VARCHAR(128) NOT NULL,
  paragraph_index INT NOT NULL,
  image_url VARCHAR(2048) NOT NULL,
  media_asset_id VARCHAR(64) NULL,
  prompt_excerpt MEDIUMTEXT NOT NULL,
  source_text MEDIUMTEXT NOT NULL,
  source_hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_official_illustration_slot_unit (unit_id),
  UNIQUE KEY uq_official_illustration_slot_position (article_id, chapter_id, paragraph_index),
  INDEX idx_official_illustration_slots_chapter (article_id, chapter_id, paragraph_index)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS official_clue_catalogs (
  article_id VARCHAR(128) PRIMARY KEY,
  source_sha256 VARCHAR(64) NOT NULL,
  draft_json JSON NOT NULL,
  published_json JSON NULL,
  draft_revision INT NOT NULL DEFAULT 1,
  published_revision INT NOT NULL DEFAULT 0,
  draft_updated_by VARCHAR(64) NOT NULL,
  published_by VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  draft_updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  published_at TIMESTAMP NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS official_clue_catalog_versions (
  id VARCHAR(64) PRIMARY KEY,
  article_id VARCHAR(128) NOT NULL,
  revision INT NOT NULL,
  source_sha256 VARCHAR(64) NOT NULL,
  catalog_json JSON NOT NULL,
  published_by VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_official_clue_catalog_revision (article_id, revision),
  INDEX idx_official_clue_catalog_versions_article (article_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

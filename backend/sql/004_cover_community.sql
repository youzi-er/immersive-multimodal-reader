CREATE TABLE IF NOT EXISTS cover_projects (
  id VARCHAR(64) PRIMARY KEY,
  owner_user_id VARCHAR(64) NOT NULL,
  article_id VARCHAR(128) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cover_project_owner_article (owner_user_id, article_id),
  CONSTRAINT fk_cover_project_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cover_versions (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  version_number INT UNSIGNED NOT NULL,
  owner_user_id VARCHAR(64) NOT NULL,
  article_id VARCHAR(128) NOT NULL,
  status ENUM('private', 'public', 'withdrawn', 'moderated', 'deleted') NOT NULL DEFAULT 'private',
  image_url VARCHAR(2048) NOT NULL,
  media_asset_id VARCHAR(64) NULL,
  mode ENUM('guided', 'advanced') NOT NULL,
  prompt MEDIUMTEXT NOT NULL,
  final_prompt MEDIUMTEXT NOT NULL,
  mood VARCHAR(64) NULL,
  palette VARCHAR(64) NULL,
  composition VARCHAR(64) NULL,
  parameters_json JSON NULL,
  book_title VARCHAR(255) NOT NULL,
  book_author VARCHAR(255) NOT NULL,
  book_subtitle VARCHAR(255) NULL,
  remixed_from_version_id VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  withdrawn_at TIMESTAMP NULL,
  moderated_at TIMESTAMP NULL,
  UNIQUE KEY uq_cover_project_version (project_id, version_number),
  INDEX idx_cover_versions_article_status (article_id, status, created_at),
  INDEX idx_cover_versions_owner (owner_user_id, created_at),
  INDEX idx_cover_versions_remix (remixed_from_version_id, created_at),
  CONSTRAINT fk_cover_version_project FOREIGN KEY (project_id) REFERENCES cover_projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_cover_version_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_cover_version_remix FOREIGN KEY (remixed_from_version_id) REFERENCES cover_versions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cover_likes (
  version_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (version_id, user_id),
  INDEX idx_cover_likes_user (user_id, created_at),
  CONSTRAINT fk_cover_like_version FOREIGN KEY (version_id) REFERENCES cover_versions(id) ON DELETE CASCADE,
  CONSTRAINT fk_cover_like_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cover_collections (
  version_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (version_id, user_id),
  INDEX idx_cover_collections_user (user_id, created_at),
  CONSTRAINT fk_cover_collection_version FOREIGN KEY (version_id) REFERENCES cover_versions(id) ON DELETE CASCADE,
  CONSTRAINT fk_cover_collection_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS active_book_covers (
  user_id VARCHAR(64) NOT NULL,
  article_id VARCHAR(128) NOT NULL,
  version_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, article_id),
  INDEX idx_active_book_covers_version (version_id, updated_at),
  CONSTRAINT fk_active_cover_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_active_cover_version FOREIGN KEY (version_id) REFERENCES cover_versions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cover_reports (
  id VARCHAR(64) PRIMARY KEY,
  version_id VARCHAR(64) NOT NULL,
  reporter_user_id VARCHAR(64) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  status ENUM('open', 'resolved', 'dismissed') NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cover_reporter_version (version_id, reporter_user_id),
  INDEX idx_cover_reports_status (status, created_at),
  CONSTRAINT fk_cover_report_version FOREIGN KEY (version_id) REFERENCES cover_versions(id) ON DELETE CASCADE,
  CONSTRAINT fk_cover_report_user FOREIGN KEY (reporter_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

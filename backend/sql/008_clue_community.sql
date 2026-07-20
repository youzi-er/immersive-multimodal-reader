CREATE TABLE IF NOT EXISTS clue_image_projects (
  id VARCHAR(64) PRIMARY KEY,
  owner_user_id VARCHAR(64) NOT NULL,
  article_id VARCHAR(128) NOT NULL,
  clue_id VARCHAR(128) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_clue_image_project_owner_clue (owner_user_id, clue_id),
  INDEX idx_clue_image_project_article (article_id, clue_id),
  CONSTRAINT fk_clue_image_project_owner
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS clue_image_versions (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  version_number INT UNSIGNED NOT NULL,
  owner_user_id VARCHAR(64) NOT NULL,
  article_id VARCHAR(128) NOT NULL,
  clue_id VARCHAR(128) NOT NULL,
  occurrence_id VARCHAR(128) NOT NULL,
  chapter_id VARCHAR(128) NOT NULL,
  paragraph_index INT NOT NULL,
  clue_label VARCHAR(255) NOT NULL,
  clue_type VARCHAR(32) NOT NULL,
  status ENUM('private', 'public', 'withdrawn', 'moderated', 'deleted') NOT NULL DEFAULT 'private',
  image_url VARCHAR(2048) NOT NULL,
  media_asset_id VARCHAR(64) NULL,
  final_prompt MEDIUMTEXT NOT NULL,
  aspect_ratio VARCHAR(16) NOT NULL,
  model VARCHAR(128) NULL,
  source_text MEDIUMTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  withdrawn_at TIMESTAMP NULL,
  moderated_at TIMESTAMP NULL,
  UNIQUE KEY uq_clue_image_project_version (project_id, version_number),
  INDEX idx_clue_image_versions_clue_status (clue_id, status, created_at),
  INDEX idx_clue_image_versions_position (article_id, chapter_id, paragraph_index),
  INDEX idx_clue_image_versions_article_status (article_id, status, created_at),
  INDEX idx_clue_image_versions_owner (owner_user_id, created_at),
  CONSTRAINT fk_clue_image_version_project
    FOREIGN KEY (project_id) REFERENCES clue_image_projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_clue_image_version_owner
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS clue_image_adoptions (
  user_id VARCHAR(64) NOT NULL,
  clue_id VARCHAR(128) NOT NULL,
  version_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, clue_id),
  INDEX idx_clue_image_adoptions_version (version_id, updated_at),
  CONSTRAINT fk_clue_image_adoption_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_clue_image_adoption_version
    FOREIGN KEY (version_id) REFERENCES clue_image_versions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS clue_image_likes (
  version_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (version_id, user_id),
  INDEX idx_clue_image_likes_user (user_id, created_at),
  CONSTRAINT fk_clue_image_like_version
    FOREIGN KEY (version_id) REFERENCES clue_image_versions(id) ON DELETE CASCADE,
  CONSTRAINT fk_clue_image_like_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS clue_image_reports (
  id VARCHAR(64) PRIMARY KEY,
  version_id VARCHAR(64) NOT NULL,
  reporter_user_id VARCHAR(64) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  status ENUM('open', 'resolved', 'dismissed') NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_clue_image_reporter_version (version_id, reporter_user_id),
  INDEX idx_clue_image_reports_status (status, created_at),
  CONSTRAINT fk_clue_image_report_version
    FOREIGN KEY (version_id) REFERENCES clue_image_versions(id) ON DELETE CASCADE,
  CONSTRAINT fk_clue_image_report_user
    FOREIGN KEY (reporter_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

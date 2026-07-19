CREATE TABLE IF NOT EXISTS illustration_style_versions (
  id VARCHAR(64) PRIMARY KEY,
  article_id VARCHAR(128) NOT NULL,
  version_number INT UNSIGNED NOT NULL,
  name VARCHAR(128) NOT NULL,
  global_style_prompt MEDIUMTEXT NOT NULL,
  global_negative_prompt MEDIUMTEXT NULL,
  style_profile_json JSON NULL,
  usage_notes MEDIUMTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_illustration_style_article_version (article_id, version_number),
  INDEX idx_illustration_style_article (article_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS active_illustration_styles (
  article_id VARCHAR(128) PRIMARY KEY,
  style_version_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_active_illustration_style_version (style_version_id),
  CONSTRAINT fk_active_illustration_style_version
    FOREIGN KEY (style_version_id) REFERENCES illustration_style_versions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS illustration_projects (
  id VARCHAR(64) PRIMARY KEY,
  owner_user_id VARCHAR(64) NOT NULL,
  unit_id VARCHAR(128) NOT NULL,
  article_id VARCHAR(128) NOT NULL,
  chapter_id VARCHAR(128) NOT NULL,
  paragraph_index INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_illustration_project_owner_unit (owner_user_id, unit_id),
  INDEX idx_illustration_project_position (article_id, chapter_id, paragraph_index),
  CONSTRAINT fk_illustration_project_owner
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS illustration_versions (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  version_number INT UNSIGNED NOT NULL,
  owner_user_id VARCHAR(64) NOT NULL,
  unit_id VARCHAR(128) NOT NULL,
  article_id VARCHAR(128) NOT NULL,
  chapter_id VARCHAR(128) NOT NULL,
  paragraph_index INT NOT NULL,
  status ENUM('private', 'public', 'withdrawn', 'moderated', 'deleted') NOT NULL DEFAULT 'private',
  image_url VARCHAR(2048) NOT NULL,
  media_asset_id VARCHAR(64) NULL,
  prompt_mode ENUM('official', 'free') NOT NULL,
  final_prompt MEDIUMTEXT NOT NULL,
  style_version_id VARCHAR(64) NULL,
  aspect_ratio VARCHAR(16) NOT NULL DEFAULT '16:9',
  model VARCHAR(128) NULL,
  source_text MEDIUMTEXT NOT NULL,
  source_hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  withdrawn_at TIMESTAMP NULL,
  moderated_at TIMESTAMP NULL,
  UNIQUE KEY uq_illustration_project_version (project_id, version_number),
  INDEX idx_illustration_versions_unit_status (unit_id, status, created_at),
  INDEX idx_illustration_versions_article_status (article_id, status, created_at),
  INDEX idx_illustration_versions_owner (owner_user_id, created_at),
  CONSTRAINT fk_illustration_version_project
    FOREIGN KEY (project_id) REFERENCES illustration_projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_illustration_version_owner
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_illustration_version_style
    FOREIGN KEY (style_version_id) REFERENCES illustration_style_versions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS illustration_adoptions (
  user_id VARCHAR(64) NOT NULL,
  unit_id VARCHAR(128) NOT NULL,
  version_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, unit_id),
  INDEX idx_illustration_adoptions_version (version_id, updated_at),
  CONSTRAINT fk_illustration_adoption_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_illustration_adoption_version
    FOREIGN KEY (version_id) REFERENCES illustration_versions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS illustration_likes (
  version_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (version_id, user_id),
  INDEX idx_illustration_likes_user (user_id, created_at),
  CONSTRAINT fk_illustration_like_version
    FOREIGN KEY (version_id) REFERENCES illustration_versions(id) ON DELETE CASCADE,
  CONSTRAINT fk_illustration_like_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS illustration_comments (
  id VARCHAR(64) PRIMARY KEY,
  version_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  content VARCHAR(1000) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_illustration_comments_version (version_id, created_at),
  INDEX idx_illustration_comments_user (user_id, created_at),
  CONSTRAINT fk_illustration_comment_version
    FOREIGN KEY (version_id) REFERENCES illustration_versions(id) ON DELETE CASCADE,
  CONSTRAINT fk_illustration_comment_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS illustration_reports (
  id VARCHAR(64) PRIMARY KEY,
  version_id VARCHAR(64) NOT NULL,
  reporter_user_id VARCHAR(64) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  status ENUM('open', 'resolved', 'dismissed') NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_illustration_reporter_version (version_id, reporter_user_id),
  INDEX idx_illustration_reports_status (status, created_at),
  CONSTRAINT fk_illustration_report_version
    FOREIGN KEY (version_id) REFERENCES illustration_versions(id) ON DELETE CASCADE,
  CONSTRAINT fk_illustration_report_user
    FOREIGN KEY (reporter_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

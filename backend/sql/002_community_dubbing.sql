CREATE TABLE IF NOT EXISTS character_voice_designs (
  id VARCHAR(64) PRIMARY KEY,
  owner_user_id VARCHAR(64) NOT NULL,
  article_id VARCHAR(128) NOT NULL,
  character_code VARCHAR(64) NOT NULL,
  character_name VARCHAR(128) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_voice_design_owner_character (owner_user_id, article_id, character_code),
  CONSTRAINT fk_voice_design_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS character_voice_design_versions (
  id VARCHAR(64) PRIMARY KEY,
  design_id VARCHAR(64) NOT NULL,
  version_number INT UNSIGNED NOT NULL,
  prompt VARCHAR(500) NOT NULL,
  preview_text VARCHAR(500) NOT NULL,
  voice_id VARCHAR(255) NOT NULL,
  preview_audio_url VARCHAR(2048) NULL,
  preview_media_asset_id VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_voice_design_version (design_id, version_number),
  INDEX idx_voice_design_versions_created (design_id, created_at),
  CONSTRAINT fk_voice_design_version_design FOREIGN KEY (design_id) REFERENCES character_voice_designs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dubbing_projects (
  id VARCHAR(64) PRIMARY KEY,
  owner_user_id VARCHAR(64) NOT NULL,
  unit_id VARCHAR(191) NOT NULL,
  article_id VARCHAR(128) NOT NULL,
  chapter_id VARCHAR(128) NOT NULL,
  paragraph_index INT NOT NULL,
  kind ENUM('ai', 'human') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_dubbing_project_owner_unit_kind (owner_user_id, unit_id, kind),
  INDEX idx_dubbing_projects_unit (unit_id, created_at),
  CONSTRAINT fk_dubbing_project_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dubbing_versions (
  id VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  version_number INT UNSIGNED NOT NULL,
  owner_user_id VARCHAR(64) NOT NULL,
  unit_id VARCHAR(191) NOT NULL,
  article_id VARCHAR(128) NOT NULL,
  chapter_id VARCHAR(128) NOT NULL,
  paragraph_index INT NOT NULL,
  kind ENUM('ai', 'human') NOT NULL,
  status ENUM('private', 'public', 'withdrawn', 'moderated', 'deleted') NOT NULL,
  audio_url VARCHAR(2048) NOT NULL,
  media_asset_id VARCHAR(64) NULL,
  source_text MEDIUMTEXT NOT NULL,
  source_hash VARCHAR(128) NOT NULL,
  duration_ms INT UNSIGNED NULL,
  prompt_snapshot_json JSON NULL,
  segments_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  withdrawn_at TIMESTAMP NULL,
  moderated_at TIMESTAMP NULL,
  UNIQUE KEY uq_dubbing_project_version (project_id, version_number),
  INDEX idx_dubbing_versions_unit_status (unit_id, status, created_at),
  INDEX idx_dubbing_versions_owner (owner_user_id, created_at),
  CONSTRAINT fk_dubbing_version_project FOREIGN KEY (project_id) REFERENCES dubbing_projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_dubbing_version_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dubbing_likes (
  version_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (version_id, user_id),
  INDEX idx_dubbing_likes_user (user_id, created_at),
  CONSTRAINT fk_dubbing_like_version FOREIGN KEY (version_id) REFERENCES dubbing_versions(id) ON DELETE CASCADE,
  CONSTRAINT fk_dubbing_like_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dubbing_adoptions (
  user_id VARCHAR(64) NOT NULL,
  unit_id VARCHAR(191) NOT NULL,
  version_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, unit_id),
  INDEX idx_dubbing_adoptions_version (version_id, updated_at),
  CONSTRAINT fk_dubbing_adoption_version FOREIGN KEY (version_id) REFERENCES dubbing_versions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_dubbing_adoption_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dubbing_reports (
  id VARCHAR(64) PRIMARY KEY,
  version_id VARCHAR(64) NOT NULL,
  reporter_user_id VARCHAR(64) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  status ENUM('open', 'resolved', 'dismissed') NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_dubbing_reporter_version (version_id, reporter_user_id),
  INDEX idx_dubbing_reports_status (status, created_at),
  CONSTRAINT fk_dubbing_report_version FOREIGN KEY (version_id) REFERENCES dubbing_versions(id) ON DELETE CASCADE,
  CONSTRAINT fk_dubbing_report_user FOREIGN KEY (reporter_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

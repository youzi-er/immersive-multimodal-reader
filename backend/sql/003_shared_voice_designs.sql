CREATE TABLE IF NOT EXISTS dubbing_version_shared_voice_designs (
  dubbing_version_id VARCHAR(64) NOT NULL,
  voice_design_version_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (dubbing_version_id, voice_design_version_id),
  INDEX idx_shared_voice_design_version (voice_design_version_id, created_at),
  CONSTRAINT fk_shared_voice_dubbing_version
    FOREIGN KEY (dubbing_version_id) REFERENCES dubbing_versions(id) ON DELETE CASCADE,
  CONSTRAINT fk_shared_voice_design_version
    FOREIGN KEY (voice_design_version_id) REFERENCES character_voice_design_versions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

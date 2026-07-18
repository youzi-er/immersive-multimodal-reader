import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureSchema, getPool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let communitySchemaPromise;

function splitStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export function ensureCommunitySchema() {
  communitySchemaPromise ||= (async () => {
    await ensureSchema();
    for (const filename of [
      '002_community_dubbing.sql',
      '003_shared_voice_designs.sql',
      '004_cover_community.sql'
    ]) {
      const sql = await fs.readFile(path.resolve(__dirname, `../sql/${filename}`), 'utf8');
      for (const statement of splitStatements(sql)) {
        await getPool().query(statement);
      }
    }
    const [parameterColumns] = await getPool().query(
      "SHOW COLUMNS FROM cover_versions LIKE 'parameters_json'"
    );
    if (parameterColumns.length === 0) {
      await getPool().query('ALTER TABLE cover_versions ADD COLUMN parameters_json JSON NULL AFTER composition');
    }
  })();
  return communitySchemaPromise;
}

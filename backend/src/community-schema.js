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
    for (const filename of ['002_community_dubbing.sql', '003_shared_voice_designs.sql']) {
      const sql = await fs.readFile(path.resolve(__dirname, `../sql/${filename}`), 'utf8');
      for (const statement of splitStatements(sql)) {
        await getPool().query(statement);
      }
    }
  })();
  return communitySchemaPromise;
}

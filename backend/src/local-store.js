import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../data');
fs.mkdirSync(dataDir, { recursive: true });

const databasePath = process.env.LOCAL_DATABASE_PATH || path.join(dataDir, 'immersive-reader.sqlite');
const database = new DatabaseSync(databasePath);
database.exec('PRAGMA foreign_keys = ON');
database.exec('PRAGMA journal_mode = WAL');
database.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    display_name TEXT NOT NULL,
    bio TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS paragraph_comments (
    id TEXT PRIMARY KEY,
    article_id TEXT NOT NULL,
    chapter_id TEXT NOT NULL,
    paragraph_index INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 1000),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_paragraph_comments_position
    ON paragraph_comments(article_id, chapter_id, paragraph_index, created_at);
`);

function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    passwordSalt: row.password_salt,
    displayName: row.display_name,
    bio: row.bio,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toComment(row) {
  return {
    id: row.id,
    articleId: row.article_id,
    chapterId: row.chapter_id,
    paragraphIndex: row.paragraph_index,
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function createUser(user) {
  database.prepare(`
    INSERT INTO users (id, username, password_hash, password_salt, display_name, bio)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(user.id, user.username, user.passwordHash, user.passwordSalt, user.displayName, user.bio ?? null);
  return getUserById(user.id);
}

export async function getUserById(id) {
  return toUser(database.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').get(id));
}

export async function getUserByUsername(username) {
  return toUser(database.prepare('SELECT * FROM users WHERE username = ? LIMIT 1').get(username));
}

export async function ensureUser(user) {
  const existing = await getUserByUsername(user.username);
  return existing || createUser(user);
}

export async function listParagraphComments({ articleId, chapterId }) {
  const rows = database.prepare(`
    SELECT pc.*, u.username, u.display_name
    FROM paragraph_comments pc
    JOIN users u ON u.id = pc.user_id
    WHERE pc.article_id = ? AND pc.chapter_id = ?
    ORDER BY pc.paragraph_index ASC, pc.created_at ASC
  `).all(articleId, chapterId);
  return rows.map(toComment);
}

export async function createParagraphComment(comment) {
  database.prepare(`
    INSERT INTO paragraph_comments (id, article_id, chapter_id, paragraph_index, user_id, content)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(comment.id, comment.articleId, comment.chapterId, comment.paragraphIndex, comment.userId, comment.content);
  const row = database.prepare(`
    SELECT pc.*, u.username, u.display_name
    FROM paragraph_comments pc
    JOIN users u ON u.id = pc.user_id
    WHERE pc.id = ? LIMIT 1
  `).get(comment.id);
  return toComment(row);
}

export async function deleteParagraphComment(id, userId) {
  const result = database.prepare(
    'DELETE FROM paragraph_comments WHERE id = ? AND user_id = ?'
  ).run(id, userId);
  return Number(result.changes) > 0;
}

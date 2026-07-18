import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ignoredDirectoryNames = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage']);
const deployableMediaPattern = /\.(?:png|jpe?g|webp|gif|mp3|wav|ogg|m4a|mp4)$/i;
const allowedPublicMedia = new Set([
  'frontend/public/assets/speckled-band-poster-v2.png'
]);

function normalizeRelative(filePath) {
  return filePath.split(path.sep).join('/').replace(/^\.\//, '');
}

function walkFiles(directory, prefix = '') {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) continue;
    const relative = normalizeRelative(path.join(prefix, entry.name));
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(absolute, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

function deployPayloadFiles() {
  if (fs.existsSync(path.join(repoRoot, '.git'))) {
    const safeRepoRoot = normalizeRelative(repoRoot);
    const output = execFileSync('git', ['-c', `safe.directory=${safeRepoRoot}`, 'ls-files', '-z'], {
      cwd: repoRoot,
      encoding: 'buffer'
    });
    return output.toString('utf8').split('\0').filter(Boolean).map(normalizeRelative);
  }
  return walkFiles(repoRoot);
}

const files = deployPayloadFiles();
const violations = [];

for (const file of files) {
  if (file.startsWith('backend/storage/') || file.startsWith('backend/cache/')) {
    violations.push(`${file}: generated backend media/cache must never be deployed`);
  }
  if (/^backend\/data\/.*\.sqlite(?:3)?(?:-.+)?$/i.test(file)) {
    violations.push(`${file}: local database files must never be deployed`);
  }
  if (file.startsWith('frontend/public/') && deployableMediaPattern.test(file) && !allowedPublicMedia.has(file)) {
    violations.push(`${file}: public media is not explicitly approved as a product asset`);
  }
  if (file.startsWith('backend/sql/') && file.endsWith('.sql')) {
    const sql = fs.readFileSync(path.join(repoRoot, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*--.*$/gm, '');
    if (/^\s*(?:INSERT|REPLACE|UPDATE|DELETE|LOAD\s+DATA)\b/im.test(sql)) {
      violations.push(`${file}: deployment migrations may define schema but may not seed test data`);
    }
  }
}

if (violations.length > 0) {
  console.error('Deployment payload contains local or test data:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(`Deployment payload verified: ${files.length} files, no generated media or SQL seed data.`);
}

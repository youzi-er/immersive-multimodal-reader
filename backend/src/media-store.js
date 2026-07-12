import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');

export const mediaRoot = path.resolve(process.env.MEDIA_STORAGE_ROOT || path.resolve(backendRoot, 'storage', 'media'));

function monthPath(date = new Date()) {
  return [String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, '0')];
}

function mediaUrl(...parts) {
  return `/media/${parts.map((part) => encodeURIComponent(part)).join('/')}`;
}

function extensionFromContentType(contentType, fallback) {
  if (contentType?.includes('png')) return 'png';
  if (contentType?.includes('webp')) return 'webp';
  if (contentType?.includes('jpeg') || contentType?.includes('jpg')) return 'jpg';
  if (contentType?.includes('mpeg') || contentType?.includes('mp3')) return 'mp3';
  return fallback;
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function saveImageFromUrl(sourceUrl) {
  const response = await fetch(sourceUrl);

  if (!response.ok) {
    throw new Error(`Failed to download generated image: ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  const extension = extensionFromContentType(contentType, 'jpg');
  const [year, month] = monthPath();
  const dir = path.resolve(mediaRoot, 'images', year, month);
  const filename = `${crypto.randomUUID()}.${extension}`;
  const filePath = path.resolve(dir, filename);
  const bytes = Buffer.from(await response.arrayBuffer());

  await ensureDir(dir);
  await fs.writeFile(filePath, bytes);

  return {
    url: mediaUrl('images', year, month, filename),
    filePath
  };
}

export async function saveAudioDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(audio\/[^;]+);base64,(.+)$/);

  if (!match) {
    throw new Error('Audio result is not a valid data URL');
  }

  const contentType = match[1];
  const extension = extensionFromContentType(contentType, 'mp3');
  const [year, month] = monthPath();
  const dir = path.resolve(mediaRoot, 'audio', year, month);
  const filename = `${crypto.randomUUID()}.${extension}`;
  const filePath = path.resolve(dir, filename);
  const bytes = Buffer.from(match[2], 'base64');

  await ensureDir(dir);
  await fs.writeFile(filePath, bytes);

  return {
    url: mediaUrl('audio', year, month, filename),
    filePath
  };
}

export async function removeStoredMedia(filePath) {
  if (!filePath) {
    return;
  }

  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(mediaRoot)) {
    return;
  }

  await fs.rm(resolved, { force: true });
}

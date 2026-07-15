import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
import { chapters, clues } from './data.js';
import {
  createMediaAsset,
  createUser,
  createVoiceRecording,
  deleteMediaAsset,
  deleteVoiceRecording,
  ensureUser,
  getMediaAsset,
  getUserById,
  getUserByUsername,
  getVoiceRecording,
  listMediaAssets,
  listVoiceRecordings,
  setVoiceRecordingLike,
  updateVoiceRecordingVisibility
} from './db.js';
import { mediaRoot, removeStoredMedia, saveAudioDataUrl, saveImageFromUrl } from './media-store.js';
import {
  buildSherlockImagePrompt,
  chatWithMiniMax,
  designVoice,
  generateImage,
  synthesizeSpeech
} from './services/minimax.js';
import {
  generateParagraphIllustration,
  getImageDebugInfo,
  regenerateBookStyle
} from './services/paragraphIllustration.js';
import {
  generateParagraphSpeech,
  getSpeechDebugInfo,
  getSpeechVoicesStatus,
  regenerateSpeechVoices
} from './services/paragraphSpeech.js';

const app = express();
const port = process.env.PORT || 3001;

const users = [
  {
    id: 'demo-user',
    username: 'demo',
    password: '123456',
    displayName: '演示侦探',
    bio: '正在研究福尔摩斯探案集的沉浸式阅读体验。'
  }
];

const sessions = new Map();
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
const tokenSecret = process.env.AUTH_TOKEN_SECRET || process.env.MINIMAX_API_KEY || 'local-development-secret';

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use('/media', express.static(mediaRoot));

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    bio: user.bio
  };
}

function legacyRequireAuth(req, res, next) {
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const userId = sessions.get(token);
  const user = users.find((item) => item.id === userId);

  if (!user) {
    res.status(401).json({ error: '请先登录' });
    return;
  }

  req.user = user;
  next();
}

function legacyOptionalAuth(req, _res, next) {
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const userId = sessions.get(token);
  const user = users.find((item) => item.id === userId);

  if (user) {
    req.user = user;
  }

  next();
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlJson(value) {
  return base64UrlEncode(JSON.stringify(value));
}

function signTokenPayload(payload) {
  return crypto.createHmac('sha256', tokenSecret).update(payload).digest('base64url');
}

function createAuthToken(user) {
  const payload = base64UrlJson({
    sub: user.id,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
  });
  return `${payload}.${signTokenPayload(payload)}`;
}

function verifyAuthToken(token) {
  try {
    if (!token || !token.includes('.')) {
      return null;
    }

    const [payload, signature] = token.split('.');
    const expectedSignature = signTokenPayload(payload);
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      return null;
    }

    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.sub || !data.exp || data.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return String(data.sub);
  } catch {
    return null;
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const passwordHash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, 'sha256').toString('hex');
  return { passwordHash, passwordSalt: salt };
}

function passwordMatches(password, user) {
  const { passwordHash } = hashPassword(password, user.passwordSalt);
  return crypto.timingSafeEqual(Buffer.from(passwordHash), Buffer.from(user.passwordHash));
}

async function seedDemoUser() {
  const { passwordHash, passwordSalt } = hashPassword('123456', 'demo-user-static-salt');
  await ensureUser({
    id: 'demo-user',
    username: 'demo',
    passwordHash,
    passwordSalt,
    displayName: 'Demo Reader',
    bio: 'Immersive reading demo account'
  });
}

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const userId = verifyAuthToken(token);
  const user = userId ? await getUserById(userId) : null;

  if (!user) {
    res.status(401).json({ error: 'Please sign in first' });
    return;
  }

  req.user = user;
  next();
}

async function optionalAuth(req, _res, next) {
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const userId = verifyAuthToken(token);
  const user = userId ? await getUserById(userId) : null;

  if (user) {
    req.user = user;
  }

  next();
}

function normalizeInteger(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function normalizeRange(range) {
  if (!range || typeof range !== 'object') {
    return null;
  }

  const startParagraphIndex = normalizeInteger(range.startParagraphIndex);
  const startOffset = normalizeInteger(range.startOffset);
  const endParagraphIndex = normalizeInteger(range.endParagraphIndex);
  const endOffset = normalizeInteger(range.endOffset);

  if (
    startParagraphIndex === null ||
    startOffset === null ||
    endParagraphIndex === null ||
    endOffset === null
  ) {
    return null;
  }

  return {
    startParagraphIndex,
    startOffset,
    endParagraphIndex,
    endOffset
  };
}

function normalizeMediaPosition(body) {
  return {
    articleId: String(body.articleId || 'speckled-band'),
    chapterId: body.chapterId ? String(body.chapterId) : null,
    paragraphIndex: normalizeInteger(body.paragraphIndex),
    range: normalizeRange(body.range)
  };
}

function currentUserId(req) {
  return req.user?.id || 'anonymous';
}

function rangesEqual(left, right) {
  if (!left || !right) {
    return false;
  }

  return (
    left.startParagraphIndex === right.startParagraphIndex &&
    left.startOffset === right.startOffset &&
    left.endParagraphIndex === right.endParagraphIndex &&
    left.endOffset === right.endOffset
  );
}

function metadataValue(asset, key) {
  return asset?.metadata && typeof asset.metadata === 'object' ? asset.metadata[key] : undefined;
}

function imageAssetResponse(asset, extra = {}) {
  const metadata = asset.metadata || {};

  return {
    imageUrl: asset.url,
    prompt: asset.prompt || '',
    sceneSummaryCn: metadata.sceneSummaryCn || '',
    componentType: metadata.componentType || '',
    promptCharCount: metadata.promptCharCount || 0,
    traceId: metadata.traceId || null,
    styleInitializedNow: Boolean(metadata.styleInitializedNow),
    sourceImageUrl: asset.sourceUrl,
    mediaAssetId: asset.id,
    asset,
    cacheHit: true,
    ...extra
  };
}

async function findSceneImageAsset({ articleId = 'speckled-band', chapterId, prompt }) {
  const assets = await listMediaAssets({ articleId, chapterId, mediaType: 'image' });

  return (
    assets.find(
      (asset) =>
        !asset.range &&
        metadataValue(asset, 'generationType') === 'scene' &&
        (!prompt || asset.prompt === prompt)
    ) || null
  );
}

async function findParagraphImageAsset({ articleId = 'speckled-band', chapterId, paragraphIndex, range, sourceText }) {
  const assets = await listMediaAssets({ articleId, chapterId, mediaType: 'image' });

  return (
    assets.find(
      (asset) =>
        asset.paragraphIndex === paragraphIndex &&
        rangesEqual(asset.range, range) &&
        asset.sourceText === sourceText &&
        metadataValue(asset, 'generationType') === 'paragraph-image'
    ) || null
  );
}

async function persistGeneratedImage({ req, sourceUrl, prompt, sourceText, model, metadata = {} }) {
  let saved = { url: sourceUrl, filePath: null };
  let localSaveError = null;

  try {
    saved = await saveImageFromUrl(sourceUrl);
  } catch (error) {
    localSaveError = error;
  }

  try {
    const asset = await createMediaAsset({
      id: crypto.randomUUID(),
      ...normalizeMediaPosition(req.body),
      mediaType: 'image',
      url: saved.url,
      sourceUrl,
      filePath: saved.filePath,
      prompt,
      sourceText,
      provider: 'minimax',
      model,
      userId: currentUserId(req),
      metadata: {
        ...metadata,
        localSaveError: localSaveError?.message || null
      }
    });

    return {
      asset,
      mediaAssetId: asset.id,
      imageUrl: asset.url,
      sourceImageUrl: sourceUrl,
      mediaPersistenceError: localSaveError?.message || null
    };
  } catch (error) {
    console.error('Failed to persist image media asset:', error);
    return {
      asset: null,
      mediaAssetId: null,
      imageUrl: saved.url,
      sourceImageUrl: sourceUrl,
      mediaPersistenceError: error.message || 'Failed to persist image media asset'
    };
  }
}

async function persistGeneratedAudio({ req, audioUrl, prompt, sourceText, model, metadata = {} }) {
  try {
    const saved = await saveAudioDataUrl(audioUrl);
    const asset = await createMediaAsset({
      id: crypto.randomUUID(),
      ...normalizeMediaPosition(req.body),
      mediaType: 'audio',
      url: saved.url,
      sourceUrl: null,
      filePath: saved.filePath,
      prompt,
      sourceText,
      provider: 'minimax',
      model,
      userId: currentUserId(req),
      metadata
    });

    return {
      asset,
      mediaAssetId: asset.id,
      audioUrl: asset.url,
      sourceAudioUrl: audioUrl,
      mediaPersistenceError: null
    };
  } catch (error) {
    console.error('Failed to persist audio media asset:', error);
    return {
      asset: null,
      mediaAssetId: null,
      audioUrl,
      sourceAudioUrl: null,
      mediaPersistenceError: error.message || 'Failed to persist audio media asset'
    };
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'immersive-reader-backend' });
});

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const { username, password, displayName } = req.body;
    const safeUsername = String(username ?? '').trim();
    const safePassword = String(password ?? '').trim();
    const safeDisplayName = String(displayName ?? '').trim() || safeUsername;

    if (safeUsername.length < 3) {
      res.status(400).json({ error: 'Username must be at least 3 characters' });
      return;
    }

    if (safePassword.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' });
      return;
    }

    const existing = await getUserByUsername(safeUsername);
    if (existing) {
      res.status(409).json({ error: 'Username is already registered' });
      return;
    }

    const { passwordHash, passwordSalt } = hashPassword(safePassword);
    const user = await createUser({
      id: crypto.randomUUID(),
      username: safeUsername,
      passwordHash,
      passwordSalt,
      displayName: safeDisplayName,
      bio: 'New immersive reader'
    });
    const token = createAuthToken(user);

    res.status(201).json({ token, user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    await seedDemoUser();
    const { username, password } = req.body;
    const user = await getUserByUsername(String(username ?? '').trim());

    if (!user || !passwordMatches(String(password ?? ''), user)) {
      res.status(401).json({ error: 'Username or password is incorrect' });
      return;
    }

    const token = createAuthToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.post('/api/auth/logout', requireAuth, (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/auth/register', (req, res) => {
  const { username, password, displayName } = req.body;
  const safeUsername = String(username ?? '').trim();
  const safePassword = String(password ?? '').trim();
  const safeDisplayName = String(displayName ?? '').trim() || safeUsername;

  if (safeUsername.length < 3) {
    res.status(400).json({ error: '用户名至少需要 3 个字符' });
    return;
  }

  if (safePassword.length < 6) {
    res.status(400).json({ error: '密码至少需要 6 位' });
    return;
  }

  if (users.some((user) => user.username === safeUsername)) {
    res.status(409).json({ error: '这个用户名已经被注册' });
    return;
  }

  const user = {
    id: crypto.randomUUID(),
    username: safeUsername,
    password: safePassword,
    displayName: safeDisplayName,
    bio: '新的探案读者。'
  };
  const token = crypto.randomUUID();

  users.push(user);
  sessions.set(token, user.id);

  res.status(201).json({ token, user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = users.find(
    (item) => item.username === String(username ?? '').trim() && item.password === String(password ?? '')
  );

  if (!user) {
    res.status(401).json({ error: '用户名或密码不正确' });
    return;
  }

  const token = crypto.randomUUID();
  sessions.set(token, user.id);

  res.json({ token, user: publicUser(user) });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  sessions.delete(token);
  res.json({ ok: true });
});

app.get('/api/chapters', (_req, res) => {
  res.json(chapters);
});

app.get('/api/chapters/:id', (req, res) => {
  const chapter = chapters.find((item) => item.id === req.params.id);
  if (!chapter) {
    res.status(404).json({ error: 'Chapter not found' });
    return;
  }
  res.json(chapter);
});

app.get('/api/clues', (_req, res) => {
  res.json(clues);
});

app.get('/api/media/assets', async (req, res) => {
  try {
    const { articleId, chapterId, mediaType, userId } = req.query;
    const assets = await listMediaAssets({
      articleId: articleId ? String(articleId) : undefined,
      chapterId: chapterId ? String(chapterId) : undefined,
      mediaType: mediaType ? String(mediaType) : undefined,
      userId: userId ? String(userId) : undefined
    });

    res.json({ assets });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to list media assets' });
  }
});

app.post('/api/media/assets', optionalAuth, async (req, res) => {
  try {
    const { mediaType, url, sourceUrl, filePath, prompt, sourceText, provider, model, metadata } = req.body;

    if (!['image', 'audio'].includes(mediaType)) {
      res.status(400).json({ error: 'mediaType must be image or audio' });
      return;
    }

    if (!url) {
      res.status(400).json({ error: 'url is required' });
      return;
    }

    const asset = await createMediaAsset({
      id: crypto.randomUUID(),
      ...normalizeMediaPosition(req.body),
      mediaType,
      url,
      sourceUrl,
      filePath,
      prompt,
      sourceText,
      provider: provider || 'manual',
      model,
      userId: currentUserId(req),
      metadata
    });

    res.status(201).json({ asset });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to create media asset' });
  }
});

app.delete('/api/media/assets/:id', optionalAuth, async (req, res) => {
  try {
    const asset = await getMediaAsset(req.params.id);

    if (!asset) {
      res.status(404).json({ error: 'Media asset not found' });
      return;
    }

    if (asset.userId !== 'anonymous' && asset.userId !== req.user?.id) {
      res.status(403).json({ error: 'You can only delete your own media asset' });
      return;
    }

    await deleteMediaAsset(req.params.id);
    await removeStoredMedia(asset.filePath);
    res.json({ ok: true, asset });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to delete media asset' });
  }
});

function normalizeVoiceRecordingQuery(query) {
  return {
    articleId: String(query.articleId || 'speckled-band'),
    chapterId: String(query.chapterId || ''),
    range: normalizeRange({
      startParagraphIndex: query.startParagraphIndex,
      startOffset: query.startOffset,
      endParagraphIndex: query.endParagraphIndex,
      endOffset: query.endOffset
    })
  };
}

app.get('/api/voice-recordings', requireAuth, async (req, res) => {
  try {
    const { articleId, chapterId, range } = normalizeVoiceRecordingQuery(req.query);
    if (!chapterId || !range) {
      res.status(400).json({ error: 'chapterId and range are required' });
      return;
    }

    const recordings = await listVoiceRecordings({
      articleId,
      chapterId,
      range,
      currentUserId: req.user.id
    });
    const myRecording = recordings.find((recording) => recording.userId === req.user.id) || null;
    const publicRecordings = recordings.filter((recording) => recording.visibility === 'public');

    res.json({ myRecording, publicRecordings, recordings });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to list voice recordings' });
  }
});

app.post('/api/voice-recordings', requireAuth, async (req, res) => {
  try {
    const { audioDataUrl, visibility = 'private', sourceText } = req.body;
    const position = normalizeMediaPosition(req.body);
    const safeVisibility = visibility === 'public' ? 'public' : 'private';
    const safeSourceText = String(sourceText ?? '').trim();

    if (!position.chapterId || !position.range || !Number.isInteger(position.paragraphIndex)) {
      res.status(400).json({ error: 'chapterId, paragraphIndex and range are required' });
      return;
    }

    if (!safeSourceText) {
      res.status(400).json({ error: 'sourceText is required' });
      return;
    }

    const saved = await saveAudioDataUrl(audioDataUrl);
    const asset = await createMediaAsset({
      id: crypto.randomUUID(),
      articleId: position.articleId,
      chapterId: null,
      paragraphIndex: null,
      range: null,
      mediaType: 'audio',
      url: saved.url,
      sourceUrl: null,
      filePath: saved.filePath,
      prompt: safeSourceText,
      sourceText: safeSourceText,
      provider: 'user_recording',
      model: null,
      userId: req.user.id,
      metadata: {
        generationType: 'user-recording',
        mimeType: String(audioDataUrl || '').match(/^data:([^;]+);/)?.[1] || null
      }
    });

    const recording = await createVoiceRecording({
      id: crypto.randomUUID(),
      mediaAssetId: asset.id,
      articleId: position.articleId,
      chapterId: position.chapterId,
      paragraphIndex: position.paragraphIndex,
      range: position.range,
      sourceText: safeSourceText,
      userId: req.user.id,
      visibility: safeVisibility
    });

    res.status(201).json({ recording });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to save voice recording' });
  }
});

app.patch('/api/voice-recordings/:id', requireAuth, async (req, res) => {
  try {
    const visibility = req.body.visibility === 'public' ? 'public' : 'private';
    const recording = await updateVoiceRecordingVisibility(req.params.id, req.user.id, visibility);
    if (!recording) {
      res.status(404).json({ error: 'Voice recording not found' });
      return;
    }

    res.json({ recording });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to update voice recording' });
  }
});

app.delete('/api/voice-recordings/:id', requireAuth, async (req, res) => {
  try {
    const recording = await deleteVoiceRecording(req.params.id, req.user.id);
    if (!recording) {
      res.status(404).json({ error: 'Voice recording not found' });
      return;
    }

    const asset = await deleteMediaAsset(recording.mediaAssetId);
    await removeStoredMedia(asset?.filePath);
    res.json({ ok: true, recording });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to delete voice recording' });
  }
});

app.post('/api/voice-recordings/:id/like', requireAuth, async (req, res) => {
  try {
    const recording = await getVoiceRecording(req.params.id, req.user.id);
    if (!recording || (recording.visibility !== 'public' && recording.userId !== req.user.id)) {
      res.status(404).json({ error: 'Voice recording not found' });
      return;
    }

    const nextRecording = await setVoiceRecordingLike(req.params.id, req.user.id, true);
    res.json({ recording: nextRecording });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to like voice recording' });
  }
});

app.delete('/api/voice-recordings/:id/like', requireAuth, async (req, res) => {
  try {
    const recording = await getVoiceRecording(req.params.id, req.user.id);
    if (!recording || (recording.visibility !== 'public' && recording.userId !== req.user.id)) {
      res.status(404).json({ error: 'Voice recording not found' });
      return;
    }

    const nextRecording = await setVoiceRecordingLike(req.params.id, req.user.id, false);
    res.json({ recording: nextRecording });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to unlike voice recording' });
  }
});

app.post('/api/chat', (req, res) => {
  const { question, chapterId } = req.body;
  const chapter = chapters.find((item) => item.id === chapterId) ?? chapters[0];

  if (!question || typeof question !== 'string') {
    res.status(400).json({ error: 'Question is required' });
    return;
  }

  res.json({
    answer: `根据《${chapter.title}》当前段落，建议先关注“异常物件是否真的具有表面用途”。你的问题是：“${question}”。后续这里可以接入真实大模型，让它基于章节文本回答。`
  });
});

app.post('/api/ai/chat', async (req, res) => {
  try {
    const { question, chapterId, collectedClueIds = [] } = req.body;
    const chapter = chapters.find((item) => item.id === chapterId) ?? chapters[0];

    if (!question || typeof question !== 'string') {
      res.status(400).json({ error: 'Question is required' });
      return;
    }

    const context = chapter.paragraphs
      .flat()
      .map((segment) => segment.text)
      .join('\n');
    const clueLabels = clues
      .filter((clue) => collectedClueIds.includes(clue.id))
      .map((clue) => clue.label);
    const answer = await chatWithMiniMax({
      question,
      chapterTitle: chapter.title,
      context,
      collectedClues: clueLabels
    });

    res.json({ answer });
  } catch (error) {
    res.status(500).json({ error: error.message || 'MiniMax chat failed' });
  }
});

app.post('/api/ai/tts', optionalAuth, async (req, res) => {
  try {
    const { text, speaker, voiceId, speed = 1, pitch = 0 } = req.body;

    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'Text is required' });
      return;
    }

    const voiceMap = {
      '福尔摩斯': 'Chinese (Mandarin)_Lyrical_Voice',
      '华生': 'Chinese (Mandarin)_Lyrical_Voice',
      '海伦·斯托纳': 'Chinese (Mandarin)_Lyrical_Voice'
    };
    const result = await synthesizeSpeech({
      text: speaker ? `${speaker}说：${text}` : text,
      voiceId: voiceId || voiceMap[speaker] || process.env.MINIMAX_DEFAULT_VOICE_ID,
      speed,
      pitch
    });

    const persisted = await persistGeneratedAudio({
      req,
      audioUrl: result.audioUrl,
      prompt: speaker ? `${speaker}: ${text}` : text,
      sourceText: text,
      model: process.env.MINIMAX_TTS_MODEL || 'speech-2.8-hd',
      metadata: {
        speaker: speaker || null,
        voiceId: voiceId || voiceMap[speaker] || process.env.MINIMAX_DEFAULT_VOICE_ID || null,
        speed,
        pitch,
        durationMs: result.durationMs,
        traceId: result.traceId
      }
    });

    res.json({ ...result, ...persisted });
  } catch (error) {
    res.status(500).json({ error: error.message || 'MiniMax tts failed' });
  }
});

app.post('/api/ai/image', optionalAuth, async (req, res) => {
  try {
    const { prompt, chapterId } = req.body;
    const chapter = chapters.find((item) => item.id === chapterId) ?? chapters[0];
    const finalPrompt =
      prompt ||
      buildSherlockImagePrompt({
        chapterTitle: chapter.title,
        scenePrompt: chapter.scene.imagePrompt,
        mood: chapter.scene.mood
      });

    const cached = await findSceneImageAsset({
      chapterId: chapter.id,
      prompt: finalPrompt
    });
    if (cached) {
      res.json(imageAssetResponse(cached, { prompt: cached.prompt || finalPrompt }));
      return;
    }

    const result = await generateImage({ prompt: finalPrompt, aspectRatio: '16:9' });
    const persisted = await persistGeneratedImage({
      req,
      sourceUrl: result.imageUrl,
      prompt: finalPrompt,
      sourceText: req.body.sourceText || null,
      model: process.env.MINIMAX_IMAGE_MODEL || 'image-01',
      metadata: {
        traceId: result.traceId,
        generationType: 'scene'
      }
    });

    res.json({ ...result, ...persisted, prompt: finalPrompt });
  } catch (error) {
    res.status(500).json({ error: error.message || 'MiniMax image generation failed' });
  }
});

app.post('/api/ai/paragraph-image', optionalAuth, async (req, res) => {
  try {
    const { chapterId, paragraphIndex, targetSegment } = req.body;
    const safeChapterId = String(chapterId ?? '').trim();
    const safeParagraphIndex = Number(paragraphIndex);
    const safeTargetSegment = String(targetSegment ?? '').trim();

    if (!safeChapterId) {
      res.status(400).json({ error: 'chapterId is required' });
      return;
    }

    if (!Number.isInteger(safeParagraphIndex) || safeParagraphIndex < 0) {
      res.status(400).json({ error: 'paragraphIndex must be a non-negative integer' });
      return;
    }

    if (!safeTargetSegment) {
      res.status(400).json({ error: 'targetSegment is required' });
      return;
    }

    const safeRange = normalizeRange(req.body.range);
    const cached = await findParagraphImageAsset({
      chapterId: safeChapterId,
      paragraphIndex: safeParagraphIndex,
      range: safeRange,
      sourceText: safeTargetSegment
    });
    if (cached) {
      res.json(imageAssetResponse(cached));
      return;
    }

    const result = await generateParagraphIllustration({
      chapterId: safeChapterId,
      paragraphIndex: safeParagraphIndex,
      targetSegment: safeTargetSegment
    });

    const persisted = await persistGeneratedImage({
      req,
      sourceUrl: result.imageUrl,
      prompt: result.prompt || null,
      sourceText: safeTargetSegment,
      model: process.env.MINIMAX_IMAGE_MODEL || 'image-01',
      metadata: {
        traceId: result.traceId,
        sceneSummaryCn: result.sceneSummaryCn || null,
        componentType: result.componentType || null,
        promptCharCount: result.promptCharCount || null,
        styleInitializedNow: Boolean(result.styleInitializedNow),
        generationType: 'paragraph-image'
      }
    });

    res.json({ ...result, ...persisted });
  } catch (error) {
    res.status(500).json({ error: error.message || 'MiniMax paragraph image generation failed' });
  }
});

app.get('/api/ai/speech-voices', async (_req, res) => {
  try {
    const result = await getSpeechVoicesStatus();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Speech voices status failed' });
  }
});

app.get('/api/ai/speech-debug', async (req, res) => {
  try {
    const result = await getSpeechDebugInfo({ limit: req.query.limit });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Speech debug failed' });
  }
});

app.post('/api/ai/speech-debug/regenerate-voices', async (_req, res) => {
  try {
    const result = await regenerateSpeechVoices();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Speech voices regeneration failed' });
  }
});

app.get('/api/ai/image-debug', async (req, res) => {
  try {
    const result = await getImageDebugInfo({ limit: req.query.limit });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Image debug failed' });
  }
});

app.post('/api/ai/image-debug/regenerate-style', async (_req, res) => {
  try {
    const result = await regenerateBookStyle();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Image style regeneration failed' });
  }
});

app.post('/api/ai/paragraph-speech', optionalAuth, async (req, res) => {
  try {
    const { chapterId, paragraphIndex, targetSegment } = req.body;
    const safeChapterId = String(chapterId ?? '').trim();
    const safeParagraphIndex = Number(paragraphIndex);
    const safeTargetSegment = String(targetSegment ?? '').trim();

    if (!safeChapterId) {
      res.status(400).json({ error: 'chapterId is required' });
      return;
    }

    if (!Number.isInteger(safeParagraphIndex) || safeParagraphIndex < 0) {
      res.status(400).json({ error: 'paragraphIndex must be a non-negative integer' });
      return;
    }

    if (!safeTargetSegment) {
      res.status(400).json({ error: 'targetSegment is required' });
      return;
    }

    const result = await generateParagraphSpeech({
      chapterId: safeChapterId,
      paragraphIndex: safeParagraphIndex,
      targetSegment: safeTargetSegment
    });

    const persisted = await persistGeneratedAudio({
      req,
      audioUrl: result.audioUrl,
      prompt: safeTargetSegment,
      sourceText: safeTargetSegment,
      model: process.env.MINIMAX_TTS_MODEL || 'speech-2.8-hd',
      metadata: {
        durationMs: result.durationMs,
        segmentCount: result.segmentCount,
        script: result.script || [],
        voicesInitializedNow: Boolean(result.voicesInitializedNow),
        traceId: result.traceId,
        generationType: 'paragraph-speech'
      }
    });

    res.json({ ...result, ...persisted });
  } catch (error) {
    res.status(500).json({ error: error.message || 'MiniMax paragraph speech generation failed' });
  }
});

app.post('/api/ai/image-prompt', async (req, res) => {
  try {
    const { chapterId } = req.body;
    const chapter = chapters.find((item) => item.id === chapterId) ?? chapters[0];
    const prompt = buildSherlockImagePrompt({
      chapterTitle: chapter.title,
      scenePrompt: chapter.scene.imagePrompt,
      mood: chapter.scene.mood
    });

    res.json({ prompt });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Image prompt generation failed' });
  }
});

app.post('/api/ai/voice-design', async (req, res) => {
  try {
    const { prompt, previewText, voiceId } = req.body;

    if (!prompt || !previewText) {
      res.status(400).json({ error: 'Prompt and previewText are required' });
      return;
    }

    const result = await designVoice({ prompt, previewText, voiceId });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message || 'MiniMax voice design failed' });
  }
});

app.listen(port, () => {
  console.log(`Immersive reader API running at http://localhost:${port}`);
});

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
  createParagraphComment,
  createUser,
  createVoiceRecording,
  deleteMediaAsset,
  deleteParagraphComment,
  deleteVoiceRecording,
  ensureUser,
  getMediaAsset,
  getUserById,
  getUserByUsername,
  getVoiceRecording,
  listMediaAssets,
  listParagraphComments,
  listVoiceRecordings,
  setVoiceRecordingLike,
  updateVoiceRecordingVisibility
} from './db.js';
import {
  getMediaRoot,
  removeStoredMedia,
  saveAndRegisterMedia,
  saveAudioDataUrl,
  saveImageFromUrl
} from './media-store.js';
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
import { generatePreparedClueImage, prepareClueImage } from './services/clueImage.js';
import {
  isClueImageAsset,
  selectLatestClueAssets as selectClueMediaAssets
} from './services/clueMedia.js';
import {
  generateParagraphSpeech,
  getSpeechDebugInfo,
  getSpeechVoicesStatus,
  planParagraphSpeech,
  regenerateSpeechVoices,
  synthesizePlannedParagraphSpeech
} from './services/paragraphSpeech.js';
import {
  getContentUnit,
  getContentUnitByPosition,
  listContentUnits,
  toPublicContentUnit
} from './content-units.js';
import { communityStore } from './community-store.js';

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
const clueGenerationPromises = new Map();
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
const tokenSecret = process.env.AUTH_TOKEN_SECRET || process.env.MINIMAX_API_KEY || 'local-development-secret';

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use('/media', express.static(getMediaRoot()));

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

function clueImageAssetResponse(asset, extra = {}) {
  const metadata = asset.metadata || {};
  return {
    clueId: metadata.clueId || '',
    occurrenceId: metadata.occurrenceId || '',
    skipped: false,
    imageUrl: asset.url,
    imageMode: metadata.imageMode || '',
    clueType: metadata.clueType || '',
    subject: metadata.subject || '',
    prompt: asset.prompt || '',
    promptCharCount: metadata.promptCharCount || asset.prompt?.length || 0,
    mediaAssetId: asset.id,
    cacheHit: true,
    userOverride: false,
    createdAt: asset.createdAt,
    ...extra
  };
}

function selectResolvedClueAssets(assets, { clueId, clueIds } = {}) {
  return selectClueMediaAssets(assets, { clueId, clueIds });
}

async function findClueImageAsset({ articleId, clueId }) {
  const assets = await listMediaAssets({ articleId, mediaType: 'image' });
  return selectResolvedClueAssets(assets, { clueId })[0] || null;
}

async function generateAndPersistClueImage({ req, prepared }) {
  const result = await generatePreparedClueImage(prepared);
  if (result.skipped) {
    return {
      clueId: prepared.clue.id,
      occurrenceId: prepared.occurrence.id,
      skipped: true,
      reason: result.reason,
      imageMode: result.imageMode,
      clueType: result.clueType,
      subject: result.subject,
      cacheHit: false,
      userOverride: false
    };
  }

  const occurrence = prepared.occurrence;
  const persisted = await persistGeneratedImage({
    req,
    sourceUrl: result.imageUrl,
    prompt: result.prompt,
    sourceText: occurrence.selectedText,
    model: result.model,
    userId: 'shared',
    position: {
      articleId: result.articleId,
      chapterId: occurrence.chapterId,
      paragraphIndex: occurrence.paragraphIndex,
      range: {
        startParagraphIndex: occurrence.paragraphIndex,
        startOffset: occurrence.startOffset,
        endParagraphIndex: occurrence.paragraphIndex,
        endOffset: occurrence.endOffset
      }
    },
    metadata: {
      generationType: 'clue-image',
      clueId: prepared.clue.id,
      occurrenceId: occurrence.id,
      clueType: result.clueType,
      imageMode: result.imageMode,
      subject: result.subject,
      promptCharCount: result.promptCharCount,
      traceId: result.traceId,
      fingerprint: result.fingerprint,
      plannerVersion: result.plannerVersion,
      styleInitializedNow: result.styleInitializedNow,
      plan: result.plan,
      plannerInput: result.plannerInput,
      planningAttempts: result.planningAttempts
    }
  });

  if (!persisted.asset) {
    return {
      clueId: prepared.clue.id,
      occurrenceId: occurrence.id,
      skipped: false,
      imageUrl: persisted.imageUrl || result.imageUrl,
      imageMode: result.imageMode,
      clueType: result.clueType,
      subject: result.subject,
      prompt: result.prompt,
      promptCharCount: result.promptCharCount,
      mediaAssetId: null,
      cacheHit: false,
      userOverride: false,
      mediaPersistenceError: persisted.mediaPersistenceError
    };
  }

  return clueImageAssetResponse(persisted.asset, {
    cacheHit: false,
    userOverride: false,
    sourceImageUrl: result.imageUrl,
    mediaPersistenceError: persisted.mediaPersistenceError
  });
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

async function persistGeneratedImage({
  req,
  sourceUrl,
  prompt,
  sourceText,
  model,
  metadata = {},
  position = null,
  userId = null
}) {
  const { asset } = await saveAndRegisterMedia({
    save: () => saveImageFromUrl(sourceUrl),
    register: (saved) =>
      createMediaAsset({
        id: crypto.randomUUID(),
        ...(position || normalizeMediaPosition(req.body)),
        mediaType: 'image',
        url: saved.url,
        sourceUrl,
        filePath: saved.filePath,
        prompt,
        sourceText,
        provider: 'minimax',
        model,
        userId: userId || currentUserId(req),
        metadata
      })
  });

  return {
    asset,
    mediaAssetId: asset.id,
    imageUrl: asset.url,
    sourceImageUrl: sourceUrl,
    mediaPersistenceError: null
  };
}

async function persistGeneratedAudio({
  req,
  audioUrl,
  prompt,
  sourceText,
  model,
  metadata = {},
  position = null,
  provider = 'minimax',
  userId = null
}) {
  const { asset } = await saveAndRegisterMedia({
    save: () => saveAudioDataUrl(audioUrl),
    register: (saved) =>
      createMediaAsset({
        id: crypto.randomUUID(),
        ...(position || normalizeMediaPosition(req.body)),
        mediaType: 'audio',
        url: saved.url,
        sourceUrl: null,
        filePath: saved.filePath,
        prompt,
        sourceText,
        provider,
        model,
        userId: userId || currentUserId(req),
        metadata
      })
  });

  return {
    asset,
    mediaAssetId: asset.id,
    audioUrl: asset.url,
    sourceAudioUrl: audioUrl,
    mediaPersistenceError: null
  };
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

app.get('/api/paragraph-comments', async (req, res, next) => {
  try {
    const articleId = String(req.query.articleId || '').trim();
    const chapterId = String(req.query.chapterId || '').trim();
    if (!articleId || !chapterId) {
      res.status(400).json({ error: 'articleId and chapterId are required' });
      return;
    }
    res.json({ comments: await listParagraphComments({ articleId, chapterId }) });
  } catch (error) { next(error); }
});

app.post('/api/paragraph-comments', requireAuth, async (req, res, next) => {
  try {
    const articleId = String(req.body.articleId || '').trim();
    const chapterId = String(req.body.chapterId || '').trim();
    const paragraphIndex = Number(req.body.paragraphIndex);
    const content = String(req.body.content || '').trim();
    const chapter = chapters.find((item) => item.id === chapterId);
    if (!articleId || !chapter || !Number.isInteger(paragraphIndex) || !chapter.paragraphs[paragraphIndex]) {
      res.status(400).json({ error: 'Invalid paragraph position' });
      return;
    }
    if (!content || content.length > 1000) {
      res.status(400).json({ error: 'Comment must contain 1 to 1000 characters' });
      return;
    }
    const comment = await createParagraphComment({
      id: crypto.randomUUID(), articleId, chapterId, paragraphIndex,
      userId: req.user.id, content
    });
    res.status(201).json({ comment });
  } catch (error) { next(error); }
});

app.delete('/api/paragraph-comments/:id', requireAuth, async (req, res, next) => {
  try {
    const deleted = await deleteParagraphComment(String(req.params.id), req.user.id);
    if (!deleted) {
      res.status(404).json({ error: 'Comment not found or you cannot delete it' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/ai/clue-images', optionalAuth, async (req, res) => {
  try {
    const articleId = String(req.query.articleId || 'speckled-band');
    const occurrenceIds = new Set(
      String(req.query.occurrenceIds || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    );
    if (occurrenceIds.size === 0) {
      res.json({ images: [] });
      return;
    }
    const requestedClueIds = new Set(
      clues
        .filter((clue) => clue.occurrences.some((occurrence) => occurrenceIds.has(occurrence.id)))
        .map((clue) => clue.id)
    );
    let assets = [];
    let persistenceWarning = null;
    try {
      assets = await listMediaAssets({ articleId, mediaType: 'image' });
    } catch (error) {
      persistenceWarning = error.message || '媒体数据库不可用';
    }
    const images = selectResolvedClueAssets(assets, { clueIds: requestedClueIds }).map((asset) =>
      clueImageAssetResponse(asset)
    );
    res.json({ images, persistenceAvailable: !persistenceWarning, warning: persistenceWarning });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to list clue images' });
  }
});

app.get('/api/media/assets', optionalAuth, async (req, res) => {
  try {
    const { articleId, chapterId, mediaType, userId } = req.query;
    const assets = await listMediaAssets({
      articleId: articleId ? String(articleId) : undefined,
      chapterId: chapterId ? String(chapterId) : undefined,
      mediaType: mediaType ? String(mediaType) : undefined,
      userId: userId ? String(userId) : undefined
    });

    res.json({ assets: assets.filter((asset) => !isClueImageAsset(asset)) });
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

function requireContentUnit(unitId) {
  const unit = getContentUnit(unitId);
  if (!unit) {
    const error = new Error('Standard dubbing unit not found');
    error.statusCode = 404;
    throw error;
  }
  return unit;
}

function versionVisibility(value) {
  return value === 'public' ? 'public' : 'private';
}

function sendRouteError(res, error, fallback) {
  const candidate = Number(error?.statusCode);
  const status = Number.isInteger(candidate) && candidate >= 400 && candidate <= 599 ? candidate : 500;
  res.status(status).json({ error: error?.message || fallback });
}

async function cleanUpPersistedAudio(persisted) {
  if (!persisted?.mediaAssetId) {
    return;
  }
  try {
    const asset = await deleteMediaAsset(persisted.mediaAssetId);
    await removeStoredMedia(asset?.filePath);
  } catch (error) {
    console.error('Failed to clean up orphaned audio asset:', error);
  }
}

app.get('/api/dubbing/units', optionalAuth, (req, res) => {
  const articleId = String(req.query.articleId || 'speckled-band');
  const chapterId = req.query.chapterId ? String(req.query.chapterId) : undefined;
  const units = listContentUnits({ articleId, chapterId }).map(toPublicContentUnit);
  res.json({ units });
});

app.get('/api/dubbing/unit-at-position', optionalAuth, async (req, res) => {
  try {
    const unit = getContentUnitByPosition({
      articleId: String(req.query.articleId || 'speckled-band'),
      chapterId: String(req.query.chapterId || ''),
      paragraphIndex: normalizeInteger(req.query.paragraphIndex)
    });
    if (!unit) {
      res.status(404).json({ error: 'Standard dubbing unit not found' });
      return;
    }
    const versions = await communityStore.listVersionsForUnit(unit.id, req.user?.id || '');
    res.json({ unit: toPublicContentUnit(unit), versions });
  } catch (error) {
    sendRouteError(res, error, 'Failed to locate dubbing unit');
  }
});

app.get('/api/dubbing/units/:unitId/versions', optionalAuth, async (req, res) => {
  try {
    const unit = requireContentUnit(req.params.unitId);
    const versions = await communityStore.listVersionsForUnit(unit.id, req.user?.id || '');
    res.json({ unit: toPublicContentUnit(unit), versions });
  } catch (error) {
    sendRouteError(res, error, 'Failed to list dubbing versions');
  }
});

app.get('/api/dubbing/adoptions', optionalAuth, async (req, res) => {
  try {
    const versions = req.user
      ? await communityStore.listAdoptedVersions({
          userId: req.user.id,
          articleId: String(req.query.articleId || 'speckled-band'),
          chapterId: req.query.chapterId ? String(req.query.chapterId) : undefined
        })
      : [];
    res.json({ versions });
  } catch (error) {
    sendRouteError(res, error, 'Failed to list adopted dubbing versions');
  }
});

app.get('/api/dubbing/voice-designs', requireAuth, async (req, res) => {
  try {
    const versions = await communityStore.listVoiceDesignVersions({
      ownerUserId: req.user.id,
      articleId: String(req.query.articleId || 'speckled-band'),
      characterCode: req.query.characterCode ? String(req.query.characterCode) : undefined
    });
    res.json({ versions });
  } catch (error) {
    sendRouteError(res, error, 'Failed to list character voice designs');
  }
});

app.post('/api/dubbing/voice-designs', requireAuth, async (req, res) => {
  let savedPreview = null;
  let previewAsset = null;
  try {
    const articleId = String(req.body.articleId || 'speckled-band');
    const characterCode = String(req.body.characterCode || '').trim();
    const characterName = String(req.body.characterName || '').trim();
    const prompt = String(req.body.prompt || '').trim();
    const previewText = String(req.body.previewText || '').trim();

    if (!/^[a-z0-9_-]{2,64}$/i.test(characterCode)) {
      res.status(400).json({ error: 'characterCode is invalid' });
      return;
    }
    if (!characterName || characterName.length > 80) {
      res.status(400).json({ error: 'characterName is required and must be at most 80 characters' });
      return;
    }
    if (prompt.length < 5 || prompt.length > 500) {
      res.status(400).json({ error: 'Voice prompt must contain 5-500 characters' });
      return;
    }
    if (previewText.length < 5 || previewText.length > 200) {
      res.status(400).json({ error: 'Preview text must contain 5-200 characters' });
      return;
    }

    const designed = await designVoice({ prompt, previewText });
    if (!designed.voiceId) {
      throw new Error('Voice provider did not return a voice ID');
    }
    if (designed.trialAudioUrl) {
      savedPreview = await saveAudioDataUrl(designed.trialAudioUrl);
      try {
        previewAsset = await createMediaAsset({
          id: crypto.randomUUID(),
          articleId,
          chapterId: null,
          paragraphIndex: null,
          range: null,
          mediaType: 'audio',
          url: savedPreview.url,
          sourceUrl: null,
          filePath: savedPreview.filePath,
          prompt,
          sourceText: previewText,
          provider: 'minimax',
          model: 'voice-design',
          userId: req.user.id,
          metadata: { generationType: 'character-voice-preview', characterCode }
        });
      } catch (error) {
        throw error;
      }
    }

    const version = await communityStore.createVoiceDesignVersion({
      ownerUserId: req.user.id,
      articleId,
      characterCode,
      characterName,
      prompt,
      previewText,
      voiceId: designed.voiceId,
      previewAudioUrl: savedPreview?.url || null,
      previewMediaAssetId: previewAsset?.id || null
    });
    res.status(201).json({ version });
  } catch (error) {
    if (previewAsset) {
      await deleteMediaAsset(previewAsset.id).catch(() => null);
      await removeStoredMedia(previewAsset.filePath).catch(() => {});
    } else if (savedPreview?.filePath) {
      await removeStoredMedia(savedPreview.filePath).catch(() => {});
    }
    sendRouteError(res, error, 'Failed to create character voice design');
  }
});

app.post('/api/dubbing/units/:unitId/ai-plan', requireAuth, async (req, res) => {
  try {
    const unit = requireContentUnit(req.params.unitId);
    if (!unit.hasDialogue) {
      res.status(400).json({ error: 'This paragraph does not contain character dialogue' });
      return;
    }
    const plan = await planParagraphSpeech({
      chapterId: unit.chapterId,
      paragraphIndex: unit.paragraphIndex,
      targetSegment: unit.sourceText
    });
    res.json({ unit: toPublicContentUnit(unit), plan });
  } catch (error) {
    sendRouteError(res, error, 'Failed to plan AI dubbing');
  }
});

app.post('/api/dubbing/units/:unitId/ai-versions', requireAuth, async (req, res) => {
  let persisted = null;
  try {
    const unit = requireContentUnit(req.params.unitId);
    const designIds =
      req.body.voiceDesignVersionIdsBySpeaker && typeof req.body.voiceDesignVersionIdsBySpeaker === 'object'
        ? req.body.voiceDesignVersionIdsBySpeaker
        : {};
    const voiceOverrides = {};
    const voiceDesigns = {};

    for (const [speakerCode, versionId] of Object.entries(designIds)) {
      const design = await communityStore.getVoiceDesignVersion(String(versionId), req.user.id);
      if (!design || design.articleId !== unit.articleId || design.characterCode !== speakerCode) {
        res.status(400).json({ error: `Invalid voice design for speaker ${speakerCode}` });
        return;
      }
      voiceOverrides[speakerCode] = {
        voiceId: design.voiceId,
        characterName: design.characterName
      };
      voiceDesigns[speakerCode] = {
        versionId: design.id,
        characterName: design.characterName,
        prompt: design.prompt,
        previewText: design.previewText,
        versionNumber: design.versionNumber
      };
    }

    const result = await synthesizePlannedParagraphSpeech({
      chapterId: unit.chapterId,
      paragraphIndex: unit.paragraphIndex,
      targetSegment: unit.sourceText,
      segments: req.body.segments,
      voiceOverrides,
      generationSettings: req.body.generationSettings
    });
    persisted = await persistGeneratedAudio({
      req,
      audioUrl: result.audioUrl,
      prompt: unit.sourceText,
      sourceText: unit.sourceText,
      model: process.env.MINIMAX_TTS_MODEL || 'speech-2.8-hd',
      position: {
        articleId: unit.articleId,
        chapterId: unit.chapterId,
        paragraphIndex: unit.paragraphIndex,
        range: unit.range
      },
      userId: req.user.id,
      metadata: {
        generationType: 'community-ai-dubbing',
        unitId: unit.id,
        sourceHash: unit.sourceHash,
        durationMs: result.durationMs,
        segmentCount: result.segmentCount,
        script: result.script,
        planSegments: result.planSegments,
        generationSettings: result.generationSettings,
        ttsRequests: result.ttsRequests,
        traceId: result.traceId
      }
    });
    if (!persisted.mediaAssetId) {
      throw new Error(persisted.mediaPersistenceError || 'AI dubbing audio could not be persisted');
    }

    const version = await communityStore.createDubbingVersion({
      ownerUserId: req.user.id,
      unitId: unit.id,
      articleId: unit.articleId,
      chapterId: unit.chapterId,
      paragraphIndex: unit.paragraphIndex,
      kind: 'ai',
      status: versionVisibility(req.body.visibility),
      audioUrl: persisted.audioUrl,
      mediaAssetId: persisted.mediaAssetId,
      sourceText: unit.sourceText,
      sourceHash: unit.sourceHash,
      durationMs: result.durationMs,
      promptSnapshot: {
        voiceDesigns,
        performanceSegments: result.planSegments,
        generationSettings: result.generationSettings,
        ttsRequests: result.ttsRequests
      },
      segments: result.planSegments
    });
    res.status(201).json({ unit: toPublicContentUnit(unit), version });
  } catch (error) {
    await cleanUpPersistedAudio(persisted);
    sendRouteError(res, error, 'Failed to create AI dubbing version');
  }
});

app.post('/api/dubbing/units/:unitId/human-versions', requireAuth, async (req, res) => {
  let persisted = null;
  try {
    const unit = requireContentUnit(req.params.unitId);
    const audioDataUrl = String(req.body.audioDataUrl || '');
    if (!audioDataUrl.startsWith('data:audio/') && !audioDataUrl.startsWith('data:video/')) {
      res.status(400).json({ error: 'A valid audio recording is required' });
      return;
    }
    persisted = await persistGeneratedAudio({
      req,
      audioUrl: audioDataUrl,
      prompt: unit.sourceText,
      sourceText: unit.sourceText,
      model: null,
      position: {
        articleId: unit.articleId,
        chapterId: unit.chapterId,
        paragraphIndex: unit.paragraphIndex,
        range: unit.range
      },
      provider: 'user_recording',
      userId: req.user.id,
      metadata: {
        generationType: 'community-human-dubbing',
        unitId: unit.id,
        sourceHash: unit.sourceHash,
        dialogueOnly: true
      }
    });
    if (!persisted.mediaAssetId) {
      throw new Error(persisted.mediaPersistenceError || 'Human dubbing audio could not be persisted');
    }
    const version = await communityStore.createDubbingVersion({
      ownerUserId: req.user.id,
      unitId: unit.id,
      articleId: unit.articleId,
      chapterId: unit.chapterId,
      paragraphIndex: unit.paragraphIndex,
      kind: 'human',
      status: versionVisibility(req.body.visibility),
      audioUrl: persisted.audioUrl,
      mediaAssetId: persisted.mediaAssetId,
      sourceText: unit.sourceText,
      sourceHash: unit.sourceHash,
      durationMs: null,
      promptSnapshot: null,
      segments: []
    });
    res.status(201).json({ unit: toPublicContentUnit(unit), version });
  } catch (error) {
    await cleanUpPersistedAudio(persisted);
    sendRouteError(res, error, 'Failed to create human dubbing version');
  }
});

app.patch('/api/dubbing/versions/:versionId/status', requireAuth, async (req, res) => {
  try {
    const status = String(req.body.status || '');
    const version = await communityStore.setVersionStatus(req.params.versionId, req.user.id, status);
    if (!version) {
      res.status(404).json({ error: 'Dubbing version not found' });
      return;
    }
    if (status === 'deleted' && version.mediaAssetId) {
      try {
        const asset = await deleteMediaAsset(version.mediaAssetId);
        await removeStoredMedia(asset?.filePath);
      } catch (cleanupError) {
        console.error('Failed to clean up deleted private dubbing media:', cleanupError);
      }
    }
    res.json({ version });
  } catch (error) {
    sendRouteError(res, error, 'Failed to update dubbing status');
  }
});

app.post('/api/dubbing/versions/:versionId/like', requireAuth, async (req, res) => {
  try {
    const version = await communityStore.setLike(req.params.versionId, req.user.id, true);
    if (!version) {
      res.status(404).json({ error: 'Public dubbing version not found' });
      return;
    }
    res.json({ version });
  } catch (error) {
    sendRouteError(res, error, 'Failed to like dubbing version');
  }
});

app.delete('/api/dubbing/versions/:versionId/like', requireAuth, async (req, res) => {
  try {
    const version = await communityStore.setLike(req.params.versionId, req.user.id, false);
    if (!version) {
      res.status(404).json({ error: 'Public dubbing version not found' });
      return;
    }
    res.json({ version });
  } catch (error) {
    sendRouteError(res, error, 'Failed to unlike dubbing version');
  }
});

app.put('/api/dubbing/units/:unitId/adoption', requireAuth, async (req, res) => {
  try {
    const unit = requireContentUnit(req.params.unitId);
    const requestedVersion = await communityStore.getVersion(String(req.body.versionId || ''), req.user.id);
    if (!requestedVersion || requestedVersion.unitId !== unit.id || requestedVersion.status !== 'public') {
      res.status(400).json({ error: 'A public dubbing version from this unit is required' });
      return;
    }
    const version = await communityStore.adoptVersion(requestedVersion.id, req.user.id);
    res.json({ version });
  } catch (error) {
    sendRouteError(res, error, 'Failed to adopt dubbing version');
  }
});

app.delete('/api/dubbing/units/:unitId/adoption', requireAuth, async (req, res) => {
  try {
    const unit = requireContentUnit(req.params.unitId);
    const removed = await communityStore.cancelAdoption(unit.id, req.user.id);
    res.json({ ok: true, removed });
  } catch (error) {
    sendRouteError(res, error, 'Failed to cancel dubbing adoption');
  }
});

app.post('/api/dubbing/versions/:versionId/reports', requireAuth, async (req, res) => {
  try {
    const reason = String(req.body.reason || '').trim();
    if (reason.length < 3 || reason.length > 500) {
      res.status(400).json({ error: 'Report reason must contain 3-500 characters' });
      return;
    }
    const report = await communityStore.createReport({
      versionId: req.params.versionId,
      reporterUserId: req.user.id,
      reason
    });
    if (!report) {
      res.status(404).json({ error: 'Public dubbing version not found' });
      return;
    }
    res.status(201).json({ report });
  } catch (error) {
    sendRouteError(res, error, 'Failed to report dubbing version');
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

app.post('/api/ai/clue-image', optionalAuth, async (req, res) => {
  try {
    const clueId = String(req.body.clueId || '').trim();
    const occurrenceId = String(req.body.occurrenceId || '').trim();
    const force = req.body.force === true;
    if (!clueId || !occurrenceId) {
      res.status(400).json({ error: 'clueId and occurrenceId are required' });
      return;
    }

    if (!force) {
      const cached = await findClueImageAsset({
        articleId: 'speckled-band',
        clueId
      });
      if (cached) {
        res.json(clueImageAssetResponse(cached));
        return;
      }

      let generationPromise = clueGenerationPromises.get(clueId);
      if (!generationPromise) {
        generationPromise = (async () => {
          const latest = await findClueImageAsset({
            articleId: 'speckled-band',
            clueId
          });
          if (latest) {
            return clueImageAssetResponse(latest);
          }
          const prepared = await prepareClueImage({ clueId, occurrenceId });
          return generateAndPersistClueImage({ req, prepared });
        })().finally(() => {
          clueGenerationPromises.delete(clueId);
        });
        clueGenerationPromises.set(clueId, generationPromise);
      }
      res.json(await generationPromise);
      return;
    }

    const prepared = await prepareClueImage({ clueId, occurrenceId });
    res.json(await generateAndPersistClueImage({ req, prepared }));
  } catch (error) {
    const status = /未知线索|出现位置/.test(error.message || '') ? 400 : 500;
    res.status(status).json({ error: error.message || 'MiniMax clue image generation failed' });
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

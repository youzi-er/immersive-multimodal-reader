import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const officialIllustrationSelections = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../content/official-illustration-selections.json'), 'utf8')
);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
import { applyClueManifest, chapters, clues, getClueOccurrence, getParagraphContext } from './data.js';
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
  updateUserDisplayName,
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
  generateDiyParagraphIllustration,
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
  planPreparedParagraphSpeech,
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
import { coverStore } from './cover-store.js';
import { illustrationStore } from './illustration-store.js';
import { clueImageStore } from './clue-image-store.js';
import { officialClueCatalogStore } from './official-clue-catalog-store.js';
import {
  buildPublishedClueManifest,
  CLUE_CURATION_ARTICLE_ID,
  clueDraftSummary,
  createSuggestedClueDraft,
  getOfficialClueSourceManifest,
  upgradeClueDraftToCurrentRecommendations,
  validateClueDraft
} from './official-clue-curation.js';
import { getPreparedDubbingPlan } from './prepared-dubbing-plans.js';
import { buildCoverPrompt } from './services/coverImage.js';
import { ensureBookStyle } from './services/bookImageStyle.js';
import { generateClueImageCandidates } from './services/clueCreativeImage.js';

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

function requireOfficialStudioAccess(req, res, next) {
  const configuredUserIds = String(process.env.OFFICIAL_STUDIO_USER_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const allowedUserIds = configuredUserIds.length > 0
    ? configuredUserIds
    : process.env.NODE_ENV === 'production' ? [] : ['demo-user'];
  if (!req.user || !allowedUserIds.includes(req.user.id)) {
    res.status(403).json({ error: 'Official illustration studio access is required' });
    return;
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

app.patch('/api/auth/me', requireAuth, async (req, res, next) => {
  try {
    const displayName = String(req.body.displayName ?? '').trim();

    if (displayName.length < 1) {
      res.status(400).json({ error: 'Display name cannot be empty' });
      return;
    }

    if (displayName.length > 40) {
      res.status(400).json({ error: 'Display name must be 40 characters or fewer' });
      return;
    }

    const user = await updateUserDisplayName(req.user.id, displayName);
    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
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

function clueStudioSourceClues() {
  return getOfficialClueSourceManifest().clues.map((clue) => ({
    ...clue,
    occurrences: clue.occurrences.map((occurrence) => ({
      ...occurrence,
      fullParagraph: getParagraphContext({
        chapterId: occurrence.chapterId,
        paragraphIndex: occurrence.paragraphIndex,
        contextChars: 0
      })?.originalTarget || ''
    }))
  }));
}

app.get(
  '/api/clue-studio/catalog',
  requireAuth,
  requireOfficialStudioAccess,
  async (req, res) => {
    try {
      const suggestedDraft = createSuggestedClueDraft();
      let catalog = await officialClueCatalogStore.getCatalog(CLUE_CURATION_ARTICLE_ID);
      if (!catalog) {
        catalog = await officialClueCatalogStore.ensureDraft({
          articleId: CLUE_CURATION_ARTICLE_ID,
          sourceSha256: suggestedDraft.sourceSha256,
          draft: suggestedDraft,
          userId: req.user.id
        });
      }
      if (catalog.sourceSha256 !== suggestedDraft.sourceSha256) {
        res.status(409).json({ error: 'The source book changed after this curation draft was created' });
        return;
      }
      let draft = upgradeClueDraftToCurrentRecommendations(catalog.draft);
      if (draft.recommendationRevision !== Number(catalog.draft.recommendationRevision || 1)) {
        catalog = await officialClueCatalogStore.saveDraft({
          articleId: CLUE_CURATION_ARTICLE_ID,
          sourceSha256: draft.sourceSha256,
          draft,
          userId: req.user.id
        });
      }
      res.json({
        sourceClues: clueStudioSourceClues(),
        draft,
        summary: clueDraftSummary(draft),
        catalog: {
          draftRevision: catalog.draftRevision,
          publishedRevision: catalog.publishedRevision,
          draftUpdatedAt: catalog.draftUpdatedAt,
          publishedAt: catalog.publishedAt,
          hasPublishedCatalog: Boolean(catalog.published)
        }
      });
    } catch (error) {
      sendRouteError(res, error, 'Failed to load the official clue studio');
    }
  }
);

app.put(
  '/api/clue-studio/draft',
  requireAuth,
  requireOfficialStudioAccess,
  async (req, res) => {
    try {
      const draft = validateClueDraft(req.body.draft);
      const catalog = await officialClueCatalogStore.saveDraft({
        articleId: CLUE_CURATION_ARTICLE_ID,
        sourceSha256: draft.sourceSha256,
        draft,
        userId: req.user.id
      });
      res.json({
        draft,
        summary: clueDraftSummary(draft),
        catalog: {
          draftRevision: catalog.draftRevision,
          publishedRevision: catalog.publishedRevision,
          draftUpdatedAt: catalog.draftUpdatedAt,
          publishedAt: catalog.publishedAt,
          hasPublishedCatalog: Boolean(catalog.published)
        }
      });
    } catch (error) {
      res.status(400).json({ error: error.message || 'Failed to save the official clue draft' });
    }
  }
);

app.post(
  '/api/clue-studio/publish',
  requireAuth,
  requireOfficialStudioAccess,
  async (req, res) => {
    try {
      const draft = validateClueDraft(req.body.draft, { requirePublishableCount: true });
      const published = buildPublishedClueManifest(draft);
      const catalog = await officialClueCatalogStore.publish({
        articleId: CLUE_CURATION_ARTICLE_ID,
        sourceSha256: draft.sourceSha256,
        draft,
        published,
        userId: req.user.id
      });
      applyClueManifest(published);
      res.json({
        draft,
        summary: clueDraftSummary(draft),
        publishedCount: published.clues.length,
        catalog: {
          draftRevision: catalog.draftRevision,
          publishedRevision: catalog.publishedRevision,
          draftUpdatedAt: catalog.draftUpdatedAt,
          publishedAt: catalog.publishedAt,
          hasPublishedCatalog: true
        }
      });
    } catch (error) {
      res.status(400).json({ error: error.message || 'Failed to publish the official clue catalog' });
    }
  }
);

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

    res.json({
      assets: assets.filter(
        (asset) =>
          !isClueImageAsset(asset) &&
          metadataValue(asset, 'generationType') !== 'diy-paragraph-image'
      )
    });
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
    const error = new Error('Standard paragraph unit not found');
    error.statusCode = 404;
    throw error;
  }
  return unit;
}

async function ensureOfficialIllustrationStyle(articleId = 'speckled-band') {
  const { style } = await ensureBookStyle();
  return illustrationStore.ensureOfficialStyle({
    articleId,
    name: '官方插图风格 V1',
    globalStylePrompt: style.global_style_prompt,
    globalNegativePrompt: style.global_negative_prompt || '',
    styleProfile: style.style_profile_cn || {},
    usageNotes: style.usage_notes || ''
  });
}

function versionVisibility(value) {
  return value === 'public' ? 'public' : 'private';
}

function toClientVoiceDesign(version) {
  if (!version) return null;
  const { voiceId: _privateVoiceId, previewMediaAssetId: _privateAssetId, ...safeVersion } = version;
  return safeVersion;
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

async function cleanUpPersistedImage(persisted) {
  if (!persisted?.mediaAssetId) return;
  try {
    const asset = await deleteMediaAsset(persisted.mediaAssetId);
    await removeStoredMedia(asset?.filePath);
  } catch (error) {
    console.error('Failed to clean up orphaned image asset:', error);
  }
}

app.get('/api/dubbing/units', optionalAuth, (req, res) => {
  const articleId = String(req.query.articleId || 'speckled-band');
  const chapterId = req.query.chapterId ? String(req.query.chapterId) : undefined;
  const units = listContentUnits({ articleId, chapterId }).map(toPublicContentUnit);
  res.json({ units });
});

app.get('/api/dubbing/community', optionalAuth, async (req, res) => {
  try {
    const versions = await communityStore.listCommunityVersions({
      currentUserId: req.user?.id || '',
      kind: String(req.query.kind || ''),
      sort: String(req.query.sort || 'popular'),
      limit: normalizeInteger(req.query.limit) || 60,
      offset: normalizeInteger(req.query.offset) || 0
    });
    res.json({ versions });
  } catch (error) {
    sendRouteError(res, error, 'Failed to load the creation square');
  }
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
    const scope = String(req.query.scope || 'mine');
    const versions = scope === 'shared'
      ? await communityStore.listSharedVoiceDesignVersions({ excludeOwnerUserId: req.user.id })
      : await communityStore.listVoiceDesignVersions({ ownerUserId: req.user.id });
    res.json({ versions: versions.map(toClientVoiceDesign) });
  } catch (error) {
    sendRouteError(res, error, 'Failed to list voice designs');
  }
});

app.post('/api/dubbing/voice-designs', requireAuth, async (req, res) => {
  let savedPreview = null;
  let previewAsset = null;
  try {
    const articleId = 'global';
    const characterCode = String(req.body.voiceKey || req.body.characterCode || `voice_${crypto.randomUUID().replaceAll('-', '')}`).trim();
    const characterName = String(req.body.voiceName || req.body.characterName || '').trim();
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
    res.status(201).json({ version: toClientVoiceDesign(version) });
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
    const prepared = getPreparedDubbingPlan(unit);
    if (prepared.segments.length === 0) {
      res.status(400).json({ error: 'This paragraph does not contain character dialogue' });
      return;
    }
    const plan = await planPreparedParagraphSpeech({
      chapterId: unit.chapterId,
      paragraphIndex: unit.paragraphIndex,
      targetSegment: unit.sourceText,
      preparedSegments: prepared.segments,
      planSource: prepared.source,
      contentVersion: prepared.contentVersion
    });
    res.json({ unit: toPublicContentUnit(unit), plan });
  } catch (error) {
    console.error('Failed to load prepared AI dubbing plan:', error);
    res.status(503).json({ error: '配音方案暂时无法加载，请稍后重试' });
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
    const requestedSharedIds = new Set(
      Array.isArray(req.body.sharedVoiceDesignVersionIds)
        ? req.body.sharedVoiceDesignVersionIds.map((value) => String(value))
        : []
    );
    const usedDesignIds = new Set(Object.values(designIds).map((value) => String(value)));
    const sharedVoiceDesignVersionIds = [];

    for (const [speakerCode, versionId] of Object.entries(designIds)) {
      const design = await communityStore.getUsableVoiceDesignVersion(String(versionId), req.user.id);
      if (!design) {
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
        versionNumber: design.versionNumber,
        ownerDisplayName: design.ownerDisplayName,
        shared: requestedSharedIds.has(design.id) && design.ownerUserId === req.user.id
      };
    }

    for (const versionId of requestedSharedIds) {
      if (!usedDesignIds.has(versionId)) {
        res.status(400).json({ error: 'Only voices used by this dubbing can be shared' });
        return;
      }
      const design = await communityStore.getVoiceDesignVersion(versionId, req.user.id);
      if (!design) {
        res.status(400).json({ error: 'Only your own voice designs can be shared' });
        return;
      }
      sharedVoiceDesignVersionIds.push(versionId);
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
      segments: result.planSegments,
      sharedVoiceDesignVersionIds
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

app.get('/api/illustrations/styles/official', optionalAuth, async (req, res) => {
  try {
    const articleId = String(req.query.articleId || 'speckled-band');
    const style = await ensureOfficialIllustrationStyle(articleId);
    res.json({ style });
  } catch (error) {
    sendRouteError(res, error, 'Failed to load the official illustration style');
  }
});

app.get('/api/illustrations/official-slots', optionalAuth, async (req, res) => {
  try {
    const articleId = String(req.query.articleId || 'speckled-band');
    const chapterId = req.query.chapterId ? String(req.query.chapterId) : '';
    const slots = await illustrationStore.listOfficialSlots({ articleId, chapterId });
    res.json({ slots });
  } catch (error) {
    sendRouteError(res, error, 'Failed to load official illustration slots');
  }
});

app.get(
  '/api/illustrations/official-selections',
  requireAuth,
  requireOfficialStudioAccess,
  async (_req, res) => {
    try {
      const selections = officialIllustrationSelections.selections.map((selection) => {
        const unit = getContentUnitByPosition({
          articleId: officialIllustrationSelections.articleId,
          chapterId: selection.chapterId,
          paragraphIndex: selection.paragraphIndex
        });
        if (!unit || !unit.sourceText.includes(selection.locatorText)) {
          throw new Error(`Official selection ${selection.id} no longer matches the source paragraph`);
        }
        return {
          ...selection,
          articleId: officialIllustrationSelections.articleId,
          placementRule: officialIllustrationSelections.placementRule,
          unit: toPublicContentUnit(unit)
        };
      });
      res.json({ selections });
    } catch (error) {
      sendRouteError(res, error, 'Failed to load official illustration selections');
    }
  }
);

app.post(
  '/api/illustrations/official-slots',
  requireAuth,
  requireOfficialStudioAccess,
  async (req, res) => {
    try {
      const selection = officialIllustrationSelections.selections.find(
        (item) => item.id === String(req.body.selectionId || '')
      );
      if (!selection) {
        res.status(400).json({ error: 'A valid official illustration selection is required' });
        return;
      }
      const version = await illustrationStore.getVersion(String(req.body.versionId || ''), req.user.id);
      if (
        !version || version.ownerUserId !== req.user.id ||
        ['deleted', 'moderated'].includes(version.status) ||
        version.chapterId !== selection.chapterId || version.paragraphIndex !== selection.paragraphIndex
      ) {
        res.status(400).json({ error: 'Choose one of your illustration candidates for this paragraph' });
        return;
      }
      const unit = requireContentUnit(version.unitId);
      const promptExcerpt = String(req.body.promptExcerpt || selection.promptExcerpt).trim();
      if (!promptExcerpt || promptExcerpt.length > 4000) {
        res.status(400).json({ error: 'The illustration focus must be between 1 and 4000 characters' });
        return;
      }
      const slot = await illustrationStore.upsertOfficialSlot({
        id: selection.id,
        unitId: unit.id,
        articleId: unit.articleId,
        chapterId: unit.chapterId,
        paragraphIndex: unit.paragraphIndex,
        imageUrl: version.imageUrl,
        mediaAssetId: version.mediaAssetId,
        promptExcerpt,
        sourceText: unit.sourceText,
        sourceHash: unit.sourceHash
      });
      res.json({ slot });
    } catch (error) {
      sendRouteError(res, error, 'Failed to select the official illustration');
    }
  }
);

app.get('/api/illustrations/community', optionalAuth, async (req, res) => {
  try {
    const scope = String(req.query.scope || 'all');
    if (!['all', 'mine'].includes(scope)) {
      res.status(400).json({ error: 'Unsupported illustration community scope' });
      return;
    }
    const versions = await illustrationStore.listCommunityVersions({
      articleId: String(req.query.articleId || ''),
      unitId: String(req.query.unitId || ''),
      currentUserId: req.user?.id || '',
      sort: String(req.query.sort || 'popular'),
      scope,
      limit: normalizeInteger(req.query.limit) || 60,
      offset: normalizeInteger(req.query.offset) || 0
    });
    res.json({ versions });
  } catch (error) {
    sendRouteError(res, error, 'Failed to load the illustration community');
  }
});

app.get('/api/illustrations/unit-at-position', optionalAuth, async (req, res) => {
  try {
    const unit = getContentUnitByPosition({
      articleId: String(req.query.articleId || 'speckled-band'),
      chapterId: String(req.query.chapterId || ''),
      paragraphIndex: normalizeInteger(req.query.paragraphIndex)
    });
    if (!unit) {
      res.status(404).json({ error: 'Standard paragraph unit not found' });
      return;
    }
    const versions = await illustrationStore.listVersionsForUnit(unit.id, req.user?.id || '');
    const myVersions = req.user
      ? await illustrationStore.listMyVersions({ ownerUserId: req.user.id, unitId: unit.id })
      : [];
    res.json({ unit: toPublicContentUnit(unit), versions, myVersions });
  } catch (error) {
    sendRouteError(res, error, 'Failed to locate the illustration paragraph');
  }
});

app.get('/api/illustrations/units/:unitId/versions', optionalAuth, async (req, res) => {
  try {
    const unit = requireContentUnit(req.params.unitId);
    const versions = await illustrationStore.listVersionsForUnit(unit.id, req.user?.id || '');
    const myVersions = req.user
      ? await illustrationStore.listMyVersions({ ownerUserId: req.user.id, unitId: unit.id })
      : [];
    res.json({ unit: toPublicContentUnit(unit), versions, myVersions });
  } catch (error) {
    sendRouteError(res, error, 'Failed to list illustration versions');
  }
});

app.get('/api/illustrations/adoptions', optionalAuth, async (req, res) => {
  try {
    const versions = req.user
      ? await illustrationStore.listAdoptedVersions({
          userId: req.user.id,
          articleId: String(req.query.articleId || 'speckled-band'),
          chapterId: req.query.chapterId ? String(req.query.chapterId) : ''
        })
      : [];
    res.json({ versions });
  } catch (error) {
    sendRouteError(res, error, 'Failed to list adopted illustrations');
  }
});

app.post('/api/illustrations/units/:unitId/versions', requireAuth, async (req, res) => {
  let persisted = null;
  try {
    const unit = requireContentUnit(req.params.unitId);
    const promptMode = String(req.body.promptMode || '');
    const finalPrompt = String(req.body.finalPrompt ?? '');
    if (!['official', 'free'].includes(promptMode)) {
      res.status(400).json({ error: 'promptMode must be official or free' });
      return;
    }
    if (!finalPrompt.trim() || finalPrompt.length > 1400) {
      res.status(400).json({ error: 'finalPrompt must contain 1-1400 characters' });
      return;
    }

    let styleVersion = null;
    if (promptMode === 'official') {
      const requestedStyleId = String(req.body.styleVersionId || '');
      styleVersion = requestedStyleId
        ? await illustrationStore.getStyleVersion(requestedStyleId)
        : await ensureOfficialIllustrationStyle(unit.articleId);
      if (!styleVersion || styleVersion.articleId !== unit.articleId) {
        res.status(400).json({ error: 'A valid official style version for this book is required' });
        return;
      }
    }

    const generated = await generateDiyParagraphIllustration({ finalPrompt });
    persisted = await persistGeneratedImage({
      req,
      sourceUrl: generated.imageUrl,
      prompt: generated.prompt,
      sourceText: unit.sourceText,
      model: generated.model,
      metadata: {
        traceId: generated.traceId,
        generationType: 'diy-paragraph-image',
        unitId: unit.id,
        promptMode,
        styleVersionId: styleVersion?.id || null,
        aspectRatio: '16:9'
      },
      position: {
        articleId: unit.articleId,
        chapterId: unit.chapterId,
        paragraphIndex: unit.paragraphIndex,
        range: unit.range
      },
      userId: req.user.id
    });
    const createdVersion = await illustrationStore.createVersion({
      ownerUserId: req.user.id,
      unitId: unit.id,
      articleId: unit.articleId,
      chapterId: unit.chapterId,
      paragraphIndex: unit.paragraphIndex,
      imageUrl: persisted.imageUrl,
      mediaAssetId: persisted.mediaAssetId,
      promptMode,
      finalPrompt,
      styleVersionId: styleVersion?.id || null,
      model: generated.model,
      sourceText: unit.sourceText,
      sourceHash: unit.sourceHash
    });
    const version = await illustrationStore.adoptVersion({
      versionId: createdVersion.id,
      userId: req.user.id,
      unitId: unit.id
    });
    res.status(201).json({ unit: toPublicContentUnit(unit), version, traceId: generated.traceId });
  } catch (error) {
    await cleanUpPersistedImage(persisted);
    sendRouteError(res, error, 'Illustration generation failed');
  }
});

app.patch('/api/illustrations/versions/:versionId/status', requireAuth, async (req, res) => {
  try {
    const status = String(req.body.status || '');
    if (!['public', 'withdrawn', 'deleted'].includes(status)) {
      res.status(400).json({ error: 'Unsupported illustration status' });
      return;
    }
    const version = await illustrationStore.setVersionStatus(
      req.params.versionId,
      req.user.id,
      status,
      String(req.body.replaceVersionId || '')
    );
    if (!version) {
      res.status(404).json({ error: 'Illustration version not found' });
      return;
    }
    res.json({ version });
  } catch (error) {
    if (error?.code === 'PUBLIC_VERSION_LIMIT') {
      res.status(409).json({
        error: error.message,
        code: error.code,
        publicVersionIds: error.publicVersionIds || []
      });
      return;
    }
    sendRouteError(res, error, 'Failed to update illustration status');
  }
});

app.put('/api/illustrations/units/:unitId/adoption', requireAuth, async (req, res) => {
  try {
    const unit = requireContentUnit(req.params.unitId);
    const version = await illustrationStore.adoptVersion({
      versionId: String(req.body.versionId || ''),
      userId: req.user.id,
      unitId: unit.id
    });
    if (!version) {
      res.status(400).json({ error: 'An available illustration from this paragraph is required' });
      return;
    }
    res.json({ unit: toPublicContentUnit(unit), version });
  } catch (error) {
    sendRouteError(res, error, 'Failed to adopt illustration');
  }
});

app.delete('/api/illustrations/units/:unitId/adoption', requireAuth, async (req, res) => {
  try {
    const unit = requireContentUnit(req.params.unitId);
    const removed = await illustrationStore.clearAdoption({ userId: req.user.id, unitId: unit.id });
    res.json({ ok: true, removed });
  } catch (error) {
    sendRouteError(res, error, 'Failed to restore the one-click illustration');
  }
});

app.post('/api/illustrations/versions/:versionId/like', requireAuth, async (req, res) => {
  try {
    const version = await illustrationStore.setLike(req.params.versionId, req.user.id, true);
    if (!version) {
      res.status(404).json({ error: 'Public illustration version not found' });
      return;
    }
    res.json({ version });
  } catch (error) {
    sendRouteError(res, error, 'Failed to like illustration');
  }
});

app.delete('/api/illustrations/versions/:versionId/like', requireAuth, async (req, res) => {
  try {
    const version = await illustrationStore.setLike(req.params.versionId, req.user.id, false);
    if (!version) {
      res.status(404).json({ error: 'Public illustration version not found' });
      return;
    }
    res.json({ version });
  } catch (error) {
    sendRouteError(res, error, 'Failed to unlike illustration');
  }
});

app.get('/api/illustrations/versions/:versionId/comments', optionalAuth, async (req, res) => {
  try {
    const comments = await illustrationStore.listComments(req.params.versionId);
    res.json({ comments });
  } catch (error) {
    sendRouteError(res, error, 'Failed to load illustration comments');
  }
});

app.post('/api/illustrations/versions/:versionId/comments', requireAuth, async (req, res) => {
  try {
    const comment = await illustrationStore.createComment({
      versionId: req.params.versionId,
      userId: req.user.id,
      content: req.body.content
    });
    if (!comment) {
      res.status(404).json({ error: 'Public illustration version not found' });
      return;
    }
    res.status(201).json({ comment });
  } catch (error) {
    sendRouteError(res, error, 'Failed to publish illustration comment');
  }
});

app.delete('/api/illustrations/comments/:commentId', requireAuth, async (req, res) => {
  try {
    const removed = await illustrationStore.deleteComment({
      commentId: req.params.commentId,
      userId: req.user.id
    });
    if (!removed) {
      res.status(404).json({ error: 'Your illustration comment was not found' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    sendRouteError(res, error, 'Failed to delete illustration comment');
  }
});

app.post('/api/illustrations/versions/:versionId/reports', requireAuth, async (req, res) => {
  try {
    const report = await illustrationStore.createReport({
      versionId: req.params.versionId,
      reporterUserId: req.user.id,
      reason: req.body.reason
    });
    if (!report) {
      res.status(404).json({ error: 'Public illustration version not found' });
      return;
    }
    res.status(201).json({ report });
  } catch (error) {
    sendRouteError(res, error, 'Failed to report illustration');
  }
});

app.get('/api/covers/history', requireAuth, async (req, res) => {
  try {
    const articleId = String(req.query.articleId || 'speckled-band');
    const versions = await coverStore.listHistory({ ownerUserId: req.user.id, articleId });
    res.json({ versions });
  } catch (error) {
    sendRouteError(res, error, 'Failed to load cover history');
  }
});

app.get('/api/covers/current', optionalAuth, async (req, res) => {
  try {
    const articleId = String(req.query.articleId || 'speckled-band');
    const version = req.user
      ? await coverStore.getCurrentCover({ userId: req.user.id, articleId })
      : null;
    res.json({ version });
  } catch (error) {
    sendRouteError(res, error, 'Failed to load the active cover');
  }
});

app.get('/api/covers/community', optionalAuth, async (req, res) => {
  try {
    const scope = String(req.query.scope || 'all');
    if (!['all', 'mine', 'collected'].includes(scope)) {
      res.status(400).json({ error: 'Unsupported cover community scope' });
      return;
    }
    const versions = await coverStore.listCommunityVersions({
      articleId: String(req.query.articleId || ''),
      currentUserId: req.user?.id || '',
      sort: String(req.query.sort || 'popular'),
      scope,
      limit: normalizeInteger(req.query.limit) || 60
    });
    res.json({ versions });
  } catch (error) {
    sendRouteError(res, error, 'Failed to load the cover community');
  }
});

app.put('/api/covers/current', requireAuth, async (req, res) => {
  try {
    const articleId = String(req.body.articleId || 'speckled-band');
    const versionId = String(req.body.versionId || '');
    const version = await coverStore.setCurrentCover({ userId: req.user.id, articleId, versionId });
    if (!version) {
      res.status(400).json({ error: '请选择自己为这本书创作的有效封面' });
      return;
    }
    res.json({ version });
  } catch (error) {
    sendRouteError(res, error, 'Failed to activate cover');
  }
});

app.delete('/api/covers/current', requireAuth, async (req, res) => {
  try {
    const articleId = String(req.query.articleId || 'speckled-band');
    const removed = await coverStore.clearCurrentCover({ userId: req.user.id, articleId });
    res.json({ ok: true, removed, version: null });
  } catch (error) {
    sendRouteError(res, error, 'Failed to restore the official cover');
  }
});

app.patch('/api/covers/versions/:versionId/status', requireAuth, async (req, res) => {
  try {
    const status = String(req.body.status || '');
    if (!['public', 'withdrawn', 'deleted'].includes(status)) {
      res.status(400).json({ error: 'Unsupported cover status' });
      return;
    }
    const version = await coverStore.setVersionStatus(req.params.versionId, req.user.id, status);
    if (!version) {
      res.status(404).json({ error: 'Cover version not found' });
      return;
    }
    res.json({ version });
  } catch (error) {
    sendRouteError(res, error, 'Failed to update cover status');
  }
});

app.post('/api/covers/versions/:versionId/like', requireAuth, async (req, res) => {
  try {
    const version = await coverStore.setLike(req.params.versionId, req.user.id, true);
    if (!version) {
      res.status(404).json({ error: 'Public cover not found' });
      return;
    }
    res.json({ version });
  } catch (error) {
    sendRouteError(res, error, 'Failed to like cover');
  }
});

app.delete('/api/covers/versions/:versionId/like', requireAuth, async (req, res) => {
  try {
    const version = await coverStore.setLike(req.params.versionId, req.user.id, false);
    if (!version) {
      res.status(404).json({ error: 'Public cover not found' });
      return;
    }
    res.json({ version });
  } catch (error) {
    sendRouteError(res, error, 'Failed to unlike cover');
  }
});

app.post('/api/covers/versions/:versionId/collection', requireAuth, async (req, res) => {
  try {
    const version = await coverStore.setCollection(req.params.versionId, req.user.id, true);
    if (!version) {
      res.status(404).json({ error: 'Public cover not found' });
      return;
    }
    res.json({ version });
  } catch (error) {
    sendRouteError(res, error, 'Failed to collect cover');
  }
});

app.delete('/api/covers/versions/:versionId/collection', requireAuth, async (req, res) => {
  try {
    const version = await coverStore.setCollection(req.params.versionId, req.user.id, false);
    if (!version) {
      res.status(404).json({ error: 'Public cover not found' });
      return;
    }
    res.json({ version });
  } catch (error) {
    sendRouteError(res, error, 'Failed to remove cover collection');
  }
});

app.post('/api/covers/versions/:versionId/reports', requireAuth, async (req, res) => {
  try {
    const reason = String(req.body.reason || '').trim();
    if (reason.length < 3 || reason.length > 500) {
      res.status(400).json({ error: '举报原因需要 3—500 个字' });
      return;
    }
    const report = await coverStore.createReport({
      versionId: req.params.versionId,
      reporterUserId: req.user.id,
      reason
    });
    if (!report) {
      res.status(404).json({ error: 'Public cover not found' });
      return;
    }
    res.status(201).json({ report });
  } catch (error) {
    sendRouteError(res, error, 'Failed to report cover');
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

app.post('/api/ai/cover', requireAuth, async (req, res) => {
  let persisted = null;
  try {
    const articleId = String(req.body.articleId || 'speckled-band').trim();
    const mode = String(req.body.mode || 'guided').trim();
    const prompt = String(req.body.prompt || '').trim();
    const mood = String(req.body.mood || '').trim().slice(0, 64);
    const palette = String(req.body.palette || '').trim().slice(0, 64);
    const composition = String(req.body.composition || '').trim().slice(0, 64);
    const requestedParameters = req.body.parameters && typeof req.body.parameters === 'object'
      ? req.body.parameters
      : {};
    const parameters = Object.fromEntries(
      [
        'focus', 'cast', 'relationship', 'storyBeat', 'performance', 'shotSize',
        'cameraAngle', 'lighting', 'colorGrade', 'texture'
      ].map((key) => [key, String(requestedParameters[key] || '').trim().slice(0, 64)])
        .filter(([, value]) => value)
    );
    const bookTitle = String(req.body.bookTitle || '斑点带子案').trim().slice(0, 255);
    const bookAuthor = String(req.body.bookAuthor || 'Arthur Conan Doyle').trim().slice(0, 255);
    const bookSubtitle = String(req.body.bookSubtitle || 'The Speckled Band').trim().slice(0, 255);
    const remixedFromVersionId = String(req.body.remixedFromVersionId || '').trim() || null;

    if (!articleId || !bookTitle || !bookAuthor || prompt.length < 5 || prompt.length > 900) {
      res.status(400).json({ error: '请填写书名、作者和 5—900 字的封面描述' });
      return;
    }
    if (!['guided', 'advanced'].includes(mode)) {
      res.status(400).json({ error: '不支持的封面创作模式' });
      return;
    }
    if (remixedFromVersionId) {
      const source = await coverStore.getVersion(remixedFromVersionId, req.user.id);
      const usable = source && source.articleId === articleId &&
        (source.status === 'public' || source.ownerUserId === req.user.id);
      if (!usable) {
        res.status(400).json({ error: '引用的灵感封面不可用' });
        return;
      }
    }

    let prompts;
    try {
      const bookStyle = mode === 'guided' ? (await ensureBookStyle()).style : null;
      prompts = buildCoverPrompt({ mode, prompt, mood, palette, composition, parameters, bookStyle });
    } catch (error) {
      res.status(400).json({ error: error.message || '封面提示词不符合要求' });
      return;
    }

    const result = await generateImage({
      prompt: prompts.finalPrompt,
      aspectRatio: '2:3',
      promptOptimizer: false
    });
    persisted = await persistGeneratedImage({
      req,
      sourceUrl: result.imageUrl,
      prompt: prompts.finalPrompt,
      sourceText: prompt,
      model: process.env.MINIMAX_IMAGE_MODEL || 'image-01',
      position: { articleId, chapterId: null, paragraphIndex: null, range: null },
      userId: req.user.id,
      metadata: {
        generationType: 'book-cover',
        mode,
        mood,
        palette,
        composition,
        parameters,
        bookTitle,
        bookAuthor,
        bookSubtitle,
        remixedFromVersionId,
        traceId: result.traceId
      }
    });
    const version = await coverStore.createVersion({
      ownerUserId: req.user.id,
      articleId,
      status: 'private',
      imageUrl: persisted.imageUrl,
      mediaAssetId: persisted.mediaAssetId,
      mode,
      prompt: prompts.prompt,
      finalPrompt: prompts.finalPrompt,
      mood,
      palette,
      composition,
      parameters,
      bookTitle,
      bookAuthor,
      bookSubtitle,
      remixedFromVersionId
    });
    res.status(201).json({ version, traceId: result.traceId });
  } catch (error) {
    await cleanUpPersistedImage(persisted);
    sendRouteError(res, error, '封面生成失败');
  }
});

app.post('/api/ai/paragraph-image', requireAuth, async (req, res) => {
  let persisted = null;
  try {
    const { chapterId, paragraphIndex, targetSegment } = req.body;
    const safeArticleId = String(req.body.articleId || 'speckled-band');
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

    const paragraphContext = getParagraphContext({
      chapterId: safeChapterId,
      paragraphIndex: safeParagraphIndex
    });
    if (!paragraphContext) {
      res.status(404).json({ error: '未找到目标段落' });
      return;
    }

    const fixedRange = {
      startParagraphIndex: safeParagraphIndex,
      startOffset: 0,
      endParagraphIndex: safeParagraphIndex,
      endOffset: paragraphContext.originalTarget.length
    };
    const safeRange = normalizeRange(req.body.range);
    if (safeTargetSegment !== paragraphContext.originalTarget.trim() || !rangesEqual(safeRange, fixedRange)) {
      res.status(400).json({ error: '段落插图必须绑定当前标准段落的完整原文' });
      return;
    }

    const unit = getContentUnitByPosition({
      articleId: safeArticleId,
      chapterId: safeChapterId,
      paragraphIndex: safeParagraphIndex
    });
    if (!unit) {
      res.status(404).json({ error: 'Standard paragraph unit not found' });
      return;
    }

    const officialStyle = await ensureOfficialIllustrationStyle(safeArticleId);
    const result = await generateParagraphIllustration({
      chapterId: safeChapterId,
      paragraphIndex: safeParagraphIndex,
      targetSegment: safeTargetSegment
    });

    persisted = await persistGeneratedImage({
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
        generationType: 'diy-paragraph-image',
        styleVersionId: officialStyle.id,
        aspectRatio: '16:9'
      },
      position: {
        articleId: safeArticleId,
        chapterId: safeChapterId,
        paragraphIndex: safeParagraphIndex,
        range: fixedRange
      }
    });

    const createdVersion = await illustrationStore.createVersion({
      ownerUserId: req.user.id,
      unitId: unit.id,
      articleId: unit.articleId,
      chapterId: unit.chapterId,
      paragraphIndex: unit.paragraphIndex,
      imageUrl: persisted.imageUrl,
      mediaAssetId: persisted.mediaAssetId,
      promptMode: 'official',
      finalPrompt: result.prompt || safeTargetSegment,
      styleVersionId: officialStyle.id,
      model: process.env.MINIMAX_IMAGE_MODEL || 'image-01',
      sourceText: unit.sourceText,
      sourceHash: unit.sourceHash
    });
    const version = await illustrationStore.adoptVersion({
      versionId: createdVersion.id,
      userId: req.user.id,
      unitId: unit.id
    });
    res.json({ ...result, ...persisted, illustrationVersionId: version.id, version });
  } catch (error) {
    await cleanUpPersistedImage(persisted);
    sendRouteError(res, error, 'MiniMax paragraph image generation failed');
  }
});

app.get('/api/clue-versions/community', optionalAuth, async (req, res) => {
  try {
    const scope = String(req.query.scope || 'all');
    if (!['all', 'mine'].includes(scope)) {
      res.status(400).json({ error: 'Unsupported clue community scope' });
      return;
    }
    const versions = await clueImageStore.listCommunityVersions({
      articleId: String(req.query.articleId || ''),
      clueId: String(req.query.clueId || ''),
      currentUserId: req.user?.id || '',
      sort: String(req.query.sort || 'popular'),
      scope,
      limit: normalizeInteger(req.query.limit) || 60,
      offset: normalizeInteger(req.query.offset) || 0
    });
    res.json({ versions });
  } catch (error) {
    sendRouteError(res, error, 'Failed to load the clue image community');
  }
});

app.get('/api/clue-versions/adoptions', optionalAuth, async (req, res) => {
  try {
    const versions = req.user
      ? await clueImageStore.listAdoptedVersions({
          userId: req.user.id,
          articleId: String(req.query.articleId || 'speckled-band')
        })
      : [];
    res.json({ versions });
  } catch (error) {
    sendRouteError(res, error, 'Failed to load adopted clue images');
  }
});

app.get('/api/clues/:clueId/image-versions', optionalAuth, async (req, res) => {
  try {
    const clue = clues.find((item) => item.id === req.params.clueId);
    if (!clue) {
      res.status(404).json({ error: 'Clue not found' });
      return;
    }
    const versions = await clueImageStore.listVersionsForClue(clue.id, req.user?.id || '');
    const myVersions = req.user
      ? await clueImageStore.listMyVersions({ ownerUserId: req.user.id, clueId: clue.id })
      : [];
    res.json({ clue, versions, myVersions });
  } catch (error) {
    sendRouteError(res, error, 'Failed to load clue image versions');
  }
});

app.post('/api/clues/:clueId/image-versions', requireAuth, async (req, res) => {
  const persistedAssets = [];
  const createdVersionIds = [];
  try {
    const clueId = String(req.params.clueId || '');
    const occurrenceId = String(req.body.occurrenceId || '');
    const finalPrompt = String(req.body.finalPrompt || '').trim();
    const entry = getClueOccurrence(clueId, occurrenceId);
    if (!entry) {
      res.status(400).json({ error: 'Choose a valid occurrence for this clue' });
      return;
    }
    if (finalPrompt.length < 5 || finalPrompt.length > 800) {
      res.status(400).json({ error: 'finalPrompt must contain 5-800 characters' });
      return;
    }

    const generatedCandidates = await generateClueImageCandidates({
      userPrompt: finalPrompt,
      clue: entry.clue,
      occurrence: entry.occurrence
    });
    const versions = [];
    for (const generated of generatedCandidates) {
      const occurrence = entry.occurrence;
      const persisted = await persistGeneratedImage({
        req,
        sourceUrl: generated.imageUrl,
        prompt: generated.prompt,
        sourceText: occurrence.selectedText,
        model: generated.model,
        userId: req.user.id,
        position: {
          articleId: 'speckled-band',
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
          generationType: 'clue-community-image',
          clueId,
          occurrenceId,
          aspectRatio: generated.aspectRatio,
          variationIndex: generated.variationIndex,
          traceId: generated.traceId
        }
      });
      persistedAssets.push(persisted);
      const version = await clueImageStore.createVersion({
        ownerUserId: req.user.id,
        articleId: 'speckled-band',
        clueId,
        occurrenceId,
        chapterId: occurrence.chapterId,
        paragraphIndex: occurrence.paragraphIndex,
        clueLabel: entry.clue.label,
        clueType: entry.clue.type,
        imageUrl: persisted.imageUrl,
        mediaAssetId: persisted.mediaAssetId,
        finalPrompt,
        aspectRatio: generated.aspectRatio,
        model: generated.model,
        sourceText: occurrence.selectedText
      });
      createdVersionIds.push(version.id);
      versions.push(version);
    }
    res.status(201).json({ versions });
  } catch (error) {
    if (createdVersionIds.length > 0 && req.user?.id) {
      await Promise.all(createdVersionIds.map((versionId) =>
        clueImageStore.setVersionStatus(versionId, req.user.id, 'deleted').catch(() => null)
      ));
    }
    if (persistedAssets.length > 0) {
      await Promise.all(persistedAssets.map((asset) => cleanUpPersistedImage(asset)));
    }
    sendRouteError(res, error, 'Clue image generation failed');
  }
});

app.patch('/api/clue-versions/:versionId/status', requireAuth, async (req, res) => {
  try {
    const status = String(req.body.status || '');
    if (!['public', 'withdrawn', 'deleted'].includes(status)) {
      res.status(400).json({ error: 'Unsupported clue image status' });
      return;
    }
    const version = await clueImageStore.setVersionStatus(
      req.params.versionId,
      req.user.id,
      status,
      String(req.body.replaceVersionId || '')
    );
    if (!version) {
      res.status(404).json({ error: 'Clue image version not found' });
      return;
    }
    res.json({ version });
  } catch (error) {
    if (error?.code === 'PUBLIC_CLUE_VERSION_LIMIT') {
      res.status(409).json({
        error: error.message,
        code: error.code,
        publicVersionIds: error.publicVersionIds || []
      });
      return;
    }
    sendRouteError(res, error, 'Failed to update clue image status');
  }
});

app.put('/api/clues/:clueId/image-adoption', requireAuth, async (req, res) => {
  try {
    const clue = clues.find((item) => item.id === req.params.clueId);
    if (!clue) {
      res.status(404).json({ error: 'Clue not found' });
      return;
    }
    const version = await clueImageStore.adoptVersion({
      versionId: String(req.body.versionId || ''),
      userId: req.user.id,
      clueId: clue.id
    });
    if (!version) {
      res.status(400).json({ error: 'Choose an available image for this clue' });
      return;
    }
    res.json({ version });
  } catch (error) {
    sendRouteError(res, error, 'Failed to adopt clue image');
  }
});

app.delete('/api/clues/:clueId/image-adoption', requireAuth, async (req, res) => {
  try {
    const removed = await clueImageStore.clearAdoption({ userId: req.user.id, clueId: req.params.clueId });
    res.json({ ok: true, removed });
  } catch (error) {
    sendRouteError(res, error, 'Failed to restore the official clue image');
  }
});

app.post('/api/clue-versions/:versionId/like', requireAuth, async (req, res) => {
  try {
    const version = await clueImageStore.setLike(req.params.versionId, req.user.id, true);
    if (!version) {
      res.status(404).json({ error: 'Public clue image not found' });
      return;
    }
    res.json({ version });
  } catch (error) {
    sendRouteError(res, error, 'Failed to like clue image');
  }
});

app.delete('/api/clue-versions/:versionId/like', requireAuth, async (req, res) => {
  try {
    const version = await clueImageStore.setLike(req.params.versionId, req.user.id, false);
    if (!version) {
      res.status(404).json({ error: 'Public clue image not found' });
      return;
    }
    res.json({ version });
  } catch (error) {
    sendRouteError(res, error, 'Failed to unlike clue image');
  }
});

app.post('/api/clue-versions/:versionId/reports', requireAuth, async (req, res) => {
  try {
    const report = await clueImageStore.createReport({
      versionId: req.params.versionId,
      reporterUserId: req.user.id,
      reason: req.body.reason
    });
    if (!report) {
      res.status(404).json({ error: 'Public clue image not found' });
      return;
    }
    res.status(201).json({ report });
  } catch (error) {
    sendRouteError(res, error, 'Failed to report clue image');
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

officialClueCatalogStore.getCatalog(CLUE_CURATION_ARTICLE_ID)
  .then((catalog) => {
    if (catalog?.published) applyClueManifest(catalog.published);
  })
  .catch((error) => {
    console.warn(`[official-clue-catalog] ${error.message || 'Failed to load published catalog'}`);
  });

const server = app.listen(port, () => {
  console.log(`Immersive reader API running at http://localhost:${port}`);
});

process.on('SIGTERM', () => {
  server.close();
});

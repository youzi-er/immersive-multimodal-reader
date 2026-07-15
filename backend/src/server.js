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
import { createMediaAsset, deleteMediaAsset, getMediaAsset, listMediaAssets } from './db.js';
import { getMediaRoot, removeStoredMedia, saveAudioDataUrl, saveImageFromUrl } from './media-store.js';
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
const clueGenerationPromises = new Map();

app.use(cors());
app.use(express.json());
app.use('/media', express.static(getMediaRoot()));

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    bio: user.bio
  };
}

function requireAuth(req, res, next) {
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

function optionalAuth(req, _res, next) {
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const userId = sessions.get(token);
  const user = users.find((item) => item.id === userId);

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

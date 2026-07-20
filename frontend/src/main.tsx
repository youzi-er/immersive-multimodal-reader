import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  computeSelectionLayout,
  rangeKey,
  type SelectionLayout,
  type TextRange
} from './readerTextSelection';
import {
  CoverArtwork,
  CoverLikeButton,
  CoverStudio,
  CommunityLikeButton,
  type CoverDraft,
  type CoverVersion
} from './cover';
import './styles.css';

type Page = 'home' | 'bookshelf' | 'reader' | 'community' | 'login' | 'register' | 'profile' | 'speech-debug';
type CommunitySection = 'dubbing' | 'illustration' | 'clue' | 'cover';

type User = {
  id: string;
  username: string;
  displayName: string;
  bio: string;
};

type TextSegment =
  | {
      type: 'narration';
      text: string;
    }
  | {
      type: 'clue';
      clueId: string;
      occurrenceId?: string;
      startOffset: number;
      endOffset: number;
      text: string;
    };

type Chapter = {
  id: string;
  title: string;
  subtitle: string;
  progress: number;
  paragraphs: TextSegment[][];
  scene: {
    title: string;
    imagePrompt: string;
    mood: string;
    soundscape: string;
  };
};

type Clue = {
  id: string;
  label: string;
  type: '物证' | '人物' | '地点' | string;
  surfaceDescription?: string;
  occurrences?: Array<{
    id: string;
    chapterId: string;
    paragraphIndex: number;
    selectedText: string;
    startOffset: number;
    endOffset: number;
  }>;
};

type CollectedClueRecord = {
  clueId: string;
  occurrenceId: string;
};

type ClueImage = {
  clueId: string;
  occurrenceId: string;
  skipped: boolean;
  reason?: string;
  imageUrl?: string;
  imageMode?: string;
  clueType?: string;
  subject?: string;
  prompt?: string;
  promptCharCount?: number;
  mediaAssetId?: string | null;
  cacheHit: boolean;
  userOverride: boolean;
  createdAt?: string;
  loading?: boolean;
  error?: string;
};

type ClueImageStatus = 'private' | 'public' | 'withdrawn' | 'moderated' | 'deleted';

type ClueImageVersion = {
  id: string;
  projectId: string;
  versionNumber: number;
  ownerUserId: string;
  username: string;
  displayName: string;
  articleId: string;
  clueId: string;
  occurrenceId: string;
  chapterId: string;
  paragraphIndex: number;
  clueLabel: string;
  clueType: string;
  status: ClueImageStatus;
  imageUrl: string;
  mediaAssetId: string | null;
  finalPrompt: string;
  aspectRatio: string;
  model: string;
  sourceText: string;
  likeCount: number;
  adoptionCount: number;
  likedByMe: boolean;
  adoptedByMe: boolean;
  ownedByMe: boolean;
  createdAt: string;
  withdrawnAt: string | null;
};

type ChatMessage = {
  role: 'reader' | 'assistant';
  content: string;
};

type ParagraphImage = {
  imageUrl: string;
  prompt: string;
  sceneSummaryCn: string;
  componentType: string;
  promptCharCount: number;
  traceId: string | null;
  styleInitializedNow: boolean;
  mediaAssetId?: string | null;
  mediaPersistenceError?: string | null;
  illustrationVersionId?: string;
};

type ParagraphSpeechScriptLine = {
  segmentId: string;
  speakerCode: string | null;
  templateCode: string | null;
  displayName: string;
  text: string;
  durationMs: number | null;
};

type ParagraphSpeech = {
  audioUrl: string;
  durationMs: number | null;
  segmentCount: number;
  script: ParagraphSpeechScriptLine[];
  voicesInitializedNow: boolean;
  traceId: string | null;
  mediaAssetId?: string | null;
  mediaPersistenceError?: string | null;
};

type VoiceRecording = {
  id: string;
  mediaAssetId: string;
  articleId: string;
  chapterId: string;
  paragraphIndex: number;
  range: TextRange;
  sourceText: string;
  userId: string;
  username: string;
  displayName: string;
  visibility: 'private' | 'public';
  audioUrl: string;
  likeCount: number;
  likedByMe: boolean;
  createdAt: string;
};

type VoiceRecordingGroup = {
  myRecording: VoiceRecording | null;
  publicRecordings: VoiceRecording[];
};

type DubbingStatus = 'private' | 'public' | 'withdrawn' | 'moderated' | 'deleted';
type DubbingKind = 'ai' | 'human';

type ContentUnit = {
  id: string;
  kind: 'paragraph-dialogue';
  articleId: string;
  chapterId: string;
  chapterTitle: string;
  paragraphIndex: number;
  sourceText: string;
  sourceHash: string;
  hasDialogue: boolean;
  range: TextRange;
};

type DubbingPerformance = {
  语速: string;
  情绪: string;
  强度: number;
  停顿: string;
  节奏: string;
  重读词: string[];
  语气词标签: { 前: string[]; 后: string[]; 句内: unknown[] };
};

type MiniMaxRange = { min: number; max: number; step: number; default: number };
type MiniMaxAnnotation =
  | { id: string; type: 'pause'; offset: number; durationSeconds: number }
  | { id: string; type: 'vocal'; offset: number; value: string };

type MiniMaxSegmentRecipe = {
  schemaVersion: 1;
  provider: 'minimax';
  annotations: MiniMaxAnnotation[];
  pronunciation: string[];
  voiceSource: {
    mode: 'default' | 'voiceId' | 'blend';
    voiceId: string;
    timbreWeights: Array<{ voiceId: string; weight: number }>;
  };
  voiceSetting: {
    speed: number;
    volume: number;
    pitch: number;
    emotion: string;
    latexRead: boolean;
    englishNormalization: boolean;
  };
  voiceModify: {
    pitch: number;
    intensity: number;
    timbre: number;
    soundEffects: string;
  };
};

type MiniMaxGenerationSettings = {
  schemaVersion: 1;
  provider: 'minimax';
  model: string;
  stream: boolean;
  streamOptions: { excludeAggregatedAudio: boolean };
  languageBoost: string;
  audioSetting: { sampleRate: number; bitrate: number; format: string; channel: number };
  subtitle: { enabled: boolean; type: string };
  outputFormat: string;
  aigcWatermark: boolean;
};

type MiniMaxCapabilities = {
  provider: 'minimax';
  schemaVersion: 1;
  models: string[];
  emotions: Array<{ value: string; label: string }>;
  vocalTags: Array<{ value: string; label: string }>;
  vocalTagModels: string[];
  soundEffects: Array<{ value: string; label: string }>;
  languages: string[];
  ranges: {
    speed: MiniMaxRange;
    volume: MiniMaxRange;
    pitch: MiniMaxRange;
    pause: MiniMaxRange;
    effect: MiniMaxRange;
    weight: MiniMaxRange;
  };
  audio: { sampleRates: number[]; bitrates: number[]; formats: string[]; channels: number[] };
  subtitleTypes: string[];
  outputFormats: string[];
  maxTimbreWeights: number;
};

type DubbingPlanSegment = {
  segmentId: string;
  speakerCode: string | null;
  templateCode: string | null;
  text: string;
  director: Record<string, unknown>;
  performance: DubbingPerformance;
  pronunciation: string[];
  recipe?: MiniMaxSegmentRecipe;
};

type DubbingPlan = {
  segments: DubbingPlanSegment[];
  roles: Array<{ code: string; label: string; tier: string }>;
  templates: Array<{ code: string; label: string }>;
  capabilities: MiniMaxCapabilities;
  generationSettings: MiniMaxGenerationSettings;
  voicesInitializedNow: boolean;
};

type AiComposerBinding = {
  unitId: string;
  sourceHash: string;
  selectionKey: string;
};

type VoiceDesignVersion = {
  id: string;
  designId: string;
  articleId: string;
  characterCode: string;
  characterName: string;
  ownerUserId: string;
  ownerUsername: string;
  ownerDisplayName: string;
  versionNumber: number;
  prompt: string;
  previewText: string;
  previewAudioUrl: string | null;
  shared: boolean;
  createdAt: string;
};

type DubbingVersion = {
  id: string;
  projectId: string;
  versionNumber: number;
  ownerUserId: string;
  username: string;
  displayName: string;
  unitId: string;
  articleId: string;
  chapterId: string;
  paragraphIndex: number;
  kind: DubbingKind;
  status: DubbingStatus;
  audioUrl: string;
  mediaAssetId: string | null;
  sourceText: string;
  sourceHash: string;
  durationMs: number | null;
  promptSnapshot: {
    voiceDesigns?: Record<string, {
      versionId: string;
      characterName: string;
      prompt: string;
      previewText: string;
      versionNumber: number;
      ownerDisplayName?: string;
      shared?: boolean;
    }>;
    performanceSegments?: DubbingPlanSegment[];
    generationSettings?: MiniMaxGenerationSettings;
    ttsRequests?: Array<Record<string, unknown>>;
  } | null;
  segments: DubbingPlanSegment[];
  likeCount: number;
  adoptionCount: number;
  likedByMe: boolean;
  adoptedByMe: boolean;
  ownedByMe: boolean;
  createdAt: string;
  withdrawnAt: string | null;
};

type DubbingUnitBundle = {
  unit: ContentUnit;
  versions: DubbingVersion[];
};

type IllustrationStatus = 'private' | 'public' | 'withdrawn' | 'moderated' | 'deleted';
type IllustrationPromptMode = 'official' | 'free';

type OfficialIllustrationStyle = {
  id: string;
  articleId: string;
  versionNumber: number;
  name: string;
  globalStylePrompt: string;
  globalNegativePrompt: string;
  styleProfile: Record<string, string>;
  usageNotes: string;
  createdAt: string;
};

type OfficialIllustrationSlot = {
  id: string;
  unitId: string;
  articleId: string;
  chapterId: string;
  paragraphIndex: number;
  imageUrl: string;
  mediaAssetId: string | null;
  promptExcerpt: string;
  sourceText: string;
  sourceHash: string;
  createdAt: string;
  updatedAt: string;
};

type IllustrationVersion = {
  id: string;
  projectId: string;
  versionNumber: number;
  ownerUserId: string;
  username: string;
  displayName: string;
  unitId: string;
  articleId: string;
  chapterId: string;
  paragraphIndex: number;
  status: IllustrationStatus;
  imageUrl: string;
  mediaAssetId: string | null;
  promptMode: IllustrationPromptMode;
  finalPrompt: string;
  styleVersionId: string | null;
  aspectRatio: '16:9';
  model: string;
  sourceText: string;
  sourceHash: string;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  adoptedByMe: boolean;
  ownedByMe: boolean;
  createdAt: string;
  withdrawnAt: string | null;
};

type IllustrationComment = {
  id: string;
  versionId: string;
  userId: string;
  username: string;
  displayName: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

type IllustrationUnitBundle = {
  unit: ContentUnit;
  versions: IllustrationVersion[];
  myVersions: IllustrationVersion[];
};

type SpeechDebugEvent = {
  timestamp: number | null;
  runId: string;
  location: string;
  message: string;
  hypothesisId: string;
  data: unknown;
};

type SpeechDebugRecord = {
  id: string;
  startedAt: number | null;
  targetSegment: string;
  chapterId: string;
  paragraphIndex: number | null;
  segmentCount: number;
  traceIds: string[];
  events: SpeechDebugEvent[];
};

type SpeechDebugInfo = {
  cache: {
    initialized: boolean;
    status: string;
    bookId: string;
    createdAt?: string;
    skipVoiceDesign?: boolean;
    atmosphere: Record<string, unknown> | null;
    roles: Array<{ code: string; label: string; tier: string; voiceId: string }>;
    templates: Array<{ code: string; label: string; voiceId: string }>;
    pronunciationToneCount: number;
  };
  prompts: {
    phase1System: string;
    phase3aSystem: string;
  };
  records: SpeechDebugRecord[];
  eventCount: number;
};

type ImageDebugRecord = {
  id: string;
  startedAt: number | null;
  targetSegment: string;
  chapterId: string;
  paragraphIndex: number | null;
  componentType: string;
  promptCharCount: number | null;
  traceId: string | null;
  events: SpeechDebugEvent[];
};

type ImageDebugInfo = {
  cache: {
    initialized: boolean;
    status: string;
    bookId: string;
    createdAt?: string;
    sourceNovel?: string;
    style: Record<string, unknown> | null;
  };
  prompts: {
    phase1System: string;
    phase2System: string;
  };
  records: ImageDebugRecord[];
  eventCount: number;
};

type RangeMedia<T> = T & {
  chapterId: string;
  range: TextRange;
  userId?: string;
  fromLibrary?: boolean;
  createdAt?: string;
};

type ParagraphBoundMedia = {
  chapterId: string;
  range: TextRange;
};

function targetsSameParagraph(left: ParagraphBoundMedia, right: ParagraphBoundMedia) {
  return (
    left.chapterId === right.chapterId &&
    left.range.startParagraphIndex === right.range.startParagraphIndex &&
    left.range.endParagraphIndex === right.range.endParagraphIndex
  );
}

function replaceParagraphMedia<T extends ParagraphBoundMedia>(
  current: Record<string, T>,
  replacement: T
) {
  const next = Object.fromEntries(
    Object.entries(current).filter(([, item]) => !targetsSameParagraph(item, replacement))
  ) as Record<string, T>;
  next[rangeKey(replacement.chapterId, replacement.range)] = replacement;
  return next;
}

function removeParagraphMedia<T extends ParagraphBoundMedia>(current: Record<string, T>, target: ParagraphBoundMedia) {
  return Object.fromEntries(
    Object.entries(current).filter(([, item]) => !targetsSameParagraph(item, target))
  ) as Record<string, T>;
}

function findParagraphMedia<T extends ParagraphBoundMedia>(current: Record<string, T>, target: ParagraphBoundMedia) {
  return Object.values(current).find((item) => targetsSameParagraph(item, target));
}

type MediaLibraryAsset = {
  id: string;
  articleId: string;
  chapterId: string | null;
  paragraphIndex: number | null;
  mediaType: 'image' | 'audio';
  url: string;
  sourceUrl: string | null;
  filePath: string | null;
  prompt: string | null;
  sourceText: string | null;
  provider: string;
  model: string | null;
  userId: string;
  range: TextRange | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

type ParagraphComment = {
  id: string;
  articleId: string;
  chapterId: string;
  paragraphIndex: number;
  userId: string;
  username: string;
  displayName: string;
  content: string;
  createdAt: string;
};

type SelectedParagraph = {
  chapterId: string;
  paragraphIndex: number;
  draft: string;
  range: TextRange;
};

type ContextTab = 'cover' | 'ai' | 'bag';
type ReadingTheme = 'light' | 'paper' | 'night';
type ReadingWidth = 'narrow' | 'standard' | 'wide';

const TOKEN_KEY = 'immersive-reader-token';
const USER_KEY = 'immersive-reader-user';
const COLLECTED_CLUES_KEY = 'immersive-reader-collected-clues';

function clueCollectionKey(userId?: string | null) {
  return `${COLLECTED_CLUES_KEY}:${userId || 'anonymous'}`;
}

function clueImageKey(clueId: string) {
  return clueId;
}

function clueOccurrences(clue?: Clue | null) {
  return Array.isArray(clue?.occurrences) ? clue.occurrences : [];
}

function resolveClueOccurrenceId(clue: Clue | undefined, occurrenceId?: string) {
  const occurrences = clueOccurrences(clue);
  if (occurrenceId && occurrences.some((item) => item.id === occurrenceId)) {
    return occurrenceId;
  }
  return occurrences[0]?.id || '';
}

function loadCollectedClues(userId?: string | null): CollectedClueRecord[] {
  const scopedKey = clueCollectionKey(userId);
  const scoped = window.localStorage.getItem(scopedKey);
  const legacy = scoped ? null : window.localStorage.getItem(COLLECTED_CLUES_KEY);
  try {
    const parsed = JSON.parse(scoped || legacy || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) =>
        typeof item === 'string'
          ? { clueId: item, occurrenceId: '' }
          : { clueId: String(item?.clueId || ''), occurrenceId: String(item?.occurrenceId || '') }
      )
      .filter((item) => item.clueId);
  } catch {
    return [];
  }
}

async function requestJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = window.localStorage.getItem(TOKEN_KEY);
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  const responseText = await res.text();
  let data: any;
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    const clueServiceHint = url.startsWith('/api/ai/clue-')
      ? '线索生图服务未正确部署，请稍后重试'
      : '服务器返回了无法识别的响应';
    throw new Error(`${clueServiceHint}（HTTP ${res.status}）`);
  }

  if (!res.ok) {
    throw new Error(data.error ?? '请求失败');
  }

  return data;
}

const api = {
  chapters: () => requestJson<Chapter[]>('/api/chapters'),
  clues: () => requestJson<Clue[]>('/api/clues'),
  paragraphComments: (articleId: string, chapterId: string) =>
    requestJson<{ comments: ParagraphComment[] }>(
      `/api/paragraph-comments?articleId=${encodeURIComponent(articleId)}&chapterId=${encodeURIComponent(chapterId)}`
    ),
  createParagraphComment: (payload: { articleId: string; chapterId: string; paragraphIndex: number; content: string }) =>
    requestJson<{ comment: ParagraphComment }>('/api/paragraph-comments', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  deleteParagraphComment: (id: string) =>
    requestJson<{ ok: true }>(`/api/paragraph-comments/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    }),
  chat: async (question: string, chapterId: string, collectedClueIds: string[]) => {
    const data = await requestJson<{ answer: string }>('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ question, chapterId, collectedClueIds })
    });
    return data.answer;
  },
  aiChat: async (question: string, chapterId: string, collectedClueIds: string[]) => {
    const data = await requestJson<{ answer: string }>('/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ question, chapterId, collectedClueIds })
    });
    return data.answer;
  },
  tts: async (payload: { text: string; speaker: string; speed: number; pitch: number }) =>
    requestJson<{ audioUrl: string; durationMs: number | null; traceId: string | null }>('/api/ai/tts', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  currentCover: (articleId: string) =>
    requestJson<{ version: CoverVersion | null }>(
      `/api/covers/current?articleId=${encodeURIComponent(articleId)}`
    ),
  coverHistory: (articleId: string) =>
    requestJson<{ versions: CoverVersion[] }>(
      `/api/covers/history?articleId=${encodeURIComponent(articleId)}`
    ),
  coverCommunity: (
    articleId: string,
    sort: 'popular' | 'newest',
    scope: 'all' | 'mine' | 'collected' = 'all'
  ) => requestJson<{ versions: CoverVersion[] }>(
    `/api/covers/community?articleId=${encodeURIComponent(articleId)}&sort=${encodeURIComponent(sort)}&scope=${encodeURIComponent(scope)}`
  ),
  createCover: (payload: CoverDraft) =>
    requestJson<{ version: CoverVersion }>('/api/ai/cover', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  setCurrentCover: (articleId: string, versionId: string) =>
    requestJson<{ version: CoverVersion }>('/api/covers/current', {
      method: 'PUT',
      body: JSON.stringify({ articleId, versionId })
    }),
  restoreOfficialCover: (articleId: string) =>
    requestJson<{ ok: true; version: null }>(
      `/api/covers/current?articleId=${encodeURIComponent(articleId)}`,
      { method: 'DELETE' }
    ),
  setCoverStatus: (versionId: string, status: 'public' | 'withdrawn' | 'deleted') =>
    requestJson<{ version: CoverVersion }>(
      `/api/covers/versions/${encodeURIComponent(versionId)}/status`,
      { method: 'PATCH', body: JSON.stringify({ status }) }
    ),
  likeCover: (versionId: string, liked: boolean) =>
    requestJson<{ version: CoverVersion }>(
      `/api/covers/versions/${encodeURIComponent(versionId)}/like`,
      { method: liked ? 'POST' : 'DELETE' }
    ),
  collectCover: (versionId: string, collected: boolean) =>
    requestJson<{ version: CoverVersion }>(
      `/api/covers/versions/${encodeURIComponent(versionId)}/collection`,
      { method: collected ? 'POST' : 'DELETE' }
    ),
  reportCover: (versionId: string, reason: string) =>
    requestJson<{ report: { status: 'open' } }>(
      `/api/covers/versions/${encodeURIComponent(versionId)}/reports`,
      { method: 'POST', body: JSON.stringify({ reason }) }
    ),
  paragraphImage: async (payload: {
    chapterId: string;
    paragraphIndex: number;
    targetSegment: string;
    range: TextRange;
  }) =>
    requestJson<ParagraphImage>('/api/ai/paragraph-image', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  officialIllustrationStyle: (articleId: string) =>
    requestJson<{ style: OfficialIllustrationStyle }>(
      `/api/illustrations/styles/official?articleId=${encodeURIComponent(articleId)}`
    ),
  officialIllustrationSlots: (articleId: string, chapterId: string) =>
    requestJson<{ slots: OfficialIllustrationSlot[] }>(
      `/api/illustrations/official-slots?articleId=${encodeURIComponent(articleId)}&chapterId=${encodeURIComponent(chapterId)}`
    ),
  illustrationUnitAtPosition: (articleId: string, chapterId: string, paragraphIndex: number) =>
    requestJson<IllustrationUnitBundle>(
      `/api/illustrations/unit-at-position?articleId=${encodeURIComponent(articleId)}&chapterId=${encodeURIComponent(
        chapterId
      )}&paragraphIndex=${paragraphIndex}`
    ),
  communityIllustrations: (
    articleId: string,
    unitId: string,
    sort: 'popular' | 'newest',
    scope: 'all' | 'mine' = 'all'
  ) => requestJson<{ versions: IllustrationVersion[] }>(
    `/api/illustrations/community?articleId=${encodeURIComponent(articleId)}&unitId=${encodeURIComponent(
      unitId
    )}&sort=${encodeURIComponent(sort)}&scope=${encodeURIComponent(scope)}`
  ),
  adoptedIllustrations: (articleId: string, chapterId: string) =>
    requestJson<{ versions: IllustrationVersion[] }>(
      `/api/illustrations/adoptions?articleId=${encodeURIComponent(articleId)}&chapterId=${encodeURIComponent(chapterId)}`
    ),
  createIllustrationVersion: (
    unitId: string,
    payload: {
      promptMode: IllustrationPromptMode;
      finalPrompt: string;
      styleVersionId?: string | null;
    }
  ) => requestJson<{ unit: ContentUnit; version: IllustrationVersion }>(
    `/api/illustrations/units/${encodeURIComponent(unitId)}/versions`,
    { method: 'POST', body: JSON.stringify(payload) }
  ),
  setIllustrationStatus: (
    versionId: string,
    status: 'public' | 'withdrawn' | 'deleted',
    replaceVersionId = ''
  ) => requestJson<{ version: IllustrationVersion }>(
    `/api/illustrations/versions/${encodeURIComponent(versionId)}/status`,
    { method: 'PATCH', body: JSON.stringify({ status, replaceVersionId }) }
  ),
  likeIllustration: (versionId: string, liked: boolean) =>
    requestJson<{ version: IllustrationVersion }>(
      `/api/illustrations/versions/${encodeURIComponent(versionId)}/like`,
      { method: liked ? 'POST' : 'DELETE' }
    ),
  adoptIllustration: (unitId: string, versionId: string) =>
    requestJson<{ unit: ContentUnit; version: IllustrationVersion }>(
      `/api/illustrations/units/${encodeURIComponent(unitId)}/adoption`,
      { method: 'PUT', body: JSON.stringify({ versionId }) }
    ),
  cancelIllustrationAdoption: (unitId: string) =>
    requestJson<{ ok: true; removed: boolean }>(
      `/api/illustrations/units/${encodeURIComponent(unitId)}/adoption`,
      { method: 'DELETE' }
    ),
  illustrationComments: (versionId: string) =>
    requestJson<{ comments: IllustrationComment[] }>(
      `/api/illustrations/versions/${encodeURIComponent(versionId)}/comments`
    ),
  createIllustrationComment: (versionId: string, content: string) =>
    requestJson<{ comment: IllustrationComment }>(
      `/api/illustrations/versions/${encodeURIComponent(versionId)}/comments`,
      { method: 'POST', body: JSON.stringify({ content }) }
    ),
  deleteIllustrationComment: (commentId: string) =>
    requestJson<{ ok: true }>(`/api/illustrations/comments/${encodeURIComponent(commentId)}`, {
      method: 'DELETE'
    }),
  reportIllustration: (versionId: string, reason: string) =>
    requestJson<{ report: { status: 'open' } }>(
      `/api/illustrations/versions/${encodeURIComponent(versionId)}/reports`,
      { method: 'POST', body: JSON.stringify({ reason }) }
    ),
  clueImageVersions: (clueId: string) =>
    requestJson<{ clue: Clue; versions: ClueImageVersion[]; myVersions: ClueImageVersion[] }>(
      `/api/clues/${encodeURIComponent(clueId)}/image-versions`
    ),
  createClueImageVersions: (clueId: string, occurrenceId: string, finalPrompt: string) =>
    requestJson<{ versions: ClueImageVersion[] }>(
      `/api/clues/${encodeURIComponent(clueId)}/image-versions`,
      { method: 'POST', body: JSON.stringify({ occurrenceId, finalPrompt }) }
    ),
  clueImageCommunity: (
    articleId: string,
    clueId: string,
    sort: 'popular' | 'newest',
    scope: 'all' | 'mine' = 'all'
  ) => requestJson<{ versions: ClueImageVersion[] }>(
    `/api/clue-versions/community?articleId=${encodeURIComponent(articleId)}&clueId=${encodeURIComponent(
      clueId
    )}&sort=${encodeURIComponent(sort)}&scope=${encodeURIComponent(scope)}`
  ),
  adoptedClueImages: (articleId = 'speckled-band') =>
    requestJson<{ versions: ClueImageVersion[] }>(
      `/api/clue-versions/adoptions?articleId=${encodeURIComponent(articleId)}`
    ),
  setClueImageStatus: (versionId: string, status: 'public' | 'withdrawn' | 'deleted') =>
    requestJson<{ version: ClueImageVersion }>(
      `/api/clue-versions/${encodeURIComponent(versionId)}/status`,
      { method: 'PATCH', body: JSON.stringify({ status }) }
    ),
  adoptClueImage: (clueId: string, versionId: string) =>
    requestJson<{ version: ClueImageVersion }>(
      `/api/clues/${encodeURIComponent(clueId)}/image-adoption`,
      { method: 'PUT', body: JSON.stringify({ versionId }) }
    ),
  restoreOfficialClueImage: (clueId: string) =>
    requestJson<{ ok: true; removed: boolean }>(
      `/api/clues/${encodeURIComponent(clueId)}/image-adoption`,
      { method: 'DELETE' }
    ),
  likeClueImage: (versionId: string, liked: boolean) =>
    requestJson<{ version: ClueImageVersion }>(
      `/api/clue-versions/${encodeURIComponent(versionId)}/like`,
      { method: liked ? 'POST' : 'DELETE' }
    ),
  reportClueImage: (versionId: string, reason: string) =>
    requestJson<{ report: { status: 'open' } }>(
      `/api/clue-versions/${encodeURIComponent(versionId)}/reports`,
      { method: 'POST', body: JSON.stringify({ reason }) }
    ),
  clueImage: (payload: { clueId: string; occurrenceId: string; force?: boolean }) =>
    requestJson<ClueImage>('/api/ai/clue-image', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  clueImages: (occurrenceIds: string[], articleId = 'speckled-band') =>
    requestJson<{ images: ClueImage[] }>(
      `/api/ai/clue-images?articleId=${encodeURIComponent(articleId)}&occurrenceIds=${encodeURIComponent(
        occurrenceIds.join(',')
      )}`
    ),
  paragraphSpeech: async (payload: {
    chapterId: string;
    paragraphIndex: number;
    targetSegment: string;
    range: TextRange;
  }) =>
    requestJson<ParagraphSpeech>('/api/ai/paragraph-speech', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  dubbingUnitAtPosition: (articleId: string, chapterId: string, paragraphIndex: number) =>
    requestJson<DubbingUnitBundle>(
      `/api/dubbing/unit-at-position?articleId=${encodeURIComponent(articleId)}&chapterId=${encodeURIComponent(
        chapterId
      )}&paragraphIndex=${paragraphIndex}`
    ),
  communityDubbingVersions: (kind: '' | DubbingKind, sort: 'popular' | 'newest') =>
    requestJson<{ versions: DubbingVersion[] }>(
      `/api/dubbing/community?kind=${encodeURIComponent(kind)}&sort=${encodeURIComponent(sort)}`
    ),
  adoptedDubbingVersions: (articleId: string, chapterId: string) =>
    requestJson<{ versions: DubbingVersion[] }>(
      `/api/dubbing/adoptions?articleId=${encodeURIComponent(articleId)}&chapterId=${encodeURIComponent(chapterId)}`
    ),
  planAiDubbing: (unitId: string) =>
    requestJson<{ unit: ContentUnit; plan: DubbingPlan }>(
      `/api/dubbing/units/${encodeURIComponent(unitId)}/ai-plan`,
      { method: 'POST' }
    ),
  voiceDesigns: (scope: 'mine' | 'shared' = 'mine') =>
    requestJson<{ versions: VoiceDesignVersion[] }>(
      `/api/dubbing/voice-designs?scope=${encodeURIComponent(scope)}`
    ),
  createVoiceDesign: (payload: {
    voiceName: string;
    prompt: string;
    previewText: string;
  }) =>
    requestJson<{ version: VoiceDesignVersion }>('/api/dubbing/voice-designs', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  createAiDubbingVersion: (
    unitId: string,
    payload: {
      segments: DubbingPlanSegment[];
      voiceDesignVersionIdsBySpeaker: Record<string, string>;
      sharedVoiceDesignVersionIds: string[];
      generationSettings: MiniMaxGenerationSettings;
      visibility: 'private' | 'public';
    }
  ) =>
    requestJson<{ unit: ContentUnit; version: DubbingVersion }>(
      `/api/dubbing/units/${encodeURIComponent(unitId)}/ai-versions`,
      { method: 'POST', body: JSON.stringify(payload) }
    ),
  createHumanDubbingVersion: (
    unitId: string,
    payload: { audioDataUrl: string; visibility: 'private' | 'public' }
  ) =>
    requestJson<{ unit: ContentUnit; version: DubbingVersion }>(
      `/api/dubbing/units/${encodeURIComponent(unitId)}/human-versions`,
      { method: 'POST', body: JSON.stringify(payload) }
    ),
  setDubbingStatus: (versionId: string, status: 'public' | 'withdrawn' | 'deleted') =>
    requestJson<{ version: DubbingVersion }>(
      `/api/dubbing/versions/${encodeURIComponent(versionId)}/status`,
      { method: 'PATCH', body: JSON.stringify({ status }) }
    ),
  likeDubbingVersion: (versionId: string, liked: boolean) =>
    requestJson<{ version: DubbingVersion }>(
      `/api/dubbing/versions/${encodeURIComponent(versionId)}/like`,
      { method: liked ? 'POST' : 'DELETE' }
    ),
  adoptDubbingVersion: (unitId: string, versionId: string) =>
    requestJson<{ version: DubbingVersion }>(
      `/api/dubbing/units/${encodeURIComponent(unitId)}/adoption`,
      { method: 'PUT', body: JSON.stringify({ versionId }) }
    ),
  cancelDubbingAdoption: (unitId: string) =>
    requestJson<{ ok: true; removed: boolean }>(
      `/api/dubbing/units/${encodeURIComponent(unitId)}/adoption`,
      { method: 'DELETE' }
    ),
  reportDubbingVersion: (versionId: string, reason: string) =>
    requestJson<{ report: { status: 'open' } }>(
      `/api/dubbing/versions/${encodeURIComponent(versionId)}/reports`,
      { method: 'POST', body: JSON.stringify({ reason }) }
    ),
  mediaAssets: (articleId: string, chapterId: string, mediaType?: 'image' | 'audio') =>
    requestJson<{ assets: MediaLibraryAsset[] }>(
      `/api/media/assets?articleId=${encodeURIComponent(articleId)}&chapterId=${encodeURIComponent(chapterId)}${
        mediaType ? `&mediaType=${encodeURIComponent(mediaType)}` : ''
      }`
    ),
  voiceRecordings: (articleId: string, chapterId: string, range: TextRange) =>
    requestJson<{ myRecording: VoiceRecording | null; publicRecordings: VoiceRecording[] }>(
      `/api/voice-recordings?articleId=${encodeURIComponent(articleId)}&chapterId=${encodeURIComponent(
        chapterId
      )}&startParagraphIndex=${range.startParagraphIndex}&startOffset=${range.startOffset}&endParagraphIndex=${
        range.endParagraphIndex
      }&endOffset=${range.endOffset}`
    ),
  createVoiceRecording: (payload: {
    articleId: string;
    chapterId: string;
    paragraphIndex: number;
    range: TextRange;
    sourceText: string;
    audioDataUrl: string;
    visibility: 'private' | 'public';
  }) =>
    requestJson<{ recording: VoiceRecording }>('/api/voice-recordings', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  updateVoiceRecording: (id: string, visibility: 'private' | 'public') =>
    requestJson<{ recording: VoiceRecording }>(`/api/voice-recordings/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ visibility })
    }),
  deleteVoiceRecording: (id: string) =>
    requestJson<{ ok: true; recording: VoiceRecording }>(`/api/voice-recordings/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    }),
  likeVoiceRecording: (id: string, liked: boolean) =>
    requestJson<{ recording: VoiceRecording }>(`/api/voice-recordings/${encodeURIComponent(id)}/like`, {
      method: liked ? 'POST' : 'DELETE'
    }),
  speechDebug: (limit = 20) => requestJson<SpeechDebugInfo>(`/api/ai/speech-debug?limit=${limit}`),
  imageDebug: (limit = 20) => requestJson<ImageDebugInfo>(`/api/ai/image-debug?limit=${limit}`),
  deleteMediaAsset: (id: string) =>
    requestJson<{ ok: true; asset: MediaLibraryAsset }>(`/api/media/assets/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    }),
  regenerateSpeechVoices: () =>
    requestJson('/api/ai/speech-debug/regenerate-voices', {
      method: 'POST'
    }),
  regenerateImageStyle: () =>
    requestJson('/api/ai/image-debug/regenerate-style', {
      method: 'POST'
    }),
  register: (form: { username: string; password: string; displayName: string }) =>
    requestJson<{ token: string; user: User }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(form)
    }),
  login: (form: { username: string; password: string }) =>
    requestJson<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(form)
    }),
  updateProfile: (form: { displayName: string }) =>
    requestJson<{ user: User }>('/api/auth/me', {
      method: 'PATCH',
      body: JSON.stringify(form)
    }),
  logout: () =>
    requestJson<{ ok: true }>('/api/auth/logout', {
      method: 'POST'
    })
};

function App() {
  const [page, setPage] = useState<Page>('home');
  const [user, setUser] = useState<User | null>(() => {
    const saved = window.localStorage.getItem(USER_KEY);
    return saved ? JSON.parse(saved) : null;
  });
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [clues, setClues] = useState<Clue[]>([]);
  const [collectedClues, setCollectedClues] = useState<CollectedClueRecord[]>(() => {
    const savedUser = window.localStorage.getItem(USER_KEY);
    const savedUserId = savedUser ? JSON.parse(savedUser)?.id : null;
    return loadCollectedClues(savedUserId);
  });
  const [clueImages, setClueImages] = useState<Record<string, ClueImage>>({});
  const [chapterId, setChapterId] = useState('speckled-band-1');
  const [activeCover, setActiveCover] = useState<CoverVersion | null>(null);
  const [coverInspiration, setCoverInspiration] = useState<CoverVersion | null>(null);
  const [communitySection, setCommunitySection] = useState<CommunitySection>('dubbing');
  const [notice, setNotice] = useState('');
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: '我是你的案情助手。你可以问我：目前有哪些证物？谁最可疑？这一段发生在哪里？'
    }
  ]);

  useEffect(() => {
    api.chapters().then(setChapters);
    api.clues().then((nextClues) => {
      setClues(nextClues);
      setCollectedClues((previous) =>
        previous.flatMap((record) => {
          const clue = nextClues.find((item) => item.id === record.clueId);
          if (!clue) return [];
          const occurrenceId = resolveClueOccurrenceId(clue, record.occurrenceId);
          return [{ clueId: clue.id, occurrenceId }];
        })
      );
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setActiveCover(null);
      return;
    }
    api.currentCover('speckled-band')
      .then(({ version }) => {
        if (!cancelled) setActiveCover(version);
      })
      .catch(() => {
        if (!cancelled) setActiveCover(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    window.localStorage.setItem(clueCollectionKey(user?.id), JSON.stringify(collectedClues));
    window.localStorage.removeItem(COLLECTED_CLUES_KEY);
  }, [collectedClues, user?.id]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.clueImages(collectedClues.map((record) => record.occurrenceId).filter(Boolean)),
      user ? api.adoptedClueImages() : Promise.resolve({ versions: [] as ClueImageVersion[] })
    ])
      .then(([{ images }, { versions }]) => {
        if (cancelled) return;
        setClueImages((previous) => ({
          ...previous,
          ...Object.fromEntries(images.map((image) => [clueImageKey(image.clueId), image])),
          ...Object.fromEntries(versions.map((version) => [clueImageKey(version.clueId), {
            clueId: version.clueId,
            occurrenceId: version.occurrenceId,
            skipped: false,
            imageUrl: version.imageUrl,
            prompt: version.finalPrompt,
            mediaAssetId: version.mediaAssetId,
            cacheHit: true,
            userOverride: true,
            createdAt: version.createdAt
          } satisfies ClueImage]))
        }));
      })
      .catch(() => {
        // 数据库未配置时，仍允许本次会话继续使用刚生成的远程图。
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, collectedClues]);

  function saveSession(token: string, nextUser: User) {
    window.localStorage.setItem(TOKEN_KEY, token);
    window.localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    setUser(nextUser);
    setCollectedClues(loadCollectedClues(nextUser.id));
    setClueImages({});
    setPage('bookshelf');
  }

  function updateCurrentUser(nextUser: User) {
    window.localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    setUser(nextUser);
  }

  async function logout() {
    try {
      await api.logout();
    } catch {
      // 本地原型里即使后端 session 失效，也允许前端退出。
    }
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
    setUser(null);
    setCollectedClues([]);
    setClueImages({});
    setActiveCover(null);
    setCoverInspiration(null);
    setPage('home');
  }

  return (
    <main>
      <TopNav page={page} user={user} setPage={setPage} logout={logout} />

      {page === 'home' && <HomePage user={user} setPage={setPage} activeCover={activeCover} />}
      {page === 'community' && (
        <CommunityPage
          user={user}
          setPage={setPage}
          setChapterId={setChapterId}
          initialSection={communitySection}
          onCoverRemix={(version) => {
            setCoverInspiration(version);
            setChapterId('speckled-band-1');
            setPage('reader');
          }}
        />
      )}
      {page === 'login' && <AuthPage mode="login" saveSession={saveSession} setPage={setPage} />}
      {page === 'register' && <AuthPage mode="register" saveSession={saveSession} setPage={setPage} />}
      {page === 'bookshelf' &&
        (user ? (
          <BookshelfPage
            user={user}
            chapters={chapters}
            collectedClueCount={collectedClues.length}
            activeCover={activeCover}
            setChapterId={setChapterId}
            setPage={setPage}
          />
        ) : (
          <AuthPage mode="login" saveSession={saveSession} setPage={setPage} />
        ))}
      {page === 'profile' &&
        (user ? (
          <ProfilePage
            user={user}
            setPage={setPage}
            collectedClues={collectedClues}
            clues={clues}
            clueImages={clueImages}
            activeCover={activeCover}
            updateUser={updateCurrentUser}
          />
        ) : (
          <AuthPage mode="login" saveSession={saveSession} setPage={setPage} />
        ))}
      {page === 'speech-debug' &&
        (user ? <SpeechDebugPage /> : <AuthPage mode="login" saveSession={saveSession} setPage={setPage} />)}
      {page === 'reader' &&
        (user ? (
          <ReaderPage
            user={user}
            chapters={chapters}
            clues={clues}
            collectedClueRecords={collectedClues}
            setCollectedClues={setCollectedClues}
            clueImages={clueImages}
            setClueImages={setClueImages}
            chapterId={chapterId}
            setChapterId={setChapterId}
            notice={notice}
            setNotice={setNotice}
            question={question}
            setQuestion={setQuestion}
            messages={messages}
            setMessages={setMessages}
            setPage={setPage}
            activeCover={activeCover}
            setActiveCover={setActiveCover}
            coverInspiration={coverInspiration}
            clearCoverInspiration={() => setCoverInspiration(null)}
            openCoverCommunity={() => {
              setCommunitySection('cover');
              setPage('community');
            }}
            openClueCommunity={() => {
              setCommunitySection('clue');
              setPage('community');
            }}
          />
        ) : (
          <AuthPage mode="login" saveSession={saveSession} setPage={setPage} />
        ))}
    </main>
  );
}

function TopNav({
  page,
  user,
  setPage,
  logout
}: {
  page: Page;
  user: User | null;
  setPage: (page: Page) => void;
  logout: () => void;
}) {
  return (
    <header className={page === 'reader' ? 'top-nav reader-global-nav' : 'top-nav'}>
      <button className="nav-brand" onClick={() => setPage('home')}>
        <span>CR</span>
        <strong>CaseReader</strong>
      </button>
      <nav>
        <button className={page === 'home' ? 'active' : ''} onClick={() => setPage('home')}>
          首页
        </button>
        <button className={page === 'community' ? 'active' : ''} onClick={() => setPage('community')}>
          创作广场
        </button>
        {user ? (
          <>
            <button
              className={page === 'bookshelf' || page === 'reader' ? 'active' : ''}
              onClick={() => setPage('bookshelf')}
            >
              我的书架
            </button>
            <button className={page === 'profile' ? 'active' : ''} onClick={() => setPage('profile')}>
              阅读档案
            </button>
            <button onClick={logout}>退出</button>
          </>
        ) : (
          <>
            <button className={page === 'login' ? 'active' : ''} onClick={() => setPage('login')}>
              登录
            </button>
            <button className="primary-nav" onClick={() => setPage('register')}>
              注册
            </button>
          </>
        )}
      </nav>
    </header>
  );
}

function HomePage({
  user,
  setPage,
  activeCover
}: {
  user: User | null;
  setPage: (page: Page) => void;
  activeCover: CoverVersion | null;
}) {
  return (
    <section className="home-page">
      <section className="home-hero">
        <div className="home-hero-copy">
          <p className="eyebrow">IMMERSIVE STORY READING</p>
          <h1>探案小说的专注阅读空间</h1>
          <p>
            让声音、画面与线索自然融入阅读，深入感受故事中的人物与世界。
          </p>
          <div className="home-actions">
            <button onClick={() => setPage(user ? 'bookshelf' : 'login')}>
              {user ? '进入书架' : '登录后阅读'}
            </button>
            <button className="secondary" onClick={() => setPage(user ? 'profile' : 'register')}>
              {user ? '阅读档案' : '建立档案'}
            </button>
          </div>
        </div>
        <div className="home-reading-card">
          <CoverArtwork version={activeCover} className="book-cover" />
          <div className="reading-card-meta">
            <span>当前章节</span>
            <strong>贝克街的求助</strong>
            <div className="progress">
              <span style={{ width: '18%' }} />
            </div>
            <p>已读 18% · 3 个开放章节</p>
          </div>
        </div>
      </section>

      <section className="home-overview">
        <div className="home-book-preview">
          <div className="preview-page">
            <span>阅读摘录</span>
            <h2>福尔摩斯探案集</h2>
            <p>“案件里最危险的部分，往往藏在最普通的物件后面。”</p>
          </div>
          <div className="preview-context">
            <span>阅读体验</span>
            <h2>沉浸阅读，灵感随行</h2>
            <p>在需要的时刻调用声音、视觉与线索工具，保持阅读节奏完整。</p>
          </div>
        </div>
      </section>

      <div className="feature-grid">
        <article>
          <span>Voice</span>
          <h2>对白配音</h2>
          <p>为人物对白赋予声音，感受语气、情绪与角色关系。</p>
        </article>
        <article>
          <span>Cover</span>
          <h2>封面设计</h2>
          <p>以视觉语言重新诠释故事，创作属于你的作品封面。</p>
        </article>
        <article>
          <span>Evidence</span>
          <h2>证物整理</h2>
          <p>收集人物、地点与关键物件，逐步还原案件脉络。</p>
        </article>
      </div>
    </section>
  );
}

function CommunityPage({
  user,
  setPage,
  setChapterId,
  initialSection,
  onCoverRemix
}: {
  user: User | null;
  setPage: (page: Page) => void;
  setChapterId: (chapterId: string) => void;
  initialSection: CommunitySection;
  onCoverRemix: (version: CoverVersion) => void;
}) {
  const [section, setSection] = useState<CommunitySection>(initialSection);

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  return (
    <>
      <nav className="community-content-switch" aria-label="创作类型">
        <button type="button" className={section === 'dubbing' ? 'active' : ''} onClick={() => setSection('dubbing')}>
          <span>VOICE WORKS</span><strong>配音社区</strong>
        </button>
        <button type="button" className={section === 'illustration' ? 'active' : ''} onClick={() => setSection('illustration')}>
          <span>ILLUSTRATION GALLERY</span><strong>插图社区</strong>
        </button>
        <button type="button" className={section === 'clue' ? 'active' : ''} onClick={() => setSection('clue')}>
          <span>EVIDENCE GALLERY</span><strong>证物社区</strong>
        </button>
        <button type="button" className={section === 'cover' ? 'active' : ''} onClick={() => setSection('cover')}>
          <span>POSTER GALLERY</span><strong>封面社区</strong>
        </button>
      </nav>
      {section === 'dubbing' ? (
        <DubbingCommunityPage user={user} setPage={setPage} setChapterId={setChapterId} />
      ) : section === 'illustration' ? (
        <IllustrationCommunityPage user={user} setPage={setPage} setChapterId={setChapterId} />
      ) : section === 'clue' ? (
        <ClueCommunityPage user={user} setPage={setPage} setChapterId={setChapterId} />
      ) : (
        <CoverCommunityPage user={user} setPage={setPage} onRemix={onCoverRemix} />
      )}
    </>
  );
}

function DubbingCommunityPage({
  user,
  setPage,
  setChapterId
}: {
  user: User | null;
  setPage: (page: Page) => void;
  setChapterId: (chapterId: string) => void;
}) {
  const [tab, setTab] = useState<'all' | 'ai' | 'human' | 'mine'>('all');
  const [sort, setSort] = useState<'popular' | 'newest'>('popular');
  const [versions, setVersions] = useState<DubbingVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadVersions = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const kind = tab === 'ai' || tab === 'human' ? tab : '';
      const result = await api.communityDubbingVersions(kind, sort);
      setVersions(tab === 'mine' ? result.versions.filter((version) => version.ownerUserId === user?.id) : result.versions);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '创作广场加载失败');
    } finally {
      setLoading(false);
    }
  }, [sort, tab, user?.id]);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  function requireLogin() {
    if (user) return true;
    setPage('login');
    return false;
  }

  async function toggleLike(version: DubbingVersion) {
    if (!requireLogin()) return;
    try {
      const { version: updated } = await api.likeDubbingVersion(version.id, !version.likedByMe);
      setVersions((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '点赞失败');
    }
  }

  async function adopt(version: DubbingVersion) {
    if (!requireLogin()) return;
    try {
      const { version: updated } = await api.adoptDubbingVersion(version.unitId, version.id);
      setVersions((current) => current.map((item) =>
        item.unitId === version.unitId ? { ...item, adoptedByMe: item.id === updated.id } : item
      ));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '采用失败');
    }
  }

  async function report(version: DubbingVersion) {
    if (!requireLogin()) return;
    const reason = window.prompt('请简要说明举报原因（3—500 字）');
    if (!reason) return;
    try {
      await api.reportDubbingVersion(version.id, reason);
      window.alert('举报已提交');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '举报失败');
    }
  }

  async function withdraw(version: DubbingVersion) {
    if (!user || version.ownerUserId !== user.id) return;
    if (!window.confirm('撤回后作品将从创作广场消失，已采用的读者仍可继续播放。确定撤回吗？')) return;
    try {
      await api.setDubbingStatus(version.id, 'withdrawn');
      setVersions((current) => current.filter((item) => item.id !== version.id));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '作品撤回失败');
    }
  }

  return (
    <section className="community-page">
      <header className="community-hero">
        <div>
          <p className="eyebrow">CREATION SQUARE</p>
          <h1>创作广场</h1>
          <p>聆听读者对故事段落的多样演绎，发现不同声音中的角色与情绪。</p>
        </div>
        <div className="community-hero-stat">
          <strong>{versions.length}</strong>
          <span>公开作品</span>
        </div>
      </header>

      <div className="community-toolbar">
        <div className="community-tabs">
          {([['all', '全部作品'], ['ai', 'AI 配音'], ['human', '真人配音'], ...(user ? [['mine', '我的作品']] : [])] as Array<[typeof tab, string]>).map(([value, label]) => (
            <button key={value} type="button" className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{label}</button>
          ))}
        </div>
        <label>
          排序
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
            <option value="popular">热门优先</option>
            <option value="newest">最新发布</option>
          </select>
        </label>
      </div>

      {error && <p className="community-error">{error}</p>}
      {loading ? (
        <p className="community-empty">正在载入作品...</p>
      ) : versions.length === 0 ? (
        <p className="community-empty">暂无公开作品。</p>
      ) : (
        <div className="community-grid">
          {versions.map((version) => {
            const sharedVoices = Object.values(version.promptSnapshot?.voiceDesigns || {}).filter((voice) => voice.shared);
            return (
              <article key={version.id} className="community-work-card">
                <header>
                  <div className={`community-kind ${version.kind}`}>{version.kind === 'ai' ? 'AI 配音' : '真人配音'}</div>
                  <span>V{version.versionNumber}</span>
                </header>
                <div className="community-creator">
                  <span className="community-avatar">{(version.displayName || version.username).slice(0, 1)}</span>
                  <div>
                    <strong>{version.displayName || version.username}</strong>
                    <small>《斑点带子案》· {version.chapterId} · 第 {version.paragraphIndex + 1} 段</small>
                  </div>
                </div>
                <blockquote>{version.sourceText}</blockquote>
                <audio controls preload="none" src={version.audioUrl}>你的浏览器不支持音频播放。</audio>
                {sharedVoices.length > 0 && (
                  <div className="shared-voice-tags">
                    {sharedVoices.map((voice) => <span key={voice.versionId}>可用音色 · {voice.characterName}</span>)}
                  </div>
                )}
                <footer>
                  <span>采用 {version.adoptionCount}</span>
                  <div>
                    <CommunityLikeButton
                      liked={version.likedByMe}
                      likeCount={version.likeCount}
                      ownedByMe={version.ownerUserId === user?.id}
                      onToggle={() => void toggleLike(version)}
                    />
                    <button type="button" className={version.adoptedByMe ? 'active' : ''} onClick={() => void adopt(version)}>
                      {version.adoptedByMe ? '当前使用' : '采用为我的配音'}
                    </button>
                    {user && version.ownerUserId !== user.id && <button type="button" onClick={() => void report(version)}>举报</button>}
                    {user && version.ownerUserId === user.id && <button type="button" onClick={() => void withdraw(version)}>撤回作品</button>}
                    <button type="button" onClick={() => {
                      if (!requireLogin()) return;
                      setChapterId(version.chapterId);
                      setPage('reader');
                    }}>查看原文</button>
                  </div>
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function IllustrationWorkCard({
  version,
  user,
  compact = false,
  onRequireLogin,
  onLike,
  onAdopt,
  onWithdraw,
  onReport,
  onViewSource,
  onCommentCount
}: {
  version: IllustrationVersion;
  user: User | null;
  compact?: boolean;
  onRequireLogin: () => void;
  onLike: (version: IllustrationVersion) => Promise<void>;
  onAdopt: (version: IllustrationVersion) => Promise<void>;
  onWithdraw?: (version: IllustrationVersion) => Promise<void>;
  onReport: (version: IllustrationVersion) => Promise<void>;
  onViewSource?: (version: IllustrationVersion) => void;
  onCommentCount?: (versionId: string, count: number) => void;
}) {
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<IllustrationComment[]>([]);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentError, setCommentError] = useState('');
  const [copied, setCopied] = useState(false);

  async function toggleComments() {
    const nextOpen = !commentsOpen;
    setCommentsOpen(nextOpen);
    if (!nextOpen || commentsLoaded || version.status !== 'public') return;
    setCommentBusy(true);
    setCommentError('');
    try {
      const result = await api.illustrationComments(version.id);
      setComments(result.comments);
      setCommentsLoaded(true);
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : '评论加载失败');
    } finally {
      setCommentBusy(false);
    }
  }

  async function submitComment(event: React.FormEvent) {
    event.preventDefault();
    if (!user) {
      onRequireLogin();
      return;
    }
    const content = commentDraft.trim();
    if (!content) return;
    setCommentBusy(true);
    setCommentError('');
    try {
      const { comment } = await api.createIllustrationComment(version.id, content);
      const next = [...comments, comment];
      setComments(next);
      setCommentsLoaded(true);
      setCommentDraft('');
      onCommentCount?.(version.id, next.length);
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : '评论发布失败');
    } finally {
      setCommentBusy(false);
    }
  }

  async function removeComment(comment: IllustrationComment) {
    if (!window.confirm('确定删除这条评论吗？')) return;
    setCommentBusy(true);
    try {
      await api.deleteIllustrationComment(comment.id);
      const next = comments.filter((item) => item.id !== comment.id);
      setComments(next);
      onCommentCount?.(version.id, next.length);
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : '评论删除失败');
    } finally {
      setCommentBusy(false);
    }
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(version.finalPrompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      window.prompt('复制创作提示词', version.finalPrompt);
    }
  }

  const creatorName = version.displayName || version.username || '匿名创作者';
  return (
    <article className={`illustration-work-card${compact ? ' compact' : ''}`}>
      <div className="illustration-work-image">
        <img src={version.imageUrl} alt={`由 ${creatorName} 创作的段落插图`} />
        <span>{version.promptMode === 'official' ? '官方风格' : '自由创作'}</span>
      </div>
      <div className="illustration-work-copy">
        <header>
          <div className="community-creator">
            <span className="community-avatar">{creatorName.slice(0, 1)}</span>
            <div>
              <strong>{creatorName}</strong>
              <small>第 {version.paragraphIndex + 1} 段 · V{version.versionNumber}</small>
            </div>
          </div>
          {version.status !== 'public' && <span className={`illustration-status ${version.status}`}>{version.status === 'private' ? '未发布' : '已撤回'}</span>}
        </header>
        {!compact && <blockquote>{version.sourceText}</blockquote>}
        <details className="illustration-full-prompt">
          <summary>查看创作提示词</summary>
          <p>{version.finalPrompt}</p>
        </details>
        <div className="illustration-work-actions">
          <span>评论 {version.commentCount}</span>
          <div>
            {version.status === 'public' && (
              <CommunityLikeButton
                liked={version.likedByMe}
                likeCount={version.likeCount}
                ownedByMe={version.ownerUserId === user?.id}
                onToggle={() => void onLike(version)}
              />
            )}
            <button type="button" className={version.adoptedByMe ? 'active' : ''} onClick={() => void onAdopt(version)}>
              {version.adoptedByMe ? '当前使用' : '采用为我的插图'}
            </button>
            <button type="button" onClick={() => void copyPrompt()}>{copied ? '已复制' : '复制提示词'}</button>
            {version.status === 'public' && <button type="button" onClick={() => void toggleComments()}>评论</button>}
            {version.ownerUserId === user?.id && version.status === 'public' && onWithdraw && (
              <button type="button" onClick={() => void onWithdraw(version)}>撤回作品</button>
            )}
            {user && version.ownerUserId !== user.id && version.status === 'public' && (
              <button type="button" onClick={() => void onReport(version)}>举报</button>
            )}
            {onViewSource && <button type="button" onClick={() => onViewSource(version)}>查看原文</button>}
          </div>
        </div>
        {commentsOpen && version.status === 'public' && (
          <div className="illustration-comments">
            {commentBusy && !commentsLoaded ? <p>正在加载评论...</p> : comments.length === 0 ? <p>暂无评论。</p> : comments.map((comment) => (
              <div key={comment.id} className="illustration-comment">
                <div><strong>{comment.displayName || comment.username}</strong><span>{comment.content}</span></div>
                {comment.userId === user?.id && <button type="button" disabled={commentBusy} onClick={() => void removeComment(comment)}>删除</button>}
              </div>
            ))}
            <form onSubmit={submitComment}>
              <input
                value={commentDraft}
                maxLength={1000}
                placeholder={user ? '发表你的看法' : '登录后参与讨论'}
                onChange={(event) => setCommentDraft(event.target.value)}
              />
              <button type="submit" disabled={commentBusy || !commentDraft.trim()}>发布</button>
            </form>
            {commentError && <p className="form-error">{commentError}</p>}
          </div>
        )}
      </div>
    </article>
  );
}

function IllustrationCommunityPage({
  user,
  setPage,
  setChapterId
}: {
  user: User | null;
  setPage: (page: Page) => void;
  setChapterId: (chapterId: string) => void;
}) {
  const [tab, setTab] = useState<'all' | 'mine'>('all');
  const [sort, setSort] = useState<'popular' | 'newest'>('popular');
  const [versions, setVersions] = useState<IllustrationVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadVersions = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.communityIllustrations('', '', sort, tab);
      setVersions(result.versions);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '插图创作广场加载失败');
    } finally {
      setLoading(false);
    }
  }, [sort, tab]);

  useEffect(() => { void loadVersions(); }, [loadVersions]);

  function requireLogin() {
    if (!user) setPage('login');
  }

  function replaceVersion(updated: IllustrationVersion) {
    setVersions((current) => current.map((item) => item.id === updated.id ? updated : item));
  }

  async function toggleLike(version: IllustrationVersion) {
    if (!user) { requireLogin(); return; }
    try {
      replaceVersion((await api.likeIllustration(version.id, !version.likedByMe)).version);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '点赞失败');
    }
  }

  async function adopt(version: IllustrationVersion) {
    if (!user) { requireLogin(); return; }
    try {
      const updated = (await api.adoptIllustration(version.unitId, version.id)).version;
      setVersions((current) => current.map((item) => item.unitId === updated.unitId
        ? { ...item, adoptedByMe: item.id === updated.id }
        : item));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '采用插图失败');
    }
  }

  async function withdraw(version: IllustrationVersion) {
    if (!window.confirm('撤回后作品将从创作广场消失，已经采用的读者仍可继续使用。确定撤回吗？')) return;
    try {
      await api.setIllustrationStatus(version.id, 'withdrawn');
      setVersions((current) => current.filter((item) => item.id !== version.id));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '撤回失败');
    }
  }

  async function report(version: IllustrationVersion) {
    if (!user) { requireLogin(); return; }
    const reason = window.prompt('请简要说明举报原因（最多 500 字）')?.trim();
    if (!reason) return;
    try {
      await api.reportIllustration(version.id, reason);
      window.alert('举报已提交');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '举报失败');
    }
  }

  return (
    <section className="community-page illustration-square-page">
      <header className="community-hero illustration-square-hero">
        <div>
          <p className="eyebrow">ILLUSTRATION GALLERY</p>
          <h1>插图创作广场</h1>
          <p>探索读者对故事段落的多样视觉表达，发现值得采用的插图与创作灵感。</p>
        </div>
        <div className="community-hero-stat"><strong>{versions.length}</strong><span>公开作品</span></div>
      </header>
      <div className="community-toolbar">
        <div className="community-tabs">
          <button type="button" className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>全部作品</button>
          {user && <button type="button" className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>我的作品</button>}
        </div>
        <label>排序<select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="popular">热门优先</option><option value="newest">最新发布</option></select></label>
      </div>
      {error && <p className="community-error">{error}</p>}
      {loading ? <p className="community-empty">正在载入插图作品...</p> : versions.length === 0 ? (
        <p className="community-empty">暂无公开作品。</p>
      ) : (
        <div className="illustration-community-grid">
          {versions.map((version) => (
            <IllustrationWorkCard
              key={version.id}
              version={version}
              user={user}
              onRequireLogin={requireLogin}
              onLike={toggleLike}
              onAdopt={adopt}
              onWithdraw={withdraw}
              onReport={report}
              onViewSource={(item) => { setChapterId(item.chapterId); setPage('reader'); }}
              onCommentCount={(id, count) => setVersions((current) => current.map((item) => item.id === id ? { ...item, commentCount: count } : item))}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ClueVersionCard({
  version,
  user,
  compact = false,
  onLike,
  onAdopt,
  onPublish,
  onWithdraw,
  onReport,
  onViewSource
}: {
  version: ClueImageVersion;
  user: User | null;
  compact?: boolean;
  onLike: (version: ClueImageVersion) => Promise<void>;
  onAdopt: (version: ClueImageVersion) => Promise<void>;
  onPublish?: (version: ClueImageVersion) => Promise<void>;
  onWithdraw?: (version: ClueImageVersion) => Promise<void>;
  onReport?: (version: ClueImageVersion) => Promise<void>;
  onViewSource?: (version: ClueImageVersion) => void;
}) {
  const creatorName = version.displayName || version.username || '匿名创作者';
  return (
    <article className={`clue-version-card${compact ? ' compact' : ''}${version.adoptedByMe ? ' adopted' : ''}`}>
      <div className="clue-version-image">
        <img src={version.imageUrl} alt={`${version.clueLabel}证物图`} />
        <span>{version.clueType}</span>
      </div>
      <div className="clue-version-copy">
        <header>
          <div className="community-creator">
            <span className="community-avatar">{creatorName.slice(0, 1)}</span>
            <div><strong>{creatorName}</strong><small>{version.clueLabel} · V{version.versionNumber}</small></div>
          </div>
          {version.status !== 'public' && (
            <span className={`illustration-status ${version.status}`}>
              {version.status === 'private' ? '未发布' : '已撤回'}
            </span>
          )}
        </header>
        {!compact && <blockquote>{version.sourceText}</blockquote>}
        <details className="illustration-full-prompt"><summary>查看创作提示词</summary><p>{version.finalPrompt}</p></details>
        <div className="clue-version-meta">采用 {version.adoptionCount}</div>
        <div className="clue-version-actions">
          {version.status === 'public' && (
            <CommunityLikeButton
              liked={version.likedByMe}
              likeCount={version.likeCount}
              ownedByMe={version.ownerUserId === user?.id}
              onToggle={() => void onLike(version)}
            />
          )}
          <button type="button" className={version.adoptedByMe ? 'active' : ''} onClick={() => void onAdopt(version)}>
            {version.adoptedByMe ? '当前使用' : '用于我的证物'}
          </button>
          {version.ownerUserId === user?.id && version.status === 'private' && onPublish && (
            <button type="button" onClick={() => void onPublish(version)}>发布到社区</button>
          )}
          {version.ownerUserId === user?.id && version.status === 'public' && onWithdraw && (
            <button type="button" onClick={() => void onWithdraw(version)}>撤回作品</button>
          )}
          {user && version.ownerUserId !== user.id && version.status === 'public' && onReport && (
            <button type="button" onClick={() => void onReport(version)}>举报</button>
          )}
          {onViewSource && <button type="button" onClick={() => onViewSource(version)}>查看原文</button>}
        </div>
      </div>
    </article>
  );
}

function ClueCommunityPage({
  user,
  setPage,
  setChapterId
}: {
  user: User | null;
  setPage: (page: Page) => void;
  setChapterId: (chapterId: string) => void;
}) {
  const [tab, setTab] = useState<'all' | 'mine'>('all');
  const [sort, setSort] = useState<'popular' | 'newest'>('popular');
  const [versions, setVersions] = useState<ClueImageVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadVersions = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.clueImageCommunity('speckled-band', '', sort, tab);
      setVersions(result.versions);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '证物社区加载失败');
    } finally {
      setLoading(false);
    }
  }, [sort, tab]);

  useEffect(() => { void loadVersions(); }, [loadVersions]);

  function requireLogin() {
    if (user) return true;
    setPage('login');
    return false;
  }

  function replaceVersion(updated: ClueImageVersion) {
    setVersions((current) => current.map((item) => item.id === updated.id ? updated : item));
  }

  async function like(version: ClueImageVersion) {
    if (!requireLogin()) return;
    try {
      replaceVersion((await api.likeClueImage(version.id, !version.likedByMe)).version);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '点赞失败');
    }
  }

  async function adopt(version: ClueImageVersion) {
    if (!requireLogin()) return;
    try {
      const updated = (await api.adoptClueImage(version.clueId, version.id)).version;
      setVersions((current) => current.map((item) => item.clueId === updated.clueId
        ? { ...item, adoptedByMe: item.id === updated.id }
        : item));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '采用证物图失败');
    }
  }

  async function withdraw(version: ClueImageVersion) {
    if (!window.confirm('撤回后作品将从证物社区消失，已有采用者不受影响。确定撤回吗？')) return;
    try {
      await api.setClueImageStatus(version.id, 'withdrawn');
      setVersions((current) => current.filter((item) => item.id !== version.id));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '撤回失败');
    }
  }

  async function report(version: ClueImageVersion) {
    if (!requireLogin()) return;
    const reason = window.prompt('请简要说明举报原因（最多 500 字）')?.trim();
    if (!reason) return;
    try {
      await api.reportClueImage(version.id, reason);
      window.alert('举报已提交');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '举报失败');
    }
  }

  return (
    <section className="community-page clue-community-page">
      <header className="community-hero clue-square-hero">
        <div><p className="eyebrow">EVIDENCE GALLERY</p><h1>证物创作社区</h1><p>围绕同一件证物探索不同视觉解释，采用只会改变你自己的阅读版本。</p></div>
        <div className="community-hero-stat"><strong>{versions.length}</strong><span>公开证物图</span></div>
      </header>
      <div className="community-toolbar">
        <div className="community-tabs">
          <button type="button" className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>全部作品</button>
          {user && <button type="button" className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>我的作品</button>}
        </div>
        <label>排序<select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="popular">热门优先</option><option value="newest">最新发布</option></select></label>
      </div>
      {error && <p className="community-error">{error}</p>}
      {loading ? <p className="community-empty">正在载入证物作品...</p> : versions.length === 0 ? (
        <p className="community-empty">暂无公开证物作品。</p>
      ) : (
        <div className="clue-community-grid">
          {versions.map((version) => (
            <ClueVersionCard
              key={version.id}
              version={version}
              user={user}
              onLike={like}
              onAdopt={adopt}
              onWithdraw={withdraw}
              onReport={report}
              onViewSource={(item) => { setChapterId(item.chapterId); setPage('reader'); }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CoverCommunityPage({
  user,
  setPage,
  onRemix
}: {
  user: User | null;
  setPage: (page: Page) => void;
  onRemix: (version: CoverVersion) => void;
}) {
  const [tab, setTab] = useState<'all' | 'mine' | 'collected'>('all');
  const [sort, setSort] = useState<'popular' | 'newest'>('popular');
  const [versions, setVersions] = useState<CoverVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [likingIds, setLikingIds] = useState<Set<string>>(() => new Set());

  const loadVersions = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.coverCommunity('', sort, tab);
      setVersions(result.versions);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '封面社区加载失败');
    } finally {
      setLoading(false);
    }
  }, [sort, tab]);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  function requireLogin() {
    if (user) return true;
    setPage('login');
    return false;
  }

  function replaceVersion(version: CoverVersion) {
    setVersions((current) => current.map((item) => item.id === version.id ? version : item));
  }

  async function toggleLike(version: CoverVersion) {
    if (!requireLogin()) return;
    if (likingIds.has(version.id)) return;
    setLikingIds((current) => new Set(current).add(version.id));
    setError('');
    try {
      replaceVersion((await api.likeCover(version.id, !version.likedByMe)).version);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '点赞失败');
    } finally {
      setLikingIds((current) => {
        const next = new Set(current);
        next.delete(version.id);
        return next;
      });
    }
  }

  async function toggleCollection(version: CoverVersion) {
    if (!requireLogin()) return;
    try {
      replaceVersion((await api.collectCover(version.id, !version.collectedByMe)).version);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '收藏失败');
    }
  }

  async function report(version: CoverVersion) {
    if (!requireLogin()) return;
    const reason = window.prompt('请简要说明举报原因（3—500 字）');
    if (!reason) return;
    try {
      await api.reportCover(version.id, reason);
      window.alert('举报已提交');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '举报失败');
    }
  }

  async function withdraw(version: CoverVersion) {
    if (!user || version.ownerUserId !== user.id) return;
    if (!window.confirm('确定将这张封面从创作广场撤回吗？你的版本历史不会删除。')) return;
    try {
      await api.setCoverStatus(version.id, 'withdrawn');
      setVersions((current) => current.filter((item) => item.id !== version.id));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '撤回失败');
    }
  }

  return (
    <section className="community-page cover-square-page">
      <header className="community-hero cover-square-hero">
        <div>
          <p className="eyebrow">POSTER GALLERY</p>
          <h1>封面创作社区</h1>
          <p>探索读者对同一部作品的多样视觉诠释。</p>
        </div>
        <div className="community-hero-stat"><strong>{versions.length}</strong><span>公开封面</span></div>
      </header>

      <div className="community-toolbar">
        <div className="community-tabs">
          <button type="button" className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>全部封面</button>
          {user && <button type="button" className={tab === 'collected' ? 'active' : ''} onClick={() => setTab('collected')}>我的收藏</button>}
          {user && <button type="button" className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>我的作品</button>}
        </div>
        <label>排序<select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="popular">热门优先</option><option value="newest">最新发布</option></select></label>
      </div>

      {error && <p className="community-error">{error}</p>}
      {loading ? <p className="community-empty">正在载入封面作品…</p> : versions.length === 0 ? (
        <p className="community-empty">暂无公开封面。</p>
      ) : (
        <div className="community-cover-grid">
          {versions.map((version) => (
            <article key={version.id} className="community-cover-card">
              <CoverArtwork version={version} />
              <div className="community-cover-card-copy">
                <header><span className="community-kind cover">电影海报封面</span><small>V{version.versionNumber}</small></header>
                <div className="community-creator">
                  <span className="community-avatar">{(version.displayName || version.username).slice(0, 1)}</span>
                <div><strong>{version.displayName || version.username}</strong><small>《{version.bookTitle}》· {version.mode === 'guided' ? '引导创作' : '自由创作'}</small></div>
                </div>
                <div className="cover-community-metrics">收藏 {version.collectionCount} · 衍生创作 {version.remixCount}</div>
                <div className="cover-community-tags">{[version.mood, version.palette, version.composition].filter(Boolean).map((tag) => <span key={tag}>{tag}</span>)}</div>
                <details className="cover-full-prompt"><summary>查看创作提示词</summary><p>{version.finalPrompt}</p></details>
                <footer>
                  <CoverLikeButton
                    version={version}
                    ownedByMe={version.ownerUserId === user?.id}
                    pending={likingIds.has(version.id)}
                    onToggle={() => void toggleLike(version)}
                  />
                  {version.ownerUserId === user?.id ? (
                    <button type="button" onClick={() => void withdraw(version)}>撤回作品</button>
                  ) : (
                    <>
                      <button type="button" className={version.collectedByMe ? 'active' : ''} onClick={() => void toggleCollection(version)}>{version.collectedByMe ? '已收藏' : '收藏'}</button>
                      {user && <button type="button" onClick={() => void report(version)}>举报</button>}
                    </>
                  )}
                  <button type="button" className="cover-remix-cta" onClick={() => {
                    if (!requireLogin()) return;
                    onRemix(version);
                  }}>基于此作品创作</button>
                </footer>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function VoiceLibrary({
  compact = false,
  onCreated
}: {
  compact?: boolean;
  onCreated?: (version: VoiceDesignVersion) => void;
}) {
  const [voices, setVoices] = useState<VoiceDesignVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [voiceName, setVoiceName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [previewText, setPreviewText] = useState('');

  const loadVoices = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.voiceDesigns('mine');
      setVoices(result.versions);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '音色库加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadVoices();
  }, [loadVoices]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (voiceName.trim().length < 2 || prompt.trim().length < 5 || previewText.trim().length < 5) {
      setError('请填写音色名称，并为音色描述和试听文本各输入至少 5 个字');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const { version } = await api.createVoiceDesign({
        voiceName: voiceName.trim(),
        prompt: prompt.trim(),
        previewText: previewText.trim()
      });
      setVoices((current) => [version, ...current]);
      setVoiceName('');
      setPrompt('');
      setPreviewText('');
      onCreated?.(version);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '音色创建失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={compact ? 'voice-library compact' : 'voice-library'}>
      <div className="voice-library-heading">
        <div>
          <p className="eyebrow">MY VOICE LIBRARY</p>
          <h2>我的音色库</h2>
          <p>建立个人音色库，为不同作品与角色持续使用。</p>
        </div>
        <span>{voices.length} 个音色版本</span>
      </div>

      <form className="voice-design-form" onSubmit={submit}>
        <label>
          音色名称
          <input value={voiceName} maxLength={80} placeholder="例如：冷静的青年侦探" onChange={(event) => setVoiceName(event.target.value)} />
        </label>
        <label>
          音色描述
          <textarea value={prompt} maxLength={500} rows={3} placeholder="描述年龄、质感、语气、节奏与听感" onChange={(event) => setPrompt(event.target.value)} />
        </label>
        <label>
          试听文本
          <textarea value={previewText} maxLength={200} rows={2} placeholder="输入一段最能体现该音色特点的文本" onChange={(event) => setPreviewText(event.target.value)} />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" disabled={saving}>{saving ? '正在创建...' : '创建音色'}</button>
      </form>

      <div className="voice-library-list">
        {loading ? <p>正在读取我的音色...</p> : voices.length === 0 ? <p>暂无个人音色。</p> : voices.map((voice) => (
          <article key={voice.id} className="voice-library-card">
            <div>
              <strong>{voice.characterName}</strong>
              <small>V{voice.versionNumber} · {voice.shared ? '已随公开作品共享' : '个人音色'}</small>
              <p>{voice.prompt}</p>
              <span>试听文本：{voice.previewText}</span>
            </div>
            {voice.previewAudioUrl && <audio controls preload="none" src={voice.previewAudioUrl} />}
          </article>
        ))}
      </div>
    </section>
  );
}

function BookshelfPage({
  user,
  chapters,
  collectedClueCount,
  activeCover,
  setChapterId,
  setPage
}: {
  user: User;
  chapters: Chapter[];
  collectedClueCount: number;
  activeCover: CoverVersion | null;
  setChapterId: (id: string) => void;
  setPage: (page: Page) => void;
}) {
  const currentChapter = chapters[0];
  const lastChapter = chapters.length
    ? chapters.reduce((best, chapter) => (chapter.progress > best.progress ? chapter : best))
    : null;
  const shelfProgress = lastChapter?.progress ?? 18;
  const lastRead = lastChapter?.subtitle ?? '贝克街的求助';
  const books = [
    {
      id: 'speckled-band',
      title: '斑点带子案',
      author: 'Arthur Conan Doyle',
      category: '福尔摩斯探案集',
      progress: shelfProgress,
      lastRead,
      totalChapters: chapters.length || 3,
      clueCount: collectedClueCount,
      status: '继续阅读'
    },
    {
      id: 'red-headed-league',
      title: '红发会',
      author: 'Arthur Conan Doyle',
      category: '即将开放',
      progress: 0,
      lastRead: '尚未开始',
      totalChapters: 0,
      clueCount: 0,
      status: '待解锁'
    },
    {
      id: 'blue-carbuncle',
      title: '蓝宝石案',
      author: 'Arthur Conan Doyle',
      category: '即将开放',
      progress: 0,
      lastRead: '尚未开始',
      totalChapters: 0,
      clueCount: 0,
      status: '待解锁'
    }
  ];

  function openBook(bookId: string) {
    if (bookId !== 'speckled-band') return;
    setChapterId(currentChapter?.id ?? 'speckled-band-1');
    setPage('reader');
  }

  return (
    <section className="bookshelf-page">
      <header className="shelf-hero">
        <div>
          <p className="eyebrow">My Library</p>
          <h1>{user.displayName} 的书架</h1>
          <p>收藏正在阅读与已经读过的作品，随时继续上次的阅读。</p>
        </div>
        <div className="shelf-summary">
          <span>{books.length}</span>
          <p>书架藏书</p>
          <span>{collectedClueCount}</span>
          <p>已收集证物</p>
        </div>
      </header>

      <section className="continue-card">
        <CoverArtwork version={activeCover} className="mini-cover" />
        <div>
          <p className="eyebrow">最近阅读</p>
          <h2>《斑点带子案》</h2>
          <p>上次读到：{lastRead}</p>
          <div className="progress">
            <span style={{ width: `${shelfProgress}%` }} />
          </div>
        </div>
        <button onClick={() => openBook('speckled-band')}>继续</button>
      </section>

      <section className="book-grid" aria-label="我的书架">
        {books.map((book) => {
          const available = book.id === 'speckled-band';

          return (
            <button
              key={book.id}
              className={available ? 'shelf-book' : 'shelf-book locked'}
              onClick={() => openBook(book.id)}
              type="button"
            >
              <span className="book-spine">{book.category}</span>
              {available ? (
                <CoverArtwork version={activeCover} className="book-cover-tile" />
              ) : (
                <span className="book-cover-tile">
                  <small>{book.author}</small>
                  <strong>{book.title}</strong>
                </span>
              )}
              <span className="book-info">
                <strong>{book.title}</strong>
                <small>{book.lastRead}</small>
                <span className="book-progress">
                  <span style={{ width: `${book.progress}%` }} />
                </span>
                <small>
                  {book.totalChapters ? `${book.totalChapters} 章 · ${book.clueCount} 件证物` : '内容准备中'}
                </small>
              </span>
              <span className="book-status">{book.status}</span>
            </button>
          );
        })}
      </section>
    </section>
  );
}

function AuthPage({
  mode,
  saveSession,
  setPage
}: {
  mode: 'login' | 'register';
  saveSession: (token: string, user: User) => void;
  setPage: (page: Page) => void;
}) {
  const [username, setUsername] = useState(mode === 'login' ? 'demo' : '');
  const [password, setPassword] = useState(mode === 'login' ? '123456' : '');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const isLogin = mode === 'login';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = isLogin
        ? await api.login({ username, password })
        : await api.register({ username, password, displayName });
      saveSession(result.token, result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <p className="eyebrow">{isLogin ? 'Welcome back' : 'Create account'}</p>
        <h1>{isLogin ? '登录账号' : '注册账号'}</h1>
        <p className="form-tip">
          账号与社区数据保存在 MySQL；本地与部署环境使用各自配置的数据库。
        </p>

        {!isLogin && (
          <label>
            昵称
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
        )}

        <label>
          用户名
          <input value={username} onChange={(event) => setUsername(event.target.value)} required />
        </label>

        <label>
          密码
          <input
            value={password}
            type="password"
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>

        {error && <p className="form-error">{error}</p>}

        <button type="submit" disabled={loading}>
          {loading ? '提交中...' : isLogin ? '登录' : '注册并进入'}
        </button>

        <button
          type="button"
          className="link-button"
          onClick={() => setPage(isLogin ? 'register' : 'login')}
        >
          {isLogin ? '注册账号' : '返回登录'}
        </button>
      </form>
    </section>
  );
}

function ProfilePage({
  user,
  setPage,
  collectedClues,
  clues,
  clueImages,
  activeCover,
  updateUser
}: {
  user: User | null;
  setPage: (page: Page) => void;
  collectedClues: CollectedClueRecord[];
  clues: Clue[];
  clueImages: Record<string, ClueImage>;
  activeCover: CoverVersion | null;
  updateUser: (user: User) => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [draftDisplayName, setDraftDisplayName] = useState(user?.displayName ?? '');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const collectedEntries = collectedClues.flatMap((record) => {
    const clue = clues.find((item) => item.id === record.clueId);
    return clue ? [{ clue, record }] : [];
  });

  if (!user) {
    return (
      <section className="profile-page">
        <div className="profile-card">
          <h1>请先登录</h1>
          <p>登录后可以查看你的阅读进度、证物袋和阅读档案。</p>
          <button onClick={() => setPage('login')}>去登录</button>
        </div>
      </section>
    );
  }

  async function saveDisplayName() {
    const displayName = draftDisplayName.trim();
    if (!displayName) {
      setProfileError('昵称不能为空');
      return;
    }

    setProfileSaving(true);
    setProfileError('');
    try {
      const { user: nextUser } = await api.updateProfile({ displayName });
      updateUser(nextUser);
      setDraftDisplayName(nextUser.displayName);
      setEditingName(false);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : '昵称保存失败');
    } finally {
      setProfileSaving(false);
    }
  }

  return (
    <section className="profile-page">
      <div className="profile-card">
        <div className="avatar">{user.displayName.slice(0, 1).toUpperCase()}</div>
        {editingName ? (
          <div className="profile-name-editor">
            <input
              value={draftDisplayName}
              maxLength={40}
              onChange={(event) => setDraftDisplayName(event.target.value)}
              aria-label="昵称"
            />
            <button type="button" onClick={saveDisplayName} disabled={profileSaving}>
              {profileSaving ? '保存中' : '保存'}
            </button>
            <button
              className="secondary"
              type="button"
              onClick={() => {
                setDraftDisplayName(user.displayName);
                setEditingName(false);
                setProfileError('');
              }}
              disabled={profileSaving}
            >
              取消
            </button>
          </div>
        ) : (
          <>
            <h1>{user.displayName}</h1>
            <button
              className="profile-edit-name"
              type="button"
              onClick={() => {
                setDraftDisplayName(user.displayName);
                setEditingName(true);
              }}
            >
              修改昵称
            </button>
          </>
        )}
        <p>@{user.username}</p>
        <p>{user.bio}</p>
        {profileError && <p className="profile-error">{profileError}</p>}
      </div>

      <div className="profile-stats">
        <article>
          <span>{collectedEntries.length}</span>
          <p>已收集证物</p>
        </article>
        <article>
          <span>3</span>
          <p>开放章节</p>
        </article>
        <article>
          <span>76%</span>
          <p>最高阅读进度</p>
        </article>
      </div>

      <div className="profile-card">
        <h2>我的证物袋</h2>
        {collectedEntries.length === 0 ? (
          <p>暂无已收集证物。阅读时可将可疑细节收入证物袋。</p>
        ) : (
          <div className="profile-clues">
            {collectedEntries.map(({ clue, record }) => {
              const image = clueImages[clueImageKey(clue.id)];
              return (
                <article key={clue.id} className="clue-card profile-clue-card">
                  {image?.imageUrl ? (
                    <img className="clue-card-image" src={image.imageUrl} alt={clue.label} />
                  ) : (
                    <div className="clue-image-placeholder">尚未生成图像</div>
                  )}
                  <span>{clue.type}</span>
                  <h3>{clue.label}</h3>
                  <p>{clue.surfaceDescription}</p>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <div className="profile-card profile-cover-card">
        <CoverArtwork version={activeCover} />
        <div>
          <p className="eyebrow">Current Cover</p>
          <h2>{activeCover ? `我的封面 V${activeCover.versionNumber}` : '官方封面'}</h2>
          <p>{activeCover ? '这张封面已经同步到首页、书架和阅读档案。' : '进入阅读器右侧的封面设计，创作属于你的电影海报。'}</p>
          <button type="button" onClick={() => setPage('reader')}>去设计封面</button>
        </div>
      </div>

      <div className="profile-card voice-profile-card">
        <VoiceLibrary />
      </div>
    </section>
  );
}

function formatDebugTime(timestamp: number | null) {
  if (!timestamp) {
    return '未知时间';
  }
  return new Date(timestamp).toLocaleString();
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre className="debug-json">{JSON.stringify(value, null, 2)}</pre>;
}

function SpeechDebugPage() {
  const [speechDebugInfo, setSpeechDebugInfo] = useState<SpeechDebugInfo | null>(null);
  const [imageDebugInfo, setImageDebugInfo] = useState<ImageDebugInfo | null>(null);
  const [activeDomain, setActiveDomain] = useState<'speech' | 'image'>('speech');
  const [activePrompt, setActivePrompt] = useState<'speechPhase1' | 'speechPhase3a' | 'imagePhase1' | 'imagePhase2'>(
    'speechPhase3a'
  );
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState<'' | 'speech' | 'image'>('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  const loadDebugInfo = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [speechResult, imageResult] = await Promise.all([api.speechDebug(20), api.imageDebug(20)]);
      setSpeechDebugInfo(speechResult);
      setImageDebugInfo(imageResult);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '调试信息加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDebugInfo();
  }, [loadDebugInfo]);

  async function copyPrompt() {
    const prompt = getActivePromptText();
    if (!prompt) return;
    await navigator.clipboard.writeText(prompt);
    setCopied('提示词已复制');
    window.setTimeout(() => setCopied(''), 1800);
  }

  async function regenerateGlobalProduct(kind: 'speech' | 'image') {
    const label = kind === 'speech' ? '语音音色缓存' : '图像全局风格缓存';
    const confirmed = window.confirm(`确定重新生成${label}吗？当前生成结果将被替换。`);
    if (!confirmed) return;

    setRegenerating(kind);
    setError('');
    try {
      if (kind === 'speech') {
        await api.regenerateSpeechVoices();
      } else {
        await api.regenerateImageStyle();
      }
      await loadDebugInfo();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : `${label}重新生成失败`);
    } finally {
      setRegenerating('');
    }
  }

  function getActivePromptText() {
    if (activePrompt === 'speechPhase1') return speechDebugInfo?.prompts.phase1System ?? '';
    if (activePrompt === 'speechPhase3a') return speechDebugInfo?.prompts.phase3aSystem ?? '';
    if (activePrompt === 'imagePhase1') return imageDebugInfo?.prompts.phase1System ?? '';
    return imageDebugInfo?.prompts.phase2System ?? '';
  }

  const activePromptText = getActivePromptText();
  const promptLabelMap = {
    speechPhase1: '语音阶段一 system prompt',
    speechPhase3a: '语音阶段三 3a system prompt',
    imagePhase1: '图像阶段一 system prompt',
    imagePhase2: '图像阶段二 system prompt'
  };

  return (
    <section className="speech-debug-page">
      <div className="debug-header">
        <div>
          <p className="eyebrow">Generation Debug</p>
          <h1>生成调试</h1>
          <p>查看语音与文生图的全局缓存、提示词模板，以及最近生成链路。</p>
        </div>
        <div className="debug-actions">
          <button type="button" onClick={loadDebugInfo} disabled={loading || Boolean(regenerating)}>
            {loading ? '刷新中...' : '刷新'}
          </button>
          <button type="button" onClick={() => regenerateGlobalProduct('speech')} disabled={Boolean(regenerating)}>
            {regenerating === 'speech' ? '生成中...' : '重生成音色'}
          </button>
          <button type="button" onClick={() => regenerateGlobalProduct('image')} disabled={Boolean(regenerating)}>
            {regenerating === 'image' ? '生成中...' : '重生成图像风格'}
          </button>
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}

      {speechDebugInfo && imageDebugInfo && (
        <>
          <div className="debug-domain-tabs">
            <button
              type="button"
              className={activeDomain === 'speech' ? 'active' : ''}
              onClick={() => setActiveDomain('speech')}
            >
              配音
            </button>
            <button
              type="button"
              className={activeDomain === 'image' ? 'active' : ''}
              onClick={() => setActiveDomain('image')}
            >
              文生图
            </button>
          </div>

          <section className="debug-section">
            <div className="debug-section-heading">
              <h2>{activeDomain === 'speech' ? '配音缓存状态' : '图像风格缓存状态'}</h2>
              <span>
                {(activeDomain === 'speech' ? speechDebugInfo.cache.initialized : imageDebugInfo.cache.initialized)
                  ? '已初始化'
                  : '未初始化'}
              </span>
            </div>
            {activeDomain === 'speech' ? (
              <>
                <div className="debug-metrics">
                  <article>
                    <span>Book</span>
                    <strong>{speechDebugInfo.cache.bookId}</strong>
                  </article>
                  <article>
                    <span>Roles</span>
                    <strong>{speechDebugInfo.cache.roles.length}</strong>
                  </article>
                  <article>
                    <span>Templates</span>
                    <strong>{speechDebugInfo.cache.templates.length}</strong>
                  </article>
                  <article>
                    <span>Tones</span>
                    <strong>{speechDebugInfo.cache.pronunciationToneCount}</strong>
                  </article>
                </div>
                <div className="debug-grid">
                  <div>
                    <h3>角色音色</h3>
                    <JsonBlock value={speechDebugInfo.cache.roles} />
                  </div>
                  <div>
                    <h3>模板声音池</h3>
                    <JsonBlock value={speechDebugInfo.cache.templates} />
                  </div>
                </div>
                <details className="debug-details">
                  <summary>氛围配置与局部表演弹性</summary>
                  <JsonBlock value={speechDebugInfo.cache.atmosphere} />
                </details>
              </>
            ) : (
              <>
                <div className="debug-metrics">
                  <article>
                    <span>Book</span>
                    <strong>{imageDebugInfo.cache.bookId}</strong>
                  </article>
                  <article>
                    <span>Status</span>
                    <strong>{imageDebugInfo.cache.status}</strong>
                  </article>
                  <article>
                    <span>Records</span>
                    <strong>{imageDebugInfo.records.length}</strong>
                  </article>
                  <article>
                    <span>Events</span>
                    <strong>{imageDebugInfo.eventCount}</strong>
                  </article>
                </div>
                <details className="debug-details" open>
                  <summary>全局风格产物</summary>
                  <JsonBlock value={imageDebugInfo.cache.style} />
                </details>
              </>
            )}
          </section>

          <section className="debug-section">
            <div className="debug-section-heading">
              <h2>当前提示词</h2>
              <button type="button" onClick={copyPrompt}>
                复制
              </button>
            </div>
            <div className="debug-tabs">
              <button
                type="button"
                className={activePrompt === 'speechPhase1' ? 'active' : ''}
                onClick={() => setActivePrompt('speechPhase1')}
              >
                语音阶段一
              </button>
              <button
                type="button"
                className={activePrompt === 'speechPhase3a' ? 'active' : ''}
                onClick={() => setActivePrompt('speechPhase3a')}
              >
                语音阶段三
              </button>
              <button
                type="button"
                className={activePrompt === 'imagePhase1' ? 'active' : ''}
                onClick={() => setActivePrompt('imagePhase1')}
              >
                图像阶段一
              </button>
              <button
                type="button"
                className={activePrompt === 'imagePhase2' ? 'active' : ''}
                onClick={() => setActivePrompt('imagePhase2')}
              >
                图像阶段二
              </button>
              <span>{copied || promptLabelMap[activePrompt]}</span>
            </div>
            <pre className="debug-prompt">{activePromptText}</pre>
          </section>

          <section className="debug-section">
            <div className="debug-section-heading">
              <h2>{activeDomain === 'speech' ? '最近配音记录' : '最近文生图记录'}</h2>
              <span>
                {activeDomain === 'speech'
                  ? `${speechDebugInfo.records.length} 批次 / ${speechDebugInfo.eventCount} 条事件`
                  : `${imageDebugInfo.records.length} 批次 / ${imageDebugInfo.eventCount} 条事件`}
              </span>
            </div>
            {(activeDomain === 'speech' ? speechDebugInfo.records : imageDebugInfo.records).length === 0 ? (
              <p className="debug-empty">
                {activeDomain === 'speech' ? '还没有配音记录。生成一次配音后刷新这里。' : '还没有文生图记录。生成一次插图后刷新这里。'}
              </p>
            ) : (
              <div className="debug-records">
                {(activeDomain === 'speech' ? speechDebugInfo.records : imageDebugInfo.records).map((record) => (
                  <details key={record.id} className="debug-record">
                    <summary>
                      <strong>{record.targetSegment || '未记录目标片段'}</strong>
                      <span>
                        {formatDebugTime(record.startedAt)} ·{' '}
                        {'segmentCount' in record
                          ? `${record.segmentCount} 段 · ${record.traceIds[0] ?? '无 trace'}`
                          : `${record.componentType || '未分类'} · ${record.traceId ?? '无 trace'}`}
                      </span>
                    </summary>
                    <div className="debug-record-body">
                      {record.events.map((event, index) => (
                        <details key={`${record.id}-${event.message}-${index}`} className="debug-event">
                          <summary>
                            <span>{event.message}</span>
                            <small>{event.location}</small>
                          </summary>
                          <JsonBlock value={event} />
                        </details>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}

function ClueCreatorPanel({
  clue,
  occurrenceId,
  user,
  onImageChange,
  onNotice,
  onOpenCommunity
}: {
  clue: Clue;
  occurrenceId: string;
  user: User;
  onImageChange: (image: ClueImage) => void;
  onNotice: (message: string) => void;
  onOpenCommunity: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'mine' | 'community'>('mine');
  const [prompt, setPrompt] = useState(clue.surfaceDescription || `维多利亚时代侦探案中的${clue.label}，作为关键证物的写实特写`);
  const [versions, setVersions] = useState<ClueImageVersion[]>([]);
  const [myVersions, setMyVersions] = useState<ClueImageVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const loadVersions = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.clueImageVersions(clue.id);
      setVersions(result.versions);
      setMyVersions(result.myVersions);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '证物版本加载失败');
    } finally {
      setLoading(false);
    }
  }, [clue.id]);

  useEffect(() => {
    if (open) void loadVersions();
  }, [open, loadVersions]);

  function updateVersion(updated: ClueImageVersion) {
    setVersions((current) => current.map((item) => item.id === updated.id ? updated : item));
    setMyVersions((current) => current.map((item) => item.id === updated.id ? updated : item));
  }

  async function generate() {
    const finalPrompt = prompt.trim();
    if (finalPrompt.length < 5) {
      setError('请至少写 5 个字，描述你希望看到的证物画面');
      return;
    }
    setGenerating(true);
    setError('');
    try {
      const result = await api.createClueImageVersions(clue.id, occurrenceId, finalPrompt);
      setMyVersions((current) => [...result.versions, ...current]);
      setVersions((current) => [...result.versions, ...current]);
      setTab('mine');
      onNotice('已生成 2 张证物候选，请选择一张用于自己的版本');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '证物图生成失败');
    } finally {
      setGenerating(false);
    }
  }

  async function adopt(version: ClueImageVersion) {
    try {
      const updated = (await api.adoptClueImage(clue.id, version.id)).version;
      setVersions((current) => current.map((item) => item.clueId === clue.id ? { ...item, adoptedByMe: item.id === updated.id } : item));
      setMyVersions((current) => current.map((item) => ({ ...item, adoptedByMe: item.id === updated.id })));
      onImageChange({
        clueId: clue.id,
        occurrenceId: updated.occurrenceId,
        skipped: false,
        imageUrl: updated.imageUrl,
        prompt: updated.finalPrompt,
        mediaAssetId: updated.mediaAssetId,
        cacheHit: true,
        userOverride: true,
        createdAt: updated.createdAt
      });
      onNotice(`已将 V${updated.versionNumber} 用于你的证物袋`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '采用证物图失败');
    }
  }

  async function restoreOfficial() {
    try {
      await api.restoreOfficialClueImage(clue.id);
      const { images } = await api.clueImages([occurrenceId]);
      const official = images.find((item) => item.clueId === clue.id);
      if (official) onImageChange(official);
      setVersions((current) => current.map((item) => ({ ...item, adoptedByMe: false })));
      setMyVersions((current) => current.map((item) => ({ ...item, adoptedByMe: false })));
      onNotice('已恢复官方默认证物图，你的历史版本仍然保留');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '恢复官方证物图失败');
    }
  }

  async function like(version: ClueImageVersion) {
    try {
      updateVersion((await api.likeClueImage(version.id, !version.likedByMe)).version);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '点赞失败');
    }
  }

  async function publish(version: ClueImageVersion) {
    try {
      updateVersion((await api.setClueImageStatus(version.id, 'public')).version);
      onNotice('证物作品已发布到社区');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '发布失败');
    }
  }

  async function withdraw(version: ClueImageVersion) {
    if (!window.confirm('撤回后作品将从证物社区消失，已有采用者不受影响。确定撤回吗？')) return;
    try {
      updateVersion((await api.setClueImageStatus(version.id, 'withdrawn')).version);
      onNotice('证物作品已撤回；已有采用者仍可继续使用');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '撤回失败');
    }
  }

  async function report(version: ClueImageVersion) {
    const reason = window.prompt('请简要说明举报原因（最多 500 字）')?.trim();
    if (!reason) return;
    try {
      await api.reportClueImage(version.id, reason);
      onNotice('举报已提交');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '举报失败');
    }
  }

  const visibleVersions = tab === 'mine'
    ? myVersions
    : versions.filter((version) => version.status === 'public');
  const hasAdoption = versions.some((version) => version.adoptedByMe) || myVersions.some((version) => version.adoptedByMe);

  return (
    <div className="clue-creator">
      <button type="button" className="clue-creator-toggle" onClick={() => setOpen((value) => !value)}>
        {open ? '收起证物创作' : '创作我的证物图'}
      </button>
      {open && (
        <div className="clue-creator-body">
          <label>
            <span>画面提示词 <small>{prompt.length}/800</small></span>
            <textarea
              value={prompt}
              maxLength={800}
              rows={4}
              placeholder="描述主体、环境、光线、视角和氛围"
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>
          <div className="clue-creator-primary-actions">
            <button type="button" disabled={generating || !occurrenceId} onClick={() => void generate()}>
              {generating ? '正在生成 2 张候选…' : '生成 2 张候选'}
            </button>
            {hasAdoption && <button type="button" onClick={() => void restoreOfficial()}>恢复官方版本</button>}
          </div>
          <div className="clue-creator-tabs">
            <button type="button" className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>我的版本</button>
            <button type="button" className={tab === 'community' ? 'active' : ''} onClick={() => setTab('community')}>社区作品</button>
          </div>
          {error && <p className="form-error">{error}</p>}
          {loading ? <p className="clue-creator-empty">正在载入版本…</p> : visibleVersions.length === 0 ? (
            <p className="clue-creator-empty">{tab === 'mine' ? '还没有个人版本，先生成两张候选。' : '这件证物还没有公开作品。'}</p>
          ) : (
            <div className="clue-version-grid">
              {visibleVersions.map((version) => (
                <ClueVersionCard
                  key={version.id}
                  version={version}
                  user={user}
                  compact
                  onLike={like}
                  onAdopt={adopt}
                  onPublish={publish}
                  onWithdraw={withdraw}
                  onReport={report}
                />
              ))}
            </div>
          )}
          <button type="button" className="clue-open-community" onClick={onOpenCommunity}>进入完整证物社区</button>
        </div>
      )}
    </div>
  );
}

function ReaderPage({
  user,
  chapters,
  clues,
  collectedClueRecords,
  setCollectedClues,
  clueImages,
  setClueImages,
  chapterId,
  setChapterId,
  notice,
  setNotice,
  question,
  setQuestion,
  messages,
  setMessages,
  setPage,
  activeCover,
  setActiveCover,
  coverInspiration,
  clearCoverInspiration,
  openCoverCommunity,
  openClueCommunity
}: {
  user: User | null;
  chapters: Chapter[];
  clues: Clue[];
  collectedClueRecords: CollectedClueRecord[];
  setCollectedClues: React.Dispatch<React.SetStateAction<CollectedClueRecord[]>>;
  clueImages: Record<string, ClueImage>;
  setClueImages: React.Dispatch<React.SetStateAction<Record<string, ClueImage>>>;
  chapterId: string;
  setChapterId: (id: string) => void;
  notice: string;
  setNotice: (notice: string) => void;
  question: string;
  setQuestion: (question: string) => void;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setPage: (page: Page) => void;
  activeCover: CoverVersion | null;
  setActiveCover: (cover: CoverVersion | null) => void;
  coverInspiration: CoverVersion | null;
  clearCoverInspiration: () => void;
  openCoverCommunity: () => void;
  openClueCommunity: () => void;
}) {
  const chapter = useMemo(
    () => chapters.find((item) => item.id === chapterId) ?? chapters[0],
    [chapters, chapterId]
  );
  const chapterIndex = useMemo(
    () => chapters.findIndex((item) => item.id === chapter?.id),
    [chapters, chapter]
  );
  const previousChapter = chapterIndex > 0 ? chapters[chapterIndex - 1] : null;
  const nextChapter =
    chapterIndex >= 0 && chapterIndex < chapters.length - 1 ? chapters[chapterIndex + 1] : null;

  const collectedClues = useMemo(
    () =>
      collectedClueRecords.flatMap((record) => {
        const clue = clues.find((item) => item.id === record.clueId);
        return clue ? [{ clue, record }] : [];
      }),
    [clues, collectedClueRecords]
  );
  const collectedClueIds = useMemo(
    () => collectedClueRecords.map((record) => record.clueId),
    [collectedClueRecords]
  );
  const chapterClues = useMemo(() => {
    if (!chapter) return [];

    const clueIds = new Set<string>();
    chapter.paragraphs.forEach((paragraph) => {
      paragraph.forEach((segment) => {
        if (segment.type === 'clue') {
          clueIds.add(segment.clueId);
        }
      });
    });
    return clues.filter((clue) => clueIds.has(clue.id));
  }, [chapter, clues]);
  const [contextTab, setContextTab] = useState<ContextTab>('cover');
  const [contextOpen, setContextOpen] = useState(false);
  const [mobileChromeOpen, setMobileChromeOpen] = useState(false);
  const [mobileTocOpen, setMobileTocOpen] = useState(false);
  const [mobileRailExpanded, setMobileRailExpanded] = useState(false);
  const [isMobileReader, setIsMobileReader] = useState(() =>
    window.matchMedia('(max-width: 760px)').matches
  );
  const [readingTheme, setReadingTheme] = useState<ReadingTheme>('light');
  const [readingWidth, setReadingWidth] = useState<ReadingWidth>('standard');
  const [fontSize, setFontSize] = useState(19);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bagPulse, setBagPulse] = useState(false);
  const [activeClueId, setActiveClueId] = useState<string | null>(null);
  const clueGenerationRunningRef = useRef(false);
  const queuedClueGenerationRef = useRef<{
    clueId: string;
    occurrenceId: string;
    force: boolean;
  } | null>(null);
  const [selectedParagraph, setSelectedParagraph] = useState<SelectedParagraph | null>(null);
  const [selectionLayout, setSelectionLayout] = useState<SelectionLayout | null>(null);
  const bookPageRef = useRef<HTMLElement | null>(null);
  const selectionToolbarActionsRef = useRef<HTMLDivElement | null>(null);
  const [paragraphImageLoadingKey, setParagraphImageLoadingKey] = useState<string | null>(null);
  const [paragraphImages, setParagraphImages] = useState<Record<string, RangeMedia<ParagraphImage>>>({});
  const [platformParagraphImages, setPlatformParagraphImages] = useState<Record<string, RangeMedia<ParagraphImage>>>({});
  const [collapsedParagraphImages, setCollapsedParagraphImages] = useState<Record<string, RangeMedia<ParagraphImage>>>({});
  const toggleContextPanel = useCallback(
    (tab: ContextTab) => {
      setContextOpen((open) => (open && contextTab === tab ? false : true));
      setContextTab(tab);
      setMobileRailExpanded(false);
      setMobileChromeOpen(false);
      setMobileTocOpen(false);
    },
    [contextTab]
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 760px)');
    const handleChange = (event: MediaQueryListEvent) => setIsMobileReader(event.matches);

    setIsMobileReader(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (!isMobileReader) return;

    const hideTransientControls = () => {
      setMobileChromeOpen(false);
      setMobileRailExpanded(false);
    };

    window.addEventListener('scroll', hideTransientControls, { passive: true });
    return () => window.removeEventListener('scroll', hideTransientControls);
  }, [isMobileReader]);

  useEffect(() => {
    if (!coverInspiration) return;
    setContextTab('cover');
    setContextOpen(true);
  }, [coverInspiration]);

  useEffect(() => {
    setMobileTocOpen(false);
    setMobileChromeOpen(false);
    setSettingsOpen(false);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [chapter.id]);
  const [paragraphAudios, setParagraphAudios] = useState<Record<string, RangeMedia<ParagraphSpeech>>>({});
  const [platformParagraphAudios, setPlatformParagraphAudios] = useState<
    Record<string, RangeMedia<ParagraphSpeech>>
  >({});
  const [playingAudioKey, setPlayingAudioKey] = useState<string | null>(null);
  const [audioPaused, setAudioPaused] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [paragraphSpeechLoadingKey, setParagraphSpeechLoadingKey] = useState<string | null>(null);
  const [voicePanelOpen, setVoicePanelOpen] = useState(false);
  const [voiceDesignerOpen, setVoiceDesignerOpen] = useState(false);
  const [voiceDesignerSpeaker, setVoiceDesignerSpeaker] = useState<string | null>(null);
  const [paragraphCommunityOpen, setParagraphCommunityOpen] = useState(false);
  const [paragraphCommunityKind, setParagraphCommunityKind] = useState<'dubbing' | 'illustration'>('dubbing');
  const [paragraphCommunityTab, setParagraphCommunityTab] = useState<'all' | 'ai' | 'human'>('all');
  const [dubbingBundles, setDubbingBundles] = useState<Record<string, DubbingUnitBundle>>({});
  const [illustrationBundles, setIllustrationBundles] = useState<Record<string, IllustrationUnitBundle>>({});
  const [illustrationLoadingKey, setIllustrationLoadingKey] = useState<string | null>(null);
  const [illustrationCreatorOpen, setIllustrationCreatorOpen] = useState(false);
  const [illustrationCreatorTab, setIllustrationCreatorTab] = useState<'create' | 'mine'>('create');
  const [illustrationPromptMode, setIllustrationPromptMode] = useState<IllustrationPromptMode>('official');
  const [officialIllustrationStyle, setOfficialIllustrationStyle] = useState<OfficialIllustrationStyle | null>(null);
  const [illustrationSceneDescription, setIllustrationSceneDescription] = useState('');
  const [illustrationFinalPrompt, setIllustrationFinalPrompt] = useState('');
  const [illustrationGenerating, setIllustrationGenerating] = useState(false);
  const [illustrationError, setIllustrationError] = useState('');
  const [illustrationPublishTarget, setIllustrationPublishTarget] = useState<string | null>(null);
  const [voiceLoadingKey, setVoiceLoadingKey] = useState<string | null>(null);
  const [voiceSaving, setVoiceSaving] = useState(false);
  const [aiComposerOpen, setAiComposerOpen] = useState(false);
  const [aiPlan, setAiPlan] = useState<DubbingPlan | null>(null);
  const [aiComposerBinding, setAiComposerBinding] = useState<AiComposerBinding | null>(null);
  const [aiPlanning, setAiPlanning] = useState(false);
  const aiComposerRequestRef = useRef(0);
  const selectedDubbingKeyRef = useRef<string | null>(null);
  const [voiceDesignsBySpeaker, setVoiceDesignsBySpeaker] = useState<Record<string, VoiceDesignVersion>>({});
  const [myVoiceDesigns, setMyVoiceDesigns] = useState<VoiceDesignVersion[]>([]);
  const [sharedVoiceDesigns, setSharedVoiceDesigns] = useState<VoiceDesignVersion[]>([]);
  const [sharedVoiceDesignIds, setSharedVoiceDesignIds] = useState<string[]>([]);
  const [annotationCursorBySegment, setAnnotationCursorBySegment] = useState<Record<string, number>>({});
  const [pauseSecondsBySegment, setPauseSecondsBySegment] = useState<Record<string, number>>({});
  const [vocalTagBySegment, setVocalTagBySegment] = useState<Record<string, string>>({});
  const [paragraphComments, setParagraphComments] = useState<ParagraphComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [activeCommentParagraph, setActiveCommentParagraph] = useState<number | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentSaving, setCommentSaving] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const [commentError, setCommentError] = useState('');
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'ready'>('idle');
  const [recordingPreviewUrl, setRecordingPreviewUrl] = useState<string | null>(null);
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const longPressTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!chapter) return;
    let cancelled = false;
    setCommentsLoading(true);
    setParagraphComments([]);
    setActiveCommentParagraph(null);
    api.paragraphComments('speckled-band', chapter.id)
      .then(({ comments }) => { if (!cancelled) setParagraphComments(comments); })
      .catch((error) => { if (!cancelled) setCommentError(error.message || '评论加载失败'); })
      .finally(() => { if (!cancelled) setCommentsLoading(false); });
    return () => { cancelled = true; };
  }, [chapter?.id, user?.id]);

  async function submitParagraphComment(paragraphIndex: number) {
    const content = commentDraft.trim();
    if (!user) { setPage('login'); return; }
    if (!content || !chapter) return;
    setCommentSaving(true);
    setCommentError('');
    try {
      const { comment } = await api.createParagraphComment({
        articleId: 'speckled-band', chapterId: chapter.id, paragraphIndex, content
      });
      setParagraphComments((current) => [...current, comment]);
      setCommentDraft('');
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : '评论发布失败');
    } finally {
      setCommentSaving(false);
    }
  }

  async function removeParagraphComment(comment: ParagraphComment) {
    if (!window.confirm('确定删除这条评论吗？')) return;
    setDeletingCommentId(comment.id);
    setCommentError('');
    try {
      await api.deleteParagraphComment(comment.id);
      setParagraphComments((current) => current.filter((item) => item.id !== comment.id));
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : '评论删除失败');
    } finally {
      setDeletingCommentId(null);
    }
  }

  function metadataString(metadata: Record<string, unknown> | null, key: string) {
    const value = metadata?.[key];
    return typeof value === 'string' ? value : '';
  }

  function metadataNumber(metadata: Record<string, unknown> | null, key: string) {
    const value = metadata?.[key];
    return typeof value === 'number' ? value : null;
  }

  function currentRangeForSource(chapterId: string, range: TextRange, sourceText?: string | null): TextRange | null {
    if (!sourceText) {
      return range;
    }

    if (!chapter || chapter.id !== chapterId) {
      return null;
    }

    const paragraph = chapter.paragraphs[range.startParagraphIndex];
    if (paragraph && range.startParagraphIndex === range.endParagraphIndex) {
      const currentText = paragraphToText(paragraph);
      if (currentText.slice(range.startOffset, range.endOffset) === sourceText) {
        return range;
      }
    }

    const exactParagraphIndex = chapter.paragraphs.findIndex((item) => paragraphToText(item) === sourceText);
    if (exactParagraphIndex < 0) {
      return null;
    }

    return {
      startParagraphIndex: exactParagraphIndex,
      startOffset: 0,
      endParagraphIndex: exactParagraphIndex,
      endOffset: sourceText.length
    };
  }

  function mediaAssetPositionKey(asset: MediaLibraryAsset) {
    if (!asset.chapterId || !asset.range) {
      return null;
    }

    return rangeKey(asset.chapterId, asset.range);
  }

  function audioFromAsset(asset: MediaLibraryAsset): RangeMedia<ParagraphSpeech> | null {
    const key = mediaAssetPositionKey(asset);
    if (!key || asset.mediaType !== 'audio' || !asset.chapterId || !asset.range) {
      return null;
    }

    if (asset.metadata?.generationType !== 'paragraph-speech') {
      return null;
    }

    const currentRange = currentRangeForSource(asset.chapterId, asset.range, asset.sourceText);
    if (!currentRange) {
      return null;
    }

    const script = Array.isArray(asset.metadata?.script)
      ? (asset.metadata.script as ParagraphSpeechScriptLine[])
      : [];

    return {
      chapterId: asset.chapterId,
      range: currentRange,
      audioUrl: asset.url,
      durationMs: metadataNumber(asset.metadata, 'durationMs'),
      segmentCount: metadataNumber(asset.metadata, 'segmentCount') ?? script.length,
      script,
      voicesInitializedNow: Boolean(asset.metadata?.voicesInitializedNow),
      traceId: metadataString(asset.metadata, 'traceId') || null,
      mediaAssetId: asset.id,
      userId: asset.userId,
      fromLibrary: true,
      createdAt: asset.createdAt
    };
  }

  function audioFromDubbingVersion(version: DubbingVersion): RangeMedia<ParagraphSpeech> | null {
    const savedRange: TextRange = {
      startParagraphIndex: version.paragraphIndex,
      startOffset: 0,
      endParagraphIndex: version.paragraphIndex,
      endOffset: version.sourceText.length
    };
    const range = currentRangeForSource(version.chapterId, savedRange, version.sourceText);

    if (!range) {
      return null;
    }

    return {
      chapterId: version.chapterId,
      range,
      audioUrl: version.audioUrl,
      durationMs: version.durationMs,
      segmentCount: version.segments.length,
      script: version.segments.map((segment) => ({
        segmentId: segment.segmentId,
        speakerCode: segment.speakerCode,
        templateCode: segment.templateCode,
        displayName: segment.speakerCode || segment.templateCode || '角色',
        text: segment.text,
        durationMs: null
      })),
      voicesInitializedNow: false,
      traceId: null,
      mediaAssetId: version.mediaAssetId,
      userId: version.ownerUserId,
      fromLibrary: true,
      createdAt: version.createdAt
    };
  }

  function imageFromIllustrationVersion(version: IllustrationVersion): RangeMedia<ParagraphImage> {
    const range: TextRange = {
      startParagraphIndex: version.paragraphIndex,
      startOffset: 0,
      endParagraphIndex: version.paragraphIndex,
      endOffset: version.sourceText.length
    };
    return {
      chapterId: version.chapterId,
      range,
      imageUrl: version.imageUrl,
      prompt: version.finalPrompt,
      sceneSummaryCn: '',
      componentType: 'community-illustration',
      promptCharCount: version.finalPrompt.length,
      traceId: null,
      styleInitializedNow: false,
      mediaAssetId: version.mediaAssetId,
      illustrationVersionId: version.id,
      userId: version.ownerUserId,
      fromLibrary: true,
      createdAt: version.createdAt
    };
  }

  function imageFromOfficialSlot(slot: OfficialIllustrationSlot): RangeMedia<ParagraphImage> {
    return {
      chapterId: slot.chapterId,
      range: {
        startParagraphIndex: slot.paragraphIndex,
        startOffset: 0,
        endParagraphIndex: slot.paragraphIndex,
        endOffset: slot.sourceText.length
      },
      imageUrl: slot.imageUrl,
      prompt: '',
      sceneSummaryCn: '',
      componentType: 'official-illustration',
      promptCharCount: 0,
      traceId: null,
      styleInitializedNow: false,
      mediaAssetId: slot.mediaAssetId,
      userId: 'official',
      fromLibrary: true,
      createdAt: slot.updatedAt || slot.createdAt
    };
  }

  useEffect(() => {
    setSelectedParagraph(null);
    stopParagraphAudio();
    setCollapsedParagraphImages({});
  }, [chapterId]);

  useEffect(() => {
    if (!chapter?.id) {
      return;
    }

    let cancelled = false;

    Promise.all([
      api.mediaAssets('speckled-band', chapter.id, 'audio'),
      api.officialIllustrationSlots('speckled-band', chapter.id).catch(() => ({ slots: [] })),
      api.adoptedDubbingVersions('speckled-band', chapter.id).catch(() => ({ versions: [] })),
      api.adoptedIllustrations('speckled-band', chapter.id).catch(() => ({ versions: [] }))
    ])
      .then(([{ assets }, { slots }, { versions: adoptedVersions }, { versions: adoptedIllustrations }]) => {
        if (cancelled) {
          return;
        }

        let nextImages: Record<string, RangeMedia<ParagraphImage>> = {};
        let nextAudios: Record<string, RangeMedia<ParagraphSpeech>> = {};
        slots.forEach((slot) => {
          const image = imageFromOfficialSlot(slot);
          nextImages = replaceParagraphMedia(nextImages, image);
        });
        assets.forEach((asset) => {
          if (!mediaAssetPositionKey(asset)) {
            return;
          }

          const audio = audioFromAsset(asset);
          if (audio && !findParagraphMedia(nextAudios, audio)) {
            nextAudios = replaceParagraphMedia(nextAudios, audio);
          }
        });

        let resolvedAudios = { ...nextAudios };
        adoptedVersions.forEach((version) => {
          const audio = audioFromDubbingVersion(version);
          if (!audio) {
            return;
          }
          resolvedAudios = replaceParagraphMedia(resolvedAudios, audio);
        });

        let resolvedImages = { ...nextImages };
        adoptedIllustrations.forEach((version) => {
          const image = imageFromIllustrationVersion(version);
          resolvedImages = replaceParagraphMedia(resolvedImages, image);
        });

        setPlatformParagraphImages(nextImages);
        setParagraphImages(resolvedImages);
        setPlatformParagraphAudios(nextAudios);
        setParagraphAudios(resolvedAudios);
      })
      .catch(() => {
        if (!cancelled) {
          setParagraphImages({});
          setPlatformParagraphImages({});
          setPlatformParagraphAudios({});
          setParagraphAudios({});
        }
      });

    return () => {
      cancelled = true;
    };
  }, [chapter?.id, user?.id]);

  function stopParagraphAudio() {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.removeAttribute('src');
      audio.load();
    }
    setPlayingAudioKey(null);
    setAudioPaused(false);
    if ('speechSynthesis' in window && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }

  function playParagraphAudio(key: string, audioUrl: string) {
    stopParagraphAudio();

    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    setPlayingAudioKey(key);
    setAudioPaused(false);

    audio.addEventListener('ended', () => {
      setPlayingAudioKey((current) => (current === key ? null : current));
      setAudioPaused(false);
    });

    void audio.play().catch(() => {
      setNotice('音频播放失败');
      window.setTimeout(() => setNotice(''), 1800);
      setPlayingAudioKey(null);
      setAudioPaused(false);
    });
  }

  function toggleParagraphAudio(key: string, audioUrl: string) {
    const audio = audioRef.current;
    if (playingAudioKey === key && audio && !audio.paused) {
      audio.pause();
      setAudioPaused(true);
      return;
    }

    if (playingAudioKey === key && audio?.paused) {
      setPlayingAudioKey(key);
      void audio.play()
        .then(() => setAudioPaused(false))
        .catch(() => {
          setAudioPaused(true);
          setNotice('音频播放失败');
          window.setTimeout(() => setNotice(''), 1800);
        });
      return;
    }

    playParagraphAudio(key, audioUrl);
  }

  function resetRecordingDraft() {
    if (recordingPreviewUrl) {
      URL.revokeObjectURL(recordingPreviewUrl);
    }
    setRecordingPreviewUrl(null);
    setRecordingBlob(null);
    setRecordingState('idle');
    recordingChunksRef.current = [];
  }

  function stopRecordingStream() {
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
  }

  function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error('Failed to read recording'));
      reader.readAsDataURL(blob);
    });
  }

  function dubbingBundleKey(selection: Pick<SelectedParagraph, 'chapterId' | 'paragraphIndex'>) {
    return `${selection.chapterId}-${selection.paragraphIndex}`;
  }

  function aiComposerMatchesUnit(binding: AiComposerBinding | null, unit: ContentUnit) {
    return Boolean(
      binding &&
        binding.unitId === unit.id &&
        binding.sourceHash === unit.sourceHash &&
        binding.selectionKey === `${unit.chapterId}-${unit.paragraphIndex}`
    );
  }

  function resetAiComposerState(invalidateRequest = true) {
    if (invalidateRequest) {
      aiComposerRequestRef.current += 1;
    }
    setAiPlanning(false);
    setVoiceSaving(false);
    setAiComposerOpen(false);
    setAiPlan(null);
    setAiComposerBinding(null);
    setVoiceDesignsBySpeaker({});
    setSharedVoiceDesignIds([]);
    setAnnotationCursorBySegment({});
    setPauseSecondsBySegment({});
    setVocalTagBySegment({});
  }

  function closeAiComposer() {
    resetAiComposerState();
  }

  function closeAiDesignMenu() {
    closeAiComposer();
    setVoicePanelOpen(false);
  }

  function composeOfficialIllustrationPrompt(style: OfficialIllustrationStyle, sceneDescription: string) {
    const scene = sceneDescription.trim();
    const styleBlock = style.globalStylePrompt.trim();
    const avoidPrefix = style.globalNegativePrompt.trim() ? '\n\nAvoid: ' : '';
    const fixedLength = styleBlock.length + avoidPrefix.length;
    const sceneBudget = Math.max(0, 1400 - fixedLength - style.globalNegativePrompt.length - (scene ? 2 : 0));
    const safeScene = scene.slice(0, sceneBudget);
    const withoutAvoid = [safeScene, styleBlock].filter(Boolean).join('\n\n');
    const negativeBudget = Math.max(0, 1400 - withoutAvoid.length - avoidPrefix.length);
    return `${withoutAvoid}${avoidPrefix}${style.globalNegativePrompt.slice(0, negativeBudget)}`;
  }

  async function loadIllustrationBundle(selection = selectedParagraph) {
    if (!selection) return null;
    const key = dubbingBundleKey(selection);
    setIllustrationLoadingKey(key);
    try {
      const bundle = await api.illustrationUnitAtPosition(
        'speckled-band',
        selection.chapterId,
        selection.paragraphIndex
      );
      setIllustrationBundles((current) => ({ ...current, [key]: bundle }));
      setSelectedParagraph((current) =>
        current && current.chapterId === bundle.unit.chapterId && current.paragraphIndex === bundle.unit.paragraphIndex
          ? { ...current, draft: bundle.unit.sourceText, range: bundle.unit.range }
          : current
      );
      return bundle;
    } catch (error) {
      setIllustrationError(error instanceof Error ? error.message : '插图版本加载失败');
      return null;
    } finally {
      setIllustrationLoadingKey(null);
    }
  }

  async function openIllustrationCreator() {
    if (!user) {
      setPage('login');
      return;
    }
    if (!selectedParagraph) return;
    closeVoiceDesigner();
    closeAiDesignMenu();
    setParagraphCommunityOpen(false);
    setIllustrationCreatorOpen(true);
    setIllustrationCreatorTab('create');
    setIllustrationPublishTarget(null);
    setIllustrationError('');
    const selection = selectedParagraph;
    try {
      const [bundle, styleResult] = await Promise.all([
        loadIllustrationBundle(selection),
        api.officialIllustrationStyle('speckled-band')
      ]);
      if (!bundle) return;
      const style = styleResult.style;
      setOfficialIllustrationStyle(style);
      const description = `为下面这段原文创作一张叙事插图。请自行安排人物、环境、布局和光线：\n${bundle.unit.sourceText}`;
      setIllustrationSceneDescription(description);
      setIllustrationPromptMode('official');
      setIllustrationFinalPrompt('');
    } catch (error) {
      setIllustrationError(error instanceof Error ? error.message : '插图创作器加载失败');
    }
  }

  async function createIllustration() {
    if (!user || !selectedParagraph || illustrationGenerating) return;
    const key = dubbingBundleKey(selectedParagraph);
    const bundle = illustrationBundles[key] || await loadIllustrationBundle(selectedParagraph);
    if (!bundle) return;
    const finalPrompt = illustrationPromptMode === 'official' && officialIllustrationStyle
      ? composeOfficialIllustrationPrompt(officialIllustrationStyle, illustrationSceneDescription)
      : illustrationFinalPrompt;
    if (!finalPrompt.trim() || finalPrompt.length > 1400) {
      setIllustrationError(
        illustrationPromptMode === 'official'
          ? '请填写画面描述。'
          : '请填写创作提示词。'
      );
      return;
    }
    setIllustrationGenerating(true);
    setIllustrationError('');
    try {
      const { version } = await api.createIllustrationVersion(bundle.unit.id, {
        promptMode: illustrationPromptMode,
        finalPrompt,
        styleVersionId: illustrationPromptMode === 'official' ? officialIllustrationStyle?.id : null
      });
      const image = imageFromIllustrationVersion(version);
      setParagraphImages((current) => replaceParagraphMedia(current, image));
      setCollapsedParagraphImages((current) => removeParagraphMedia(current, image));
      await loadIllustrationBundle(selectedParagraph);
      setIllustrationCreatorTab('mine');
      setNotice('插图已生成，已用于我的版本并收录至“我的作品”。');
      window.setTimeout(() => setNotice(''), 2600);
    } catch (error) {
      setIllustrationError(error instanceof Error ? error.message : '插图生成失败');
    } finally {
      setIllustrationGenerating(false);
    }
  }

  async function adoptIllustrationVersion(version: IllustrationVersion) {
    if (!user) {
      setPage('login');
      return;
    }
    try {
      const { version: adopted } = await api.adoptIllustration(version.unitId, version.id);
      const image = imageFromIllustrationVersion(adopted);
      setParagraphImages((current) => replaceParagraphMedia(current, image));
      setCollapsedParagraphImages((current) => removeParagraphMedia(current, image));
      if (selectedParagraph) await loadIllustrationBundle(selectedParagraph);
      setNotice('已设为我的当前段落插图');
      window.setTimeout(() => setNotice(''), 1800);
    } catch (error) {
      setIllustrationError(error instanceof Error ? error.message : '采用插图失败');
    }
  }

  async function restoreOneClickIllustration(unit: ContentUnit) {
    if (!user) return;
    try {
      await api.cancelIllustrationAdoption(unit.id);
      setParagraphImages((current) => {
        const platformImage = findParagraphMedia(platformParagraphImages, unit);
        return platformImage
          ? replaceParagraphMedia(current, platformImage)
          : removeParagraphMedia(current, unit);
      });
      setCollapsedParagraphImages((current) => removeParagraphMedia(current, unit));
      if (selectedParagraph) await loadIllustrationBundle(selectedParagraph);
      setNotice('已恢复一键生成插图');
      window.setTimeout(() => setNotice(''), 1600);
    } catch (error) {
      setIllustrationError(error instanceof Error ? error.message : '恢复一键插图失败');
    }
  }

  async function toggleIllustrationLike(version: IllustrationVersion) {
    if (!user) { setPage('login'); return; }
    try {
      await api.likeIllustration(version.id, !version.likedByMe);
      if (selectedParagraph) await loadIllustrationBundle(selectedParagraph);
    } catch (error) {
      setIllustrationError(error instanceof Error ? error.message : '点赞失败');
    }
  }

  async function reportIllustrationVersion(version: IllustrationVersion) {
    if (!user) { setPage('login'); return; }
    const reason = window.prompt('请简要说明举报原因（最多 500 字）')?.trim();
    if (!reason) return;
    try {
      await api.reportIllustration(version.id, reason);
      setNotice('举报已提交');
      window.setTimeout(() => setNotice(''), 1600);
    } catch (error) {
      setIllustrationError(error instanceof Error ? error.message : '举报失败');
    }
  }

  async function changeIllustrationStatus(
    version: IllustrationVersion,
    status: 'public' | 'withdrawn' | 'deleted',
    replaceVersionId = ''
  ) {
    try {
      await api.setIllustrationStatus(version.id, status, replaceVersionId);
      setIllustrationPublishTarget(null);
      if (selectedParagraph) await loadIllustrationBundle(selectedParagraph);
    } catch (error) {
      setIllustrationError(error instanceof Error ? error.message : '作品状态更新失败');
    }
  }

  function publishIllustration(version: IllustrationVersion, bundle: IllustrationUnitBundle) {
    const publicVersions = bundle.myVersions.filter((item) => item.status === 'public' && item.id !== version.id);
    if (publicVersions.length >= 3) {
      setIllustrationPublishTarget(version.id);
      return;
    }
    void changeIllustrationStatus(version, 'public');
  }

  async function loadDubbingBundle(selection = selectedParagraph) {
    if (!selection) {
      return null;
    }

    const key = dubbingBundleKey(selection);
    setVoiceLoadingKey(key);

    try {
      const bundle = await api.dubbingUnitAtPosition(
        'speckled-band',
        selection.chapterId,
        selection.paragraphIndex
      );
      setDubbingBundles((prev) => ({ ...prev, [key]: bundle }));
      setSelectedParagraph((current) =>
        current && current.chapterId === bundle.unit.chapterId && current.paragraphIndex === bundle.unit.paragraphIndex
          ? { ...current, draft: bundle.unit.sourceText, range: bundle.unit.range }
          : current
      );
      return bundle;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '配音版本加载失败');
      window.setTimeout(() => setNotice(''), 2400);
      return null;
    } finally {
      setVoiceLoadingKey(null);
    }
  }

  async function startAiDubbingCreation() {
    if (!user) {
      setPage('login');
      return;
    }
    if (!selectedParagraph || aiPlanning || voiceSaving) {
      return;
    }

    const requestedSelection = selectedParagraph;
    const requestedSelectionKey = dubbingBundleKey(requestedSelection);
    const requestId = aiComposerRequestRef.current + 1;
    aiComposerRequestRef.current = requestId;

    resetAiComposerState(false);
    setAiPlanning(true);
    setAiComposerOpen(true);
    setVoicePanelOpen(true);
    try {
      const bundle =
        dubbingBundles[requestedSelectionKey] || (await loadDubbingBundle(requestedSelection));
      if (!bundle) {
        throw new Error('当前段落配音暂不可用。');
      }
      if (!bundle.unit.hasDialogue) {
        throw new Error('这个段落没有角色对白，不需要创建配音');
      }
      const [{ unit, plan }, myVoices, sharedVoices] = await Promise.all([
        api.planAiDubbing(bundle.unit.id),
        api.voiceDesigns('mine'),
        api.voiceDesigns('shared')
      ]);
      if (
        aiComposerRequestRef.current !== requestId ||
        selectedDubbingKeyRef.current !== requestedSelectionKey
      ) {
        return;
      }
      if (unit.id !== bundle.unit.id || unit.sourceHash !== bundle.unit.sourceHash) {
        throw new Error('标准段落已更新，请重新打开 AI 配音编辑器');
      }
      if (!plan.segments.length) {
        throw new Error('没有从这个段落识别出可配音的角色对白');
      }
      setAiComposerBinding({
        unitId: unit.id,
        sourceHash: unit.sourceHash,
        selectionKey: requestedSelectionKey
      });
      setAiPlan(plan);
      setAnnotationCursorBySegment(Object.fromEntries(plan.segments.map((segment) => {
        const punctuationOffset = Math.max(segment.text.indexOf('，'), segment.text.indexOf(','));
        const offset = punctuationOffset >= 0 ? punctuationOffset + 1 : Math.min(1, segment.text.length);
        return [segment.segmentId, offset];
      })));
      setPauseSecondsBySegment(Object.fromEntries(plan.segments.map((segment) => [
        segment.segmentId,
        plan.capabilities.ranges.pause.default
      ])));
      setVocalTagBySegment(Object.fromEntries(plan.segments.map((segment) => [
        segment.segmentId,
        plan.capabilities.vocalTags[0]?.value || 'breath'
      ])));
      setVoiceDesignsBySpeaker({});
      setMyVoiceDesigns(myVoices.versions);
      setSharedVoiceDesigns(sharedVoices.versions);
      setSharedVoiceDesignIds([]);
    } catch (error) {
      if (aiComposerRequestRef.current !== requestId) {
        return;
      }
      resetAiComposerState(false);
      setVoicePanelOpen(false);
      setNotice(error instanceof Error ? error.message : 'AI 配音规划失败');
      window.setTimeout(() => setNotice(''), 2800);
    } finally {
      if (aiComposerRequestRef.current === requestId) {
        setAiPlanning(false);
      }
    }
  }

  function updateAiPlanSegment(
    segmentId: string,
    key: 'speakerCode' | keyof DubbingPerformance,
    value: string | number | string[]
  ) {
    setAiPlan((current) => {
      if (!current) return current;
      return {
        ...current,
        segments: current.segments.map((segment) => {
          if (segment.segmentId !== segmentId) return segment;
          if (key === 'speakerCode') {
            return { ...segment, speakerCode: String(value), templateCode: null };
          }
          return {
            ...segment,
            performance: { ...segment.performance, [key]: value }
          };
        })
      };
    });
  }

  function updateAiSegmentRecipe(
    segmentId: string,
    updater: (recipe: MiniMaxSegmentRecipe) => MiniMaxSegmentRecipe
  ) {
    setAiPlan((current) => {
      if (!current) return current;
      return {
        ...current,
        segments: current.segments.map((segment) =>
          segment.segmentId === segmentId && segment.recipe
            ? { ...segment, recipe: updater(segment.recipe) }
            : segment
        )
      };
    });
  }

  function updateRecipeSection<Section extends 'voiceSetting' | 'voiceModify' | 'voiceSource'>(
    segmentId: string,
    section: Section,
    patch: Partial<MiniMaxSegmentRecipe[Section]>
  ) {
    updateAiSegmentRecipe(segmentId, (recipe) => ({
      ...recipe,
      [section]: { ...recipe[section], ...patch }
    }));
  }

  function updateGenerationSettings(
    updater: (settings: MiniMaxGenerationSettings) => MiniMaxGenerationSettings
  ) {
    setAiPlan((current) => current ? { ...current, generationSettings: updater(current.generationSettings) } : current);
  }

  function addSegmentAnnotation(segment: DubbingPlanSegment, type: MiniMaxAnnotation['type']) {
    if (!aiPlan || !segment.recipe) return;
    const offset = annotationCursorBySegment[segment.segmentId];
    if (!Number.isInteger(offset)) {
      setNotice('请先点击台词中的一个字，标记会插入在该字之后');
      return;
    }
    if (type === 'pause' && (offset <= 0 || offset >= segment.text.length)) {
      setNotice('停顿必须插入在两个可发音文字之间');
      return;
    }
    if (type === 'pause' && segment.recipe.annotations.some((item) => item.type === 'pause' && item.offset === offset)) {
      setNotice('这个位置已经有停顿标记');
      return;
    }
    const id = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `annotation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const annotation: MiniMaxAnnotation = type === 'pause'
      ? {
          id,
          type,
          offset,
          durationSeconds: pauseSecondsBySegment[segment.segmentId] ?? aiPlan.capabilities.ranges.pause.default
        }
      : {
          id,
          type,
          offset,
          value: vocalTagBySegment[segment.segmentId] || aiPlan.capabilities.vocalTags[0]?.value || 'breath'
        };
    updateAiSegmentRecipe(segment.segmentId, (recipe) => ({
      ...recipe,
      annotations: [...recipe.annotations, annotation].sort((left, right) => left.offset - right.offset)
    }));
  }

  function removeSegmentAnnotation(segmentId: string, annotationId: string) {
    updateAiSegmentRecipe(segmentId, (recipe) => ({
      ...recipe,
      annotations: recipe.annotations.filter((item) => item.id !== annotationId)
    }));
  }

  async function saveAiDubbingVersion(visibility: 'private' | 'public') {
    if (!selectedParagraph || !aiPlan || voiceSaving) return;
    const selectionKey = dubbingBundleKey(selectedParagraph);
    const bundle = dubbingBundles[selectionKey];
    if (!bundle) return;
    if (!aiComposerMatchesUnit(aiComposerBinding, bundle.unit)) {
      closeAiComposer();
      setNotice('段落已经切换，请重新打开 AI 配音编辑器');
      window.setTimeout(() => setNotice(''), 2600);
      return;
    }

    const requestId = aiComposerRequestRef.current;
    const requestedSelection = selectedParagraph;
    setVoiceSaving(true);
    try {
      const voiceDesignVersionIdsBySpeaker = Object.fromEntries(
        Object.entries(voiceDesignsBySpeaker).map(([speakerCode, version]) => [speakerCode, version.id])
      );
      await api.createAiDubbingVersion(bundle.unit.id, {
        segments: aiPlan.segments,
        voiceDesignVersionIdsBySpeaker,
        sharedVoiceDesignVersionIds: sharedVoiceDesignIds,
        generationSettings: aiPlan.generationSettings,
        visibility
      });
      await loadDubbingBundle(requestedSelection);
      if (
        aiComposerRequestRef.current === requestId &&
        selectedDubbingKeyRef.current === selectionKey
      ) {
        closeAiComposer();
      }
      setNotice(visibility === 'public' ? '配音已发布。' : '配音已收录至“我的作品”。');
      window.setTimeout(() => setNotice(''), 1800);
    } catch (error) {
      if (aiComposerRequestRef.current !== requestId) {
        return;
      }
      setNotice(error instanceof Error ? error.message : 'AI 配音生成失败');
      window.setTimeout(() => setNotice(''), 3000);
    } finally {
      if (aiComposerRequestRef.current === requestId) {
        setVoiceSaving(false);
      }
    }
  }

  async function startUserRecording() {
    if (!user) {
      setPage('login');
      return;
    }
    try {
      if (selectedParagraph) {
        await loadDubbingBundle(selectedParagraph);
      }
      resetRecordingDraft();
      const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
      if (!window.isSecureContext && !isLocalhost) {
        throw new Error('浏览器要求 HTTPS 才能使用麦克风录音');
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('当前浏览器或访问方式不支持麦克风录音');
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      const recorderOptions =
        typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? { mimeType: 'audio/webm;codecs=opus' }
          : undefined;
      const recorder = new MediaRecorder(stream, recorderOptions);
      mediaRecorderRef.current = recorder;
      recordingChunksRef.current = [];

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      });

      recorder.addEventListener('stop', () => {
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(recordingChunksRef.current, { type: mimeType });
        setRecordingBlob(blob);
        setRecordingPreviewUrl(URL.createObjectURL(blob));
        setRecordingState('ready');
        stopRecordingStream();
      });

      recorder.start();
      setRecordingState('recording');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Microphone permission failed');
      window.setTimeout(() => setNotice(''), 2400);
    }
  }

  function stopUserRecording() {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }

  async function saveUserRecording(visibility: 'private' | 'public') {
    if (!selectedParagraph || !recordingBlob || voiceSaving) {
      return;
    }
    if (!user) {
      setPage('login');
      return;
    }
    setVoiceSaving(true);

    try {
      const bundle =
        dubbingBundles[dubbingBundleKey(selectedParagraph)] || (await loadDubbingBundle(selectedParagraph));
      if (!bundle) return;
      const audioDataUrl = await blobToDataUrl(recordingBlob);
      await api.createHumanDubbingVersion(bundle.unit.id, { audioDataUrl, visibility });
      await loadDubbingBundle(selectedParagraph);
      resetRecordingDraft();
      setNotice(visibility === 'public' ? '配音已发布。' : '配音已收录至“我的作品”。');
      window.setTimeout(() => setNotice(''), 1800);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '真人配音保存失败');
      window.setTimeout(() => setNotice(''), 2600);
    } finally {
      setVoiceSaving(false);
    }
  }

  async function updateDubbingStatus(version: DubbingVersion, status: 'public' | 'withdrawn' | 'deleted') {
    try {
      await api.setDubbingStatus(version.id, status);
      if (selectedParagraph) await loadDubbingBundle(selectedParagraph);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '配音状态更新失败');
      window.setTimeout(() => setNotice(''), 2400);
    }
  }

  async function deleteDubbingVersion(version: DubbingVersion) {
    const confirmed = window.confirm(
      version.status === 'public'
        ? '公开版本将被撤回，新用户无法再查看或采用。已有采用者仍可继续播放。'
        : '确定删除这个未发布版本吗？'
    );
    if (!confirmed) {
      return;
    }
    await updateDubbingStatus(version, version.status === 'public' ? 'withdrawn' : 'deleted');
  }

  async function toggleDubbingLike(version: DubbingVersion) {
    if (!user) {
      setPage('login');
      return;
    }
    try {
      await api.likeDubbingVersion(version.id, !version.likedByMe);
      if (selectedParagraph) await loadDubbingBundle(selectedParagraph);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '点赞更新失败');
      window.setTimeout(() => setNotice(''), 2200);
    }
  }

  async function adoptDubbingVersion(version: DubbingVersion, unit: ContentUnit) {
    if (!user) {
      setPage('login');
      return;
    }
    try {
      await api.adoptDubbingVersion(unit.id, version.id);
      await loadDubbingBundle(selectedParagraph);
      const audio = audioFromDubbingVersion({ ...version, adoptedByMe: true });
      if (!audio) {
        setNotice('该配音与当前正文不匹配，已跳过显示');
        window.setTimeout(() => setNotice(''), 2200);
        return;
      }
      setParagraphAudios((current) => replaceParagraphMedia(current, audio));
      setNotice('已用于我的阅读');
      window.setTimeout(() => setNotice(''), 1600);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '采用配音失败');
      window.setTimeout(() => setNotice(''), 2200);
    }
  }

  async function cancelDubbingAdoption(unit: ContentUnit) {
    if (!user) return;
    try {
      await api.cancelDubbingAdoption(unit.id);
      await loadDubbingBundle(selectedParagraph);
      setParagraphAudios((current) => {
        const platformAudio = findParagraphMedia(platformParagraphAudios, unit);
        return platformAudio
          ? replaceParagraphMedia(current, platformAudio)
          : removeParagraphMedia(current, unit);
      });
      setNotice('已使用官方配音。');
      window.setTimeout(() => setNotice(''), 1600);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '切换官方配音失败');
      window.setTimeout(() => setNotice(''), 2200);
    }
  }

  async function reportDubbingVersion(version: DubbingVersion) {
    if (!user) {
      setPage('login');
      return;
    }
    const reason = window.prompt('请简要说明举报原因（3-500 字）')?.trim() || '';
    if (!reason) return;
    try {
      await api.reportDubbingVersion(version.id, reason);
      setNotice('举报已提交，等待平台处理');
      window.setTimeout(() => setNotice(''), 1800);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '举报提交失败');
      window.setTimeout(() => setNotice(''), 2200);
    }
  }

  useEffect(() => {
    return () => {
      if (longPressTimer.current !== null) {
        window.clearTimeout(longPressTimer.current);
      }
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
      }
      stopRecordingStream();
      if (recordingPreviewUrl) {
        URL.revokeObjectURL(recordingPreviewUrl);
      }
    };
  }, [recordingPreviewUrl]);

  function paragraphKey(paragraphIndex: number) {
    return `${chapter.id}-${paragraphIndex}`;
  }

  function paragraphToText(paragraph: TextSegment[]) {
    return paragraph.map((segment) => segment.text).join('');
  }

  function clearLongPressTimer() {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  const refreshSelectionLayout = useCallback(() => {
    if (!selectedParagraph || !bookPageRef.current) {
      setSelectionLayout(null);
      return;
    }

    setSelectionLayout(computeSelectionLayout(bookPageRef.current, selectedParagraph.range));
  }, [selectedParagraph]);

  useEffect(() => {
    if (!selectedParagraph) {
      setSelectionLayout(null);
      return;
    }

    const frame = window.requestAnimationFrame(() => refreshSelectionLayout());
    return () => window.cancelAnimationFrame(frame);
  }, [selectedParagraph, refreshSelectionLayout, fontSize, readingWidth, chapter.id]);

  useEffect(() => {
    if (!selectedParagraph) return;
    setMobileChromeOpen(false);
    setMobileRailExpanded(false);
  }, [selectedParagraph]);

  useEffect(() => {
    if (!selectedParagraph) {
      return;
    }

    const handleViewportChange = () => refreshSelectionLayout();
    window.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('resize', handleViewportChange);

    return () => {
      window.removeEventListener('scroll', handleViewportChange, true);
      window.removeEventListener('resize', handleViewportChange);
    };
  }, [selectedParagraph, refreshSelectionLayout]);

  useEffect(() => {
    if (!selectedParagraph) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedParagraph(null);
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.closest('.text-selection-layer') ||
        target.closest('.mobile-selection-sheet-layer') ||
        target.closest('.reader-paragraph') ||
        target.closest('.inline-audio-play')
      ) {
        return;
      }
      setSelectedParagraph(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('pointerdown', handlePointerDown, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [selectedParagraph]);

  useEffect(() => {
    const selectionKey = selectedParagraph ? dubbingBundleKey(selectedParagraph) : null;
    if (selectedDubbingKeyRef.current === selectionKey) {
      return;
    }

    selectedDubbingKeyRef.current = selectionKey;
    resetAiComposerState();
    setVoicePanelOpen(false);
  }, [selectedParagraph?.chapterId, selectedParagraph?.paragraphIndex]);

  useEffect(() => {
    if (!selectedParagraph) {
      setVoicePanelOpen(false);
      setParagraphCommunityOpen(false);
      setIllustrationCreatorOpen(false);
      return;
    }

    if (voicePanelOpen || paragraphCommunityOpen) {
      void loadDubbingBundle(selectedParagraph);
    }
    if (illustrationCreatorOpen || paragraphCommunityOpen) {
      void loadIllustrationBundle(selectedParagraph);
    }
  }, [
    selectedParagraph?.chapterId,
    selectedParagraph?.paragraphIndex,
    voicePanelOpen,
    paragraphCommunityOpen,
    illustrationCreatorOpen
  ]);

  function selectParagraph(paragraph: TextSegment[], paragraphIndex: number) {
    clearLongPressTimer();
    window.getSelection()?.removeAllRanges();
    const draft = paragraphToText(paragraph);
    const range: TextRange = {
      startParagraphIndex: paragraphIndex,
      startOffset: 0,
      endParagraphIndex: paragraphIndex,
      endOffset: draft.length
    };

    setSelectedParagraph({
      chapterId: chapter.id,
      paragraphIndex,
      draft,
      range
    });
    window.requestAnimationFrame(() => window.getSelection()?.removeAllRanges());
  }

  function handleParagraphContextMenu(event: React.MouseEvent, paragraph: TextSegment[], paragraphIndex: number) {
    event.preventDefault();
    selectParagraph(paragraph, paragraphIndex);
  }

  function handleParagraphPointerDown(
    event: React.PointerEvent,
    paragraph: TextSegment[],
    paragraphIndex: number
  ) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) {
      return;
    }

    clearLongPressTimer();
    longPressTimer.current = window.setTimeout(() => {
      selectParagraph(paragraph, paragraphIndex);
    }, 560);
  }

  async function generateParagraphSpeech() {
    if (!selectedParagraph || paragraphSpeechLoadingKey) return;

    const targetSegment = selectedParagraph.draft.trim();
    if (!targetSegment) {
      setNotice('目标段落不能为空');
      window.setTimeout(() => setNotice(''), 1800);
      return;
    }

    const key = rangeKey(selectedParagraph.chapterId, selectedParagraph.range);
    const savedRange = selectedParagraph.range;
    const savedChapterId = selectedParagraph.chapterId;
    const savedParagraphIndex = selectedParagraph.paragraphIndex;

    setParagraphSpeechLoadingKey(key);
    setNotice('正在一键生成 AI 配音...');
    try {
      const result = await api.paragraphSpeech({
        chapterId: savedChapterId,
        paragraphIndex: savedParagraphIndex,
        targetSegment,
        range: savedRange
      });
      const audio = { ...result, chapterId: savedChapterId, range: savedRange, fromLibrary: false };
      setParagraphAudios((prev) => replaceParagraphMedia(prev, audio));
      setPlatformParagraphAudios((prev) => replaceParagraphMedia(prev, audio));
      setSelectedParagraph(null);
      setNotice('AI 配音已生成');
      window.setTimeout(() => setNotice(''), 1800);
      playParagraphAudio(key, result.audioUrl);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'AI 配音生成失败');
      window.setTimeout(() => setNotice(''), 2600);
    } finally {
      setParagraphSpeechLoadingKey(null);
    }
  }

  function openHumanDubbingPlaceholder() {
    setNotice('“我来配音”下级菜单将在下一阶段实现');
    window.setTimeout(() => setNotice(''), 2200);
  }

  async function generateParagraphImage() {
    if (!selectedParagraph || paragraphImageLoadingKey) return;
    if (!user) {
      setPage('login');
      return;
    }

    const targetSegment = selectedParagraph.draft.trim();
    if (!targetSegment) {
      setNotice('目标段落不能为空');
      window.setTimeout(() => setNotice(''), 1800);
      return;
    }

    const key = rangeKey(selectedParagraph.chapterId, selectedParagraph.range);
    const savedRange = selectedParagraph.range;
    const savedChapterId = selectedParagraph.chapterId;
    const savedParagraphIndex = selectedParagraph.paragraphIndex;
    setParagraphImageLoadingKey(key);
    setNotice('正在生成段落插图，首次使用会先初始化全书风格，可能较慢');
    try {
      const result = await api.paragraphImage({
        chapterId: savedChapterId,
        paragraphIndex: savedParagraphIndex,
        targetSegment,
        range: savedRange
      });
      const image = { ...result, chapterId: savedChapterId, range: savedRange, fromLibrary: false };
      setParagraphImages((prev) => replaceParagraphMedia(prev, image));
      setCollapsedParagraphImages((prev) => removeParagraphMedia(prev, image));
      setSelectedParagraph(null);
      setNotice('段落插图已生成，仅用于我的版本');
      window.setTimeout(() => setNotice(''), 1800);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '段落插图生成失败');
      window.setTimeout(() => setNotice(''), 2600);
    } finally {
      setParagraphImageLoadingKey(null);
    }
  }

  function hideParagraphImage(key: string, image: RangeMedia<ParagraphImage>) {
    setCollapsedParagraphImages((prev) => ({
      ...prev,
      [key]: image
    }));
    setParagraphImages((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setNotice('插图已收起');
    window.setTimeout(() => setNotice(''), 1600);
  }

  function expandParagraphImage(key: string) {
    const image = collapsedParagraphImages[key];
    if (!image) {
      return;
    }

    setParagraphImages((prev) => ({
      ...prev,
      [key]: image
    }));
    setCollapsedParagraphImages((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function deleteParagraphImage(key: string, image: RangeMedia<ParagraphImage>) {
    if (!image.illustrationVersionId || !user) {
      return;
    }
    const officialImage = findParagraphMedia(platformParagraphImages, image);
    const confirmed = window.confirm(
      officialImage ? '恢复该位置的官方默认插图？' : '从我的版本中移除这张插图？'
    );
    if (!confirmed) {
      return;
    }

    try {
      const bundle = await api.illustrationUnitAtPosition(
        'speckled-band',
        image.chapterId,
        image.range.startParagraphIndex
      );
      await api.cancelIllustrationAdoption(bundle.unit.id);
      setCollapsedParagraphImages((prev) => removeParagraphMedia(prev, image));
      setParagraphImages((prev) => officialImage
        ? replaceParagraphMedia(prev, officialImage)
        : removeParagraphMedia(prev, image));
      setNotice(officialImage ? '已恢复官方默认插图' : '已从我的版本中移除插图');
      window.setTimeout(() => setNotice(''), 1600);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '插图删除失败');
      window.setTimeout(() => setNotice(''), 2400);
    }
  }

  async function askAssistant() {
    if (!question.trim() || !chapter) return;
    const currentQuestion = question.trim();
    setQuestion('');
    setMessages((prev) => [...prev, { role: 'reader', content: currentQuestion }]);
    let answer: string;
    try {
      answer = await api.aiChat(currentQuestion, chapter.id, collectedClueIds);
    } catch (error) {
      answer = await api.chat(currentQuestion, chapter.id, collectedClueIds);
    }
    setMessages((prev) => [...prev, { role: 'assistant', content: answer }]);
  }

  async function generateQueuedClueImages(initial: {
    clueId: string;
    occurrenceId: string;
    force: boolean;
  }) {
    if (clueGenerationRunningRef.current) {
      queuedClueGenerationRef.current = initial;
      return;
    }

    clueGenerationRunningRef.current = true;
    let current: typeof initial | null = initial;
    while (current) {
      const request = current;
      const key = clueImageKey(request.clueId);
      setClueImages((previous) => ({
        ...previous,
        [key]: {
          ...(previous[key] || {
            clueId: request.clueId,
            occurrenceId: request.occurrenceId,
            skipped: false,
            cacheHit: false,
            userOverride: request.force
          }),
          loading: true,
          error: undefined
        }
      }));

      try {
        const result = await api.clueImage(request);
        setClueImages((previous) => ({ ...previous, [key]: { ...result, loading: false } }));
      } catch (error) {
        const message = error instanceof Error ? error.message : '线索图生成失败';
        setClueImages((previous) => ({
          ...previous,
          [key]: {
            ...(previous[key] || {
              clueId: request.clueId,
              occurrenceId: request.occurrenceId,
              skipped: false,
              cacheHit: false,
              userOverride: request.force
            }),
            loading: false,
            error: message
          }
        }));
      }

      current = queuedClueGenerationRef.current;
      queuedClueGenerationRef.current = null;
    }
    clueGenerationRunningRef.current = false;
  }

  function collectClue(clueId: string, requestedOccurrenceId?: string) {
    const clue = clues.find((item) => item.id === clueId);
    if (!clue) return;
    const occurrenceId = resolveClueOccurrenceId(clue, requestedOccurrenceId);

    setCollectedClues((previous) => {
      const existing = previous.find((item) => item.clueId === clueId);
      if (existing) {
        setNotice(
          existing.occurrenceId === occurrenceId
            ? `已打开：“${clue.label}”`
            : `已更新“${clue.label}”的阅读位置`
        );
        return previous.map((item) => (item.clueId === clueId ? { clueId, occurrenceId } : item));
      }
      setNotice(`已收入证物袋：“${clue.label}”`);
      return [...previous, { clueId, occurrenceId }];
    });

    setActiveClueId(clueId);
    setContextTab('bag');
    setContextOpen(true);
    setBagPulse(true);
    window.setTimeout(() => setBagPulse(false), 620);
    const existingImage = clueImages[clueImageKey(clueId)];
    if (occurrenceId && !existingImage?.imageUrl && !existingImage?.skipped && !existingImage?.loading) {
      void generateQueuedClueImages({ clueId, occurrenceId, force: false });
    }

    window.setTimeout(() => setNotice(''), 1800);
  }

  function removeClue(clueId: string) {
    const clue = clues.find((item) => item.id === clueId);

    setCollectedClues((previous) => previous.filter((item) => item.clueId !== clueId));
    setActiveClueId((current) => (current === clueId ? null : current));
    setNotice(clue ? `已从证物袋取出：“${clue.label}”` : '已从证物袋取出');
    window.setTimeout(() => setNotice(''), 1800);
  }

  function regenerateClue(clueId: string, occurrenceId: string) {
    if (!occurrenceId) {
      setNotice('线索服务版本未更新，请稍后刷新页面');
      window.setTimeout(() => setNotice(''), 2200);
      return;
    }
    setActiveClueId(clueId);
    void generateQueuedClueImages({ clueId, occurrenceId, force: true });
  }

  function renderSegmentSlice(segment: TextSegment, segmentIndex: number, text: string) {
    if (!text) {
      return null;
    }

    if (segment.type === 'clue') {
      if (text.length !== segment.text.length) {
        return <span key={`${segmentIndex}-${text}`}>{text}</span>;
      }

      return (
        <button
          key={segmentIndex}
          className={collectedClueIds.includes(segment.clueId) ? 'clue-segment collected' : 'clue-segment'}
          onClick={() => collectClue(segment.clueId, segment.occurrenceId)}
          title={collectedClueIds.includes(segment.clueId) ? '打开证物袋' : '点击收入证物袋并生成图像'}
          type="button"
        >
          {text}
        </button>
      );
    }

    return <span key={`${segmentIndex}-${text}`}>{text}</span>;
  }

  function renderTextRange(paragraph: TextSegment[], start: number, end: number) {
    if (start >= end) {
      return [];
    }

    const nodes: React.ReactNode[] = [];
    let offset = 0;

    paragraph.forEach((segment, segmentIndex) => {
      const segmentStart = offset;
      const segmentEnd = offset + segment.text.length;
      offset = segmentEnd;

      if (segmentEnd <= start || segmentStart >= end) {
        return;
      }

      const sliceStart = Math.max(0, start - segmentStart);
      const sliceEnd = Math.min(segment.text.length, end - segmentStart);
      const slice = segment.text.slice(sliceStart, sliceEnd);
      const node = renderSegmentSlice(segment, segmentIndex, slice);

      if (node) {
        nodes.push(node);
      }
    });

    return nodes;
  }

  function renderInlinePlayButton(mediaKey: string, audio: RangeMedia<ParagraphSpeech>) {
    const isPlaying = playingAudioKey === mediaKey && !audioPaused;

    return (
      <button
        key={`play-${mediaKey}`}
        type="button"
        className={`inline-audio-play${isPlaying ? ' playing' : ''}${audio.fromLibrary ? ' library-media' : ''}`}
        onClick={(event) => {
          event.stopPropagation();
          toggleParagraphAudio(mediaKey, audio.audioUrl);
        }}
        aria-label={isPlaying ? '暂停配音' : '播放配音'}
        title={isPlaying ? '暂停' : '播放配音'}
      />
    );
  }

  function renderDubbingVersionCard(version: DubbingVersion, unit: ContentUnit) {
    const audioKey = `dubbing-${version.id}`;
    const isPlaying = playingAudioKey === audioKey && !audioPaused;
    const isMine = version.ownerUserId === user?.id;
    const kindLabel = version.kind === 'ai' ? 'AI 配音' : '真人演绎';
    const statusLabels: Record<DubbingStatus, string> = {
      private: '未发布',
      public: '公开',
      withdrawn: '已停止公开',
      moderated: '已下架',
      deleted: '已删除'
    };

    return (
      <article key={version.id} className={`voice-recording-row dubbing-version-card${version.adoptedByMe ? ' adopted' : ''}`}>
        <div className="dubbing-version-summary">
          <strong>{isMine ? '我的配音' : version.displayName || version.username}</strong>
          <small>
            {kindLabel} · V{version.versionNumber} · {statusLabels[version.status]}
          </small>
          <span>采用 {version.adoptionCount}</span>
        </div>
        <div className="voice-recording-actions">
          <button type="button" onClick={() => toggleParagraphAudio(audioKey, version.audioUrl)}>
            {isPlaying ? '暂停' : '播放'}
          </button>
          {version.adoptedByMe ? (
            <button type="button" onClick={() => void cancelDubbingAdoption(unit)}>
              使用官方配音
            </button>
          ) : version.status === 'public' ? (
            <button type="button" onClick={() => void adoptDubbingVersion(version, unit)}>
              用于我的阅读
            </button>
          ) : null}
          {version.status === 'public' && (
            <>
              <CommunityLikeButton
                liked={version.likedByMe}
                likeCount={version.likeCount}
                ownedByMe={isMine}
                onToggle={() => void toggleDubbingLike(version)}
              />
              {!isMine && <button type="button" onClick={() => void reportDubbingVersion(version)}>举报</button>}
            </>
          )}
          {isMine ? (
            <>
              {version.status === 'private' && (
                <button type="button" onClick={() => void updateDubbingStatus(version, 'public')}>公开</button>
              )}
              {(version.status === 'private' || version.status === 'public') && (
                <button type="button" onClick={() => void deleteDubbingVersion(version)}>
                  {version.status === 'public' ? '撤回' : '删除'}
                </button>
              )}
            </>
          ) : null}
        </div>
        {version.kind === 'ai' && version.promptSnapshot && (
          <details className="dubbing-prompt-details">
            <summary>展开设计</summary>
            {Object.entries(version.promptSnapshot.voiceDesigns || {}).map(([speakerCode, design]) => (
              <div key={speakerCode} className="dubbing-prompt-block">
                <strong>{design.characterName}声线 V{design.versionNumber}</strong>
                <p>{design.prompt}</p>
                <small>试听文本：{design.previewText}</small>
              </div>
            ))}
            {(version.promptSnapshot.performanceSegments || []).map((segment) => {
              const recipe = segment.recipe;
              return (
                <div key={segment.segmentId} className="dubbing-prompt-block">
                  <strong>{segment.text}</strong>
                  {recipe ? (
                    <>
                      <p>
                        情绪：{recipe.voiceSetting.emotion || '智能匹配'} · 语速 {recipe.voiceSetting.speed} ·
                        音量 {recipe.voiceSetting.volume} · 音调 {recipe.voiceSetting.pitch}
                      </p>
                      <p>
                        标记 {recipe.annotations.length} 个 · 效果器（音高 {recipe.voiceModify.pitch} / 力度{' '}
                        {recipe.voiceModify.intensity} / 音色 {recipe.voiceModify.timbre}）
                      </p>
                    </>
                  ) : (
                    <p>
                      {segment.performance.情绪} · {segment.performance.语速} · 强度 {segment.performance.强度} ·{' '}
                      {segment.performance.节奏} · {segment.performance.停顿}
                    </p>
                  )}
                </div>
              );
            })}
            {(version.promptSnapshot.generationSettings || version.promptSnapshot.ttsRequests) && (
              <details className="raw-minimax-recipe">
                <summary>查看生成参数</summary>
                <pre>{JSON.stringify({
                  generationSettings: version.promptSnapshot.generationSettings,
                  requests: version.promptSnapshot.ttsRequests
                }, null, 2)}</pre>
              </details>
            )}
          </details>
        )}
      </article>
    );
  }

  function renderAnnotatedSegmentText(segment: DubbingPlanSegment) {
    if (!segment.recipe || !aiPlan) return <p>{segment.text}</p>;
    const units: Array<{ char: string; start: number; end: number }> = [];
    let utf16Offset = 0;
    for (const char of segment.text) {
      units.push({ char, start: utf16Offset, end: utf16Offset + char.length });
      utf16Offset += char.length;
    }
    const annotationsAt = (offset: number) => segment.recipe?.annotations.filter((item) => item.offset === offset) || [];
    const renderAnnotations = (offset: number) => annotationsAt(offset).map((annotation) => {
      const label = annotation.type === 'pause'
        ? `停顿 ${annotation.durationSeconds}s`
        : aiPlan.capabilities.vocalTags.find((item) => item.value === annotation.value)?.label || annotation.value;
      return (
        <button
          key={annotation.id}
          type="button"
          className={`speech-annotation-chip ${annotation.type}`}
          title="点击删除标记"
          onClick={() => removeSegmentAnnotation(segment.segmentId, annotation.id)}
        >
          {label}<span aria-hidden="true">×</span>
        </button>
      );
    });

    return (
      <div className="annotated-script" aria-label="可插入台词标记的原文">
        {renderAnnotations(0)}
        {units.map((unit) => (
          <React.Fragment key={`${segment.segmentId}-${unit.start}`}>
            <button
              type="button"
              className={annotationCursorBySegment[segment.segmentId] === unit.end ? 'script-character active' : 'script-character'}
              title={`点击后在“${unit.char}”之后插入标记`}
              onClick={() => setAnnotationCursorBySegment((current) => ({
                ...current,
                [segment.segmentId]: unit.end
              }))}
            >
              {unit.char}
            </button>
            {renderAnnotations(unit.end)}
          </React.Fragment>
        ))}
      </div>
    );
  }

  function assignVoiceToSpeaker(speakerCode: string, versionId: string) {
    if (!versionId) {
      setVoiceDesignsBySpeaker((current) => {
        const next = { ...current };
        delete next[speakerCode];
        return next;
      });
      return;
    }
    const version = [...myVoiceDesigns, ...sharedVoiceDesigns].find((item) => item.id === versionId);
    if (version) {
      setVoiceDesignsBySpeaker((current) => ({ ...current, [speakerCode]: version }));
    }
  }

  function openVoiceDesigner(speakerCode: string | null = null) {
    setVoiceDesignerSpeaker(speakerCode);
    setVoiceDesignerOpen(true);
  }

  function closeVoiceDesigner() {
    setVoiceDesignerOpen(false);
    setVoiceDesignerSpeaker(null);
  }

  function handleVoiceCreated(version: VoiceDesignVersion) {
    setMyVoiceDesigns((current) => [version, ...current.filter((item) => item.id !== version.id)]);
    if (voiceDesignerSpeaker) {
      setVoiceDesignsBySpeaker((current) => ({ ...current, [voiceDesignerSpeaker]: version }));
      setNotice(`已为当前角色选用“${version.characterName}”`);
      window.setTimeout(() => setNotice(''), 1800);
      closeVoiceDesigner();
    }
  }

  function renderAiComposer(bundle: DubbingUnitBundle) {
    if (!aiComposerOpen) return null;
    if (aiPlanning) {
      return <p className="voice-panel-empty">正在识别角色和表演方式...</p>;
    }
    if (!aiPlan || !aiComposerMatchesUnit(aiComposerBinding, bundle.unit)) return null;
    const capabilities = aiPlan.capabilities;
    const activeRoles = aiPlan.roles.filter((role) => aiPlan.segments.some((segment) => segment.speakerCode === role.code));
    const selectedOwnVoices = Array.from(new Map(
      Object.values(voiceDesignsBySpeaker)
        .filter((voice) => voice.ownerUserId === user?.id)
        .map((voice) => [voice.id, voice])
    ).values());

    return (
      <section className="ai-dubbing-composer">
        <div className="ai-voice-lock">
          <div>
            <span className="ai-voice-lock-dot" aria-hidden="true" />
            <strong>为角色分配音色</strong>
          </div>
          <small>可以使用平台默认音色、我的自创音色，或创作者公开共享的音色。</small>
        </div>

        <div className="role-voice-assignments">
          {activeRoles.map((role) => (
            <label key={role.code}>
              <span>{role.label}</span>
              <select
                value={voiceDesignsBySpeaker[role.code]?.id || ''}
                onChange={(event) => assignVoiceToSpeaker(role.code, event.target.value)}
              >
                <option value="">平台默认音色</option>
                {myVoiceDesigns.length > 0 && (
                  <optgroup label="我的音色">
                    {myVoiceDesigns.map((voice) => <option key={voice.id} value={voice.id}>{voice.characterName} · V{voice.versionNumber}</option>)}
                  </optgroup>
                )}
                {sharedVoiceDesigns.length > 0 && (
                  <optgroup label="创作广场共享音色">
                    {sharedVoiceDesigns.map((voice) => <option key={voice.id} value={voice.id}>{voice.characterName} · {voice.ownerDisplayName}</option>)}
                  </optgroup>
                )}
              </select>
              <button type="button" onClick={() => openVoiceDesigner(role.code)}>为这个角色设计新音色</button>
            </label>
          ))}
        </div>

        <details className="minimax-global-settings">
          <summary>生成与音频设置</summary>
          <div className="ai-segment-fields">
            <label>
              模型
              <select
                value={aiPlan.generationSettings.model}
                onChange={(event) => updateGenerationSettings((settings) => ({
                  ...settings,
                  model: event.target.value
                }))}
              >
                {capabilities.models.map((model) => <option key={model} value={model}>{model}</option>)}
              </select>
            </label>
            <label>
              语言增强
              <select
                value={aiPlan.generationSettings.languageBoost}
                onChange={(event) => updateGenerationSettings((settings) => ({
                  ...settings,
                  languageBoost: event.target.value
                }))}
              >
                {capabilities.languages.map((language) => <option key={language} value={language}>{language}</option>)}
              </select>
            </label>
            <label>
              采样率
              <select
                value={aiPlan.generationSettings.audioSetting.sampleRate}
                onChange={(event) => updateGenerationSettings((settings) => ({
                  ...settings,
                  audioSetting: { ...settings.audioSetting, sampleRate: Number(event.target.value) }
                }))}
              >
                {capabilities.audio.sampleRates.map((value) => <option key={value} value={value}>{value} Hz</option>)}
              </select>
            </label>
            <label>
              MP3 比特率
              <select
                value={aiPlan.generationSettings.audioSetting.bitrate}
                onChange={(event) => updateGenerationSettings((settings) => ({
                  ...settings,
                  audioSetting: { ...settings.audioSetting, bitrate: Number(event.target.value) }
                }))}
              >
                {capabilities.audio.bitrates.map((value) => <option key={value} value={value}>{value / 1000} kbps</option>)}
              </select>
            </label>
            <label>
              声道
              <select
                value={aiPlan.generationSettings.audioSetting.channel}
                onChange={(event) => updateGenerationSettings((settings) => ({
                  ...settings,
                  audioSetting: { ...settings.audioSetting, channel: Number(event.target.value) }
                }))}
              >
                {capabilities.audio.channels.map((value) => (
                  <option key={value} value={value}>{value === 1 ? '单声道' : '双声道'}</option>
                ))}
              </select>
            </label>
            <label>
              字幕粒度
              <select
                value={aiPlan.generationSettings.subtitle.type}
                disabled={!aiPlan.generationSettings.subtitle.enabled}
                onChange={(event) => updateGenerationSettings((settings) => ({
                  ...settings,
                  subtitle: { ...settings.subtitle, type: event.target.value }
                }))}
              >
                {capabilities.subtitleTypes.filter((value) => value !== 'word_streaming').map((value) => (
                  <option key={value} value={value}>{value === 'word' ? '词级' : '句级'}</option>
                ))}
              </select>
            </label>
            <label className="toggle-field">
              <input
                type="checkbox"
                checked={aiPlan.generationSettings.subtitle.enabled}
                onChange={(event) => updateGenerationSettings((settings) => ({
                  ...settings,
                  subtitle: { ...settings.subtitle, enabled: event.target.checked }
                }))}
              />
              生成时间戳字幕
            </label>
            <label className="toggle-field">
              <input
                type="checkbox"
                checked={aiPlan.generationSettings.aigcWatermark}
                onChange={(event) => updateGenerationSettings((settings) => ({
                  ...settings,
                  aigcWatermark: event.target.checked
                }))}
              />
              AI 音频标识
            </label>
          </div>
          <p className="platform-output-note">正式版本固定使用非流式、MP3、HEX 持久化输出；这些传输参数由平台管理。</p>
        </details>

        <div className="ai-segment-list">
          {aiPlan.segments.map((segment) => {
            const recipe = segment.recipe;
            if (!recipe) return null;
            return (
              <article key={segment.segmentId} className="ai-segment-editor">
                <div className="segment-editor-heading">
                  <label>
                    角色
                    <select
                      value={segment.speakerCode || ''}
                      onChange={(event) => updateAiPlanSegment(segment.segmentId, 'speakerCode', event.target.value)}
                    >
                      {aiPlan.roles.map((role) => <option key={role.code} value={role.code}>{role.label}</option>)}
                    </select>
                  </label>
                  <small>点击台词中的字，标记会插入在该字之后；点击标记可删除。</small>
                </div>

                {renderAnnotatedSegmentText(segment)}

                <div className="annotation-toolbar">
                  <label>
                    停顿秒数
                    <input
                      type="number"
                      min={capabilities.ranges.pause.min}
                      max={capabilities.ranges.pause.max}
                      step={capabilities.ranges.pause.step}
                      value={pauseSecondsBySegment[segment.segmentId] ?? capabilities.ranges.pause.default}
                      onChange={(event) => setPauseSecondsBySegment((current) => ({
                        ...current,
                        [segment.segmentId]: Number(event.target.value)
                      }))}
                    />
                  </label>
                  <button type="button" onClick={() => addSegmentAnnotation(segment, 'pause')}>插入停顿</button>
                  <label>
                    语气词
                    <select
                      value={vocalTagBySegment[segment.segmentId] || capabilities.vocalTags[0]?.value}
                      onChange={(event) => setVocalTagBySegment((current) => ({
                        ...current,
                        [segment.segmentId]: event.target.value
                      }))}
                    >
                      {capabilities.vocalTags.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={!capabilities.vocalTagModels.includes(aiPlan.generationSettings.model)}
                    title={capabilities.vocalTagModels.includes(aiPlan.generationSettings.model) ? '' : '当前模型不支持语气词标签'}
                    onClick={() => addSegmentAnnotation(segment, 'vocal')}
                  >
                    插入语气词
                  </button>
                </div>

                <div className="ai-segment-fields primary-settings">
                  <label>
                    情绪
                    <select
                      value={recipe.voiceSetting.emotion}
                      onChange={(event) => updateRecipeSection(segment.segmentId, 'voiceSetting', { emotion: event.target.value })}
                    >
                      {capabilities.emotions.map((item) => <option key={item.value || 'auto'} value={item.value}>{item.label}</option>)}
                    </select>
                  </label>
                  <label>
                    语速 {recipe.voiceSetting.speed.toFixed(2)}
                    <input
                      type="range"
                      min={capabilities.ranges.speed.min}
                      max={capabilities.ranges.speed.max}
                      step={capabilities.ranges.speed.step}
                      value={recipe.voiceSetting.speed}
                      onChange={(event) => updateRecipeSection(segment.segmentId, 'voiceSetting', { speed: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    音量 {recipe.voiceSetting.volume.toFixed(1)}
                    <input
                      type="range"
                      min={capabilities.ranges.volume.min}
                      max={capabilities.ranges.volume.max}
                      step={capabilities.ranges.volume.step}
                      value={recipe.voiceSetting.volume}
                      onChange={(event) => updateRecipeSection(segment.segmentId, 'voiceSetting', { volume: Number(event.target.value) })}
                    />
                  </label>
                  <div className="locked-setting">
                    <span>当前角色音色</span>
                    <strong>{segment.speakerCode && voiceDesignsBySpeaker[segment.speakerCode]
                      ? voiceDesignsBySpeaker[segment.speakerCode].characterName
                      : '平台默认'}</strong>
                  </div>
                </div>

                <details className="segment-advanced-settings">
                  <summary>发音与文本选项</summary>
                  <div className="ai-segment-fields">
                    <label className="toggle-field">
                      <input type="checkbox" checked={recipe.voiceSetting.englishNormalization} onChange={(event) => updateRecipeSection(segment.segmentId, 'voiceSetting', { englishNormalization: event.target.checked })} />
                      英文数字规范化
                    </label>
                    <label className="toggle-field">
                      <input type="checkbox" checked={recipe.voiceSetting.latexRead} onChange={(event) => updateRecipeSection(segment.segmentId, 'voiceSetting', { latexRead: event.target.checked })} />
                      朗读 LaTeX
                    </label>
                    <label className="wide">
                      发音修正（每行一项：文字/读法）
                      <textarea
                        rows={2}
                        value={recipe.pronunciation.join('\n')}
                        placeholder={'处理/(chu3)(li3)\nHolmes/(hoʊmz)'}
                        onChange={(event) => updateAiSegmentRecipe(segment.segmentId, (currentRecipe) => ({
                          ...currentRecipe,
                          pronunciation: event.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
                        }))}
                      />
                    </label>
                  </div>
                </details>
              </article>
            );
          })}
        </div>
        {selectedOwnVoices.length > 0 && (
          <div className="voice-share-options">
            <strong>共享所用音色</strong>
            <p>共享后，其他创作者可在配音作品中使用该音色。</p>
            {selectedOwnVoices.map((voice) => (
              <label key={voice.id}>
                <input
                  type="checkbox"
                  checked={sharedVoiceDesignIds.includes(voice.id)}
                  onChange={(event) => setSharedVoiceDesignIds((current) => event.target.checked
                    ? [...new Set([...current, voice.id])]
                    : current.filter((id) => id !== voice.id))}
                />
                同时公开“{voice.characterName}”，允许其他创作者使用
              </label>
            ))}
          </div>
        )}
        <div className="ai-composer-actions">
          <button className="ai-secondary-action" type="button" onClick={() => void saveAiDubbingVersion('private')} disabled={voiceSaving}>保存作品</button>
          <button className="ai-primary-action" type="button" onClick={() => void saveAiDubbingVersion('public')} disabled={voiceSaving}>
            {voiceSaving ? '生成中...' : '生成并发布'}
          </button>
        </div>
      </section>
    );
  }

  function renderVoiceDesignerPanel() {
    return (
      <div
        className="selection-voice-panel ai-design-panel voice-designer-panel"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="ai-design-panel-header">
          <div>
            <span>VOICE DESIGN</span>
            <strong>我来设计音色</strong>
            <p>{voiceDesignerSpeaker ? '创建完成后会自动返回，并为当前角色选中新音色。' : '创建可跨作品、跨角色使用的个人音色。'}</p>
          </div>
          <button type="button" className="ai-design-close" onClick={closeVoiceDesigner} aria-label="关闭音色设计">×</button>
        </header>
        <div className="ai-design-panel-body">
          <VoiceLibrary compact onCreated={handleVoiceCreated} />
        </div>
      </div>
    );
  }

  function renderIllustrationCreatorPanel() {
    if (!selectedParagraph) return null;
    const key = dubbingBundleKey(selectedParagraph);
    const bundle = illustrationBundles[key];
    const loading = illustrationLoadingKey === key;
    const replacementTarget = bundle?.myVersions.find((version) => version.id === illustrationPublishTarget) || null;
    const publicVersions = bundle?.myVersions.filter((version) => version.status === 'public') || [];
    const illustrationPromptReady = illustrationPromptMode === 'official'
      ? Boolean(officialIllustrationStyle && illustrationSceneDescription.trim())
      : Boolean(illustrationFinalPrompt.trim());

    return (
      <div
        className="selection-voice-panel ai-design-panel illustration-creator-panel"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="ai-design-panel-header">
          <div>
            <span>DIY ILLUSTRATION</span>
            <strong>创作段落插图</strong>
            <p>为当前段落构思画面，创作专属插图。</p>
          </div>
          <button type="button" className="ai-design-close" onClick={() => setIllustrationCreatorOpen(false)} aria-label="关闭插图创作器">×</button>
        </header>
        <div className="ai-design-panel-body">
          <div className="voice-panel-tabs illustration-creator-tabs">
            <button type="button" className={illustrationCreatorTab === 'create' ? 'active' : ''} onClick={() => setIllustrationCreatorTab('create')}>创作插图</button>
            <button type="button" className={illustrationCreatorTab === 'mine' ? 'active' : ''} onClick={() => setIllustrationCreatorTab('mine')}>我的作品 {bundle ? `(${bundle.myVersions.length})` : ''}</button>
          </div>
          {loading && !bundle ? (
            <div className="ai-design-loading"><span aria-hidden="true" /><p>正在准备当前段落与官方风格...</p></div>
          ) : !bundle ? (
            <p className="voice-panel-empty">当前段落暂不可用。</p>
          ) : illustrationCreatorTab === 'create' ? (
            <div className="illustration-create-form">
              <div className="ai-design-source">
                <span>当前段落</span>
                <p>{bundle.unit.sourceText}</p>
              </div>
              <div className="illustration-mode-switch">
                <button
                  type="button"
                  className={illustrationPromptMode === 'official' ? 'active' : ''}
                  onClick={() => {
                    setIllustrationPromptMode('official');
                  }}
                >官方风格</button>
                <button
                  type="button"
                  className={illustrationPromptMode === 'free' ? 'active' : ''}
                  onClick={() => {
                    setIllustrationPromptMode('free');
                    if (!illustrationFinalPrompt.trim()) {
                      setIllustrationFinalPrompt(illustrationSceneDescription.slice(0, 1400));
                    }
                  }}
                >自由创作</button>
              </div>
              {illustrationPromptMode === 'official' && (
                <>
                  <div className="illustration-official-style">
                    <header>
                      <strong>官方风格</strong>
                      <span>官方插图风格 · V{officialIllustrationStyle?.versionNumber || 1}</span>
                    </header>
                    <p>{officialIllustrationStyle?.globalStylePrompt || '正在读取官方风格提示词...'}</p>
                    <small>该风格提示词将在生成时自动追加。</small>
                  </div>
                  <label>
                    画面描述
                    <textarea
                      value={illustrationSceneDescription}
                      rows={5}
                      maxLength={700}
                      placeholder="描述画面中的人物、场景、构图、动作与光线。"
                      onChange={(event) => setIllustrationSceneDescription(event.target.value)}
                    />
                    <small>{illustrationSceneDescription.length}/700</small>
                  </label>
                </>
              )}
              {illustrationPromptMode === 'free' && (
                <label>
                  创作提示词
                  <textarea
                    className="illustration-final-prompt"
                    value={illustrationFinalPrompt}
                    rows={9}
                    maxLength={1400}
                    placeholder="描述你希望呈现的画面、风格与视觉细节。"
                    onChange={(event) => setIllustrationFinalPrompt(event.target.value)}
                  />
                  <small>{illustrationFinalPrompt.length}/1400</small>
                </label>
              )}
              <div className="illustration-create-actions">
                <span>16:9 横向插图</span>
                <button type="button" className="ai-primary-action" disabled={illustrationGenerating || !illustrationPromptReady} onClick={() => void createIllustration()}>
                  {illustrationGenerating ? '创作中...' : '生成插图'}
                </button>
              </div>
            </div>
          ) : (
            <div className="illustration-my-works">
              {replacementTarget && (
                <div className="illustration-replacement-picker">
                  <strong>当前段落已发布 3 幅作品</strong>
                  <p>请选择一幅已发布作品进行替换。原作品的互动数据将独立保留。</p>
                  <div>
                    {publicVersions.map((version) => (
                      <button key={version.id} type="button" onClick={() => void changeIllustrationStatus(replacementTarget, 'public', version.id)}>
                        <img src={version.imageUrl} alt="" /><span>替换此作品</span>
                      </button>
                    ))}
                  </div>
                  <button type="button" onClick={() => setIllustrationPublishTarget(null)}>暂不发布</button>
                </div>
              )}
              {bundle.myVersions.length === 0 ? (
                <div className="paragraph-community-empty"><strong>暂无插图作品</strong><p>完成创作后，作品将在这里集中展示。</p></div>
              ) : bundle.myVersions.map((version) => (
                <div key={version.id} className="illustration-my-work-row">
                  <IllustrationWorkCard
                    version={version}
                    user={user}
                    compact
                    onRequireLogin={() => setPage('login')}
                    onLike={toggleIllustrationLike}
                    onAdopt={(item) => item.adoptedByMe ? restoreOneClickIllustration(bundle.unit) : adoptIllustrationVersion(item)}
                    onWithdraw={(item) => changeIllustrationStatus(item, 'withdrawn')}
                    onReport={reportIllustrationVersion}
                    onCommentCount={() => { void loadIllustrationBundle(selectedParagraph); }}
                  />
                  <div className="illustration-my-work-management">
                    {version.status === 'private' && <button type="button" onClick={() => publishIllustration(version, bundle)}>发布作品</button>}
                    {version.status === 'public' && <button type="button" onClick={() => void changeIllustrationStatus(version, 'withdrawn')}>撤回作品</button>}
                    {version.status === 'withdrawn' && <button type="button" onClick={() => publishIllustration(version, bundle)}>重新发布</button>}
                    {version.status !== 'public' && <button type="button" onClick={() => {
                      if (window.confirm('确定删除这幅作品吗？')) void changeIllustrationStatus(version, 'deleted');
                    }}>删除</button>}
                    {version.adoptedByMe && <button type="button" onClick={() => void restoreOneClickIllustration(bundle.unit)}>使用官方插图</button>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {illustrationError && <p className="form-error illustration-error">{illustrationError}</p>}
        </div>
      </div>
    );
  }

  function renderParagraphCommunityPanel() {
    if (!selectedParagraph) return null;
    const key = dubbingBundleKey(selectedParagraph);
    const bundle = dubbingBundles[key];
    const illustrationBundle = illustrationBundles[key];
    const loading = paragraphCommunityKind === 'dubbing'
      ? voiceLoadingKey === key
      : illustrationLoadingKey === key;
    const publicVersions = (bundle?.versions || []).filter((version) =>
      version.status === 'public' &&
      (paragraphCommunityTab === 'all' || version.kind === paragraphCommunityTab)
    );
    const publicIllustrations = (illustrationBundle?.versions || []).filter((version) => version.status === 'public');
    const activeUnit = paragraphCommunityKind === 'dubbing' ? bundle?.unit : illustrationBundle?.unit;

    return (
      <div
        className="selection-voice-panel ai-design-panel paragraph-community-panel"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="ai-design-panel-header">
          <div>
            <span>CREATION SQUARE</span>
            <strong>当前段落创作</strong>
            <p>探索其他读者对当前段落的声音与画面表达。</p>
          </div>
          <button
            type="button"
            className="ai-design-close"
            onClick={() => setParagraphCommunityOpen(false)}
            aria-label="关闭当前段落创作广场"
          >
            ×
          </button>
        </header>

        <div className="ai-design-panel-body">
          <div className="paragraph-community-kind-tabs">
            <button type="button" className={paragraphCommunityKind === 'dubbing' ? 'active' : ''} onClick={() => setParagraphCommunityKind('dubbing')}>配音</button>
            <button type="button" className={paragraphCommunityKind === 'illustration' ? 'active' : ''} onClick={() => setParagraphCommunityKind('illustration')}>插图</button>
          </div>
          {loading ? (
            <div className="ai-design-loading">
              <span aria-hidden="true" />
              <p>正在载入段落作品...</p>
            </div>
          ) : !activeUnit ? (
            <p className="voice-panel-empty">当前段落作品暂不可用。</p>
          ) : (
            <>
              <div className="ai-design-source paragraph-community-source">
                <span>当前段落</span>
                <p>{activeUnit.sourceText}</p>
              </div>
              {paragraphCommunityKind === 'dubbing' && bundle ? (
                <>
                  <div className="voice-panel-tabs paragraph-community-tabs">
                    {([['all', '全部'], ['ai', 'AI 配音'], ['human', '真人配音']] as const).map(([value, label]) => (
                      <button key={value} type="button" className={paragraphCommunityTab === value ? 'active' : ''} onClick={() => setParagraphCommunityTab(value)}>{label}</button>
                    ))}
                  </div>
                  <div className="voice-panel-section paragraph-community-list">
                    {publicVersions.length > 0 ? publicVersions.map((version) => renderDubbingVersionCard(version, bundle.unit)) : (
                      <div className="paragraph-community-empty"><strong>暂无公开作品</strong><p>创作并发布你的段落配音。</p></div>
                    )}
                  </div>
                </>
              ) : illustrationBundle ? (
                <div className="paragraph-illustration-community-list">
                  {publicIllustrations.length > 0 ? publicIllustrations.map((version) => (
                    <IllustrationWorkCard
                      key={version.id}
                      version={version}
                      user={user}
                      compact
                      onRequireLogin={() => setPage('login')}
                      onLike={toggleIllustrationLike}
                      onAdopt={adoptIllustrationVersion}
                      onWithdraw={(item) => changeIllustrationStatus(item, 'withdrawn')}
                      onReport={reportIllustrationVersion}
                      onCommentCount={() => { void loadIllustrationBundle(selectedParagraph); }}
                    />
                  )) : (
                    <div className="paragraph-community-empty"><strong>暂无公开插图</strong><p>创作并发布你的段落插图。</p></div>
                  )}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    );
  }

  function renderVoicePanel() {
    if (!selectedParagraph) {
      return null;
    }

    const key = dubbingBundleKey(selectedParagraph);
    const bundle = dubbingBundles[key];
    const loading = voiceLoadingKey === key;
    const myVersions = (bundle?.versions || []).filter((version) => version.ownerUserId === user?.id);
    return (
      <div
        className="selection-voice-panel ai-design-panel"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="ai-design-panel-header">
          <div>
            <span>AI DUBBING DESIGN</span>
            <strong>我来设计 AI 配音</strong>
            <p>逐句打磨语气、节奏与情绪，完成整段配音。</p>
          </div>
          <button type="button" className="ai-design-close" onClick={closeAiDesignMenu} aria-label="关闭 AI 配音设计">
            ×
          </button>
        </header>

        {loading ? (
          <div className="ai-design-loading">
            <span aria-hidden="true" />
            <p>正在准备这段台词...</p>
          </div>
        ) : !bundle ? (
          <p className="voice-panel-empty">当前段落配音暂不可用。</p>
        ) : (
          <div className="ai-design-panel-body">
            <div className="ai-design-source">
              <span>当前段落</span>
              <p>{bundle.unit.sourceText}</p>
            </div>

            {renderAiComposer(bundle)}
            {myVersions.length > 0 && (
              <details className="ai-design-library my-dubbing-library">
                <summary>
                  <div>
                    <strong>我的配音版本</strong>
                    <small>{myVersions.length} 个未发布或已发布版本</small>
                  </div>
                  <span>管理</span>
                </summary>
                <div className="ai-design-library-content voice-panel-section">
                  {myVersions.map((version) => renderDubbingVersionCard(version, bundle.unit))}
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    );
  }

  function renderParagraphAudioControls(paragraphIndex: number) {
    const audios = Object.entries(paragraphAudios).filter(
      ([, entry]) => entry.chapterId === chapter.id && entry.range.startParagraphIndex === paragraphIndex
    );

    if (audios.length === 0) {
      return null;
    }

    return (
      <div className="paragraph-audio-controls" aria-label="段落配音">
        {audios.map(([key, audio]) => renderInlinePlayButton(key, audio))}
      </div>
    );
  }

  function renderParagraphImageMedia(paragraphIndex: number) {
    const images = Object.entries(paragraphImages).filter(
      ([, entry]) => entry.chapterId === chapter.id && entry.range.endParagraphIndex === paragraphIndex
    );
    const collapsedImages = Object.entries(collapsedParagraphImages).filter(
      ([, entry]) => entry.chapterId === chapter.id && entry.range.endParagraphIndex === paragraphIndex
    );

    if (images.length === 0 && collapsedImages.length === 0) {
      return null;
    }

    return (
      <div className="paragraph-image-media">
        {collapsedImages.map(([key, image]) => (
          <div
            key={`collapsed-image-${key}`}
            className={`inline-image-placeholder${image.fromLibrary ? ' library-media' : ''}`}
          >
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                expandParagraphImage(key);
              }}
            >
              展开插图
            </button>
          </div>
        ))}
        {images.map(([key, image]) => {
          const officialImage = findParagraphMedia(platformParagraphImages, image);
          return (
            <div
            key={`image-${key}`}
            className={`inline-image-frame${image.fromLibrary ? ' library-media' : ''}`}
            >
              <span className="inline-image-actions">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    hideParagraphImage(key, image);
                  }}
                >
                  收起
                </button>
                {image.illustrationVersionId && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void deleteParagraphImage(key, image);
                    }}
                  >
                    {officialImage ? '恢复官方' : '移出我的版本'}
                  </button>
                )}
              </span>
              <img
                className="inline-selection-image"
                src={image.imageUrl}
                alt=""
                title={image.fromLibrary ? `Media library: ${image.userId || 'unknown'}` : undefined}
              />
            </div>
          );
        })}
      </div>
    );
  }

  if (!chapter) {
    return <main className="loading">正在加载阅读桌...</main>;
  }

  const currentRangeKey = selectedParagraph
    ? rangeKey(selectedParagraph.chapterId, selectedParagraph.range)
    : null;
  const imageGenerating = Boolean(currentRangeKey && paragraphImageLoadingKey === currentRangeKey);
  const oneClickSpeechGenerating = Boolean(
    currentRangeKey && paragraphSpeechLoadingKey === currentRangeKey
  );
  const speechGenerating = oneClickSpeechGenerating || aiPlanning || voiceSaving;

  const selectionPanelOpen =
    illustrationCreatorOpen || paragraphCommunityOpen || voiceDesignerOpen || voicePanelOpen;
  const chapterAudioEntries = Object.entries(paragraphAudios)
    .filter(([, audio]) => audio.chapterId === chapter.id)
    .sort(([, a], [, b]) => a.range.startParagraphIndex - b.range.startParagraphIndex);

  function toggleReaderAudio() {
    const currentAudio = audioRef.current;
    if (playingAudioKey && currentAudio?.src) {
      if (currentAudio.paused) {
        void currentAudio.play()
          .then(() => setAudioPaused(false))
          .catch(() => {
            setAudioPaused(true);
            setNotice('音频播放失败');
            window.setTimeout(() => setNotice(''), 1800);
          });
      } else {
        currentAudio.pause();
        setAudioPaused(true);
      }
      return;
    }

    const visibleAudio = chapterAudioEntries.find(([, audio]) => {
      const paragraph = bookPageRef.current?.querySelector<HTMLElement>(
        `[data-paragraph-index="${audio.range.startParagraphIndex}"]`
      );
      if (!paragraph) return false;
      const rect = paragraph.getBoundingClientRect();
      return rect.bottom > 64 && rect.top < window.innerHeight - 72;
    });
    const nextAudio = visibleAudio ?? chapterAudioEntries[0];

    if (!nextAudio) {
      setNotice('当前章节还没有可播放的配音');
      window.setTimeout(() => setNotice(''), 1800);
      return;
    }

    playParagraphAudio(nextAudio[0], nextAudio[1].audioUrl);
  }

  function revealMoreSelectionActions(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const scroller = selectionToolbarActionsRef.current;
    if (!scroller) return;

    const atEnd = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 8;
    scroller.scrollTo({
      left: atEnd ? 0 : scroller.scrollLeft + Math.max(180, scroller.clientWidth * 0.72),
      behavior: 'smooth'
    });
  }

  function closeSelectionPanels() {
    setIllustrationCreatorOpen(false);
    setParagraphCommunityOpen(false);
    closeVoiceDesigner();
    closeAiDesignMenu();
  }

  function handleReaderSurfaceClick(event: React.MouseEvent<HTMLElement>) {
    if (!isMobileReader || selectedParagraph || mobileTocOpen || contextOpen || settingsOpen) return;

    const target = event.target as HTMLElement;
    if (
      target.closest('button, a, input, textarea, select, label, details, summary') ||
      target.closest('.paragraph-comments, .paragraph-image-media, .text-selection-layer')
    ) {
      return;
    }

    setMobileChromeOpen((open) => !open);
    setMobileRailExpanded(false);
  }

  return (
    <section className={selectedParagraph ? 'app-shell has-selection' : 'app-shell'}>
      <aside className="sidebar">
        <button className="shelf-back" onClick={() => setPage('bookshelf')} type="button">
          <span>←</span>
          <strong>返回书架</strong>
        </button>

        <section className="panel">
          <div className="toc-header">
            <span>当前作品</span>
            <h2>《斑点带子案》</h2>
            <p>{chapter.progress}% 已读</p>
            <div className="progress">
              <span style={{ width: `${chapter.progress}%` }} />
            </div>
          </div>
          <div className="chapter-list">
            {chapters.map((item, index) => {
              const readState =
                item.id === chapter.id ? 'current' : item.progress < chapter.progress ? 'read' : 'unread';

              return (
                <button
                  key={item.id}
                  className={`chapter ${readState}`}
                  onClick={() => setChapterId(item.id)}
                >
                  <span className="chapter-index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="chapter-text">
                    <strong>{item.title}</strong>
                    <small>{item.subtitle}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </aside>

      <section className={`reader theme-${readingTheme} width-${readingWidth}`}>
        {mobileChromeOpen && (
          <>
            <div className="mobile-reader-topbar" aria-label="阅读导航">
              <button type="button" onClick={() => setPage('bookshelf')} aria-label="返回书架">
                <span aria-hidden="true">‹</span>
              </button>
              <strong>{chapter.title}</strong>
              <button type="button" onClick={() => setMobileChromeOpen(false)} aria-label="收起阅读工具">
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <div className="mobile-reader-bottombar" aria-label="阅读工具">
              <button
                type="button"
                onClick={() => {
                  setMobileTocOpen(true);
                  setMobileChromeOpen(false);
                }}
              >
                <span aria-hidden="true">☷</span>
                目录
              </button>
              <button
                type="button"
                onClick={() => {
                  setSettingsOpen(true);
                  setMobileChromeOpen(false);
                }}
              >
                <span aria-hidden="true">Aa</span>
                阅读设置
              </button>
              <button
                type="button"
                className="mobile-reader-community"
                onClick={() => setPage('community')}
                aria-label="进入创作广场"
              >
                <span className="mobile-reader-community-icon" aria-hidden="true">创</span>
                创作广场
              </button>
              <span className="mobile-reader-progress">{chapter.progress}%</span>
            </div>
          </>
        )}

        <div className="reader-toolbar">
          <div>
            <p className="eyebrow">福尔摩斯探案集</p>
            <h2>{chapter.title}</h2>
            <div className="reader-meta">
              <span>{chapter.subtitle}</span>
              <span>{chapter.paragraphs.length} 段</span>
              <span>{collectedClues.length} 件证物</span>
            </div>
          </div>
          <div className="toolbar-actions">
            <button
              className={settingsOpen ? 'settings-trigger active' : 'settings-trigger'}
              onClick={() => setSettingsOpen((open) => !open)}
            >
              阅读设置
            </button>
            <button onClick={toggleReaderAudio}>
              {playingAudioKey && !audioPaused ? '暂停配音' : audioPaused ? '继续播放' : '播放配音'}
            </button>
          </div>
        </div>

        {settingsOpen && (
          <button
            type="button"
            className="mobile-sheet-scrim"
            onClick={() => setSettingsOpen(false)}
            aria-label="关闭阅读设置"
          />
        )}

        {settingsOpen && (
          <div className="reading-settings" aria-label="阅读设置">
            <div className="mobile-sheet-heading">
              <strong>阅读设置</strong>
              <button type="button" onClick={() => setSettingsOpen(false)}>完成</button>
            </div>
            <div className="setting-group">
              <span>版心</span>
              <div className="segmented-control">
                {[
                  ['narrow', '窄'],
                  ['standard', '标准'],
                  ['wide', '宽']
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={readingWidth === value ? 'active' : ''}
                    onClick={() => setReadingWidth(value as ReadingWidth)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="setting-group">
              <span>主题</span>
              <div className="segmented-control">
                {[
                  ['light', '浅色'],
                  ['paper', '纸张'],
                  ['night', '夜间']
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={readingTheme === value ? 'active' : ''}
                    onClick={() => setReadingTheme(value as ReadingTheme)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="setting-group">
              <span>字号</span>
              <div className="stepper-control">
                <button type="button" onClick={() => setFontSize((size) => Math.max(16, size - 1))}>
                  -
                </button>
                <strong>{fontSize}</strong>
                <button type="button" onClick={() => setFontSize((size) => Math.min(24, size + 1))}>
                  +
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="reader-progress-strip" aria-hidden="true">
          <span style={{ width: `${chapter.progress}%` }} />
        </div>

        <article
          key={chapter.id}
          ref={bookPageRef}
          className={selectedParagraph ? 'book-page selecting' : 'book-page'}
          style={{ '--reader-font-size': `${fontSize}px` } as React.CSSProperties}
          onClick={handleReaderSurfaceClick}
        >
          {chapter.paragraphs.map((paragraph, paragraphIndex) => {
            const key = paragraphKey(paragraphIndex);
            const comments = paragraphComments.filter((comment) => comment.paragraphIndex === paragraphIndex);
            const commentsOpen = activeCommentParagraph === paragraphIndex;

            return (
              <div className="reader-paragraph-block" key={key}>
                {renderParagraphAudioControls(paragraphIndex)}
                <p
                  className="reader-paragraph"
                  data-paragraph-index={paragraphIndex}
                  onContextMenu={(event) => handleParagraphContextMenu(event, paragraph, paragraphIndex)}
                  onPointerDown={(event) => handleParagraphPointerDown(event, paragraph, paragraphIndex)}
                  onPointerUp={clearLongPressTimer}
                  onPointerCancel={clearLongPressTimer}
                  onPointerLeave={clearLongPressTimer}
                  title="长按或右键选取完整段落"
                >
                  {renderTextRange(paragraph, 0, paragraphToText(paragraph).length)}
                </p>
                {renderParagraphImageMedia(paragraphIndex)}
                <button
                  type="button"
                  className={commentsOpen ? 'paragraph-comment-trigger active' : 'paragraph-comment-trigger'}
                  onClick={() => {
                    setActiveCommentParagraph(commentsOpen ? null : paragraphIndex);
                    setCommentDraft('');
                    setCommentError('');
                  }}
                  aria-expanded={commentsOpen}
                >
                  评论{comments.length ? ` ${comments.length}` : ''}
                </button>
              {commentsOpen && (
                <section className="paragraph-comments" aria-label={`第 ${paragraphIndex + 1} 段评论`}>
                  {commentsLoading && <p className="comment-status">正在加载评论…</p>}
                  {!commentsLoading && comments.length === 0 && (
                    <p className="comment-status">暂无评论，欢迎参与讨论。</p>
                  )}
                  {comments.map((comment) => (
                    <article className="paragraph-comment" key={comment.id}>
                      <div>
                        <strong>{comment.displayName || comment.username}</strong>
                        <span className="paragraph-comment-meta">
                          <time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString('zh-CN')}</time>
                          {user?.id === comment.userId && (
                            <button
                              type="button"
                              className="comment-delete"
                              disabled={deletingCommentId === comment.id}
                              onClick={() => removeParagraphComment(comment)}
                            >
                              {deletingCommentId === comment.id ? '删除中…' : '删除'}
                            </button>
                          )}
                        </span>
                      </div>
                      <p>{comment.content}</p>
                    </article>
                  ))}
                  {user ? (
                    <form
                      className="paragraph-comment-form"
                      onSubmit={(event) => { event.preventDefault(); submitParagraphComment(paragraphIndex); }}
                    >
                      <textarea
                        value={commentDraft}
                        onChange={(event) => setCommentDraft(event.target.value)}
                        maxLength={1000}
                        rows={3}
                        placeholder="写下你对这一段的看法…"
                      />
                      <div>
                        <span>{commentDraft.trim().length}/1000</span>
                        <button type="submit" disabled={commentSaving || !commentDraft.trim()}>
                          {commentSaving ? '发布中…' : '发布评论'}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button type="button" className="comment-login" onClick={() => setPage('login')}>
                      登录后参与评论
                    </button>
                  )}
                  {commentError && <p className="comment-error">{commentError}</p>}
                </section>
              )}
              </div>
            );
          })}

          {selectedParagraph && selectionLayout && (
            <div className="text-selection-layer" aria-hidden="true">
              {selectionLayout.rects.map((rect, index) => (
                <span
                  key={`${rect.top}-${rect.left}-${index}`}
                  className="selection-highlight"
                  style={{
                    top: `${rect.top}px`,
                    left: `${rect.left}px`,
                    width: `${rect.width}px`,
                    height: `${rect.height}px`
                  }}
                />
              ))}
              <button
                type="button"
                className="selection-handle selection-handle-start selection-handle-fixed"
                style={{
                  top: `${selectionLayout.startHandle.y}px`,
                  left: `${selectionLayout.startHandle.x}px`,
                  height: `${selectionLayout.startHandle.height}px`
                }}
                tabIndex={-1}
                aria-hidden="true"
              />
              <button
                type="button"
                className="selection-handle selection-handle-end selection-handle-fixed"
                style={{
                  top: `${selectionLayout.endHandle.y}px`,
                  left: `${selectionLayout.endHandle.x}px`,
                  height: `${selectionLayout.endHandle.height}px`
                }}
                tabIndex={-1}
                aria-hidden="true"
              />
              <div
                className="selection-toolbar"
                style={{
                  top: `${selectionLayout.toolbar.top}px`,
                  left: `${selectionLayout.toolbar.left}px`,
                  width: `${selectionLayout.toolbar.width}px`
                }}
              >
                <div className="selection-toolbar-actions" ref={selectionToolbarActionsRef}>
                  <button
                    type="button"
                    onClick={generateParagraphImage}
                    disabled={imageGenerating || speechGenerating}
                  >
                    {imageGenerating ? '生成中...' : '生成插图'}
                  </button>
                  <button
                    type="button"
                    className={illustrationCreatorOpen ? 'selection-menu-button active' : 'selection-menu-button'}
                    aria-expanded={illustrationCreatorOpen}
                    onClick={() => illustrationCreatorOpen ? setIllustrationCreatorOpen(false) : void openIllustrationCreator()}
                    disabled={imageGenerating || speechGenerating || illustrationGenerating}
                  >
                    <span>我来创作插图</span>
                    <span className="selection-menu-chevron" aria-hidden="true">›</span>
                  </button>
                  <button
                    type="button"
                    className={paragraphCommunityOpen ? 'selection-menu-button active' : 'selection-menu-button'}
                    aria-expanded={paragraphCommunityOpen}
                    onClick={() => {
                      if (paragraphCommunityOpen) {
                        setParagraphCommunityOpen(false);
                        return;
                      }
                      closeVoiceDesigner();
                      closeAiDesignMenu();
                      setIllustrationCreatorOpen(false);
                      setParagraphCommunityKind('dubbing');
                      setParagraphCommunityTab('all');
                      setParagraphCommunityOpen(true);
                    }}
                    disabled={imageGenerating || speechGenerating}
                  >
                    <span>创作广场</span>
                    <span className="selection-menu-chevron" aria-hidden="true">›</span>
                  </button>
                  <button
                    type="button"
                    onClick={generateParagraphSpeech}
                    disabled={imageGenerating || speechGenerating || illustrationGenerating}
                  >
                    {oneClickSpeechGenerating ? '生成中...' : '一键生成 AI 配音'}
                  </button>
                  <button
                    type="button"
                    className="selection-menu-button"
                    onClick={openHumanDubbingPlaceholder}
                    disabled={imageGenerating || speechGenerating}
                  >
                    <span>我来配音</span>
                    <span className="selection-menu-chevron" aria-hidden="true">›</span>
                  </button>
                  <button
                    type="button"
                    className={voiceDesignerOpen ? 'selection-menu-button active' : 'selection-menu-button'}
                    aria-expanded={voiceDesignerOpen}
                    onClick={() => {
                      if (voiceDesignerOpen) {
                        closeVoiceDesigner();
                        return;
                      }
                      setParagraphCommunityOpen(false);
                      setIllustrationCreatorOpen(false);
                      setVoicePanelOpen(false);
                      openVoiceDesigner();
                    }}
                    disabled={imageGenerating || speechGenerating}
                  >
                    <span>我来设计音色</span>
                    <span className="selection-menu-chevron" aria-hidden="true">›</span>
                  </button>
                  <button
                    type="button"
                    className={voicePanelOpen ? 'selection-menu-button active' : 'selection-menu-button'}
                    aria-expanded={voicePanelOpen}
                    onClick={() => {
                      if (voicePanelOpen) {
                        closeAiDesignMenu();
                        return;
                      }
                      closeVoiceDesigner();
                      setParagraphCommunityOpen(false);
                      setIllustrationCreatorOpen(false);
                      void startAiDubbingCreation();
                    }}
                    disabled={imageGenerating || speechGenerating}
                  >
                    <span>我来设计 AI 配音</span>
                    <span className="selection-menu-chevron" aria-hidden="true">›</span>
                  </button>
                </div>
                <button
                  type="button"
                  className="selection-toolbar-more"
                  onClick={revealMoreSelectionActions}
                  aria-label="查看更多操作"
                  title="查看更多操作"
                >
                  <span aria-hidden="true">›</span>
                </button>
                  {!isMobileReader && (
                    illustrationCreatorOpen
                      ? renderIllustrationCreatorPanel()
                      : paragraphCommunityOpen
                        ? renderParagraphCommunityPanel()
                        : voiceDesignerOpen
                          ? renderVoiceDesignerPanel()
                          : voicePanelOpen && renderVoicePanel()
                  )}
              </div>
            </div>
          )}
        </article>

        {isMobileReader && selectedParagraph && selectionPanelOpen && (
          <div className="mobile-selection-sheet-layer">
            <button
              type="button"
              className="mobile-selection-sheet-scrim"
              onClick={closeSelectionPanels}
              aria-label="关闭当前创作面板"
            />
            {illustrationCreatorOpen
              ? renderIllustrationCreatorPanel()
              : paragraphCommunityOpen
                ? renderParagraphCommunityPanel()
                : voiceDesignerOpen
                  ? renderVoiceDesignerPanel()
                  : voicePanelOpen && renderVoicePanel()}
          </div>
        )}

        <footer className="page-turner">
          <button
            type="button"
            disabled={!previousChapter}
            onClick={() => previousChapter && setChapterId(previousChapter.id)}
          >
            上一章
            <span>{previousChapter?.subtitle ?? '已经是开头'}</span>
          </button>
          <button
            type="button"
            disabled={!nextChapter}
            onClick={() => nextChapter && setChapterId(nextChapter.id)}
          >
            下一章
            <span>{nextChapter?.subtitle ?? '已经是结尾'}</span>
          </button>
        </footer>
      </section>

      <aside
        className={`${contextOpen ? 'right-rail open' : 'right-rail'}${mobileRailExpanded ? ' rail-expanded' : ''}`}
        aria-label="阅读辅助浮窗"
      >
        <div className="context-rail-control">
          <button
            type="button"
            className="context-rail-toggle"
            onClick={() => {
              setMobileRailExpanded((expanded) => !expanded);
              setMobileChromeOpen(false);
            }}
            aria-expanded={mobileRailExpanded}
            aria-label={mobileRailExpanded ? '收起阅读辅助' : '展开阅读辅助'}
          >
            <span aria-hidden="true">{mobileRailExpanded ? '›' : '‹'}</span>
          </button>
          <div className="context-tabs" role="tablist" aria-label="阅读辅助">
            <button
              type="button"
              role="tab"
              className={contextOpen && contextTab === 'cover' ? 'active' : ''}
              aria-expanded={contextOpen && contextTab === 'cover'}
              onClick={() => toggleContextPanel('cover')}
            >
              封面设计
            </button>
            <button
              type="button"
              role="tab"
              className={contextOpen && contextTab === 'ai' ? 'active' : ''}
              aria-expanded={contextOpen && contextTab === 'ai'}
              onClick={() => toggleContextPanel('ai')}
            >
              助手
            </button>
            <button
              type="button"
              role="tab"
              className={`${contextOpen && contextTab === 'bag' ? 'active' : ''}${bagPulse ? ' pulse' : ''}`}
              aria-expanded={contextOpen && contextTab === 'bag'}
              onClick={() => toggleContextPanel('bag')}
            >
              证物袋
              <span>{collectedClues.length}</span>
            </button>
          </div>
        </div>

        {contextOpen && (
          <button
            type="button"
            className="context-modal-scrim"
            onClick={() => setContextOpen(false)}
            aria-label="关闭阅读辅助浮窗"
          />
        )}

        {contextOpen && (
          <div className="context-popover">
            <div className="context-popover-header">
              <strong>{contextTab === 'cover' ? '封面设计' : contextTab === 'ai' ? '助手' : '证物袋'}</strong>
              <button type="button" onClick={() => setContextOpen(false)} aria-label="关闭阅读辅助浮窗">
                关闭
              </button>
            </div>

            {contextTab === 'cover' && (
              <CoverStudio
                articleId="speckled-band"
                api={api}
                activeCover={activeCover}
                onActiveCoverChange={setActiveCover}
                onOpenFullCommunity={openCoverCommunity}
                inspiration={coverInspiration}
                onInspirationHandled={clearCoverInspiration}
              />
            )}

            {contextTab === 'ai' && (
          <section className="chat-card context-card">
            <div className="context-heading">
              <h2>案情助手</h2>
              <span>不剧透</span>
            </div>
            <div className="messages">
              {messages.map((message, index) => (
                <p key={index} className={message.role}>
                  {message.content}
                </p>
              ))}
            </div>
            <div className="chat-input">
              <input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') askAssistant();
                }}
                placeholder="问一个关于当前案情的问题"
              />
              <button onClick={askAssistant}>发送</button>
            </div>
          </section>
        )}

            {contextTab === 'bag' && (
              <section className="bag-card context-card">
                <div className="context-heading">
                  <h2>证物袋</h2>
                  <div className="bag-heading-actions"><span>{collectedClues.length} 件</span><button type="button" onClick={openClueCommunity}>证物社区</button></div>
                </div>

                {collectedClues.length === 0 ? (
                  <p className="empty-bag">暂无证物。点击正文中的可疑细节即可收集。</p>
                ) : (
                  <div className="clue-board-list">
                    {collectedClues.map(({ clue, record }) => {
                      const image = clueImages[clueImageKey(clue.id)];
                      return (
                        <article
                          key={clue.id}
                          className={activeClueId === clue.id ? 'clue-card active' : 'clue-card'}
                        >
                          <div className="clue-card-header">
                            <span>{clue.type}</span>
                            <div className="clue-card-actions">
                              <button type="button" onClick={() => removeClue(clue.id)}>
                                取出
                              </button>
                            </div>
                          </div>

                          <div className="clue-image-stage">
                            {!record.occurrenceId ? (
                              <div className="clue-image-placeholder error">
                                线索服务版本未更新，请稍后刷新页面
                              </div>
                            ) : image?.loading ? (
                              <div className="clue-image-placeholder loading">正在规划画面...</div>
                            ) : image?.imageUrl ? (
                              <img className="clue-card-image" src={image.imageUrl} alt={clue.label} />
                            ) : image?.skipped ? (
                              <div className="clue-image-placeholder">{image.reason || '这条线索不适合图像化'}</div>
                            ) : image?.error ? (
                              <div className="clue-image-placeholder error">{image.error}</div>
                            ) : (
                              <div className="clue-image-placeholder">等待生成</div>
                            )}
                          </div>
                          <h3>{clue.label}</h3>
                          <p>{clue.surfaceDescription}</p>
                          {image?.userOverride && <span className="clue-personal-version">当前显示：我的版本</span>}
                          {user && (
                            <ClueCreatorPanel
                              clue={clue}
                              occurrenceId={record.occurrenceId}
                              user={user}
                              onImageChange={(nextImage) => setClueImages((current) => ({
                                ...current,
                                [clueImageKey(clue.id)]: nextImage
                              }))}
                              onNotice={(message) => {
                                setNotice(message);
                                window.setTimeout(() => setNotice(''), 2400);
                              }}
                              onOpenCommunity={openClueCommunity}
                            />
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            )}          </div>
        )}
      </aside>

      {mobileTocOpen && (
        <div className="mobile-toc-layer">
          <button
            type="button"
            className="mobile-toc-scrim"
            onClick={() => setMobileTocOpen(false)}
            aria-label="关闭目录"
          />
          <section className="mobile-toc-sheet" role="dialog" aria-modal="true" aria-label="章节目录">
            <header>
              <div>
                <span>当前作品</span>
                <strong>《斑点带子案》</strong>
              </div>
              <button type="button" onClick={() => setMobileTocOpen(false)} aria-label="关闭目录">×</button>
            </header>
            <div className="mobile-toc-progress">
              <div>
                <span>阅读进度</span>
                <strong>{chapter.progress}%</strong>
              </div>
              <span><i style={{ width: `${chapter.progress}%` }} /></span>
            </div>
            <div className="mobile-toc-list">
              {chapters.map((item, index) => (
                <button
                  type="button"
                  key={item.id}
                  className={item.id === chapter.id ? 'mobile-toc-chapter current' : 'mobile-toc-chapter'}
                  aria-current={item.id === chapter.id ? 'page' : undefined}
                  onClick={() => {
                    setChapterId(item.id);
                    setMobileTocOpen(false);
                  }}
                >
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.subtitle}</small>
                  </span>
                  <span aria-hidden="true">›</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {notice && <div className="toast">{notice}</div>}
    </section>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

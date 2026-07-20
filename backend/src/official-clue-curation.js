import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceManifest = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../content/speckled-band-clues.json'), 'utf8')
);
const suggestions = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../content/official-clue-curation-suggestions.json'), 'utf8')
);

export const CLUE_CURATION_ARTICLE_ID = sourceManifest.articleId;
export const CLUE_CURATION_MINIMUM = Number(suggestions.targetCount.minimum);
export const CLUE_CURATION_MAXIMUM = Number(suggestions.targetCount.maximum);
export const CLUE_CURATION_RECOMMENDATION_REVISION = Number(suggestions.recommendationRevision || 1);
export const CLUE_CURATION_TYPES = Object.freeze(['人物', '地点', '物证']);

const sourceById = new Map(sourceManifest.clues.map((clue) => [clue.id, clue]));
const suggestionByMemberId = new Map();
for (const group of suggestions.groups) {
  for (const memberId of group.memberIds) {
    if (!sourceById.has(memberId)) {
      throw new Error(`Unknown clue suggestion member: ${memberId}`);
    }
    if (suggestionByMemberId.has(memberId)) {
      throw new Error(`Duplicate clue suggestion member: ${memberId}`);
    }
    suggestionByMemberId.set(memberId, group);
  }
}

function normalizedText(value, maximumLength, field) {
  const text = String(value || '').trim();
  if (!text || text.length > maximumLength) {
    throw new Error(`${field} must contain 1-${maximumLength} characters`);
  }
  return text;
}

export function getOfficialClueSourceManifest() {
  return structuredClone(sourceManifest);
}

export function createSuggestedClueDraft() {
  return {
    version: 1,
    recommendationRevision: CLUE_CURATION_RECOMMENDATION_REVISION,
    articleId: sourceManifest.articleId,
    sourceSha256: sourceManifest.sourceSha256,
    entries: sourceManifest.clues.map((clue) => {
      const group = suggestionByMemberId.get(clue.id);
      const isTarget = group?.targetId === clue.id;
      return {
        sourceClueId: clue.id,
        decision: group ? (isTarget ? 'keep' : 'merge') : 'archive',
        mergeTargetId: group && !isTarget ? group.targetId : null,
        label: isTarget ? group.label : clue.label,
        type: group?.type || clue.type,
        surfaceDescription: clue.surfaceDescription,
        hiddenIdentityPrompt: isTarget ? group.hiddenIdentityPrompt : '',
        suggestionReason: group?.reason || '该条目更适合作为人物、地点或核心证物的画面细节，不建议独立成项。'
      };
    })
  };
}

export function validateClueDraft(input, { requirePublishableCount = false } = {}) {
  if (
    !input || input.version !== 1 || input.articleId !== sourceManifest.articleId ||
    input.sourceSha256 !== sourceManifest.sourceSha256 || !Array.isArray(input.entries)
  ) {
    throw new Error('The clue curation draft does not match the current source catalog');
  }
  if (input.entries.length !== sourceManifest.clues.length) {
    throw new Error('The clue curation draft must account for every source candidate');
  }

  const seen = new Set();
  const entries = input.entries.map((rawEntry) => {
    const sourceClueId = String(rawEntry?.sourceClueId || '');
    const source = sourceById.get(sourceClueId);
    if (!source || seen.has(sourceClueId)) {
      throw new Error(`Invalid or repeated source clue: ${sourceClueId || '(missing)'}`);
    }
    seen.add(sourceClueId);
    const decision = String(rawEntry.decision || '');
    if (!['keep', 'merge', 'archive'].includes(decision)) {
      throw new Error(`Invalid curation decision for ${sourceClueId}`);
    }
    const type = String(rawEntry.type || '');
    if (!CLUE_CURATION_TYPES.includes(type)) {
      throw new Error(`Invalid clue type for ${sourceClueId}`);
    }
    return {
      sourceClueId,
      decision,
      mergeTargetId: decision === 'merge' ? String(rawEntry.mergeTargetId || '') : null,
      label: normalizedText(rawEntry.label, 120, 'Clue label'),
      type,
      surfaceDescription: normalizedText(rawEntry.surfaceDescription, 1200, 'Clue description'),
      hiddenIdentityPrompt: decision === 'keep'
        ? normalizedText(rawEntry.hiddenIdentityPrompt, 1200, 'Hidden identity prompt')
        : String(rawEntry.hiddenIdentityPrompt || '').trim().slice(0, 1200),
      suggestionReason: String(rawEntry.suggestionReason || '').trim().slice(0, 1000)
    };
  });

  const byId = new Map(entries.map((entry) => [entry.sourceClueId, entry]));
  for (const entry of entries) {
    if (entry.decision !== 'merge') continue;
    const target = byId.get(entry.mergeTargetId);
    if (!target || target.decision !== 'keep' || target.sourceClueId === entry.sourceClueId) {
      throw new Error(`Merge target for ${entry.sourceClueId} must be a retained clue`);
    }
    if (target.type !== entry.type) {
      throw new Error(`Merged clues must share one type: ${entry.sourceClueId}`);
    }
  }

  const retainedCount = entries.filter((entry) => entry.decision === 'keep').length;
  if (
    requirePublishableCount &&
    (retainedCount < CLUE_CURATION_MINIMUM || retainedCount > CLUE_CURATION_MAXIMUM)
  ) {
    throw new Error(
      `The official clue catalog must retain ${CLUE_CURATION_MINIMUM}-${CLUE_CURATION_MAXIMUM} clues; currently ${retainedCount}`
    );
  }
  return {
    ...input,
    recommendationRevision: Number(input.recommendationRevision || 1),
    entries
  };
}

export function upgradeClueDraftToCurrentRecommendations(input) {
  const draft = validateClueDraft(input);
  if (draft.recommendationRevision >= CLUE_CURATION_RECOMMENDATION_REVISION) {
    return draft;
  }
  const entriesById = new Map(draft.entries.map((entry) => [entry.sourceClueId, { ...entry }]));
  for (const group of suggestions.groups) {
    if (Number(group.introducedRevision || 1) <= draft.recommendationRevision) continue;
    for (const memberId of group.memberIds) {
      const entry = entriesById.get(memberId);
      const isTarget = group.targetId === memberId;
      entriesById.set(memberId, {
        ...entry,
        decision: isTarget ? 'keep' : 'merge',
        mergeTargetId: isTarget ? null : group.targetId,
        label: isTarget ? group.label : entry.label,
        type: group.type || entry.type,
        hiddenIdentityPrompt: isTarget ? group.hiddenIdentityPrompt : entry.hiddenIdentityPrompt,
        suggestionReason: group.reason
      });
    }
  }
  return validateClueDraft({
    ...draft,
    recommendationRevision: CLUE_CURATION_RECOMMENDATION_REVISION,
    entries: draft.entries.map((entry) => entriesById.get(entry.sourceClueId))
  });
}

export function buildPublishedClueManifest(input) {
  const draft = validateClueDraft(input, { requirePublishableCount: true });
  const entriesById = new Map(draft.entries.map((entry) => [entry.sourceClueId, entry]));
  const occurrencesByTarget = new Map(
    draft.entries
      .filter((entry) => entry.decision === 'keep')
      .map((entry) => [entry.sourceClueId, []])
  );

  for (const entry of draft.entries) {
    if (entry.decision === 'archive') continue;
    const targetId = entry.decision === 'keep' ? entry.sourceClueId : entry.mergeTargetId;
    const targetOccurrences = occurrencesByTarget.get(targetId);
    for (const occurrence of sourceById.get(entry.sourceClueId).occurrences) {
      if (!targetOccurrences.some((item) => item.id === occurrence.id)) {
        targetOccurrences.push({ ...occurrence });
      }
    }
  }

  const clues = [...occurrencesByTarget.entries()].map(([targetId, occurrences]) => {
    const entry = entriesById.get(targetId);
    occurrences.sort(
      (left, right) =>
        left.globalParagraphIndex - right.globalParagraphIndex || left.startOffset - right.startOffset
    );
    return {
      id: targetId,
      label: entry.label,
      type: entry.type,
      surfaceDescription: entry.surfaceDescription,
      hiddenIdentityPrompt: entry.hiddenIdentityPrompt,
      occurrences
    };
  });
  clues.sort(
    (left, right) =>
      left.occurrences[0].globalParagraphIndex - right.occurrences[0].globalParagraphIndex ||
      left.occurrences[0].startOffset - right.occurrences[0].startOffset
  );

  return {
    version: 1,
    articleId: sourceManifest.articleId,
    sourceSha256: sourceManifest.sourceSha256,
    generatedAt: new Date().toISOString(),
    generator: {
      protocol: 'official-clue-curation-v1',
      sourceCatalog: 'speckled-band-clues-v1'
    },
    clues
  };
}

export function clueDraftSummary(input) {
  const draft = validateClueDraft(input);
  const decisions = { keep: 0, merge: 0, archive: 0 };
  const retainedTypes = Object.fromEntries(CLUE_CURATION_TYPES.map((type) => [type, 0]));
  for (const entry of draft.entries) {
    decisions[entry.decision] += 1;
    if (entry.decision === 'keep') retainedTypes[entry.type] += 1;
  }
  return {
    totalCandidates: draft.entries.length,
    decisions,
    retainedTypes,
    publishable:
      decisions.keep >= CLUE_CURATION_MINIMUM && decisions.keep <= CLUE_CURATION_MAXIMUM,
    minimum: CLUE_CURATION_MINIMUM,
    maximum: CLUE_CURATION_MAXIMUM
  };
}

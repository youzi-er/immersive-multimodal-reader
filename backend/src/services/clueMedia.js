function metadataValue(asset, key) {
  return asset?.metadata && typeof asset.metadata === 'object' ? asset.metadata[key] : undefined;
}

export function isClueImageAsset(asset) {
  return asset?.mediaType === 'image' && metadataValue(asset, 'generationType') === 'clue-image';
}

export function selectResolvedClueAssets(
  assets,
  currentUser,
  { plannerVersion, fingerprint, clueId, occurrenceId } = {}
) {
  const candidates = assets.filter((asset) => {
    if (!isClueImageAsset(asset)) return false;
    if (plannerVersion && metadataValue(asset, 'plannerVersion') !== plannerVersion) return false;
    if (fingerprint && metadataValue(asset, 'fingerprint') !== fingerprint) return false;
    if (clueId && metadataValue(asset, 'clueId') !== clueId) return false;
    if (occurrenceId && metadataValue(asset, 'occurrenceId') !== occurrenceId) return false;
    return asset.userId === currentUser || asset.userId === 'shared';
  });

  const byOccurrence = new Map();
  for (const asset of candidates) {
    const key = `${metadataValue(asset, 'clueId')}:${metadataValue(asset, 'occurrenceId')}`;
    const existing = byOccurrence.get(key);
    if (!existing || (asset.userId === currentUser && existing.userId !== currentUser)) {
      byOccurrence.set(key, asset);
    }
  }
  return [...byOccurrence.values()];
}

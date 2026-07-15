function metadataValue(asset, key) {
  return asset?.metadata && typeof asset.metadata === 'object' ? asset.metadata[key] : undefined;
}

export function isClueImageAsset(asset) {
  return asset?.mediaType === 'image' && metadataValue(asset, 'generationType') === 'clue-image';
}

function createdAtTime(asset) {
  const timestamp = Date.parse(asset?.createdAt || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function selectLatestClueAssets(assets, { clueId, clueIds } = {}) {
  const requestedClueIds = clueIds ? new Set(clueIds) : null;
  const candidates = assets.filter((asset) => {
    if (!isClueImageAsset(asset)) return false;
    const assetClueId = metadataValue(asset, 'clueId');
    if (!assetClueId) return false;
    if (clueId && assetClueId !== clueId) return false;
    if (requestedClueIds && !requestedClueIds.has(assetClueId)) return false;
    return true;
  });

  candidates.sort((left, right) => createdAtTime(right) - createdAtTime(left));

  const latestByClue = new Map();
  for (const asset of candidates) {
    const assetClueId = metadataValue(asset, 'clueId');
    if (!latestByClue.has(assetClueId)) {
      latestByClue.set(assetClueId, asset);
    }
  }
  return [...latestByClue.values()];
}

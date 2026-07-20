import React, { useMemo, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './officialClueStudio.css';

const TOKEN_KEY = 'immersive-reader-token';
type Decision = 'keep' | 'merge' | 'archive';
type ClueType = '人物' | '地点' | '物证';

type SourceOccurrence = {
  id: string;
  chapterId: string;
  paragraphIndex: number;
  selectedText: string;
  fullParagraph: string;
};

type SourceClue = {
  id: string;
  label: string;
  type: ClueType;
  surfaceDescription: string;
  occurrences: SourceOccurrence[];
};

type DraftEntry = {
  sourceClueId: string;
  decision: Decision;
  mergeTargetId: string | null;
  label: string;
  type: ClueType;
  surfaceDescription: string;
  hiddenIdentityPrompt: string;
  suggestionReason: string;
};

type ClueDraft = {
  version: 1;
  recommendationRevision: number;
  articleId: string;
  sourceSha256: string;
  entries: DraftEntry[];
};

type DraftSummary = {
  totalCandidates: number;
  decisions: Record<Decision, number>;
  retainedTypes: Record<ClueType, number>;
  publishable: boolean;
  minimum: number;
  maximum: number;
};

type CatalogMeta = {
  draftRevision: number;
  publishedRevision: number;
  draftUpdatedAt: string;
  publishedAt: string | null;
  hasPublishedCatalog: boolean;
};

type CatalogResponse = {
  sourceClues: SourceClue[];
  draft: ClueDraft;
  summary: DraftSummary;
  catalog: CatalogMeta;
};

async function requestJson<T>(url: string, init: RequestInit = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
  return payload as T;
}

function summarize(draft: ClueDraft): DraftSummary {
  const decisions = { keep: 0, merge: 0, archive: 0 };
  const retainedTypes: Record<ClueType, number> = { 人物: 0, 地点: 0, 物证: 0 };
  for (const entry of draft.entries) {
    decisions[entry.decision] += 1;
    if (entry.decision === 'keep') retainedTypes[entry.type] += 1;
  }
  return {
    totalCandidates: draft.entries.length,
    decisions,
    retainedTypes,
    publishable: decisions.keep >= 20 && decisions.keep <= 30,
    minimum: 20,
    maximum: 30
  };
}

function decisionLabel(decision: Decision) {
  return decision === 'keep' ? '保留' : decision === 'merge' ? '合并' : '归档';
}

function formatTime(value: string | null) {
  if (!value) return '尚未发布';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString('zh-CN');
}

function OfficialClueStudio() {
  const [sourceClues, setSourceClues] = useState<SourceClue[]>([]);
  const [draft, setDraft] = useState<ClueDraft | null>(null);
  const [catalog, setCatalog] = useState<CatalogMeta | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [activeId, setActiveId] = useState('');
  const [decisionFilter, setDecisionFilter] = useState<'all' | Decision>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | ClueType>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    requestJson<CatalogResponse>('/api/clue-studio/catalog')
      .then((result) => {
        setSourceClues(result.sourceClues);
        setDraft(result.draft);
        setCatalog(result.catalog);
        setSavedSnapshot(JSON.stringify(result.draft));
        setActiveId(result.draft.entries[0]?.sourceClueId || '');
      })
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : '筛选台加载失败'))
      .finally(() => setLoading(false));
  }, []);

  const sourceById = useMemo(
    () => new Map(sourceClues.map((clue) => [clue.id, clue])),
    [sourceClues]
  );
  const entryById = useMemo(
    () => new Map((draft?.entries || []).map((entry) => [entry.sourceClueId, entry])),
    [draft]
  );
  const activeEntry = draft?.entries.find((entry) => entry.sourceClueId === activeId) || null;
  const activeSource = activeEntry ? sourceById.get(activeEntry.sourceClueId) || null : null;
  const summary = draft ? summarize(draft) : null;
  const dirty = Boolean(draft && JSON.stringify(draft) !== savedSnapshot);

  const invalidMerges = useMemo(() => {
    if (!draft) return [];
    return draft.entries.filter((entry) => {
      if (entry.decision !== 'merge') return false;
      const target = entryById.get(entry.mergeTargetId || '');
      return !target || target.decision !== 'keep' || target.type !== entry.type;
    });
  }, [draft, entryById]);

  const filteredEntries = useMemo(() => {
    if (!draft) return [];
    const normalizedSearch = search.trim().toLowerCase();
    return draft.entries.filter((entry) => {
      const source = sourceById.get(entry.sourceClueId);
      if (decisionFilter !== 'all' && entry.decision !== decisionFilter) return false;
      if (typeFilter !== 'all' && entry.type !== typeFilter) return false;
      if (!normalizedSearch) return true;
      return `${entry.label} ${source?.label || ''} ${entry.sourceClueId}`.toLowerCase().includes(normalizedSearch);
    });
  }, [decisionFilter, draft, search, sourceById, typeFilter]);

  function updateEntry(sourceClueId: string, patch: Partial<DraftEntry>) {
    setDraft((current) => current ? {
      ...current,
      entries: current.entries.map((entry) =>
        entry.sourceClueId === sourceClueId ? { ...entry, ...patch } : entry
      )
    } : current);
    setNotice('');
    setError('');
  }

  function setDecision(decision: Decision) {
    if (!activeEntry || !draft) return;
    if (decision === 'merge') {
      const currentTarget = entryById.get(activeEntry.mergeTargetId || '');
      const target = currentTarget?.decision === 'keep' && currentTarget.type === activeEntry.type
        ? currentTarget
        : draft.entries.find((entry) =>
          entry.decision === 'keep' && entry.type === activeEntry.type && entry.sourceClueId !== activeEntry.sourceClueId
        );
      updateEntry(activeEntry.sourceClueId, { decision, mergeTargetId: target?.sourceClueId || null });
      return;
    }
    updateEntry(activeEntry.sourceClueId, { decision, mergeTargetId: null });
  }

  function setType(type: ClueType) {
    if (!activeEntry || !draft) return;
    let mergeTargetId = activeEntry.mergeTargetId;
    if (activeEntry.decision === 'merge') {
      const target = draft.entries.find((entry) =>
        entry.decision === 'keep' && entry.type === type && entry.sourceClueId !== activeEntry.sourceClueId
      );
      mergeTargetId = target?.sourceClueId || null;
    }
    updateEntry(activeEntry.sourceClueId, { type, mergeTargetId });
  }

  async function saveDraft() {
    if (!draft || saving) return;
    setSaving(true);
    setError('');
    try {
      const result = await requestJson<Pick<CatalogResponse, 'draft' | 'summary' | 'catalog'>>(
        '/api/clue-studio/draft',
        { method: 'PUT', body: JSON.stringify({ draft }) }
      );
      setDraft(result.draft);
      setCatalog(result.catalog);
      setSavedSnapshot(JSON.stringify(result.draft));
      setNotice(`草稿已保存 · 第 ${result.catalog.draftRevision} 版`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '草稿保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function publishCatalog() {
    if (!draft || publishing || !summary?.publishable || invalidMerges.length > 0) return;
    const confirmed = window.confirm(
      `确认发布包含 ${summary.decisions.keep} 个主题的官方证物目录？正文中的证物标记会立即切换到新目录。`
    );
    if (!confirmed) return;
    setPublishing(true);
    setError('');
    try {
      const result = await requestJson<Pick<CatalogResponse, 'draft' | 'summary' | 'catalog'> & { publishedCount: number }>(
        '/api/clue-studio/publish',
        { method: 'POST', body: JSON.stringify({ draft }) }
      );
      setDraft(result.draft);
      setCatalog(result.catalog);
      setSavedSnapshot(JSON.stringify(result.draft));
      setNotice(`官方目录第 ${result.catalog.publishedRevision} 版已发布，共 ${result.publishedCount} 个主题。`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '正式目录发布失败');
    } finally {
      setPublishing(false);
    }
  }

  if (loading) {
    return <main className="clue-studio-state"><span className="clue-spinner" /><p>正在整理77个原始候选…</p></main>;
  }

  if (!draft || !catalog || !summary) {
    return (
      <main className="clue-studio-state clue-studio-error">
        <strong>官方证物筛选台暂时无法打开</strong>
        <p>{error || '没有可用的筛选草稿'}</p>
        <a href="/">返回阅读网站并登录</a>
      </main>
    );
  }

  return (
    <main className="official-clue-studio">
      <header className="clue-studio-header">
        <div className="clue-title-block">
          <span>THE SPECKLED BAND · OFFICIAL CLUE CURATION</span>
          <h1>官方证物筛选台</h1>
          <p>人物、地点与物证统一筛选；合并不会丢失任何原文位置，归档条目随时可以恢复。</p>
        </div>
        <div className="clue-header-actions">
          <div className="revision-note">
            <span>{dirty ? '有未保存修改' : `草稿第 ${catalog.draftRevision} 版`}</span>
            <small>正式目录：{catalog.hasPublishedCatalog ? `第 ${catalog.publishedRevision} 版` : '尚未发布'}</small>
          </div>
          <button type="button" className="secondary" onClick={() => void saveDraft()} disabled={saving || !dirty}>
            {saving ? '保存中…' : '保存草稿'}
          </button>
          <button
            type="button"
            className="publish"
            onClick={() => void publishCatalog()}
            disabled={publishing || !summary.publishable || invalidMerges.length > 0}
          >
            {publishing ? '发布中…' : '发布正式目录'}
          </button>
        </div>
      </header>

      <section className="clue-summary-strip" aria-label="筛选摘要">
        <div><span>原始候选</span><strong>{summary.totalCandidates}</strong></div>
        <div className="keep"><span>正式保留</span><strong>{summary.decisions.keep}</strong><small>目标 20–30</small></div>
        <div className="merge"><span>合并归入</span><strong>{summary.decisions.merge}</strong></div>
        <div className="archive"><span>可恢复归档</span><strong>{summary.decisions.archive}</strong></div>
        <div><span>类型构成</span><strong className="type-counts">{summary.retainedTypes.人物} 人物 · {summary.retainedTypes.地点} 地点 · {summary.retainedTypes.物证} 物证</strong></div>
        <div><span>最近发布</span><strong className="date-value">{formatTime(catalog.publishedAt)}</strong></div>
      </section>

      <div className="clue-studio-layout">
        <aside className="candidate-panel">
          <div className="candidate-filters">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索名称或编号"
              aria-label="搜索候选证物"
            />
            <div className="filter-row">
              {(['all', 'keep', 'merge', 'archive'] as const).map((value) => (
                <button key={value} type="button" className={decisionFilter === value ? 'active' : ''} onClick={() => setDecisionFilter(value)}>
                  {value === 'all' ? '全部' : decisionLabel(value)}
                </button>
              ))}
            </div>
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as 'all' | ClueType)} aria-label="按类型筛选">
              <option value="all">全部类型</option>
              <option value="人物">人物</option>
              <option value="地点">地点</option>
              <option value="物证">物证</option>
            </select>
          </div>
          <div className="candidate-list">
            {filteredEntries.map((entry) => {
              const source = sourceById.get(entry.sourceClueId);
              const target = entry.decision === 'merge' ? entryById.get(entry.mergeTargetId || '') : null;
              return (
                <button
                  type="button"
                  key={entry.sourceClueId}
                  className={`${activeId === entry.sourceClueId ? 'active' : ''} ${entry.decision}`}
                  onClick={() => setActiveId(entry.sourceClueId)}
                >
                  <i>{entry.type}</i>
                  <span><strong>{source?.label || entry.label}</strong><small>{entry.decision === 'merge' ? `并入：${target?.label || '未选择'}` : entry.suggestionReason}</small></span>
                  <em>{decisionLabel(entry.decision)}</em>
                </button>
              );
            })}
            {filteredEntries.length === 0 && <p className="empty-filter">没有符合筛选条件的候选。</p>}
          </div>
        </aside>

        {activeEntry && activeSource && (
          <section className="curation-workspace">
            <div className="workspace-heading">
              <div><span>原始候选</span><h2>{activeSource.label}</h2><code>{activeSource.id}</code></div>
              <div className="decision-switch" aria-label="筛选决定">
                {(['keep', 'merge', 'archive'] as Decision[]).map((decision) => (
                  <button type="button" key={decision} className={activeEntry.decision === decision ? `active ${decision}` : ''} onClick={() => setDecision(decision)}>
                    {decisionLabel(decision)}
                  </button>
                ))}
              </div>
            </div>

            <div className="recommendation"><strong>系统建议</strong><p>{activeEntry.suggestionReason}</p></div>

            {activeEntry.decision === 'merge' && (
              <label className="field merge-field">
                <span>合并到正式主题</span>
                <select value={activeEntry.mergeTargetId || ''} onChange={(event) => updateEntry(activeEntry.sourceClueId, { mergeTargetId: event.target.value || null })}>
                  <option value="">请选择保留主题</option>
                  {draft.entries.filter((entry) => entry.decision === 'keep' && entry.type === activeEntry.type && entry.sourceClueId !== activeEntry.sourceClueId).map((entry) => (
                    <option value={entry.sourceClueId} key={entry.sourceClueId}>{entry.label}</option>
                  ))}
                </select>
                <small>合并后，下方所有原文位置都会归入目标主题。</small>
              </label>
            )}

            {activeEntry.decision === 'archive' && (
              <div className="archive-note"><strong>该候选会从正式目录隐藏</strong><p>原始定义和全部原文位置仍然保留。以后切换为“保留”或“合并”即可恢复。</p></div>
            )}

            <div className={`editor-grid ${activeEntry.decision !== 'keep' ? 'muted' : ''}`}>
              <label className="field">
                <span>正式名称</span>
                <input value={activeEntry.label} disabled={activeEntry.decision !== 'keep'} onChange={(event) => updateEntry(activeEntry.sourceClueId, { label: event.target.value })} />
              </label>
              <label className="field">
                <span>类型标签</span>
                <select value={activeEntry.type} disabled={activeEntry.decision !== 'keep'} onChange={(event) => setType(event.target.value as ClueType)}>
                  <option value="人物">人物</option><option value="地点">地点</option><option value="物证">物证</option>
                </select>
              </label>
              <label className="field full">
                <span>公开描述</span>
                <textarea rows={4} value={activeEntry.surfaceDescription} disabled={activeEntry.decision !== 'keep'} onChange={(event) => updateEntry(activeEntry.sourceClueId, { surfaceDescription: event.target.value })} />
              </label>
              <label className="field full hidden-prompt">
                <span>隐藏身份约束 <i>用户不会看到</i></span>
                <textarea rows={4} value={activeEntry.hiddenIdentityPrompt} disabled={activeEntry.decision !== 'keep'} onChange={(event) => updateEntry(activeEntry.sourceClueId, { hiddenIdentityPrompt: event.target.value })} />
                <small>未来生成图片时由后台暗中附加，防止人物、地点或物件身份跑偏。</small>
              </label>
            </div>

            <div className="occurrence-section">
              <div className="section-title"><span>对应原文</span><strong>{activeSource.occurrences.length} 处</strong></div>
              {activeSource.occurrences.map((occurrence) => (
                <article key={occurrence.id}>
                  <header><span>{occurrence.chapterId} · 第 {occurrence.paragraphIndex + 1} 段</span><code>{occurrence.id}</code></header>
                  <blockquote>{occurrence.selectedText}</blockquote>
                  <details><summary>查看完整段落</summary><p>{occurrence.fullParagraph}</p></details>
                </article>
              ))}
            </div>
          </section>
        )}

        <aside className="publication-panel">
          <span>PUBLICATION CHECK</span>
          <h3>正式目录检查</h3>
          <div className={summary.publishable ? 'check good' : 'check bad'}>
            <strong>{summary.decisions.keep}</strong><p>正式主题数量</p><small>{summary.publishable ? '处于20–30的发布范围内' : '必须调整到20–30个'}</small>
          </div>
          <div className={invalidMerges.length === 0 ? 'check good compact' : 'check bad compact'}>
            <strong>{invalidMerges.length}</strong><p>无效合并</p><small>{invalidMerges.length === 0 ? '所有合并目标均有效' : '请重新选择保留目标'}</small>
          </div>
          <div className="group-preview">
            <strong>当前正式主题</strong>
            {draft.entries.filter((entry) => entry.decision === 'keep').map((entry) => {
              const mergedCount = draft.entries.filter((candidate) => candidate.decision === 'merge' && candidate.mergeTargetId === entry.sourceClueId).length;
              return <button type="button" key={entry.sourceClueId} onClick={() => setActiveId(entry.sourceClueId)}><span>{entry.label}</span><small>{entry.type}{mergedCount ? ` · 合并 ${mergedCount} 项` : ''}</small></button>;
            })}
          </div>
          {(error || notice) && <div className={error ? 'panel-message error' : 'panel-message'}>{error || notice}</div>}
        </aside>
      </div>
    </main>
  );
}

createRoot(document.getElementById('official-clue-studio-root')!).render(
  <React.StrictMode><OfficialClueStudio /></React.StrictMode>
);

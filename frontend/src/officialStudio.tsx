import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './officialStudio.css';

const TOKEN_KEY = 'immersive-reader-token';

type TextRange = {
  startParagraphIndex: number;
  startOffset: number;
  endParagraphIndex: number;
  endOffset: number;
};

type ContentUnit = {
  id: string;
  articleId: string;
  chapterId: string;
  chapterTitle: string;
  paragraphIndex: number;
  sourceText: string;
  sourceHash: string;
  range: TextRange;
};

type Selection = {
  id: string;
  title: string;
  chapterId: string;
  paragraphIndex: number;
  locatorText: string;
  promptExcerpt: string;
  articleId: string;
  placementRule: 'after-paragraph';
  unit: ContentUnit;
};

type IllustrationVersion = {
  id: string;
  versionNumber: number;
  status: 'private' | 'public' | 'withdrawn' | 'moderated' | 'deleted';
  imageUrl: string;
  finalPrompt: string;
  createdAt: string;
};

type OfficialSlot = {
  id: string;
  unitId: string;
  chapterId: string;
  paragraphIndex: number;
  imageUrl: string;
  promptExcerpt: string;
};

type OfficialStyle = {
  id: string;
  globalStylePrompt: string;
  globalNegativePrompt: string;
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
  if (!response.ok) {
    throw new Error(payload.error || `请求失败（${response.status}）`);
  }
  return payload as T;
}

function buildPrompt(style: OfficialStyle | null, selection: Selection, focus: string) {
  const maximumLength = 1400;
  const fixedBlocks = [
    (style?.globalStylePrompt || '维多利亚时代英国侦探小说叙事插图，写实、克制、电影感。').slice(0, 360),
    `本张插图的画面焦点：${focus.trim().slice(0, 700)}`,
    '只表现一个最清晰的叙事瞬间；不得把整段文字逐句拼贴成多格画面。',
    '图片中不要出现文字、字幕、水印、边框或界面元素。',
    style?.globalNegativePrompt ? `避免：${style.globalNegativePrompt.slice(0, 220)}` : ''
  ].filter(Boolean);
  const fixedPrompt = fixedBlocks.join('\n\n');
  const contextPrefix = '\n\n所属完整段落仅用于理解上下文和人物关系：';
  const remainingLength = maximumLength - fixedPrompt.length - contextPrefix.length;
  return remainingLength > 0
    ? `${fixedPrompt}${contextPrefix}${selection.unit.sourceText.slice(0, remainingLength)}`
    : fixedPrompt.slice(0, maximumLength);
}

function OfficialStudio() {
  const [selections, setSelections] = useState<Selection[]>([]);
  const [officialSlots, setOfficialSlots] = useState<OfficialSlot[]>([]);
  const [style, setStyle] = useState<OfficialStyle | null>(null);
  const [activeId, setActiveId] = useState('');
  const [focusDrafts, setFocusDrafts] = useState<Record<string, string>>({});
  const [versions, setVersions] = useState<Record<string, IllustrationVersion[]>>({});
  const [selectedVersions, setSelectedVersions] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const active = selections.find((item) => item.id === activeId) || selections[0] || null;
  const activeVersions = active ? versions[active.id] || [] : [];
  const activeOfficial = active
    ? officialSlots.find((slot) => slot.chapterId === active.chapterId && slot.paragraphIndex === active.paragraphIndex)
    : null;
  const completed = useMemo(
    () => selections.filter((selection) => officialSlots.some(
      (slot) => slot.chapterId === selection.chapterId && slot.paragraphIndex === selection.paragraphIndex
    )).length,
    [officialSlots, selections]
  );

  async function loadVersions(selection: Selection) {
    const bundle = await requestJson<{ myVersions: IllustrationVersion[] }>(
      `/api/illustrations/unit-at-position?articleId=${encodeURIComponent(selection.articleId)}&chapterId=${encodeURIComponent(
        selection.chapterId
      )}&paragraphIndex=${selection.paragraphIndex}`
    );
    setVersions((current) => ({ ...current, [selection.id]: bundle.myVersions }));
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      requestJson<{ selections: Selection[] }>('/api/illustrations/official-selections'),
      requestJson<{ slots: OfficialSlot[] }>('/api/illustrations/official-slots?articleId=speckled-band'),
      requestJson<{ style: OfficialStyle }>('/api/illustrations/styles/official?articleId=speckled-band')
    ]).then(async ([selectionResult, slotResult, styleResult]) => {
      if (cancelled) return;
      setSelections(selectionResult.selections);
      setOfficialSlots(slotResult.slots);
      setStyle(styleResult.style);
      setActiveId(selectionResult.selections[0]?.id || '');
      setFocusDrafts(Object.fromEntries(selectionResult.selections.map((item) => [item.id, item.promptExcerpt])));
      await Promise.all(selectionResult.selections.map(loadVersions));
    }).catch((nextError) => {
      if (!cancelled) setError(nextError instanceof Error ? nextError.message : '制作台加载失败');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  async function generateCandidates(count: number) {
    if (!active || generating) return;
    const focus = (focusDrafts[active.id] || '').trim();
    if (!focus) {
      setError('请填写画面焦点。');
      return;
    }
    setGenerating(true);
    setError('');
    setNotice(`正在生成 ${count} 张候选图…`);
    try {
      for (let index = 0; index < count; index += 1) {
        await requestJson(`/api/illustrations/units/${encodeURIComponent(active.unit.id)}/versions`, {
          method: 'POST',
          body: JSON.stringify({
            promptMode: 'official',
            finalPrompt: buildPrompt(style, active, focus),
            styleVersionId: style?.id || null
          })
        });
      }
      await loadVersions(active);
      setNotice('候选图已生成。请选择一张设为官方基准。');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '候选图生成失败');
      setNotice('');
    } finally {
      setGenerating(false);
    }
  }

  async function promoteSelection() {
    if (!active || saving) return;
    const versionId = selectedVersions[active.id];
    if (!versionId) {
      setError('请先选择一张候选图。');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const { slot } = await requestJson<{ slot: OfficialSlot }>('/api/illustrations/official-slots', {
        method: 'POST',
        body: JSON.stringify({
          selectionId: active.id,
          versionId,
          promptExcerpt: focusDrafts[active.id]
        })
      });
      setOfficialSlots((current) => [...current.filter((item) => item.unitId !== slot.unitId), slot]);
      setNotice('已写入官方基准版本。图片会显示在整个段落之后。');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '官方图保存失败');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <main className="studio-state"><span className="studio-spinner" /><p>正在准备官方插图任务…</p></main>;
  }

  if (error && selections.length === 0) {
    return (
      <main className="studio-state studio-error-state">
        <strong>制作台暂时无法打开</strong>
        <p>{error}</p>
        <a href="/">返回阅读网站并登录</a>
      </main>
    );
  }

  return (
    <main className="official-studio">
      <header className="studio-header">
        <div>
          <span>THE SPECKLED BAND · OFFICIAL ART</span>
          <h1>官方插图制作台</h1>
          <p>框选片段决定画面，完整段落决定图片落位。</p>
        </div>
        <div className="studio-progress"><strong>{completed}/{selections.length}</strong><span>已定稿</span></div>
      </header>

      <div className="studio-layout">
        <aside className="studio-task-list" aria-label="官方插图任务">
          {selections.map((selection, index) => {
            const done = officialSlots.some(
              (slot) => slot.chapterId === selection.chapterId && slot.paragraphIndex === selection.paragraphIndex
            );
            return (
              <button
                type="button"
                key={selection.id}
                className={`${active?.id === selection.id ? 'active' : ''}${done ? ' done' : ''}`}
                onClick={() => { setActiveId(selection.id); setError(''); setNotice(''); }}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div><strong>{selection.title}</strong><small>{selection.chapterId} · 第 {selection.paragraphIndex + 1} 段后</small></div>
                <i>{done ? '已定稿' : '待制作'}</i>
              </button>
            );
          })}
        </aside>

        {active && (
          <section className="studio-workspace">
            <div className="studio-context-card">
              <div className="studio-context-heading">
                <div><span>画面焦点</span><h2>{active.title}</h2></div>
                <strong>固定落位：完整第 {active.paragraphIndex + 1} 段之后</strong>
              </div>
              <label>
                <span>用于生成的片段，可在生成前微调</span>
                <textarea
                  rows={4}
                  value={focusDrafts[active.id] || ''}
                  onChange={(event) => setFocusDrafts((current) => ({ ...current, [active.id]: event.target.value }))}
                />
              </label>
              <details>
                <summary>查看所属完整段落</summary>
                <p>{active.unit.sourceText}</p>
              </details>
              <div className="studio-placement-note">
                <span aria-hidden="true">↓</span>
                <p><strong>图片不会插在框选文字处。</strong>无论焦点来自段首、段中还是段尾，最终都渲染在上面整段文字结束之后。</p>
              </div>
            </div>

            <div className="studio-candidate-header">
              <div><span>候选画面</span><strong>{activeVersions.length} 个个人候选版本</strong></div>
              <div>
                <button type="button" onClick={() => void generateCandidates(1)} disabled={generating}>生成 1 张</button>
                <button type="button" className="primary" onClick={() => void generateCandidates(3)} disabled={generating}>
                  {generating ? '生成中…' : '生成 3 张候选'}
                </button>
              </div>
            </div>

            {activeVersions.length > 0 ? (
              <div className="studio-candidate-grid">
                {activeVersions.map((version) => {
                  const selected = selectedVersions[active.id] === version.id;
                  const official = activeOfficial?.imageUrl === version.imageUrl;
                  return (
                    <button
                      type="button"
                      key={version.id}
                      className={`${selected ? 'selected' : ''}${official ? ' official' : ''}`}
                      onClick={() => setSelectedVersions((current) => ({ ...current, [active.id]: version.id }))}
                    >
                      <img src={version.imageUrl} alt={`${active.title} 候选版本 ${version.versionNumber}`} />
                      <span><strong>V{version.versionNumber}</strong><small>{official ? '当前官方图' : version.status === 'private' ? '私人候选' : version.status}</small></span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="studio-empty"><strong>还没有候选图</strong><p>先确认上方画面焦点，然后生成一张或三张候选。</p></div>
            )}

            <footer className="studio-action-bar">
              <div>{error ? <span className="error">{error}</span> : <span>{notice || '选定后只会更新官方基准槽位，不改变段落文字。'}</span>}</div>
              <button type="button" onClick={() => void promoteSelection()} disabled={saving || !selectedVersions[active.id]}>
                {saving ? '正在写入…' : '设为官方基准图'}
              </button>
            </footer>
          </section>
        )}
      </div>
    </main>
  );
}

createRoot(document.getElementById('official-studio-root')!).render(
  <React.StrictMode><OfficialStudio /></React.StrictMode>
);

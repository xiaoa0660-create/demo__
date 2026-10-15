'use client';
import Link from 'next/link';
import { useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  Eye,
  Feather,
  LockKeyhole,
  Pause,
  Pencil,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { api, useApp } from '@/components/app-provider';
import { Memory, scenes, skillLabels } from '@/lib/domain';
import { Dialog } from '@/components/settings';

const statusLabels = {
  observing: '正在观察',
  supported: '有较稳定证据',
  improved: '已明显改善',
  disputed: '用户已纠正',
};
export default function MemoryPage() {
  const { data, refresh, toast, setSettings } = useApp();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Memory | null>(null);
  const [deleting, setDeleting] = useState<Memory | null>(null);
  const [correction, setCorrection] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const memories = data?.memories || [];
  const visible = memories.filter(
    (m) =>
      (filter === 'all' || m.status === filter) &&
      `${m.hypothesis}${skillLabels[m.skill_key]}`.includes(search),
  );
  async function action(memory: Memory, action: 'confirm' | 'correct' | 'freeze' | 'delete') {
    setBusy(true);
    setError('');
    try {
      await api(`memory/${memory.id}`, 'PATCH', {
        action,
        correction: action === 'correct' ? correction : undefined,
      });
      await refresh();
      setEditing(null);
      setDeleting(null);
      toast(
        action === 'correct'
          ? '你的纠正已记录；旧判断已冻结，不会静默复活。'
          : action === 'delete'
            ? '记忆已删除，也会停止后续检索。'
            : action === 'freeze'
              ? '已冻结这条记忆，后续不会用它指导训练。'
              : '已记录你的确认，继续收集证据。',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function toggle() {
    setBusy(true);
    try {
      await api('profile', 'PATCH', { consent_memory: !data?.profile.consent_memory });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">A NOTEBOOK THAT GETS TO KNOW YOU</div>
          <h1>记住线索，不定义你。</h1>
          <p>这是一本关于你的观察笔记。每一个理解，都可以被你纠正。</p>
        </div>
        <button className="button secondary" onClick={() => setSettings(true)}>
          <ShieldCheck size={16} />
          管理我的数据
        </button>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      <section className="memory-intro">
        <div className="memory-book" aria-hidden="true">
          <BookOpen size={47} strokeWidth={1} />
          <span />
          <span />
        </div>
        <div>
          <span className="eyebrow">UNDERSTANDING, NOT LABELS</span>
          <h2>一点点了解，始终由你掌握。</h2>
          <p>
            只有带原话证据的观察，才会留在这里。一次表现不是标签，提示后的改善也不等于独立掌握。
          </p>
        </div>
        <div className="memory-switch">
          <span>个性化记忆</span>
          <button
            role="switch"
            aria-checked={data?.profile.consent_memory || false}
            aria-label="个性化记忆"
            className={`toggle ${data?.profile.consent_memory ? 'on' : ''}`}
            disabled={busy || !data?.capabilities.signed_in}
            onClick={() => void toggle()}
          >
            <span />
          </button>
          <small>{data?.profile.consent_memory ? '正在温和地观察' : '已暂停采集与检索'}</small>
        </div>
      </section>
      <div className="memory-toolbar">
        <div className="filter-tabs">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
            全部观察 <span>{memories.length}</span>
          </button>
          {Object.entries(statusLabels).map(([key, label]) => (
            <button
              key={key}
              className={filter === key ? 'active' : ''}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label="搜索记忆"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="找一条观察…"
          />
        </label>
      </div>
      {visible.length === 0 ? (
        <section className="empty-state memory-empty">
          <div className="memory-empty-art">
            <div className="paper-sheet">
              <span />
              <span />
              <span />
              <span />
            </div>
            <span className="paper-dot mint" />
            <span className="paper-dot sun" />
            <Feather size={39} strokeWidth={1.1} />
          </div>
          <h2>{memories.length ? '暂时没有符合条件的观察。' : '留白，是了解一个人的开始。'}</h2>
          <p>
            {memories.length
              ? '试试其他筛选，或换一个关键词。'
              : '完成一次练习后，我们会保留带出处的观察。等证据足够，再谨慎地形成理解。'}
          </p>
          {!memories.length && (
            <Link href="/coach" className="button secondary">
              从一次真实表达开始
              <ArrowRight size={16} />
            </Link>
          )}
        </section>
      ) : (
        <div className="memory-grid">
          {visible.map((m) => (
            <article className={`memory-card ${m.status}`} key={m.id}>
              <div className="memory-card-top">
                <span
                  className={`tag ${m.status === 'improved' ? 'mint' : m.status === 'disputed' ? 'coral' : 'sand'}`}
                >
                  <span className="status-dot" />
                  {statusLabels[m.status]}
                </span>
                {m.is_frozen && (
                  <span className="small muted">
                    <Pause size={12} />
                    已冻结
                  </span>
                )}
                <span className="memory-skill">{skillLabels[m.skill_key]}</span>
              </div>
              <h2>{m.hypothesis}</h2>
              <div className="memory-suggestion">
                <span>下一次，可以试试</span>
                <p>{m.next_action}</p>
              </div>
              <div className="evidence-count">
                <Eye size={14} />
                {m.evidence.length} 条原话证据
                <span>
                  {scenes[m.scene].label} · {m.confidence_band === 'medium' ? '中等置信' : '待验证'}
                </span>
              </div>
              <details>
                <summary>
                  我为什么这样理解
                  <ChevronDown size={15} />
                </summary>
                {m.evidence.map((e, i) => (
                  <div key={`${e.attempt_id}:${i}`} className="evidence-item">
                    <span className="small muted">
                      {new Date(e.created_at).toLocaleDateString('zh-CN')} ·{' '}
                      {e.source === 'local'
                        ? '本地观察，未评测'
                        : e.independent
                          ? '独立表达'
                          : '辅助练习'}{' '}
                      · {e.polarity === 'contradicts' ? '反向证据' : '观察来源'}
                    </span>
                    <blockquote>「{e.quote}」</blockquote>
                    <Link href={`/coach?session=${e.session_id}`} className="text-button">
                      回到这次表达
                      <ArrowRight size={13} />
                    </Link>
                  </div>
                ))}
              </details>
              <div className="memory-actions">
                <button onClick={() => void action(m, 'confirm')} disabled={busy}>
                  <Check size={14} />
                  确认
                </button>
                <button
                  onClick={() => {
                    setEditing(m);
                    setCorrection('');
                  }}
                >
                  <Pencil size={14} />
                  纠正
                </button>
                <button onClick={() => void action(m, 'freeze')} disabled={busy || m.is_frozen}>
                  <Pause size={14} />
                  冻结
                </button>
                <button aria-label="删除这条记忆" onClick={() => setDeleting(m)}>
                  <Trash2 size={14} />
                </button>
              </div>
              <span className="memory-updated">
                更新于 {new Date(m.updated_at).toLocaleDateString('zh-CN')}
              </span>
            </article>
          ))}
        </div>
      )}
      <section className="memory-principles">
        <div>
          <span className="principle-icon">
            <BookOpen size={19} />
          </span>
          <h3>每条观察，都有来处</h3>
          <p>回到那一次表达，查看原话与场景。</p>
        </div>
        <div>
          <span className="principle-icon">
            <CircleHelp size={19} />
          </span>
          <h3>不确定，也如实记录</h3>
          <p>至少跨两天、三个独立样本，才升级假设。</p>
        </div>
        <div>
          <span className="principle-icon">
            <LockKeyhole size={19} />
          </span>
          <h3>你的理解，优先于 AI</h3>
          <p>纠正、冻结、删除，决定哪些被记住。</p>
        </div>
      </section>
      {editing && (
        <Dialog title="你的理解，才是最重要的" onClose={() => setEditing(null)}>
          <p className="muted">纠正后，旧判断会冻结。系统不会再把它当作确定事实。</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(editing, 'correct');
            }}
          >
            <label htmlFor="memory-correction">你希望如何纠正这条观察？</label>
            <textarea
              id="memory-correction"
              value={correction}
              onChange={(e) => setCorrection(e.target.value)}
              rows={5}
              maxLength={500}
              placeholder="例如：那次是在探索新想法，并不是所有场景都这样。"
              required
            />
            <div className="button-row">
              <button className="button primary" disabled={busy || !correction.trim()}>
                保存纠正并冻结旧判断
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {deleting && (
        <Dialog title="删除这条记忆？" onClose={() => setDeleting(null)}>
          <p>
            这条观察及其版本将被删除，后续训练不再检索，也不会自动重建同一判断。原始练习仍保留在成长页。
          </p>
          <div className="button-row">
            <button className="button secondary" onClick={() => setDeleting(null)}>
              保留
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() => void action(deleting, 'delete')}
            >
              确认删除记忆
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

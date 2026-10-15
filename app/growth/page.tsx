'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  AudioLines,
  ChevronDown,
  Clock3,
  EyeOff,
  Feather,
  History,
  Leaf,
  Sprout,
  Target,
  Trash2,
} from 'lucide-react';
import { api, useApp } from '@/components/app-provider';
import { Scene, scenes, Session, skillLabels } from '@/lib/domain';
import type { growth } from '@/lib/rules';
import { Dialog } from '@/components/settings';

export default function GrowthPage() {
  const { data, refresh, toast } = useApp();
  const router = useRouter();
  const [scene, setScene] = useState<Scene>('work');
  const [days, setDays] = useState(30);
  const [metrics, setMetrics] = useState<ReturnType<typeof growth> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [viewed, setViewed] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<Session | null>(null);
  const completed = data?.sessions.filter((s) => s.status === 'completed') || [];
  useEffect(() => {
    if (!data?.capabilities.signed_in) return;
    let active = true;
    setMetrics(null);
    api<ReturnType<typeof growth>>(`growth?scene=${scene}&window=${days}`)
      .then((value) => {
        if (active) setMetrics(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [scene, days, data]);
  async function challenge(s: Session) {
    setBusy(true);
    setError('');
    try {
      const next = await api<Session>('sessions', 'POST', {
        mode: s.mode,
        scene: s.scene,
        idempotency_key: crypto.randomUUID(),
        challenge_of: s.id,
        challenge_blinded: !viewed.has(s.id),
      });
      await refresh();
      router.push(`/coach?session=${next.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api(`sessions/${deleting.id}`, 'DELETE');
      localStorage.removeItem(`fp-draft:${deleting.id}`);
      await refresh();
      setDeleting(null);
      toast('原文及关联的派生证据已清理。');
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
          <div className="eyebrow">LITTLE BY LITTLE, MORE LIKE YOU</div>
          <h1>成长，有自己的节奏。</h1>
          <p>不用每天证明自己。真实的变化，藏在一次次表达里。</p>
        </div>
        <Link className="button primary" href="/coach">
          <AudioLines size={16} />
          开始一次练习
        </Link>
      </div>
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      <section className="growth-banner">
        <div>
          <span className="pill-label">
            <Sprout size={15} />
            阶段观察
          </span>
          <h2>
            {metrics && metrics.sample_count >= 5
              ? '你的独立表达，正在留下证据。'
              : '还在建立基线，慢慢来就好。'}
          </h2>
          <p>
            {metrics && metrics.sample_count >= 5
              ? `最近 ${days} 天，${scenes[scene].label}场景积累了 ${metrics.sample_count} 个可比的有效独立样本。`
              : '至少积累 5 次同场景、相似难度的有效独立尝试后，我们再一起看趋势。'}
          </p>
          <span className="small muted">提示后的改写、本地观察，不会被算成独立能力增长。</span>
        </div>
        <div className="growth-plant" aria-hidden="true">
          <svg viewBox="0 0 180 170">
            <path
              d="M90 144V63M90 105Q51 112 49 73Q84 71 90 105M91 82Q132 88 136 39Q99 43 91 82"
              fill="#b8d5b2"
              stroke="#718b67"
              strokeWidth="1.5"
            />
            <path d="M78 147q13-8 25 0" fill="none" stroke="#c7ad85" strokeWidth="2" />
            <circle cx="39" cy="39" r="13" fill="#ffdc82" />
            <circle cx="144" cy="123" r="5" fill="#efbdaa" />
            <path d="M56 150h71" stroke="#d7cdbb" strokeDasharray="3 4" />
          </svg>
          <span>A LITTLE MORE, EVERY TIME</span>
        </div>
      </section>
      <div className="stats-grid">
        <section>
          <span>
            <Feather size={16} />
            留下的练习
          </span>
          <strong>
            {completed.length}
            <small>次</small>
          </strong>
          <p>每一次，都是你自己的声音</p>
        </section>
        <section>
          <span>
            <EyeOff size={16} />
            有效独立样本
          </span>
          <strong>
            {metrics?.sample_count ?? '—'}
            <small>次</small>
          </strong>
          <p>当前场景 · 难度 1 · 最近 {days} 天</p>
        </section>
        <section>
          <span>
            <Target size={16} />
            独立表达成功率
          </span>
          <strong>
            {metrics?.success_rate === null || !metrics ? '—' : `${metrics.success_rate}%`}
          </strong>
          <p>
            {metrics?.success_rate === null || !metrics
              ? '样本足够后再看，暂不作结论'
              : '仅统计未获提示的首次有效尝试'}
          </p>
        </section>
      </div>
      <section className="panel growth-dimensions">
        <div className="section-heading">
          <div>
            <h2>看看，哪些地方在变清晰</h2>
            <p className="small muted">只比较同场景、同难度的有效样本。</p>
          </div>
          <div className="filter-selects">
            <select
              aria-label="成长场景"
              value={scene}
              onChange={(e) => setScene(e.target.value as Scene)}
            >
              {Object.entries(scenes).map(([key, s]) => (
                <option key={key} value={key}>
                  {s.label}
                </option>
              ))}
            </select>
            <select
              aria-label="时间范围"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              <option value={30}>最近 30 天</option>
              <option value={90}>最近 90 天</option>
            </select>
          </div>
        </div>
        <div className="dimension-grid">
          {(['core', 'organization', 'causality', 'recall'] as const).map((skill, i) => {
            const metric = metrics?.dimensions.find((d) => d.skill === skill);
            const ready = metric && metric.sample_count >= 5;
            return (
              <div key={skill} className="dimension">
                <span className={`dimension-dot color-${i}`} />
                <h3>{skillLabels[skill]}</h3>
                <p>
                  {
                    [
                      '找到属于自己的判断',
                      '让信息围绕一个重点',
                      '把依据与结论连起来',
                      '合上笔记，也能讲清楚',
                    ][i]
                  }
                </p>
                <div className="dimension-track">
                  <i
                    style={{
                      width: ready ? `${(metric.passed / metric.sample_count) * 100}%` : '0%',
                    }}
                  />
                </div>
                <span>
                  {ready
                    ? `${metric.passed} / ${metric.sample_count} 次本轮达标`
                    : `${metric?.sample_count || 0} 个适用样本 · 继续观察`}
                </span>
              </div>
            );
          })}
        </div>
      </section>
      {metrics && metrics.series.length > 0 && (
        <section className="panel comparable-series">
          <h2>可比表达的变化</h2>
          <p className="small muted">
            {scenes[scene].label} · 难度 1 · 最近 {days}{' '}
            天。每个点对应一次真实独立尝试，点击查看证据。
          </p>
          <div className="series-points">
            {metrics.series.map((sample) => (
              <Link
                key={sample.session_id}
                href={`/coach?session=${sample.session_id}`}
                className={sample.passed ? 'passed' : 'pending'}
              >
                <span />
                <strong>{sample.passed ? '本轮达标' : '待改进'}</strong>
                <small>
                  {new Date(sample.observed_at).toLocaleDateString('zh-CN', {
                    month: 'numeric',
                    day: 'numeric',
                  })}
                </small>
              </Link>
            ))}
          </div>
        </section>
      )}
      <div className="section-heading history-heading">
        <h2>
          <History size={19} />
          我的练习时间线
        </h2>
        <span>回看走过的路，也挑战过去的自己</span>
      </div>
      {completed.length === 0 ? (
        <section className="empty-state history-empty">
          <div className="empty-notebook">
            <span />
            <span />
            <Feather size={29} />
          </div>
          <h2>这里，会慢慢长出你的故事。</h2>
          <p>完成第一段练习，原始表达、重述与观察证据就会留在这里。</p>
          <Link className="button secondary" href="/coach">
            留下第一段表达
            <ArrowRight size={16} />
          </Link>
        </section>
      ) : (
        <div className="history-list">
          {[...completed].reverse().map((s) => (
            <article key={s.id} className="history-card">
              <div className="history-dot" />
              <div className="history-card-top">
                <div>
                  <span className="small muted">
                    {new Intl.DateTimeFormat('zh-CN', {
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    }).format(new Date(s.created_at))}{' '}
                    · {scenes[s.scene].label}
                  </span>
                  <h3>
                    {s.topic ||
                      `${s.mode === 'think' ? '理一理' : '说清楚'} · ${scenes[s.scene].label}`}
                  </h3>
                </div>
                <span className="tag mint">{s.attempts.length} 轮真实表达</span>
              </div>
              <div className="history-meta">
                <span>
                  <Leaf size={14} />
                  {s.attempts.at(-1)?.analysis?.source === 'local'
                    ? '本地结构观察'
                    : '含结构化评测'}
                </span>
                <span>
                  <EyeOff size={14} />
                  {s.attempts.some((a) => a.is_recall) ? '完成练习复述' : '首次尝试已留存'}
                </span>
              </div>
              <details
                onToggle={(e) => {
                  if (e.currentTarget.open) setViewed((v) => new Set(v).add(s.id));
                }}
              >
                <summary>
                  展开原文与前后对比 <ChevronDown size={15} />
                </summary>
                <div className="comparison">
                  {s.attempts.map((a) => (
                    <div key={a.id}>
                      <span className="small muted">
                        第 {a.round_no} 轮 · 提示等级 {a.assistance_level}
                      </span>
                      <p>{a.confirmed_text}</p>
                    </div>
                  ))}
                </div>
                <Link className="text-button" href={`/coach?session=${s.id}`}>
                  查看完整证据与评测
                  <ArrowRight size={14} />
                </Link>
              </details>
              <div className="history-actions">
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void challenge(s)}
                >
                  <RotateIcon />
                  {Date.now() - Date.parse(s.completed_at!) >= 86400000 && !viewed.has(s.id)
                    ? '不看旧答案，延迟挑战'
                    : '再练一次（不计首次独立）'}
                </button>
                <button
                  className="icon-button delete-icon"
                  aria-label="删除这次练习"
                  onClick={() => setDeleting(s)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {deleting && (
        <Dialog title="删除这次练习？" onClose={() => setDeleting(null)}>
          <p>原文、评测及引用它的 Memory 派生内容会一并清理，不能撤销。</p>
          <div className="button-row">
            <button className="button secondary" onClick={() => setDeleting(null)}>
              保留
            </button>
            <button className="button danger" disabled={busy} onClick={() => void remove()}>
              确认删除这次练习
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
function RotateIcon() {
  return <Clock3 size={15} />;
}

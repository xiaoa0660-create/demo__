import { randomUUID } from 'node:crypto';
import {
  Analysis,
  analysisSchema,
  Attempt,
  localDate,
  Memory,
  memoryKey,
  ModelAnalysis,
  Scene,
  Session,
  Skill,
  skillLabels,
  Workspace,
} from './domain';

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'REQUEST_FAILED',
  ) {
    super(message);
  }
}
export function focusState(a: ModelAnalysis): Analysis['focus_state'] {
  if (a.uncertainty === 'high') return 'uncertain';
  if (!a.core_id) return a.points.length > 2 ? 'scattered' : 'unformed';
  if (a.irrelevant_point_ratio > 0.4) return 'scattered';
  if (a.required_relations_satisfied && a.recipient_goal_clear && a.relations.length > 0)
    return 'focused';
  return 'structured';
}
export function validateAnalysis(
  raw: unknown,
  text: string,
  mode: Session['mode'],
  scene: Scene,
  isRecall = false,
): ModelAnalysis {
  const a = analysisSchema.parse(raw);
  const ids = new Set(a.points.map((p) => p.id));
  if (ids.size !== a.points.length || (a.core_id && !ids.has(a.core_id)))
    throw new Error('Invalid core/point identifiers');
  const quotes = [
    ...a.points.map((p) => p.quote),
    ...a.relations.map((r) => r.quote),
    a.issue_quote,
    ...a.scores.filter((s) => s.score !== null).map((s) => s.quote),
  ];
  if (quotes.some((q) => !q || !text.includes(q)))
    throw new Error('Evidence must be an exact quote from confirmed text');
  if (a.relations.some((r) => !ids.has(r.from) || !ids.has(r.to) || r.from === r.to))
    throw new Error('Invalid relation');
  if (new Set(a.scores.map((s) => s.skill)).size !== 5)
    throw new Error('Duplicate rubric dimension');
  // Applicability is enforced by the server, not left to model compliance.
  a.scores = a.scores.map((s) =>
    (s.skill === 'action' && scene !== 'work') ||
    (s.skill === 'recall' && !isRecall) ||
    (s.skill === 'core' && mode === 'think' && !isRecall)
      ? { ...s, score: null, quote: '', reason: '当前探索/沟通场景不适用此项。' }
      : s,
  );
  return a;
}
export function wrapAnalysis(
  a: ModelAnalysis,
  source: Analysis['source'],
  model: string,
  text: string,
): Analysis {
  return {
    ...a,
    id: randomUUID(),
    source,
    model,
    prompt_version: 'firstpoint-1.0',
    rubric_version: 'scenario-1.0',
    focus_state: focusState(a),
    evidence_spans: [...new Set([a.issue_quote, ...a.points.map((p) => p.quote)])].map((q) => ({
      start: text.indexOf(q),
      end: text.indexOf(q) + q.length,
      quote: q,
    })),
    audio_metrics: 'unavailable',
    created_at: new Date().toISOString(),
  };
}
export function localObservation(text: string, session: Session): Analysis {
  const pieces = text
    .match(/[^，。！？；\n,!?;]+[，。！？；,!?;]?/g)
    ?.map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 5) || [text];
  const points: ModelAnalysis['points'] = pieces.map((p, i) => ({
    id: `p${i + 1}`,
    type: /建议|我认为|我倾向|决定/.test(p)
      ? 'claim'
      : /不确定|不知道|是不是|要不要|？/.test(p)
        ? 'question'
        : /因为|由于|所以/.test(p)
          ? 'reason'
          : /请.*确认|希望/.test(p)
            ? 'action'
            : 'fact',
    text: p.length > 26 ? p.slice(0, 26) + '…' : p,
    quote: p,
  }));
  const core = points.find((p) => p.type === 'claim');
  const question = points.find((p) => p.type === 'question');
  const exploring = session.mode === 'think';
  const skill: Skill = exploring
    ? 'organization'
    : !core
      ? 'core'
      : session.scene === 'work' && !/请|确认|希望/.test(text)
        ? 'action'
        : 'causality';
  const a: ModelAnalysis = {
    points,
    relations: [],
    core_id: core?.id || null,
    uncertainty: text.length < 10 ? 'high' : 'medium',
    irrelevant_point_ratio: 0,
    required_relations_satisfied: false,
    recipient_goal_clear: /请|确认|希望/.test(text),
    primary_skill: skill,
    issue_title: exploring
      ? '先找到你最想探索的那个点'
      : !core
        ? '试着说出你此刻的判断'
        : '让判断与依据连起来',
    issue_quote: question?.quote || core?.quote || points[0].quote,
    why: '这是根据原文分句与显式词语得到的本地观察，不能代替 AI 对语义和情境的评估。',
    next_action: exploring
      ? '这些线索里，哪一个是你现在最想弄明白的？'
      : !core
        ? '你现在倾向怎么做？先用自己的话说出这个判断。'
        : '支持你这个判断的最关键依据是什么？',
    scores: (Object.keys(skillLabels) as Skill[]).map((skill) => ({
      skill,
      score: null,
      quote: '',
      reason: 'AI 尚未连接，未进行能力评测。',
    })),
  };
  return wrapAnalysis(a, 'local', 'local-observation-1', text);
}
export function eligibility(state: Workspace, session: Session, text: string) {
  const first = session.attempts.length === 0;
  const unaided = session.hints.length === 0;
  const earlier = state.sessions
    .filter((s) => s.id !== session.id)
    .flatMap((s) => s.attempts.map((a) => ({ s, a })));
  const seen = earlier.some(
    ({ s, a }) =>
      s.scene === session.scene &&
      (a.confirmed_text.trim() === text.trim() || (s.topic !== '' && s.topic === session.topic)),
  );
  const prior = state.sessions.find((s) => s.id === session.challenge_of);
  return {
    independent_eligible:
      first && unaided && !session.quick_advice && !session.challenge_of && !seen,
    delayed_recall_eligible:
      first &&
      unaided &&
      !!prior?.completed_at &&
      session.challenge_blinded &&
      Date.now() - Date.parse(prior.completed_at) >= 86400000,
    assistance_level: Math.max(0, ...session.hints.map((h) => h.level)),
    answer_revealed: session.hints.some((h) => h.level === 3),
  };
}
export function passed(a: Attempt) {
  if (!a.analysis || a.analysis.source !== 'openai' || a.analysis.uncertainty === 'high')
    return null;
  const scores = a.analysis.scores.filter((s) => s.score !== null);
  return scores.length ? scores.every((s) => s.score === 2) : null;
}
export function rebuildMemories(state: Workspace) {
  if (!state.profile.consent_memory) return;
  for (const scene of ['work', 'interview', 'opinion', 'free'] as Scene[]) {
    for (const skill of Object.keys(skillLabels) as Skill[]) {
      const key = `${scene}:${skill}`;
      if (state.suppressed_memories.includes(key)) continue;
      const existing = state.memories.find((m) => memoryKey(m) === key);
      if (existing?.is_frozen || existing?.status === 'disputed') continue;
      const candidates = state.sessions
        .filter((s) => s.status === 'completed' && s.scene === scene)
        .flatMap((s) =>
          s.attempts
            .filter(
              (a) =>
                a.analysis?.primary_skill === skill ||
                (existing &&
                  a.analysis?.source === 'openai' &&
                  a.analysis.scores.some((score) => score.skill === skill && score.score !== null)),
            )
            .map((a) => ({ s, a })),
        );
      if (!candidates.length) continue;
      const evidence: Memory['evidence'] = candidates.map(({ s, a }) => ({
        session_id: s.id,
        attempt_id: a.id,
        quote: a.analysis!.issue_quote,
        independent: a.independent_eligible,
        source: a.analysis!.source,
        polarity:
          a.analysis!.scores.find((score) => score.skill === skill)?.score === 2
            ? 'contradicts'
            : 'supports',
        created_at: a.created_at,
      }));
      const independent = candidates.filter(
        ({ a }) =>
          a.independent_eligible &&
          a.analysis?.source === 'openai' &&
          a.analysis.uncertainty !== 'high' &&
          a.analysis.scores.find((score) => score.skill === skill)?.score !== null,
      );
      const unique = [
        ...new Map(
          independent.map((c) => [
            `${localDate(c.a.created_at, state.profile.timezone)}:${c.s.task_key}`,
            c,
          ]),
        ).values(),
      ];
      const enough =
        unique.length >= 3 &&
        new Set(unique.map((c) => localDate(c.a.created_at, state.profile.timezone))).size >= 2 &&
        new Set(unique.map((c) => c.s.task_key)).size >= 2;
      const recent = unique.slice(-3);
      const bad = recent.filter(
        ({ a }) => (a.analysis!.scores.find((s) => s.skill === skill)?.score ?? 2) < 2,
      ).length;
      const last = candidates.at(-1)!.a.analysis!;
      const status =
        enough && bad === 3 ? 'supported' : enough && bad === 0 ? 'improved' : 'observing';
      const next: Memory = {
        id: existing?.id || randomUUID(),
        skill_key: skill,
        scene,
        status,
        hypothesis:
          status === 'supported'
            ? `在${skillLabels[skill]}上，多次独立表达出现同类缺口，值得继续练习。`
            : status === 'improved'
              ? `最近的独立样本中，${skillLabels[skill]}已达本轮标准。`
              : `${skillLabels[skill]}：已收集训练片段，仍需独立样本验证。`,
        next_action: last.next_action,
        confidence_band: enough && (bad === 3 || bad === 0) ? 'medium' : 'low',
        is_frozen: false,
        evidence,
        updated_at: last.created_at,
      };
      if (existing && JSON.stringify(existing) === JSON.stringify(next)) continue;
      state.memory_versions.push({
        id: randomUUID(),
        memory_id: next.id,
        old_value: existing ? structuredClone(existing) : null,
        new_value: structuredClone(next),
        actor: 'system',
        reason: '根据可追溯训练证据更新；本地观察不升级能力假设。',
        created_at: new Date().toISOString(),
      });
      state.memories = state.memories.filter((m) => m.id !== next.id).concat(next);
    }
  }
}
export function removeSession(state: Workspace, id: string) {
  if (!state.sessions.some((s) => s.id === id)) throw new AppError(404, '找不到这次练习。');
  state.sessions = state.sessions.filter((s) => s.id !== id);
  // Drop all derived snapshots that could retain deleted text; reconstruct from remaining sources.
  const affected = state.memories.filter((m) => m.evidence.some((e) => e.session_id === id));
  const ids = new Set(affected.map((m) => m.id));
  state.memories = state.memories.filter((m) => !ids.has(m.id));
  state.memory_versions = state.memory_versions.filter(
    (v) =>
      !ids.has(v.memory_id) &&
      ![v.old_value, v.new_value].some((m) => m?.evidence.some((e) => e.session_id === id)),
  );
  for (const m of affected.filter((m) => m.is_frozen || m.status === 'disputed')) {
    if (!state.suppressed_memories.includes(memoryKey(m)))
      state.suppressed_memories.push(memoryKey(m));
  }
  for (const s of state.sessions) {
    if (s.challenge_of === id) s.challenge_of = null;
    s.hints = s.hints.map((h) =>
      h.memory_ids.some((mid) => ids.has(mid))
        ? { ...h, text: '关联记忆已删除，提示内容已清理。', memory_ids: [] }
        : h,
    );
  }
  rebuildMemories(state);
}
export function growth(state: Workspace, scene: Scene, days = 30) {
  const cutoff = Date.now() - days * 86400000;
  const all = state.sessions.filter(
    (s) =>
      s.scene === scene &&
      s.status === 'completed' &&
      s.difficulty === 1 &&
      Date.parse(s.created_at) >= cutoff,
  );
  const eligible = all.flatMap((s) =>
    s.attempts.filter((a) => a.independent_eligible && passed(a) !== null).map((a) => ({ s, a })),
  );
  const unique = [
    ...new Map(
      eligible.map((c) => [
        `${localDate(c.a.created_at, state.profile.timezone)}:${c.s.task_key}`,
        c,
      ]),
    ).values(),
  ];
  const recallSamples = all.flatMap((s) =>
    s.attempts
      .filter((a) => a.delayed_recall_eligible && passed(a) !== null)
      .map((a) => ({ s, a })),
  );
  const recalls = [
    ...new Map(
      recallSamples.map((c) => [
        `${localDate(c.a.created_at, state.profile.timezone)}:${c.s.task_key}`,
        c,
      ]),
    ).values(),
  ];
  return {
    scene,
    window_days: days,
    difficulty: 1,
    sample_count: unique.length,
    min_samples: 5,
    success_rate:
      unique.length >= 5
        ? Math.round((unique.filter((c) => passed(c.a)).length / unique.length) * 100)
        : null,
    dimensions: (Object.keys(skillLabels) as Skill[]).map((skill) => {
      const valid = (skill === 'recall' ? recalls : unique).filter(
        (c) => c.a.analysis!.scores.find((s) => s.skill === skill)?.score !== null,
      );
      return {
        skill,
        sample_count: valid.length,
        passed: valid.filter(
          (c) => c.a.analysis!.scores.find((s) => s.skill === skill)?.score === 2,
        ).length,
      };
    }),
    series:
      unique.length >= 5
        ? unique
            .slice(-20)
            .map((c) => ({ session_id: c.s.id, observed_at: c.a.created_at, passed: passed(c.a) }))
        : [],
    examples: unique.map((c) => c.s.id),
    delayed_recall_samples: recalls.length,
  };
}

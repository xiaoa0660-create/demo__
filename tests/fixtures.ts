import { randomUUID } from 'node:crypto';
import { Attempt, Session, skillLabels, Skill, Workspace, emptyWorkspace } from '../lib/domain';
import { localObservation } from '../lib/rules';

export const rawWork = '这批样本是0712的，标签只保留90天，现在标签匹配不上了，是不是要让他先暂停？';
export const revisedWork =
  '我建议先暂停0712这批标注，想请你确认。标签只保存近90天，现在无法匹配这批样本，继续标注的结果暂时用不上。';
export const rawThink =
  '很多AI产品看起来很有意思，但好像没有需求，然后竞品也很多，我有点不知道怎么判断。';
export function fixtureSession(overrides: Partial<Session> = {}): Session {
  return {
    id: randomUUID(),
    idempotency_key: randomUUID(),
    mode: 'speak',
    scene: 'work',
    topic: '',
    task_key: randomUUID(),
    difficulty: 1,
    status: 'draft',
    created_at: new Date().toISOString(),
    completed_at: null,
    attempts: [],
    hints: [],
    selected_point_id: null,
    point_corrections: {},
    removed_relations: [],
    challenge_of: null,
    challenge_blinded: true,
    quick_advice: false,
    feedback: null,
    transcripts: [],
    usage: { requests: 0, input_tokens: 0, output_tokens: 0 },
    ...overrides,
  };
}
export function fixtureAttempt(s: Session, text = rawWork, score: number | null = 0): Attempt {
  const analysis = localObservation(text, s);
  analysis.source = 'openai';
  analysis.model = 'test-fixture-not-a-live-evaluation';
  analysis.uncertainty = 'low';
  analysis.primary_skill = 'core';
  analysis.scores = (Object.keys(skillLabels) as Skill[]).map((skill) => ({
    skill,
    score: skill === 'recall' ? null : score,
    quote: text,
    reason: 'Fixture evidence',
  }));
  return {
    id: randomUUID(),
    idempotency_key: randomUUID(),
    round_no: 1,
    origin: 'text',
    confirmed_text: text,
    raw_asr_text: null,
    duration_ms: null,
    assistance_level: 0,
    answer_revealed: false,
    independent_eligible: true,
    delayed_recall_eligible: false,
    is_recall: false,
    created_at: s.created_at,
    analysis,
  };
}
export function evidenceState(count = 3, score = 0): Workspace {
  const state = emptyWorkspace();
  for (let i = 0; i < count; i++) {
    const created = new Date(Date.now() - (count - i) * 86400000).toISOString();
    const s = fixtureSession({
      created_at: created,
      completed_at: created,
      status: 'completed',
      topic: `topic-${i}`,
    });
    s.attempts.push(fixtureAttempt(s, rawWork, score));
    state.sessions.push(s);
  }
  return state;
}

import { describe, expect, it } from 'vitest';
import {
  eligibility,
  focusState,
  growth,
  localObservation,
  passed,
  rebuildMemories,
  removeSession,
  validateAnalysis,
  wrapAnalysis,
} from '../../lib/rules';
import { emptyWorkspace, memoryKey, relevantMemories } from '../../lib/domain';
import {
  evidenceState,
  fixtureAttempt,
  fixtureSession,
  rawThink,
  rawWork,
  revisedWork,
} from '../fixtures';

describe('evidence and focus', () => {
  it('never invents a claim for an exploratory question', () => {
    const s = fixtureSession({ mode: 'think' });
    const a = localObservation(rawThink, s);
    expect(a.core_id).toBeNull();
    expect(a.focus_state).toBe('scattered');
    expect(a.scores.every((s) => s.score === null)).toBe(true);
  });
  it('does not manufacture relations or audio metrics', () => {
    const a = localObservation(revisedWork, fixtureSession());
    expect(a.core_id).not.toBeNull();
    expect(a.relations).toEqual([]);
    expect(a.focus_state).toBe('structured');
    expect(a.audio_metrics).toBe('unavailable');
  });
  it('requires core, recipient and evidenced relations for focus', () => {
    const a = localObservation(revisedWork, fixtureSession());
    expect(focusState({ ...a, required_relations_satisfied: true })).toBe('structured');
    expect(
      focusState({
        ...a,
        required_relations_satisfied: true,
        recipient_goal_clear: true,
        relations: [{ from: 'p1', to: 'p2', type: 'supports', quote: revisedWork }],
      }),
    ).toBe('focused');
    expect(focusState({ ...a, uncertainty: 'high' })).toBe('uncertain');
  });
  it('validates exact UTF-16 spans including emoji', () => {
    const text = '🙂 我建议先暂停，想请你确认。';
    const a = localObservation(text, fixtureSession());
    for (const span of a.evidence_spans) expect(text.slice(span.start, span.end)).toBe(span.quote);
  });
  it('rejects invented quotes and invalid node references', () => {
    const a = localObservation(rawWork, fixtureSession());
    const {
      id,
      source,
      model,
      prompt_version,
      rubric_version,
      focus_state,
      evidence_spans,
      audio_metrics,
      created_at,
      ...modelOnly
    } = a;
    expect(() =>
      validateAnalysis({ ...modelOnly, issue_quote: '从未说过的内容' }, rawWork, 'speak', 'work'),
    ).toThrow();
    expect(() =>
      validateAnalysis({ ...modelOnly, core_id: 'missing' }, rawWork, 'speak', 'work'),
    ).toThrow();
  });
  it('enforces scene-specific N/A rubric dimensions', () => {
    const s = fixtureSession();
    const a = fixtureAttempt(s).analysis!;
    const {
      id,
      source,
      model,
      prompt_version,
      rubric_version,
      focus_state,
      evidence_spans,
      audio_metrics,
      created_at,
      ...raw
    } = a;
    const result = validateAnalysis(raw, rawWork, 'think', 'free');
    expect(
      result.scores
        .filter((s) => ['core', 'action', 'recall'].includes(s.skill))
        .every((s) => s.score === null),
    ).toBe(true);
  });
});
describe('independence', () => {
  it('quick advice is excluded even before an answer has been generated', () => {
    const s = fixtureSession({ quick_advice: true });
    expect(eligibility(emptyWorkspace(), s, rawWork).independent_eligible).toBe(false);
    expect(eligibility(emptyWorkspace(), s, rawWork).answer_revealed).toBe(false);
  });
  it('allows the first unaided attempt only', () => {
    const state = emptyWorkspace();
    const s = fixtureSession();
    expect(eligibility(state, s, rawWork).independent_eligible).toBe(true);
    s.attempts.push(fixtureAttempt(s));
    expect(eligibility(state, s, revisedWork).independent_eligible).toBe(false);
  });
  it('server hint logs override client claims', () => {
    const s = fixtureSession();
    s.hints.push({ level: 3, text: 'example', memory_ids: [], created_at: s.created_at });
    const e = eligibility(emptyWorkspace(), s, rawWork);
    expect(e.independent_eligible).toBe(false);
    expect(e.assistance_level).toBe(3);
    expect(e.answer_revealed).toBe(true);
  });
  it('same-topic and same-text repeats cannot become new independent tests', () => {
    const state = evidenceState(1);
    const s = fixtureSession();
    expect(eligibility(state, s, rawWork).independent_eligible).toBe(false);
    s.topic = state.sessions[0].topic;
    expect(eligibility(state, s, revisedWork).independent_eligible).toBe(false);
  });
  it('counts blinded 24h recall separately, never as first independent success', () => {
    const state = evidenceState(1);
    const s = fixtureSession({ challenge_of: state.sessions[0].id });
    const e = eligibility(state, s, revisedWork);
    expect(e.independent_eligible).toBe(false);
    expect(e.delayed_recall_eligible).toBe(true);
    s.challenge_blinded = false;
    expect(eligibility(state, s, revisedWork).delayed_recall_eligible).toBe(false);
  });
  it('does not claim same-day recall as delayed', () => {
    const state = evidenceState(1);
    state.sessions[0].completed_at = new Date().toISOString();
    const s = fixtureSession({ challenge_of: state.sessions[0].id });
    expect(eligibility(state, s, revisedWork).delayed_recall_eligible).toBe(false);
  });
});
describe('memory safeguards', () => {
  it('retains observation but needs three independent cross-day/task sources to promote', () => {
    const state = evidenceState(2);
    rebuildMemories(state);
    expect(state.memories[0].status).toBe('observing');
    const ready = evidenceState(3);
    rebuildMemories(ready);
    expect(ready.memories[0].status).toBe('supported');
    expect(ready.memories[0].evidence).toHaveLength(3);
  });
  it('same-day evidence and same-task evidence cannot promote', () => {
    const state = evidenceState();
    state.sessions.forEach((s) => {
      s.attempts[0].created_at = new Date().toISOString();
    });
    rebuildMemories(state);
    expect(state.memories[0].status).toBe('observing');
    const duplicate = evidenceState();
    duplicate.sessions.forEach((s) => {
      s.task_key = 'same';
    });
    rebuildMemories(duplicate);
    expect(duplicate.memories[0].status).toBe('observing');
  });
  it('assisted and offline samples never promote', () => {
    const state = evidenceState();
    state.sessions.forEach((s) => {
      s.attempts[0].independent_eligible = false;
    });
    rebuildMemories(state);
    expect(state.memories[0].status).toBe('observing');
    const local = evidenceState();
    local.sessions.forEach((s) => {
      s.attempts[0].analysis!.source = 'local';
    });
    rebuildMemories(local);
    expect(local.memories[0].status).toBe('observing');
  });
  it('keeps a correction frozen and excludes it from retrieval', () => {
    const state = evidenceState();
    rebuildMemories(state);
    const m = state.memories[0];
    m.status = 'disputed';
    m.is_frozen = true;
    m.hypothesis = '用户纠正';
    rebuildMemories(state);
    expect(state.memories[0].hypothesis).toBe('用户纠正');
    expect(relevantMemories(state, 'work')).toHaveLength(0);
  });
  it('does not resurrect deleted hypotheses', () => {
    const state = evidenceState();
    rebuildMemories(state);
    state.suppressed_memories.push(memoryKey(state.memories[0]));
    state.memories = [];
    rebuildMemories(state);
    expect(state.memories).toHaveLength(0);
  });
  it('removes source-derived summaries and audit snapshots on deletion', () => {
    const state = evidenceState();
    const marker = '唯一的私密测试原句';
    state.sessions[0].attempts[0].confirmed_text = marker;
    state.sessions[0].attempts[0].analysis!.issue_quote = marker;
    rebuildMemories(state);
    removeSession(state, state.sessions[0].id);
    expect(JSON.stringify(state)).not.toContain(marker);
    expect(state.memories[0].status).toBe('observing');
  });
  it('no duplicate memory evidence or versions on repeated completion', () => {
    const state = evidenceState();
    rebuildMemories(state);
    const original = JSON.stringify(state);
    rebuildMemories(state);
    expect(JSON.stringify(state)).toBe(original);
  });
  it('memory can be switched off without erasing existing data', () => {
    const state = evidenceState();
    state.profile.consent_memory = false;
    rebuildMemories(state);
    expect(state.memories).toEqual([]);
    expect(relevantMemories(state, 'work')).toEqual([]);
  });
  it('contradicting independent samples lower confidence', () => {
    const state = evidenceState();
    state.sessions[2].attempts[0].analysis!.scores.find((s) => s.skill === 'core')!.score = 2;
    rebuildMemories(state);
    expect(state.memories[0].status).toBe('observing');
    expect(state.memories[0].evidence.some((e) => e.polarity === 'contradicts')).toBe(true);
  });
});
describe('growth cohorts', () => {
  it('suppresses percentages below five valid samples', () => {
    expect(growth(evidenceState(4, 2), 'work').success_rate).toBeNull();
    expect(growth(evidenceState(5, 2), 'work').success_rate).toBe(100);
  });
  it('never mixes scenes, difficulty, assisted or local evaluations', () => {
    const state = evidenceState(6, 2);
    state.sessions[0].scene = 'free';
    state.sessions[1].difficulty = 2;
    state.sessions[2].attempts[0].independent_eligible = false;
    state.sessions[3].attempts[0].analysis!.source = 'local';
    expect(growth(state, 'work').sample_count).toBe(2);
  });
  it('treats low-confidence and no-applicable-score evaluations as unavailable', () => {
    const s = fixtureSession();
    const a = fixtureAttempt(s);
    a.analysis!.uncertainty = 'high';
    expect(passed(a)).toBeNull();
    a.analysis!.uncertainty = 'low';
    a.analysis!.scores.forEach((s) => {
      s.score = null;
    });
    expect(passed(a)).toBeNull();
  });
});

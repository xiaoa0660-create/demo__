import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureAttempt, fixtureSession, rawWork } from '../fixtures';

const mocks = vi.hoisted(() => ({ parse: vi.fn(), transcribe: vi.fn() }));
vi.mock('openai', () => ({
  default: class TestOpenAI {
    static APIError = class extends Error {
      status = 500;
    };
    responses = { parse: mocks.parse };
    audio = { transcriptions: { create: mocks.transcribe } };
  },
}));
import { analyze, coach, transcribe } from '../../lib/server/ai';

function response() {
  const a = fixtureAttempt(fixtureSession()).analysis!;
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
  return { output_parsed: raw, usage: { input_tokens: 100, output_tokens: 60 } };
}
describe('OpenAI orchestration (mocked transport; no live-model claims)', () => {
  beforeEach(() => {
    vi.stubEnv('OPENAI_API_KEY', 'test-only-not-a-real-key');
    vi.stubEnv('FIRSTPOINT_OPENAI_KEY', '');
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllEnvs());
  it('passes only confirmed text to isolated structured evaluation, with storage disabled', async () => {
    const s = fixtureSession();
    const a = fixtureAttempt(s);
    a.raw_asr_text = '错误转写';
    s.attempts = [a];
    s.hints = [
      { level: 1, text: 'PRIVATE MEMORY LABEL', memory_ids: ['private'], created_at: s.created_at },
    ];
    mocks.parse.mockResolvedValue(response());
    const result = await analyze(s, a.id);
    expect(result.analysis.source).toBe('openai');
    expect(result.usage.input_tokens).toBe(100);
    const request = mocks.parse.mock.calls[0][0];
    expect(request.store).toBe(false);
    expect(request.input).toContain(rawWork);
    expect(request.input).not.toContain('错误转写');
    expect(request.input).not.toContain('PRIVATE MEMORY LABEL');
  });
  it('retries invalid evidence once, then surfaces a recoverable error', async () => {
    const s = fixtureSession();
    s.attempts = [fixtureAttempt(s)];
    const invalid = response();
    invalid.output_parsed.issue_quote = '编造的证据';
    mocks.parse.mockResolvedValue(invalid);
    await expect(analyze(s, s.attempts[0].id)).rejects.toMatchObject({
      status: 502,
      code: 'AI_FAILED',
    });
    expect(mocks.parse).toHaveBeenCalledTimes(2);
  });
  it('does not silently use local observations after an online provider failure', async () => {
    const s = fixtureSession();
    s.attempts = [fixtureAttempt(s)];
    mocks.parse.mockRejectedValue(new Error('timeout'));
    await expect(analyze(s, s.attempts[0].id)).rejects.toMatchObject({ code: 'AI_FAILED' });
    expect(mocks.parse).toHaveBeenCalledTimes(2);
  });
  it('offline mode is explicit, unscored, and does not call the provider', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const s = fixtureSession();
    s.attempts = [fixtureAttempt(s)];
    const result = await analyze(s, s.attempts[0].id);
    expect(result.analysis.source).toBe('local');
    expect(result.analysis.scores.every((s) => s.score === null)).toBe(true);
    expect(mocks.parse).not.toHaveBeenCalled();
  });
  it('level one never reveals a complete example; level three tracks usage', async () => {
    const s = fixtureSession();
    s.attempts = [fixtureAttempt(s)];
    const first = await coach(s, 1, []);
    expect(first.text).toBe(s.attempts[0].analysis!.next_action);
    expect(mocks.parse).not.toHaveBeenCalled();
    mocks.parse.mockResolvedValue({
      output_parsed: { example: '仅基于原文的测试示范' },
      usage: { input_tokens: 90, output_tokens: 40 },
    });
    const third = await coach(s, 3, []);
    expect(third.usage.requests).toBe(1);
    expect(third.usage.output_tokens).toBe(40);
  });
  it('transcription keeps raw fillers and does not infer acoustic metrics', async () => {
    mocks.transcribe.mockResolvedValue({ text: '嗯，然后，然后我想先暂停。' });
    const result = await transcribe(
      new File(['test-fixture'], 'sample.webm', { type: 'audio/webm' }),
    );
    expect(result).toBe('嗯，然后，然后我想先暂停。');
    expect(mocks.transcribe.mock.calls[0][0].language).toBe('zh');
  });
  it('ASR timeout does not return a fabricated transcript', async () => {
    mocks.transcribe.mockRejectedValue(new Error('timeout'));
    await expect(transcribe(new File(['test'], 'sample.webm'))).rejects.toMatchObject({
      code: 'ASR_FAILED',
    });
  });
});

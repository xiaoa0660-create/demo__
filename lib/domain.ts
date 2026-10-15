import { z } from 'zod';

export const scenes = {
  work: {
    label: '工作同步',
    description: '让对方听懂，也知道下一步',
    prompt: '说一件你想同步的工作：发生了什么，希望对方做什么？',
    duration: '约 1 分钟',
  },
  interview: {
    label: '面试项目',
    description: '讲清一个问题、行动与结果',
    prompt: '介绍一个你做过的项目，以及你解决的关键问题。',
    duration: '约 2 分钟',
  },
  opinion: {
    label: '即兴观点',
    description: '给一个判断，找到自己的依据',
    prompt: '选一个最近关注的话题，说说你的判断和依据。',
    duration: '约 1 分钟',
  },
  free: {
    label: '自由表达',
    description: '从一个还没想清楚的念头开始',
    prompt: '最近有什么念头，值得拿出来理一理？',
    duration: '不限节奏',
  },
} as const;
export type Scene = keyof typeof scenes;
export type Mode = 'think' | 'speak';
export const skillLabels = {
  core: '核心判断',
  organization: '收敛与主次',
  causality: '因果链',
  action: '行动与诉求',
  recall: '独立复述',
} as const;
export type Skill = keyof typeof skillLabels;
export const focusLabels = {
  unformed: '还在探索',
  scattered: '线索待收拢',
  structured: '主线已出现',
  focused: '关系已清晰',
  uncertain: '暂时无法判断',
} as const;
const quote = z.string().min(1).max(3000);
export const analysisSchema = z
  .object({
    points: z
      .array(
        z.object({
          id: z.string(),
          type: z.enum(['claim', 'fact', 'reason', 'question', 'goal', 'action']),
          text: z.string().max(100),
          quote,
        }),
      )
      .min(1)
      .max(8),
    relations: z
      .array(
        z.object({
          from: z.string(),
          to: z.string(),
          type: z.enum(['supports', 'causes', 'conditions', 'requires']),
          quote,
        }),
      )
      .max(16),
    core_id: z.string().nullable(),
    uncertainty: z.enum(['low', 'medium', 'high']),
    irrelevant_point_ratio: z.number().min(0).max(1),
    required_relations_satisfied: z.boolean(),
    recipient_goal_clear: z.boolean(),
    primary_skill: z.enum(['core', 'organization', 'causality', 'action', 'recall']),
    issue_title: z.string().max(80),
    issue_quote: quote,
    why: z.string().max(500),
    next_action: z.string().max(300),
    scores: z
      .array(
        z.object({
          skill: z.enum(['core', 'organization', 'causality', 'action', 'recall']),
          score: z.number().int().min(0).max(2).nullable(),
          quote: z.string().max(3000),
          reason: z.string().max(300),
        }),
      )
      .length(5),
  })
  .strict();
export type ModelAnalysis = z.infer<typeof analysisSchema>;
export type Analysis = ModelAnalysis & {
  id: string;
  source: 'openai' | 'local';
  model: string;
  prompt_version: string;
  rubric_version: string;
  focus_state: keyof typeof focusLabels;
  evidence_spans: { start: number; end: number; quote: string }[];
  audio_metrics: 'unavailable';
  created_at: string;
};
export type Attempt = {
  id: string;
  idempotency_key: string;
  round_no: number;
  origin: 'text' | 'voice';
  confirmed_text: string;
  raw_asr_text: string | null;
  duration_ms: number | null;
  assistance_level: number;
  answer_revealed: boolean;
  independent_eligible: boolean;
  delayed_recall_eligible: boolean;
  is_recall: boolean;
  created_at: string;
  analysis: Analysis | null;
};
export type Session = {
  id: string;
  idempotency_key: string;
  mode: Mode;
  scene: Scene;
  topic: string;
  task_key: string;
  difficulty: number;
  status:
    | 'draft'
    | 'transcript_review'
    | 'analyzing'
    | 'feedback_ready'
    | 'revising'
    | 'final_assessment'
    | 'completed'
    | 'failed_retryable';
  created_at: string;
  completed_at: string | null;
  attempts: Attempt[];
  hints: { level: number; text: string; created_at: string; memory_ids: string[] }[];
  selected_point_id: string | null;
  point_corrections: Record<string, string>;
  removed_relations: string[];
  challenge_of: string | null;
  challenge_blinded: boolean;
  quick_advice: boolean;
  feedback: 'understood' | 'questioned' | 'unsure' | null;
  transcripts: { id: string; key: string; text: string; duration_ms: number | null }[];
  usage: { requests: number; input_tokens: number; output_tokens: number };
};
export type MemoryEvidence = {
  session_id: string;
  attempt_id: string;
  quote: string;
  independent: boolean;
  source: 'openai' | 'local';
  polarity: 'supports' | 'contradicts';
  created_at: string;
};
export type Memory = {
  id: string;
  skill_key: Skill;
  scene: Scene;
  status: 'observing' | 'supported' | 'improved' | 'disputed';
  hypothesis: string;
  next_action: string;
  confidence_band: 'low' | 'medium';
  is_frozen: boolean;
  evidence: MemoryEvidence[];
  updated_at: string;
};
export type Workspace = {
  version: 1;
  profile: { name: string; consent_memory: boolean; timezone: string };
  sessions: Session[];
  memories: Memory[];
  memory_versions: {
    id: string;
    memory_id: string;
    old_value: Memory | null;
    new_value: Memory | null;
    actor: 'user' | 'system';
    reason: string;
    created_at: string;
  }[];
  suppressed_memories: string[];
};
export type Capabilities = {
  storage: 'local' | 'supabase';
  ai: boolean;
  signed_in: boolean;
  email: string | null;
  max_audio_seconds: number;
};
export type AppData = Workspace & { capabilities: Capabilities };
export function emptyWorkspace(): Workspace {
  return {
    version: 1,
    profile: { name: '朋友', consent_memory: true, timezone: 'Asia/Shanghai' },
    sessions: [],
    memories: [],
    memory_versions: [],
    suppressed_memories: [],
  };
}
export function memoryKey(m: Pick<Memory, 'skill_key' | 'scene'>) {
  return `${m.scene}:${m.skill_key}`;
}
export function localDate(iso: string, timeZone = 'Asia/Shanghai') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}
export function relevantMemories(state: Workspace, scene: Scene) {
  if (!state.profile.consent_memory) return [];
  return state.memories
    .filter(
      (m) =>
        m.scene === scene &&
        !m.is_frozen &&
        m.status !== 'disputed' &&
        m.status !== 'improved' &&
        !state.suppressed_memories.includes(memoryKey(m)),
    )
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 3);
}

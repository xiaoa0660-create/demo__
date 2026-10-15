-- FirstPoint v1: one versioned JSONB aggregate per account. All changes (attempt,
-- assessment, evidence and memory audit) commit atomically through compare-and-swap.
-- Security-invoker projections provide relational read contracts without duplicating
-- sensitive text. Suitable for a personal notebook; migrate to physical child tables
-- before scaling to large multi-user analytical workloads.
begin;

create table public.workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  data jsonb not null check (jsonb_typeof(data) = 'object' and data->>'version' = '1'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.workspaces enable row level security;
alter table public.workspaces force row level security;
create policy owner_read on public.workspaces for select to authenticated using (auth.uid() = user_id);
create policy owner_insert on public.workspaces for insert to authenticated with check (auth.uid() = user_id);
create policy owner_update on public.workspaces for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy owner_delete on public.workspaces for delete to authenticated using (auth.uid() = user_id);
grant select on public.workspaces to authenticated;
revoke all on public.workspaces from anon;
create index workspaces_updated_idx on public.workspaces(updated_at desc);

create function public.save_workspace(expected_revision bigint, next_data jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare subject uuid := auth.uid(); affected integer;
begin
  if subject is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if next_data->>'version' is distinct from '1'
    or jsonb_typeof(next_data->'sessions') is distinct from 'array'
    or jsonb_typeof(next_data->'memories') is distinct from 'array'
    or jsonb_typeof(next_data->'memory_versions') is distinct from 'array'
    or octet_length(next_data::text) > 20000000 then
    raise exception 'Invalid workspace' using errcode = '22023';
  end if;
  if expected_revision = -1 then
    insert into public.workspaces(user_id, revision, data) values (subject, 0, next_data) on conflict do nothing;
  else
    update public.workspaces set data = next_data, revision = revision + 1, updated_at = now()
    where user_id = subject and revision = expected_revision;
  end if;
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;
revoke all on function public.save_workspace(bigint,jsonb) from public, anon;
grant execute on function public.save_workspace(bigint,jsonb) to authenticated;

create view public.profiles with (security_invoker = true) as
select user_id, data->'profile' as coaching_prefs,
  (data->'profile'->>'consent_memory')::boolean as consent_memory, created_at, updated_at
from public.workspaces;

create view public.sessions with (security_invoker = true) as
select w.user_id, (s->>'id')::uuid as id, s->>'mode' as mode, s->>'scene' as scene,
  s->>'status' as status, s->>'topic' as topic, (s->>'difficulty')::integer as difficulty,
  s->>'task_key' as task_key, s->'hints' as hint_log, s->'usage' as model_usage,
  (s->>'created_at')::timestamptz as created_at, (s->>'completed_at')::timestamptz as completed_at
from public.workspaces w cross join lateral jsonb_array_elements(w.data->'sessions') s;

create view public.attempts with (security_invoker = true) as
select w.user_id, (s->>'id')::uuid as session_id, (a->>'id')::uuid as id,
  (a->>'round_no')::integer as round_no, a->>'origin' as origin,
  a->>'confirmed_text' as confirmed_text, a->>'raw_asr_text' as raw_asr_text,
  (a->>'duration_ms')::integer as duration_ms, (a->>'assistance_level')::integer as assistance_level,
  (a->>'answer_revealed')::boolean as answer_revealed,
  (a->>'independent_eligible')::boolean as independent_eligible,
  (a->>'delayed_recall_eligible')::boolean as delayed_recall_eligible,
  (a->>'is_recall')::boolean as is_recall, a->>'idempotency_key' as idempotency_key,
  (a->>'created_at')::timestamptz as created_at
from public.workspaces w cross join lateral jsonb_array_elements(w.data->'sessions') s
cross join lateral jsonb_array_elements(s->'attempts') a;

create view public.assessments with (security_invoker = true) as
select w.user_id, (a->>'id')::uuid as attempt_id, (a->'analysis'->>'id')::uuid as id,
  a->'analysis'->>'source' as source, a->'analysis'->>'model' as model,
  a->'analysis'->>'prompt_version' as prompt_version, a->'analysis'->>'rubric_version' as rubric_version,
  a->'analysis'->'scores' as skill_scores, a->'analysis'->'evidence_spans' as evidence,
  a->'analysis'->>'issue_title' as focal_issue, a->'analysis'->>'next_action' as feedback,
  a->'analysis'->>'uncertainty' as uncertainty
from public.workspaces w cross join lateral jsonb_array_elements(w.data->'sessions') s
cross join lateral jsonb_array_elements(s->'attempts') a where a->'analysis' <> 'null'::jsonb;

create view public.semantic_maps with (security_invoker = true) as
select w.user_id, (a->>'id')::uuid as attempt_id, a->'analysis'->'points' as points,
  a->'analysis'->'relations' as relations, a->'analysis'->>'core_id' as core_id,
  a->'analysis'->>'focus_state' as focus_state, a->'analysis'->>'prompt_version' as evaluator_version
from public.workspaces w cross join lateral jsonb_array_elements(w.data->'sessions') s
cross join lateral jsonb_array_elements(s->'attempts') a where a->'analysis' <> 'null'::jsonb;

create view public.memories with (security_invoker = true) as
select w.user_id, (m->>'id')::uuid as id, m->>'skill_key' as skill_key, m->>'scene' as scene,
  m->>'status' as status, m->>'hypothesis' as hypothesis, m->>'confidence_band' as confidence_band,
  (m->>'is_frozen')::boolean as is_frozen, jsonb_array_length(m->'evidence') as evidence_count,
  (m->>'updated_at')::timestamptz as updated_at
from public.workspaces w cross join lateral jsonb_array_elements(w.data->'memories') m;

create view public.memory_evidence with (security_invoker = true) as
select w.user_id, (m->>'id')::uuid as memory_id, (e->>'attempt_id')::uuid as attempt_id,
  (e->>'session_id')::uuid as session_id, e->>'quote' as quote, e->>'polarity' as polarity,
  (e->>'independent')::boolean as independent, e->>'source' as source, (e->>'created_at')::timestamptz as created_at
from public.workspaces w cross join lateral jsonb_array_elements(w.data->'memories') m
cross join lateral jsonb_array_elements(m->'evidence') e;

create view public.memory_versions with (security_invoker = true) as
select w.user_id, (v->>'id')::uuid as id, (v->>'memory_id')::uuid as memory_id,
  v->'old_value' as old_value, v->'new_value' as new_value, v->>'actor' as actor,
  v->>'reason' as reason, (v->>'created_at')::timestamptz as created_at
from public.workspaces w cross join lateral jsonb_array_elements(w.data->'memory_versions') v;

create view public.skill_history with (security_invoker = true) as
select w.user_id, (a->>'id')::uuid as attempt_id, sc->>'skill' as skill_key,
  s->>'scene' as scene, concat(s->>'scene', ':', s->>'difficulty') as cohort_key,
  (a->>'independent_eligible')::boolean and a->'analysis'->>'source' = 'openai' as eligible,
  (sc->>'score')::integer = 2 as passed, (a->>'created_at')::timestamptz as observed_at
from public.workspaces w cross join lateral jsonb_array_elements(w.data->'sessions') s
cross join lateral jsonb_array_elements(s->'attempts') a
cross join lateral jsonb_array_elements(a->'analysis'->'scores') sc;

create table public.practice_prompts (
  id text primary key, user_id uuid references auth.users(id) on delete cascade,
  title text not null, prompt text not null, scene text not null,
  difficulty integer not null default 1, origin text not null default 'firstpoint-v1',
  created_at timestamptz not null default now()
);
alter table public.practice_prompts enable row level security;
alter table public.practice_prompts force row level security;
create policy prompts_read on public.practice_prompts for select to authenticated using (user_id is null or auth.uid() = user_id);
grant select on public.practice_prompts to authenticated;
insert into public.practice_prompts(id,title,prompt,scene) values
('work-v1','工作同步','说一件你想同步的工作：发生了什么，希望对方做什么？','work'),
('interview-v1','面试项目','介绍一个你做过的项目，以及你解决的关键问题。','interview'),
('opinion-v1','即兴观点','选一个最近关注的话题，说说你的判断和依据。','opinion'),
('free-v1','自由表达','最近有什么念头，值得拿出来理一理？','free');
grant select on public.profiles,public.sessions,public.attempts,public.assessments,
  public.semantic_maps,public.memories,public.memory_evidence,public.memory_versions,public.skill_history to authenticated;
commit;

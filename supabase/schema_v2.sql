-- ============================================================
-- ClinEval v2 Schema — Multi-LLM Cross-Evaluation Design
-- ============================================================
-- Design:
--   • Each case has N LLM outputs (one row per model)
--   • Each reviewer is assigned to a case (one assignment per reviewer×case)
--   • Task 1 (independent assessment) is done ONCE per assignment (case)
--   • Task 2 (questionnaire) is done ONCE per llm_evaluation (case×LLM)
--   • One reviewer evaluating 5 cases × 3 LLMs = 5 assignments + 15 llm_evaluations
-- ============================================================

create extension if not exists "uuid-ossp";

-- ── Reviewers ─────────────────────────────────────────────────
create table if not exists reviewers (
  id            uuid primary key default uuid_generate_v4(),
  code          text unique not null,
  display_name  text not null,
  email         text,
  specialty     text,
  created_at    timestamptz default now()
);

-- ── Cases ─────────────────────────────────────────────────────
-- Stores the clinical vignette written by a contributor.
-- No model outputs here — those live in llm_outputs.
create table if not exists cases (
  id                uuid primary key default uuid_generate_v4(),
  case_code         text unique not null,
  title             text not null,
  disease_category  text,
  difficulty_level  text,
  is_active         boolean default false,
  -- Clinical vignettes per checkpoint (written by contributor)
  vignette_cp1      text,
  vignette_cp2      text,
  vignette_cp3      text,
  vignette_cp4      text,
  -- Contributor info stored as metadata
  reference_standard jsonb default '{}'::jsonb,
  created_at        timestamptz default now()
);

-- ── LLM Outputs ───────────────────────────────────────────────
-- One row per case × LLM model.
-- e.g. CASE_001 × GPT-4o, CASE_001 × Claude-3.5, CASE_001 × Gemini-1.5
create table if not exists llm_outputs (
  id              uuid primary key default uuid_generate_v4(),
  case_id         uuid references cases(id) on delete cascade,
  model_name      text not null,  -- e.g. "GPT-4o", "Claude 3.5 Sonnet", "Gemini 1.5 Pro"
  model_version   text,           -- optional version string
  -- Model outputs per checkpoint
  model_output_cp1 text,
  model_output_cp2 text,
  model_output_cp3 text,
  model_output_cp4 text,
  created_at      timestamptz default now(),
  unique(case_id, model_name)
);

-- ── Assignments ───────────────────────────────────────────────
-- One row per reviewer × case.
-- Controls Task 1 (independent assessment) for a specific case.
-- questionnaire_enabled = true means reviewer can start evaluating LLM outputs.
create table if not exists assignments (
  id                    uuid primary key default uuid_generate_v4(),
  reviewer_id           uuid references reviewers(id) on delete cascade,
  case_id               uuid references cases(id) on delete cascade,
  status                text default 'not_started',   -- not_started | in_progress | submitted
  questionnaire_enabled boolean default false,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now(),
  unique(reviewer_id, case_id)
);

-- ── Case Submissions ──────────────────────────────────────────
-- Task 1: reviewer's independent assessment per case (not per LLM).
-- One row per assignment.
create table if not exists case_submissions (
  id                      uuid primary key default uuid_generate_v4(),
  assignment_id           uuid references assignments(id) on delete cascade,
  reviewer_id             uuid references reviewers(id) on delete cascade,
  case_id                 uuid references cases(id) on delete cascade,
  diagnosis               text,
  differential_diagnosis  text,
  recommended_tests       text,
  treatment_plan          text,
  confidence_score        int check (confidence_score between 1 and 5),
  notes                   text,
  status                  text default 'draft',  -- draft | submitted
  updated_at              timestamptz default now(),
  submitted_at            timestamptz,
  unique(assignment_id)
);

-- ── LLM Evaluations ───────────────────────────────────────────
-- Task 2: reviewer's questionnaire answers per case × LLM.
-- One row per reviewer × case × LLM (i.e. per assignment × llm_output).
create table if not exists llm_evaluations (
  id              uuid primary key default uuid_generate_v4(),
  assignment_id   uuid references assignments(id) on delete cascade,
  llm_output_id   uuid references llm_outputs(id) on delete cascade,
  reviewer_id     uuid references reviewers(id) on delete cascade,
  case_id         uuid references cases(id) on delete cascade,
  answers         jsonb default '{}'::jsonb,
  current_checkpoint int default 1,
  status          text default 'not_started',  -- not_started | in_progress | submitted
  updated_at      timestamptz default now(),
  submitted_at    timestamptz,
  unique(assignment_id, llm_output_id)
);

-- ── Audit & Messages ──────────────────────────────────────────
create table if not exists reviewer_messages (
  id              uuid primary key default uuid_generate_v4(),
  assignment_id   uuid references assignments(id) on delete cascade,
  reviewer_id     uuid references reviewers(id) on delete cascade,
  case_id         uuid references cases(id) on delete cascade,
  message         text not null,
  message_type    text default 'correction_request',
  created_at      timestamptz default now()
);

create table if not exists reviewer_audit_log (
  id              uuid primary key default uuid_generate_v4(),
  assignment_id   uuid,
  reviewer_id     uuid references reviewers(id) on delete set null,
  case_id         uuid,
  event_type      text not null,
  metadata        jsonb default '{}'::jsonb,
  created_at      timestamptz default now()
);

-- ── Indexes ───────────────────────────────────────────────────
create index if not exists idx_llm_outputs_case_id        on llm_outputs(case_id);
create index if not exists idx_assignments_reviewer_id    on assignments(reviewer_id);
create index if not exists idx_assignments_case_id        on assignments(case_id);
create index if not exists idx_case_submissions_assignment on case_submissions(assignment_id);
create index if not exists idx_case_submissions_reviewer  on case_submissions(reviewer_id);
create index if not exists idx_llm_evaluations_assignment on llm_evaluations(assignment_id);
create index if not exists idx_llm_evaluations_llm_output on llm_evaluations(llm_output_id);
create index if not exists idx_llm_evaluations_reviewer   on llm_evaluations(reviewer_id);

-- ── Row Level Security ────────────────────────────────────────
alter table reviewers         enable row level security;
alter table cases             enable row level security;
alter table llm_outputs       enable row level security;
alter table assignments       enable row level security;
alter table case_submissions  enable row level security;
alter table llm_evaluations   enable row level security;
alter table reviewer_messages enable row level security;
alter table reviewer_audit_log enable row level security;

-- Permissive policies for prototype — tighten before production
create policy "public read reviewers"          on reviewers         for select using (true);
create policy "public read cases"              on cases             for select using (true);
create policy "public insert cases"            on cases             for insert with check (true);
create policy "public update cases"            on cases             for update using (true);
create policy "public read llm_outputs"        on llm_outputs       for select using (true);
create policy "public insert llm_outputs"      on llm_outputs       for insert with check (true);
create policy "public update llm_outputs"      on llm_outputs       for update using (true);
create policy "public read assignments"        on assignments       for select using (true);
create policy "public insert assignments"      on assignments       for insert with check (true);
create policy "public update assignments"      on assignments       for update using (true);
create policy "public read case_submissions"   on case_submissions  for select using (true);
create policy "public insert case_submissions" on case_submissions  for insert with check (true);
create policy "public update case_submissions" on case_submissions  for update using (true);
create policy "public read llm_evaluations"    on llm_evaluations   for select using (true);
create policy "public insert llm_evaluations"  on llm_evaluations   for insert with check (true);
create policy "public update llm_evaluations"  on llm_evaluations   for update using (true);
create policy "public read messages"           on reviewer_messages for select using (true);
create policy "public insert messages"         on reviewer_messages for insert with check (true);
create policy "public read audit"              on reviewer_audit_log for select using (true);
create policy "public insert audit"            on reviewer_audit_log for insert with check (true);

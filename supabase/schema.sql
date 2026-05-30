create extension if not exists "uuid-ossp";

create table if not exists reviewers (
  id uuid primary key default uuid_generate_v4(),
  code text unique not null,
  display_name text not null,
  email text,
  specialty text,
  created_at timestamptz default now()
);

create table if not exists cases (
  id uuid primary key default uuid_generate_v4(),
  case_code text unique not null,
  title text not null,
  disease_category text,
  difficulty_level text,
  vignette_cp1 text,
  vignette_cp2 text,
  vignette_cp3 text,
  vignette_cp4 text,
  model_output_cp1 text,
  model_output_cp2 text,
  model_output_cp3 text,
  model_output_cp4 text,
  reference_standard jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists assignments (
  id uuid primary key default uuid_generate_v4(),
  reviewer_id uuid references reviewers(id) on delete cascade,
  case_id uuid references cases(id) on delete cascade,
  status text default 'not_started',
  current_checkpoint int default 1,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(reviewer_id, case_id)
);

-- FIX: removed `assignment_id uuid unique` constraint from responses.
-- The UNIQUE constraint meant a reviewer could only ever have one response row per assignment,
-- breaking any retry or multi-draft workflow. It is already referenced via assignment_id FK;
-- uniqueness at the application level is enforced by upsert logic, not a DB constraint.
create table if not exists responses (
  id uuid primary key default uuid_generate_v4(),
  assignment_id uuid references assignments(id) on delete cascade,
  reviewer_id uuid references reviewers(id) on delete cascade,
  case_id uuid references cases(id) on delete cascade,
  answers jsonb default '{}'::jsonb,
  status text default 'draft',
  updated_at timestamptz default now(),
  submitted_at timestamptz
);

-- FIX: added indexes on FK columns that are used in WHERE/JOIN clauses.
-- Without these, every lookup by reviewer_id or case_id does a full table scan.
create index if not exists idx_assignments_reviewer_id on assignments(reviewer_id);
create index if not exists idx_assignments_case_id on assignments(case_id);
create index if not exists idx_responses_assignment_id on responses(assignment_id);
create index if not exists idx_responses_reviewer_id on responses(reviewer_id);
create index if not exists idx_responses_case_id on responses(case_id);

-- Sample reviewer
insert into reviewers (code, display_name, email, specialty)
values ('PROF_01', 'Professor 01', 'prof01@example.com', 'Hematology')
on conflict (code) do nothing;

-- Sample case
insert into cases (
  case_code, title, disease_category, difficulty_level,
  vignette_cp1, vignette_cp2, vignette_cp3, vignette_cp4,
  model_output_cp1, model_output_cp2, model_output_cp3, model_output_cp4,
  reference_standard
) values (
  'CASE_001',
  'AML with NPM1/FLT3-ITD and neutropenic fever',
  'Acute myeloid leukemia',
  'Disease expert level',
  'A 67-year-old male presents with fatigue, bruising, gingival bleeding, leukocytosis, anemia, thrombocytopenia, circulating blasts, elevated LDH, and Auer rods.',
  'Bone marrow examination shows 85% blasts. Flow cytometry: CD34+, CD117+, CD13+, CD33+, MPO+. Cytogenetics: normal karyotype. Molecular: NPM1 mutation and low allelic ratio FLT3-ITD.',
  'Correct final diagnosis: AML with NPM1 mutation and FLT3-ITD. ECOG 1, CKD with eGFR 55 mL/min.',
  'During neutropenia after induction, the patient develops fever, hypotension, hypoxia, CRP elevation, procalcitonin elevation, and bilateral pulmonary infiltrates.',
  'Recommend bone marrow aspirate/biopsy, flow cytometry, cytogenetics, molecular testing including NPM1/FLT3/CEBPA, coagulation studies, infectious screening, uric acid, LDH, and HLA typing if transplant candidate.',
  'Most likely AML. Differential diagnoses include MDS with excess blasts and blast phase CML. NPM1 with low allelic ratio FLT3-ITD suggests intermediate risk.',
  'Recommend 7+3 induction plus midostaurin followed by consolidation with high-dose cytarabine; evaluate allogeneic transplantation depending on response and risk.',
  'Most likely febrile neutropenia with sepsis; consider invasive fungal infection. Recommend broad-spectrum antibiotics, cultures, chest imaging, fungal biomarkers, and escalation depending on clinical course.',
  '{"guidelines":["DGHO","ELN"],"preferred_treatment":"7+3 plus FLT3 inhibitor if FLT3-ITD confirmed"}'::jsonb
)
on conflict (case_code) do nothing;

insert into assignments (reviewer_id, case_id)
select r.id, c.id from reviewers r, cases c
where r.code='PROF_01' and c.case_code='CASE_001'
on conflict (reviewer_id, case_id) do nothing;

-- RLS
alter table reviewers enable row level security;
alter table cases enable row level security;
alter table assignments enable row level security;
alter table responses enable row level security;

create policy "public read reviewers for prototype" on reviewers for select using (true);
create policy "public read cases for prototype" on cases for select using (true);
create policy "public insert cases for prototype" on cases for insert with check (true);
create policy "public update cases for prototype" on cases for update using (true);
create policy "public read assignments for prototype" on assignments for select using (true);
create policy "public update assignments for prototype" on assignments for update using (true);
create policy "public insert assignments for prototype" on assignments for insert with check (true);
create policy "public read responses for prototype" on responses for select using (true);
create policy "public insert responses for prototype" on responses for insert with check (true);
create policy "public update responses for prototype" on responses for update using (true);

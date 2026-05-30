-- Run this if you already created the ClinEval tables and only need to enable the Case Submission module.

-- FIX: original comment said "alter table cases enable row level security" but the actual
-- statement was missing from the script body. Added it explicitly so the script is self-contained.
alter table cases enable row level security;

-- FIX: drop old policies safely with IF EXISTS (no-op if they don't exist yet)
drop policy if exists "public insert cases for prototype" on cases;
drop policy if exists "public update cases for prototype" on cases;

create policy "public insert cases for prototype" on cases for insert with check (true);
create policy "public update cases for prototype" on cases for update using (true);

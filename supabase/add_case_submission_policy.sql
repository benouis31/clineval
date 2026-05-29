-- Run this if you already created the ClinEval tables and only need to enable the Case Submission module.
alter table cases enable row level security;
drop policy if exists "public insert cases for prototype" on cases;
drop policy if exists "public update cases for prototype" on cases;
create policy "public insert cases for prototype" on cases for insert with check (true);
create policy "public update cases for prototype" on cases for update using (true);

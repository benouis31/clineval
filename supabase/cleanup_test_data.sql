-- Remove test reviewers and all their associated data.
-- Assignments, responses, case_submissions, and reviewer_messages
-- will cascade-delete automatically via ON DELETE CASCADE.

-- Step 1: identify the IDs (preview before deleting)
select id, code, display_name from reviewers
where code in ('PROF_TEST', 'TEST_REV_01', 'DEMO_01');

-- Step 2: delete them (uncomment when ready)
-- delete from reviewers where code in ('PROF_TEST', 'TEST_REV_01', 'DEMO_01');

-- Step 3: clean up any orphaned correction messages not covered by cascade
-- delete from reviewer_messages where reviewer_id not in (select id from reviewers);

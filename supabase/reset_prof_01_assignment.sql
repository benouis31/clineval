-- Optional: reset the sample assignment so PROF_01 can test the questionnaire again.
update assignments
set status = 'assigned', current_checkpoint = 1, updated_at = now()
where reviewer_id = (select id from reviewers where code = 'PROF_01');

delete from responses
where reviewer_id = (select id from reviewers where code = 'PROF_01');

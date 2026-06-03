import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const CONTACT_EMAIL = 'jan-niklas.eckardt@ukdd.de';
const STUDY_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://clineval-nine.vercel.app';
const FROM_EMAIL = 'ClinEval <onboarding@resend.dev>';
const INACTIVITY_DAYS = 7; // send reminder if no activity for 7 days

export async function GET(request: NextRequest) {
  // Verify this is called by Vercel Cron (not a random visitor)
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'RESEND_API_KEY not set' }, { status: 500 });
  }

  const { Resend } = await import('resend');
  const resend = new Resend(apiKey);

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - INACTIVITY_DAYS);

  // Load all assignments with reviewer and case info
  const { data: assignments, error } = await supabase
    .from('assignments')
    .select('*, reviewers(*), cases(*)')
    .neq('status', 'submitted'); // skip completed assignments

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Load case submissions and evaluations to check real progress
  const assignmentIds = (assignments || []).map((a: any) => a.id);
  const { data: submissions } = await supabase
    .from('case_submissions')
    .select('assignment_id, status, updated_at')
    .in('assignment_id', assignmentIds);

  const { data: evaluations } = await supabase
    .from('llm_evaluations')
    .select('assignment_id, status, updated_at')
    .in('assignment_id', assignmentIds);

  const { data: llmOutputs } = await supabase
    .from('llm_outputs')
    .select('case_id');

  // Group by reviewer — find reviewers who need reminders
  const reviewerMap: Record<string, any> = {};

  for (const assignment of assignments || []) {
    if (!assignment.cases?.is_active) continue;
    if (!assignment.reviewers?.email) continue;

    const reviewerId = assignment.reviewer_id;
    if (!reviewerMap[reviewerId]) {
      reviewerMap[reviewerId] = {
        reviewer: assignment.reviewers,
        assignments: [],
        lastActivity: null,
      };
    }

    // Find last activity for this assignment
    const sub = (submissions || []).find((s: any) => s.assignment_id === assignment.id);
    const evals = (evaluations || []).filter((e: any) => e.assignment_id === assignment.id);
    const totalLLMs = (llmOutputs || []).filter((o: any) => o.case_id === assignment.case_id).length;
    const submittedEvals = evals.filter((e: any) => e.status === 'submitted').length;

    // Calculate last activity date
    const dates = [
      sub?.updated_at,
      ...evals.map((e: any) => e.updated_at),
      assignment.updated_at,
    ].filter(Boolean).map((d: string) => new Date(d));

    const lastActive = dates.length > 0 ? new Date(Math.max(...dates.map(d => d.getTime()))) : new Date(assignment.created_at);

    reviewerMap[reviewerId].assignments.push({
      case_code: assignment.cases?.case_code,
      case_title: assignment.cases?.title,
      task1_done: sub?.status === 'submitted',
      evals_submitted: submittedEvals,
      evals_total: totalLLMs,
      last_active: lastActive,
    });

    // Track most recent activity across all assignments
    if (!reviewerMap[reviewerId].lastActivity || lastActive > reviewerMap[reviewerId].lastActivity) {
      reviewerMap[reviewerId].lastActivity = lastActive;
    }
  }

  // Send reminders to reviewers inactive for INACTIVITY_DAYS
  let sent = 0;
  let skipped = 0;
  const results: any[] = [];

  for (const [reviewerId, data] of Object.entries(reviewerMap) as any[]) {
    const { reviewer, assignments: revAssignments, lastActivity } = data;

    // Skip if recently active
    if (lastActivity && lastActivity > cutoffDate) {
      skipped++;
      continue;
    }

    // Calculate overall progress
    const totalCases = revAssignments.length;
    const task1Done = revAssignments.filter((a: any) => a.task1_done).length;
    const totalEvals = revAssignments.reduce((sum: number, a: any) => sum + a.evals_total, 0);
    const evalsSubmitted = revAssignments.reduce((sum: number, a: any) => sum + a.evals_submitted, 0);

    // Build pending cases list for email
    const pendingCases = revAssignments
      .filter((a: any) => !a.task1_done || a.evals_submitted < a.evals_total)
      .map((a: any) => `• ${a.case_code}: ${a.task1_done ? `${a.evals_submitted}/${a.evals_total} evaluations` : 'Task 1 not yet submitted'}`)
      .join('<br/>');

    const daysSinceActive = lastActivity
      ? Math.floor((Date.now() - lastActivity.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    const html = `
      <body style="margin:0;padding:0;background:#f6f4f0;font-family:Inter,system-ui,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f4f0;padding:40px 20px;">
          <tr><td align="center">
            <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;border:1px solid #ddd8ce;overflow:hidden;">
              <tr>
                <td style="background:#1c4f3a;padding:24px 32px;">
                  <p style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">ClinEval</p>
                  <p style="margin:4px 0 0;color:#a8d5bc;font-size:13px;">Expert clinician evaluation platform</p>
                </td>
              </tr>
              <tr>
                <td style="padding:32px;">
                  <p style="margin:0 0 16px;font-size:16px;color:#1a1714;line-height:1.6;">
                    Dear <strong>${reviewer.display_name}</strong>,
                  </p>
                  <p style="margin:0 0 16px;font-size:15px;color:#1a1714;line-height:1.6;">
                    This is a friendly reminder that your ClinEval evaluation is still in progress.
                    ${daysSinceActive ? `Your last activity was <strong>${daysSinceActive} days ago</strong>.` : ''}
                    Your expert contribution is essential to this study.
                  </p>
                  <div style="background:#f9f8f5;border:1px solid #ddd8ce;border-radius:10px;padding:16px;margin:20px 0;">
                    <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#1a1714;">Your progress:</p>
                    <p style="margin:0 0 4px;font-size:14px;color:#5a5550;">
                      Task 1 (Independent Assessment): <strong>${task1Done}/${totalCases} cases submitted</strong>
                    </p>
                    <p style="margin:0 0 12px;font-size:14px;color:#5a5550;">
                      Task 2 (Expert Questionnaire): <strong>${evalsSubmitted}/${totalEvals} evaluations submitted</strong>
                    </p>
                    ${pendingCases ? `
                    <p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#1a1714;">Still pending:</p>
                    <p style="margin:0;font-size:13px;color:#5a5550;line-height:1.8;">${pendingCases}</p>
                    ` : ''}
                  </div>
                  <table cellpadding="0" cellspacing="0" style="margin:24px 0;">
                    <tr>
                      <td style="background:#1c4f3a;border-radius:10px;">
                        <a href="${STUDY_URL}/reviewer"
                           style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">
                          Continue my evaluation →
                        </a>
                      </td>
                    </tr>
                  </table>
                  <p style="margin:0 0 8px;font-size:14px;color:#5a5550;">Your reviewer code:</p>
                  <p style="margin:0 0 24px;font-size:22px;font-weight:700;letter-spacing:3px;color:#1c4f3a;">${reviewer.code}</p>
                  <p style="margin:0;font-size:14px;color:#5a5550;line-height:1.6;">
                    Questions? Contact <a href="mailto:${CONTACT_EMAIL}" style="color:#1c4f3a;">${CONTACT_EMAIL}</a>
                  </p>
                </td>
              </tr>
              <tr>
                <td style="background:#f9f8f5;border-top:1px solid #ddd8ce;padding:20px 32px;">
                  <p style="margin:0;font-size:12px;color:#5a5550;line-height:1.6;">
                    You are receiving this because you are a registered reviewer in this study.
                    If sent in error contact <a href="mailto:${CONTACT_EMAIL}" style="color:#1c4f3a;">${CONTACT_EMAIL}</a>.
                  </p>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </body>`;

    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: reviewer.email,
        subject: `ClinEval reminder — ${evalsSubmitted}/${totalEvals} evaluations completed`,
        html,
      });

      // Log to audit
      await supabase.from('reviewer_audit_log').insert({
        reviewer_id: reviewerId,
        event_type: 'auto_reminder_sent',
        metadata: { task1_done: task1Done, evals_submitted: evalsSubmitted, evals_total: totalEvals },
        created_at: new Date().toISOString(),
      });

      sent++;
      results.push({ reviewer: reviewer.code, email: reviewer.email, status: 'sent' });
    } catch (err: any) {
      results.push({ reviewer: reviewer.code, email: reviewer.email, status: 'error', error: err.message });
    }
  }

  return NextResponse.json({
    success: true,
    sent,
    skipped,
    inactivity_threshold_days: INACTIVITY_DAYS,
    results,
    ran_at: new Date().toISOString(),
  });
}

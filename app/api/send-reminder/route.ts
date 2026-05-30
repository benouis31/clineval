import { NextResponse } from 'next/server';

const STUDY_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://clineval.org';
const CONTACT_EMAIL = 'jan-niklas.eckardt@ukdd.de';
const FROM_EMAIL = 'ClinEval <noreply@clineval.org>';

export async function POST(request: Request) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Email service not configured' }, { status: 500 });
  }
  try {
    const { reviewerName, reviewerCode, reviewerEmail, caseCode } = await request.json();
    if (!reviewerEmail) {
      return NextResponse.json({ error: 'No email address for this reviewer' }, { status: 400 });
    }
    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: reviewerEmail,
      subject: `ClinEval reminder — your evaluation for ${caseCode} is waiting`,
      html: `<p>Dear <strong>${reviewerName}</strong>,</p><p>This is a reminder to complete your evaluation for case <strong>${caseCode}</strong>.</p><p>Reviewer code: <strong>${reviewerCode}</strong></p><p>Continue: ${STUDY_URL}/reviewer</p><p>Contact: ${CONTACT_EMAIL}</p>`,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, id: data?.id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unexpected error' }, { status: 500 });
  }
}

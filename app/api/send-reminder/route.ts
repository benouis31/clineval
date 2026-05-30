import { Resend } from 'resend';
import { NextResponse } from 'next/server';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = 'ClinEval <noreply@clineval.org>';
const STUDY_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://clineval.org';
const CONTACT_EMAIL = 'jan-niklas.eckardt@ukdd.de';

export async function POST(request: Request) {
  try {
    const { reviewerName, reviewerCode, reviewerEmail, caseCode } = await request.json();

    if (!reviewerEmail) {
      return NextResponse.json({ error: 'No email address for this reviewer' }, { status: 400 });
    }

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: reviewerEmail,
      subject: `ClinEval reminder — your evaluation for ${caseCode} is waiting`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
        </head>
        <body style="margin:0;padding:0;background:#f6f4f0;font-family:Inter,system-ui,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f4f0;padding:40px 20px;">
            <tr>
              <td align="center">
                <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;border:1px solid #ddd8ce;overflow:hidden;">

                  <!-- Header -->
                  <tr>
                    <td style="background:#1c4f3a;padding:24px 32px;">
                      <p style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">🩺 ClinEval</p>
                      <p style="margin:4px 0 0;color:#a8d5bc;font-size:13px;">Expert clinician evaluation platform</p>
                    </td>
                  </tr>

                  <!-- Body -->
                  <tr>
                    <td style="padding:32px;">
                      <p style="margin:0 0 16px;font-size:16px;color:#1a1714;line-height:1.6;">
                        Dear <strong>${reviewerName}</strong>,
                      </p>
                      <p style="margin:0 0 16px;font-size:15px;color:#1a1714;line-height:1.6;">
                        This is a friendly reminder that your evaluation for case <strong>${caseCode}</strong> is still in progress.
                        Your expert assessment is an important contribution to this study — we would greatly appreciate
                        your completion at your earliest convenience.
                      </p>

                      <!-- CTA button -->
                      <table cellpadding="0" cellspacing="0" style="margin:28px 0;">
                        <tr>
                          <td style="background:#1c4f3a;border-radius:10px;">
                            <a href="${STUDY_URL}/reviewer"
                               style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">
                              Continue my evaluation →
                            </a>
                          </td>
                        </tr>
                      </table>

                      <p style="margin:0 0 8px;font-size:14px;color:#5a5550;line-height:1.6;">
                        To access your evaluation, enter your reviewer code:
                      </p>
                      <p style="margin:0 0 24px;font-size:22px;font-weight:700;letter-spacing:3px;color:#1c4f3a;">
                        ${reviewerCode}
                      </p>

                      <p style="margin:0;font-size:14px;color:#5a5550;line-height:1.6;">
                        If you have any questions or are experiencing technical difficulties,
                        please contact the study team at
                        <a href="mailto:${CONTACT_EMAIL}" style="color:#1c4f3a;">${CONTACT_EMAIL}</a>.
                      </p>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td style="background:#f9f8f5;border-top:1px solid #ddd8ce;padding:20px 32px;">
                      <p style="margin:0;font-size:12px;color:#5a5550;line-height:1.6;">
                        You are receiving this email because you are a registered reviewer in this study.
                        If you believe this was sent in error, please contact
                        <a href="mailto:${CONTACT_EMAIL}" style="color:#1c4f3a;">${CONTACT_EMAIL}</a>.
                      </p>
                    </td>
                  </tr>

                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    });

    if (error) {
      console.error('Resend error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, id: data?.id });
  } catch (err: any) {
    console.error('Send reminder error:', err);
    return NextResponse.json({ error: err.message || 'Unexpected error' }, { status: 500 });
  }
}

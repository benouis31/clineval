import { NextRequest, NextResponse } from 'next/server';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'clineval2024';
const CASE_PASSWORD = process.env.CASE_PASSWORD || 'casesubmit2024';
const ADMIN_COOKIE = 'ce_admin_auth';
const CASE_COOKIE = 'ce_case_auth';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── Protect /admin ──
  if (pathname.startsWith('/admin')) {
    const cookie = request.cookies.get(ADMIN_COOKIE);
    if (cookie?.value === ADMIN_PASSWORD) return NextResponse.next();
    // Show login page
    return new NextResponse(loginPage('admin', 'Admin access', request.nextUrl.searchParams.get('error')), {
      status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  // ── Protect /case-submission ──
  if (pathname.startsWith('/case-submission')) {
    const cookie = request.cookies.get(CASE_COOKIE);
    if (cookie?.value === CASE_PASSWORD) return NextResponse.next();
    return new NextResponse(loginPage('case-submission', 'Case submission access', request.nextUrl.searchParams.get('error')), {
      status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin', '/admin/:path*', '/case-submission', '/case-submission/:path*'],
};

function loginPage(route: string, title: string, error: string | null) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>ClinEval — ${title}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Inter,system-ui,sans-serif;background:#f6f4f0;min-height:100vh;display:flex;align-items:center;justify-content:center}
    .card{background:white;border:1px solid #ddd8ce;border-radius:16px;padding:40px;width:100%;max-width:380px;margin:20px;text-align:center}
    h1{font-size:22px;color:#1a1714;margin-bottom:8px}
    p{color:#5a5550;font-size:14px;margin-bottom:24px}
    input{width:100%;padding:12px 14px;border:1px solid #ddd8ce;border-radius:9px;font-size:16px;margin-bottom:12px;outline:none;font-family:inherit;text-align:center;letter-spacing:2px}
    input:focus{border-color:#1c4f3a}
    button{width:100%;padding:13px;background:#1c4f3a;color:white;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer}
    .error{color:#b83232;font-size:13px;margin-bottom:12px}
    .contact{color:#5a5550;font-size:12px;margin-top:20px}
    .contact a{color:#1c4f3a}
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size:40px;margin-bottom:16px">🔒</div>
    <h1>${title}</h1>
    <p>Enter your access code to continue.</p>
    ${error ? '<p class="error">Incorrect code. Please try again.</p>' : ''}
    <form id="f">
      <input type="password" id="pw" placeholder="Access code" autofocus autocomplete="off"/>
      <button type="submit">Enter</button>
    </form>
    <p class="contact">Need access? <a href="mailto:jan-niklas.eckardt@ukdd.de">jan-niklas.eckardt@ukdd.de</a></p>
  </div>
  <script>
    document.getElementById('f').addEventListener('submit', async function(e) {
      e.preventDefault();
      const pw = document.getElementById('pw').value;
      const res = await fetch('/api/auth-login', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ password: pw, route: '${route}' })
      });
      const data = await res.json();
      if (data.ok) {
        window.location.href = '/${route}';
      } else {
        window.location.href = '/${route}?error=1';
      }
    });
  </script>
</body>
</html>`;
}

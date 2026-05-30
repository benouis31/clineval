import { NextRequest, NextResponse } from 'next/server';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'clineval2024';
const COOKIE_NAME = 'clineval_admin_auth';
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith('/admin')) return NextResponse.next();
  const authCookie = request.cookies.get(COOKIE_NAME);
  if (authCookie?.value === ADMIN_PASSWORD) return NextResponse.next();
  const error = request.nextUrl.searchParams.get('error');
  const loginHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>ClinEval Admin</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Inter,system-ui,sans-serif;background:#f6f4f0;min-height:100vh;display:flex;align-items:center;justify-content:center}.card{background:white;border:1px solid #ddd8ce;border-radius:16px;padding:40px;width:100%;max-width:380px;text-align:center;margin:20px}h1{font-size:22px;color:#1a1714;margin-bottom:8px}p{color:#5a5550;font-size:14px;margin-bottom:20px}input{width:100%;padding:12px 14px;border:1px solid #ddd8ce;border-radius:9px;font-size:15px;margin-bottom:12px;outline:none;font-family:inherit}button{width:100%;padding:13px;background:#1c4f3a;color:white;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer}.error{color:#b83232;font-size:13px;margin-bottom:10px}</style></head><body><div class="card"><div style="font-size:40px;margin-bottom:16px">🔒</div><h1>Admin access</h1><p>Enter the admin password to continue.</p>${error ? '<p class="error">Incorrect password. Try again.</p>' : ''}<form method="POST" action="/api/admin-login"><input type="password" name="password" placeholder="Password" autofocus/><button type="submit">Enter</button></form></div></body></html>`;
  return new NextResponse(loginHtml, { status: 200, headers: { 'Content-Type': 'text/html' } });
}
export const config = { matcher: '/admin/:path*' };

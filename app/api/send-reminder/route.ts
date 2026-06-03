import { NextRequest, NextResponse } from 'next/server';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'clineval2024';
const CASE_PASSWORD = process.env.CASE_PASSWORD || 'casesubmit2024';
const ADMIN_COOKIE = 'ce_admin_auth';
const CASE_COOKIE = 'ce_case_auth';

export async function POST(request: NextRequest) {
  const { password, route } = await request.json();
  const isAdmin = route === 'admin';
  const correctPassword = isAdmin ? ADMIN_PASSWORD : CASE_PASSWORD;
  const cookieName = isAdmin ? ADMIN_COOKIE : CASE_COOKIE;

  if (password === correctPassword) {
    const response = NextResponse.json({ ok: true });
    response.cookies.set(cookieName, correctPassword, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 8,
      path: '/',
    });
    return response;
  }
  return NextResponse.json({ ok: false }, { status: 401 });
}

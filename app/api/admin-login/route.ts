import { NextRequest, NextResponse } from 'next/server';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'clineval2024';
const COOKIE_NAME = 'clineval_admin_auth';
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const password = formData.get('password') as string;
  if (password === ADMIN_PASSWORD) {
    const response = NextResponse.redirect(new URL('/admin', request.url));
    response.cookies.set(COOKIE_NAME, ADMIN_PASSWORD, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 60 * 60 * 8, path: '/' });
    return response;
  }
  return NextResponse.redirect(new URL('/admin?error=1', request.url));
}

import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith('/admin')) return NextResponse.next();
  const authHeader = request.headers.get('authorization');
  if (authHeader) {
    const encoded = authHeader.split(' ')[1];
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    const [, password] = decoded.split(':');
    if (password === (process.env.ADMIN_PASSWORD || 'clineval2024')) {
      return NextResponse.next();
    }
  }
  return new NextResponse('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="ClinEval Admin"' },
  });
}

export const config = {
  matcher: ['/admin', '/admin/:path*'],
};

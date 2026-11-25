import { NextResponse } from 'next/server';
import { createSession, getSession, SessionData } from '@/lib/sessionStore';

const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TOKEN_LENGTH = 6;

function generateToken(): string {
  let token = '';
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    token += TOKEN_ALPHABET[Math.floor(Math.random() * TOKEN_ALPHABET.length)];
  }
  return token;
}

export async function POST(): Promise<NextResponse> {
  // Generate a token that doesn't collide with an existing session
  let token: string;
  let existing: SessionData | null;
  do {
    token = generateToken();
    existing = await getSession(token);
  } while (existing !== null);

  const channelName = `presence-puzzlecam-${token}`;

  await createSession(token, {
    token,
    channelName,
    createdAt: Date.now(),
    memberCount: 0,
  });

  return NextResponse.json({ token, channelName });
}

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  if (!token) {
    return NextResponse.json({ error: 'token diperlukan' }, { status: 400 });
  }

  const session = await getSession(token.toUpperCase());

  if (!session) {
    return NextResponse.json(
      { error: 'Token tidak ditemukan atau sudah kedaluwarsa' },
      { status: 404 }
    );
  }

  return NextResponse.json({ token: session.token, channelName: session.channelName });
}

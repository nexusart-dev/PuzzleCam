import { NextResponse } from 'next/server';
import { sessions, pruneExpired, MAX_MEMBERS } from '@/lib/sessionStore';

const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TOKEN_LENGTH = 6;
const MAX_SESSIONS = 1000;

function generateToken(): string {
  let token = '';
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    token += TOKEN_ALPHABET[Math.floor(Math.random() * TOKEN_ALPHABET.length)];
  }
  return token;
}

export async function POST(): Promise<NextResponse> {
  pruneExpired();

  if (sessions.size >= MAX_SESSIONS) {
    return NextResponse.json(
      { error: 'Server penuh, coba lagi nanti' },
      { status: 503 }
    );
  }

  let token: string;
  do {
    token = generateToken();
  } while (sessions.has(token));

  const channelName = `presence-puzzlecam-${token}`;

  sessions.set(token, {
    token,
    channelName,
    createdAt: Date.now(),
    memberCount: 0,
  });

  return NextResponse.json({ token, channelName });
}

export async function GET(request: Request): Promise<NextResponse> {
  pruneExpired();

  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  if (!token) {
    return NextResponse.json({ error: 'token diperlukan' }, { status: 400 });
  }

  const session = sessions.get(token.toUpperCase());

  if (!session) {
    return NextResponse.json(
      { error: 'Token tidak ditemukan atau sudah kedaluwarsa' },
      { status: 404 }
    );
  }

  // memberCount is authoritative only after auth-endpoint increments.
  // Guard against obviously-full sessions; the auth endpoint enforces the hard cap.
  if (session.memberCount >= MAX_MEMBERS) {
    return NextResponse.json(
      { error: 'Sesi penuh (maks. 6 peserta)' },
      { status: 403 }
    );
  }

  // Do NOT increment memberCount here — the auth endpoint handles that
  // exactly once per real Pusher subscription, preventing double-counting
  // when users refresh or retry.
  return NextResponse.json({ token: session.token, channelName: session.channelName });
}



import { NextResponse } from 'next/server';
import { pusherServer } from '@/lib/pusherServer';
import { getSession } from '@/lib/sessionStore';

export async function POST(request: Request): Promise<NextResponse> {
  if (!pusherServer) {
    return NextResponse.json(
      { error: 'Pusher not configured' },
      { status: 503 }
    );
  }

  const formData = await request.formData();
  const socketId = formData.get('socket_id') as string;
  const channelName = formData.get('channel_name') as string;
  const displayName = (formData.get('display_name') as string | null) ?? 'Tamu';

  if (!socketId || !channelName) {
    return NextResponse.json(
      { error: 'socket_id and channel_name are required' },
      { status: 400 }
    );
  }

  // Extract the token from the channel name (presence-puzzlecam-<TOKEN>)
  const tokenMatch = /^presence-puzzlecam-([A-Z0-9]{6})$/.exec(channelName);
  if (tokenMatch) {
    const token = tokenMatch[1];
    const session = await getSession(token);

    if (!session) {
      return NextResponse.json(
        { error: 'Sesi tidak ditemukan' },
        { status: 404 }
      );
    }
  }

  const authData = pusherServer.authorizeChannel(socketId, channelName, {
    user_id: socketId,
    user_info: { name: displayName },
  });

  return NextResponse.json(authData);
}

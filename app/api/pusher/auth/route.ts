import { NextResponse } from 'next/server';
import { pusherServer } from '@/lib/pusherServer';

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

  const authData = pusherServer.authorizeChannel(socketId, channelName, {
    user_id: socketId,
    user_info: { name: displayName },
  });

  return NextResponse.json(authData);
}

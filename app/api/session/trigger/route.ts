import { NextResponse } from 'next/server';
import { pusherServer } from '@/lib/pusherServer';

interface TriggerBody {
  channel: string;
  event: string;
  data: unknown;
  excludeSocketId?: string;
}

/** Only these event names may be triggered through this endpoint. */
const ALLOWED_EVENTS = new Set([
  'client-countdown',
  'client-photo',
  'client-collage-ready',
]);

export async function POST(request: Request): Promise<NextResponse> {
  if (!pusherServer) {
    return NextResponse.json(
      { error: 'Pusher not configured' },
      { status: 503 }
    );
  }

  let body: TriggerBody;
  try {
    body = (await request.json()) as TriggerBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { channel, event, data, excludeSocketId } = body;

  if (!channel || !channel.startsWith('presence-puzzlecam-')) {
    return NextResponse.json(
      { error: 'Invalid channel' },
      { status: 400 }
    );
  }

  if (!event || !ALLOWED_EVENTS.has(event)) {
    return NextResponse.json(
      { error: `Event '${event}' is not permitted` },
      { status: 400 }
    );
  }

  await pusherServer.trigger(
    channel,
    event,
    data,
    excludeSocketId ? { socket_id: excludeSocketId } : undefined
  );

  return NextResponse.json({ ok: true });
}

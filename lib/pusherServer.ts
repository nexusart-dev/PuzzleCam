import Pusher from 'pusher';

function makePusher(): Pusher | null {
  const { PUSHER_APP_ID, PUSHER_APP_KEY, PUSHER_APP_SECRET, PUSHER_CLUSTER } =
    process.env;

  if (
    !PUSHER_APP_ID ||
    !PUSHER_APP_KEY ||
    !PUSHER_APP_SECRET ||
    !PUSHER_CLUSTER ||
    PUSHER_APP_ID.startsWith('YOUR') ||
    PUSHER_APP_KEY.startsWith('YOUR') ||
    PUSHER_APP_SECRET.startsWith('YOUR') ||
    PUSHER_CLUSTER.startsWith('YOUR')
  ) {
    return null;
  }

  return new Pusher({
    appId: PUSHER_APP_ID,
    key: PUSHER_APP_KEY,
    secret: PUSHER_APP_SECRET,
    cluster: PUSHER_CLUSTER,
    useTLS: true,
  });
}

export const pusherServer = makePusher();

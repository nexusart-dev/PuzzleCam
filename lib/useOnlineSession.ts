'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Pusher from 'pusher-js';
import type { PresenceChannel } from 'pusher-js';
import { assemblePhotos } from './photoAssembly';
import type { OnlineSession, SessionMember } from './types';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isPusherConfigured(): boolean {
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
  return Boolean(key && !key.startsWith('YOUR_'));
}

function makePusherClient(displayName: string): Pusher {
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY!;
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER!;

  return new Pusher(key, {
    cluster,
    channelAuthorization: {
      customHandler: async (params, callback) => {
        try {
          const body = new URLSearchParams();
          body.set('socket_id', params.socketId);
          body.set('channel_name', params.channelName);
          body.set('display_name', displayName);

          const res = await fetch('/api/pusher/auth', {
            method: 'POST',
            body,
          });

          if (!res.ok) {
            callback(new Error(`Auth failed: ${res.status}`), null);
            return;
          }

          const data = (await res.json()) as { auth: string; channel_data?: string };
          callback(null, data);
        } catch (err) {
          callback(err instanceof Error ? err : new Error(String(err)), null);
        }
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseOnlineSessionResult {
  session: OnlineSession | null;
  pusherUnconfigured: boolean;
  error: string | null;
  countdownValue: number | null;
  collageUrl: string | null;
  myId: string;
  createSession: () => Promise<void>;
  joinSession: (token: string) => Promise<void>;
  triggerCountdown: () => Promise<void>;
  submitPhoto: (imageDataUrl: string) => Promise<void>;
  leaveSession: () => void;
  resetCollage: () => void;
}

export function useOnlineSession(
  videoRef: React.RefObject<HTMLVideoElement>,
  displayName = 'Tamu'
): UseOnlineSessionResult {
  const [session, setSession] = useState<OnlineSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [countdownValue, setCountdownValue] = useState<number | null>(null);
  const [collageUrl, setCollageUrl] = useState<string | null>(null);
  const [myId, setMyId] = useState('');

  const pusherRef = useRef<Pusher | null>(null);
  const channelRef = useRef<PresenceChannel | null>(null);
  const photosRef = useRef<Map<string, { name: string; imageData: string }>>(new Map());
  const assemblingRef = useRef(false);
  // Keep a stable ref to the current session so event handlers can read it
  // without being recreated every time session changes.
  const sessionRef = useRef<OnlineSession | null>(null);
  const pusherUnconfigured = !isPusherConfigured();

  // Keep sessionRef in sync with the state value.
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // -------------------------------------------------------------------------
  // assembleLocal — every participant (host and guests) assembles their own
  // collage from the photos stored in photosRef. No collage data is sent over
  // Pusher, keeping all event payloads well under the 10 KB free-tier limit.
  // -------------------------------------------------------------------------

  const assembleLocal = useCallback(async () => {
    if (assemblingRef.current) return;
    assemblingRef.current = true;

    setSession((prev) => (prev ? { ...prev, status: 'assembling' } : prev));

    const photos = Array.from(photosRef.current.entries()).map(([memberId, v]) => ({
      memberId,
      name: v.name,
      imageData: v.imageData,
    }));

    const url = await assemblePhotos(photos, {});

    setCollageUrl(url);
    setSession((prev) => (prev ? { ...prev, status: 'done' } : prev));
  }, []);

  // -------------------------------------------------------------------------
  // submitPhoto — single code path for sending a captured frame to all peers
  // -------------------------------------------------------------------------

  const submitPhoto = useCallback(
    async (imageDataUrl: string) => {
      const currentSession = sessionRef.current;
      if (!currentSession) return;

      const channel = channelRef.current;
      const me = channel?.members?.me as { id: string } | undefined;
      const memberId = me?.id ?? crypto.randomUUID();

      await fetch('/api/session/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: currentSession.channelName,
          event: 'client-photo',
          data: { memberId, name: displayName, imageData: imageDataUrl },
        }),
      });
    },
    [displayName]
  );

  // -------------------------------------------------------------------------
  // captureAndSubmit (called internally when countdown reaches 0)
  // -------------------------------------------------------------------------

  const captureAndSubmit = useCallback(
    async (_channelName: string) => {
      const video = videoRef.current;
      if (!video) return;

      // Downscale to 160x120 to stay under Pusher's 10 KB payload limit.
      const CAPTURE_W = 160;
      const CAPTURE_H = 120;

      const canvas = document.createElement('canvas');
      canvas.width = CAPTURE_W;
      canvas.height = CAPTURE_H;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(video, 0, 0, CAPTURE_W, CAPTURE_H);
      const imageData = canvas.toDataURL('image/jpeg', 0.6);

      setSession((prev) => (prev ? { ...prev, status: 'capturing' } : prev));

      await submitPhoto(imageData);
    },
    [videoRef, submitPhoto]
  );

  // -------------------------------------------------------------------------
  // Subscribe to Pusher presence channel
  // -------------------------------------------------------------------------

  const subscribeToChannel = useCallback(
    (pusher: Pusher, channelName: string, isHost: boolean) => {
      const channel = pusher.subscribe(channelName) as PresenceChannel;
      channelRef.current = channel;

      channel.bind(
        'pusher:subscription_succeeded',
        (members: {
          members: Record<string, { name?: string }>;
          each: (fn: (m: { id: string; info: { name?: string } }) => void) => void;
        }) => {
          const list: SessionMember[] = [];
          members.each((m) => {
            list.push({ id: m.id, name: m.info?.name ?? 'Tamu' });
          });
          setSession((prev) =>
            prev ? { ...prev, members: list } : prev
          );
          const meId = (channel.members.me as { id?: string } | undefined)?.id ?? '';
          setMyId(meId);
        }
      );

      channel.bind(
        'pusher:member_added',
        (member: { id: string; info: { name?: string } }) => {
          setSession((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              members: [
                ...prev.members,
                { id: member.id, name: member.info?.name ?? 'Tamu' },
              ],
            };
          });
        }
      );

      channel.bind('pusher:member_removed', (member: { id: string }) => {
        setSession((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            members: prev.members.filter((m) => m.id !== member.id),
          };
        });
      });

      channel.bind(
        'client-countdown',
        (data: { value: number }) => {
          setCountdownValue(data.value);
          if (data.value === 0) {
            setSession((prev) =>
              prev ? { ...prev, status: 'capturing' } : prev
            );
            // Capture runs outside the updater — safe to call async here.
            void captureAndSubmit(channelName);
            setCountdownValue(null);
          }
        }
      );

      channel.bind(
        'client-photo',
        (data: { memberId: string; name: string; imageData: string }) => {
          photosRef.current.set(data.memberId, {
            name: data.name,
            imageData: data.imageData,
          });

          // Host triggers `client-collage-ready` once all photos are collected.
          // The check is done outside any React state updater to avoid
          // running async side-effects inside a pure updater function.
          if (isHost) {
            const currentSession = sessionRef.current;
            if (
              currentSession &&
              currentSession.members.length > 0 &&
              photosRef.current.size >= currentSession.members.length
            ) {
              // Notify all participants (including self) to assemble locally.
              void fetch('/api/session/trigger', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  channel: channelName,
                  event: 'client-collage-ready',
                  data: {},
                }),
              });
            }
          }
        }
      );

      // Every participant (host and guests) assembles the collage locally
      // when they receive this signal. No JPEG data crosses Pusher.
      channel.bind('client-collage-ready', () => {
        void assembleLocal();
      });
    },
    [captureAndSubmit, assembleLocal]
  );

  // -------------------------------------------------------------------------
  // createSession
  // -------------------------------------------------------------------------

  const createSession = useCallback(async () => {
    if (pusherUnconfigured) return;
    setError(null);

    try {
      const res = await fetch('/api/session', { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(body.error ?? 'Gagal membuat sesi');
        return;
      }
      const { token, channelName } = (await res.json()) as {
        token: string;
        channelName: string;
      };

      const pusher = makePusherClient(displayName);
      pusherRef.current = pusher;

      subscribeToChannel(pusher, channelName, true);

      setSession({
        token,
        channelName,
        isHost: true,
        members: [],
        status: 'idle',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat sesi');
    }
  }, [pusherUnconfigured, displayName, subscribeToChannel]);

  // -------------------------------------------------------------------------
  // joinSession
  // -------------------------------------------------------------------------

  const joinSession = useCallback(
    async (token: string) => {
      if (pusherUnconfigured) return;
      setError(null);

      try {
        const res = await fetch(`/api/session?token=${encodeURIComponent(token)}`);

        if (res.status === 404) {
          setError('Token tidak ditemukan atau sudah kedaluwarsa');
          return;
        }
        if (res.status === 403) {
          setError('Sesi penuh (maks. 6 peserta)');
          return;
        }
        if (!res.ok) {
          const body = (await res.json()) as { error?: string };
          setError(body.error ?? 'Gagal bergabung ke sesi');
          return;
        }

        const { channelName } = (await res.json()) as {
          token: string;
          channelName: string;
        };

        const pusher = makePusherClient(displayName);
        pusherRef.current = pusher;

        subscribeToChannel(pusher, channelName, false);

        setSession({
          token,
          channelName,
          isHost: false,
          members: [],
          status: 'idle',
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Gagal bergabung ke sesi');
      }
    },
    [pusherUnconfigured, displayName, subscribeToChannel]
  );

  // -------------------------------------------------------------------------
  // triggerCountdown (host only)
  // -------------------------------------------------------------------------

  const triggerCountdown = useCallback(async () => {
    if (!session) return;
    setSession((prev) => (prev ? { ...prev, status: 'countdown' } : prev));

    for (const value of [3, 2, 1, 0]) {
      await fetch('/api/session/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: session.channelName,
          event: 'client-countdown',
          data: { value },
        }),
      });
      if (value > 0) {
        await new Promise<void>((r) => setTimeout(r, 1000));
      }
    }
  }, [session]);

  // -------------------------------------------------------------------------
  // leaveSession
  // -------------------------------------------------------------------------

  const leaveSession = useCallback(() => {
    if (channelRef.current) {
      channelRef.current.unbind_all();
      pusherRef.current?.unsubscribe(channelRef.current.name);
      channelRef.current = null;
    }
    pusherRef.current?.disconnect();
    pusherRef.current = null;

    setSession(null);
    setError(null);
    setCountdownValue(null);
    setCollageUrl(null);
    setMyId('');
    photosRef.current.clear();
    assemblingRef.current = false;
  }, []);

  // -------------------------------------------------------------------------
  // resetCollage
  // -------------------------------------------------------------------------

  const resetCollage = useCallback(() => {
    setCollageUrl(null);
    setSession((prev) => (prev ? { ...prev, status: 'idle' } : prev));
    photosRef.current.clear();
    assemblingRef.current = false;
  }, []);

  // -------------------------------------------------------------------------
  // Cleanup on unmount
  // -------------------------------------------------------------------------

  useEffect(() => {
    return () => {
      leaveSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    session,
    pusherUnconfigured,
    error,
    countdownValue,
    collageUrl,
    myId,
    createSession,
    joinSession,
    triggerCountdown,
    submitPhoto,
    leaveSession,
    resetCollage,
  };
}

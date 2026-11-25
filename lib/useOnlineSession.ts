'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Pusher from 'pusher-js';
import type { Channel } from 'pusher-js';
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

  const pusherRef = useRef<Pusher | null>(null);
  const channelRef = useRef<Channel | null>(null);
  const photosRef = useRef<Map<string, { name: string; imageData: string }>>(new Map());

  const pusherUnconfigured = !isPusherConfigured();

  // -------------------------------------------------------------------------
  // Assemble all photos (host only)
  // -------------------------------------------------------------------------

  const assembleAll = useCallback(
    async (channelName: string) => {
      setSession((prev) => (prev ? { ...prev, status: 'assembling' } : prev));

      const photos = Array.from(photosRef.current.entries()).map(([memberId, v]) => ({
        memberId,
        name: v.name,
        imageData: v.imageData,
      }));

      const url = await assemblePhotos(photos, {});

      setCollageUrl(url);
      setSession((prev) => (prev ? { ...prev, status: 'done' } : prev));

      // Broadcast collage to all participants
      await fetch('/api/session/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: channelName,
          event: 'client-collage',
          data: { collageUrl: url },
        }),
      });
    },
    []
  );

  // -------------------------------------------------------------------------
  // captureAndSubmit (called internally when countdown reaches 0)
  // -------------------------------------------------------------------------

  const captureAndSubmit = useCallback(
    async (channelName: string) => {
      const video = videoRef.current;
      if (!video) return;

      // Downscale to 160x120 to stay under Pusher's 10KB payload limit
      const CAPTURE_W = 160;
      const CAPTURE_H = 120;

      const canvas = document.createElement('canvas');
      canvas.width = CAPTURE_W;
      canvas.height = CAPTURE_H;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(video, 0, 0, CAPTURE_W, CAPTURE_H);
      const imageData = canvas.toDataURL('image/jpeg', 0.6);

      const channel = channelRef.current;
      const me = (channel as unknown as { members?: { me?: { id: string } } })
        ?.members?.me;
      const memberId = me?.id ?? crypto.randomUUID();

      setSession((prev) => (prev ? { ...prev, status: 'capturing' } : prev));

      await fetch('/api/session/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: channelName,
          event: 'client-photo',
          data: { memberId, name: displayName, imageData },
        }),
      });
    },
    [videoRef, displayName]
  );

  // -------------------------------------------------------------------------
  // Subscribe to Pusher presence channel
  // -------------------------------------------------------------------------

  const subscribeToChannel = useCallback(
    (pusher: Pusher, channelName: string, isHost: boolean) => {
      const channel = pusher.subscribe(channelName);
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
            captureAndSubmit(channelName);
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

          if (isHost) {
            setSession((prev) => {
              if (!prev) return prev;
              if (photosRef.current.size >= prev.members.length && prev.members.length > 0) {
                // Trigger assembly asynchronously
                assembleAll(channelName);
              }
              return prev;
            });
          }
        }
      );

      channel.bind(
        'client-collage',
        (data: { collageUrl: string }) => {
          setCollageUrl(data.collageUrl);
          setSession((prev) => (prev ? { ...prev, status: 'done' } : prev));
        }
      );
    },
    [captureAndSubmit, assembleAll]
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
  // submitPhoto (manual submission)
  // -------------------------------------------------------------------------

  const submitPhoto = useCallback(
    async (imageDataUrl: string) => {
      if (!session) return;

      const channel = channelRef.current;
      const me = (channel as unknown as { members?: { me?: { id: string } } })
        ?.members?.me;
      const memberId = me?.id ?? crypto.randomUUID();

      await fetch('/api/session/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: session.channelName,
          event: 'client-photo',
          data: { memberId, name: displayName, imageData: imageDataUrl },
        }),
      });
    },
    [session, displayName]
  );

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
    photosRef.current.clear();
  }, []);

  // -------------------------------------------------------------------------
  // resetCollage
  // -------------------------------------------------------------------------

  const resetCollage = useCallback(() => {
    setCollageUrl(null);
    setSession((prev) => (prev ? { ...prev, status: 'idle' } : prev));
    photosRef.current.clear();
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
    createSession,
    joinSession,
    triggerCountdown,
    submitPhoto,
    leaveSession,
    resetCollage,
  };
}

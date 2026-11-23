'use client';
import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';

const OPTS = { path: '/socket.io', withCredentials: true } as const;

let userSocket: Socket | null = null;
const boardSockets = new Map<string, Socket>();

/** Cookie-authenticated singleton. Never returns a board socket. */
export function getSocket(): Socket {
  if (typeof window === 'undefined') return null as unknown as Socket;
  if (!userSocket) userSocket = io(OPTS);
  return userSocket;
}

/** Board socket, one per token, authenticated by the token only (no user rooms). */
export function getBoardSocket(token: string): Socket {
  if (typeof window === 'undefined') return null as unknown as Socket;
  let s = boardSockets.get(token);
  if (!s) {
    s = io({ ...OPTS, query: { board: token } });
    boardSockets.set(token, s);
  }
  return s;
}

/**
 * Drop the user socket so the next getSocket() re-handshakes with the current cookie.
 * Call after login, register, password reset/change and logout, before a full page reload.
 */
export function resetSocket(): void {
  if (userSocket) {
    userSocket.disconnect();
    userSocket = null;
  }
}

/** Best-effort: unsubscribe this device from push within 1.5 s; never throws. Returns its endpoint. */
async function dropPushSubscription(): Promise<string | undefined> {
  const work = (async () => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return undefined;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    if (!sub) return undefined;
    const endpoint = sub.endpoint;
    sub.unsubscribe().catch(() => {});
    return endpoint;
  })().catch(() => undefined);
  return Promise.race([work, new Promise<undefined>((r) => setTimeout(() => r(undefined), 1500))]);
}

/** Log out, drop the socket and reload so no rooms or state of the previous user survive. */
export async function logout(redirect = '/login'): Promise<void> {
  try {
    const endpoint = await dropPushSubscription();
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(endpoint ? { endpoint } : {}),
    });
  } finally {
    resetSocket();
    window.location.assign(redirect);
  }
}

function useBound<T>(socket: Socket | null, event: string, handler: (payload: T) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!socket) return;
    const fn = (p: T) => ref.current(p);
    socket.on(event, fn);
    return () => {
      socket.off(event, fn);
    };
  }, [socket, event]);
}

export function useLive<T = unknown>(event: string, handler: (payload: T) => void): void {
  useBound(typeof window === 'undefined' ? null : getSocket(), event, handler);
}

/** For the public board page: listens on the token-only socket. */
export function useBoardLive<T = unknown>(token: string, event: string, handler: (payload: T) => void): void {
  useBound(typeof window === 'undefined' ? null : getBoardSocket(token), event, handler);
}

/** School admins pick their branch room explicitly; re-joins after every (re)connect. */
export function useJoinBranch(branchId: string | null | undefined): void {
  const socket = typeof window === 'undefined' ? null : getSocket();
  useEffect(() => {
    if (!branchId || !socket) return;
    const join = () => socket.emit('join-branch', { branchId });
    if (socket.connected) join();
    socket.on('connect', join);
    return () => {
      socket.off('connect', join);
    };
  }, [socket, branchId]);
}

/** Calls cb when the socket reconnects (not on first connect) so pages refetch missed data. Pass a token for the board page. */
export function useOnReconnect(cb: () => void, boardToken?: string): void {
  const ref = useRef(cb);
  ref.current = cb;
  const socket = typeof window === 'undefined' ? null : boardToken ? getBoardSocket(boardToken) : getSocket();
  useEffect(() => {
    if (!socket) return;
    const fn = () => ref.current();
    socket.io.on('reconnect', fn);
    return () => {
      socket.io.off('reconnect', fn);
    };
  }, [socket]);
}

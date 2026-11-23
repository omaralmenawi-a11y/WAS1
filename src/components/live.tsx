'use client';
import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;
let boardToken: string | undefined;

/** Singleton connection. Pass `{board: token}` (board page) on first use to connect as a board client. */
export function useSocket(opts?: { board?: string }): Socket {
  if (typeof window === 'undefined') return null as unknown as Socket;
  if (opts?.board && opts.board !== boardToken && socket) {
    socket.close();
    socket = null;
  }
  if (!socket) {
    boardToken = opts?.board;
    socket = io({
      path: '/socket.io',
      withCredentials: true,
      ...(opts?.board ? { query: { board: opts.board } } : {}),
    });
  }
  return socket;
}

export function useLive<T = unknown>(event: string, handler: (payload: T) => void, opts?: { board?: string }): void {
  const ref = useRef(handler);
  ref.current = handler;
  const board = opts?.board;
  useEffect(() => {
    const s = useSocket(board ? { board } : undefined);
    const fn = (p: T) => ref.current(p);
    s.on(event, fn);
    return () => {
      s.off(event, fn);
    };
  }, [event, board]);
}

/** School admins pick their branch room explicitly; re-joins after reconnect. */
export function useJoinBranch(branchId: string | null | undefined): void {
  useEffect(() => {
    if (!branchId) return;
    const s = useSocket();
    const join = () => s.emit('join-branch', { branchId });
    join();
    s.on('connect', join);
    return () => {
      s.off('connect', join);
    };
  }, [branchId]);
}

/** Calls cb when the socket reconnects (not on first connect) so pages refetch missed data. */
export function useOnReconnect(cb: () => void, opts?: { board?: string }): void {
  const ref = useRef(cb);
  ref.current = cb;
  const board = opts?.board;
  useEffect(() => {
    const s = useSocket(board ? { board } : undefined);
    const fn = () => ref.current();
    s.io.on('reconnect', fn);
    return () => {
      s.io.off('reconnect', fn);
    };
  }, [board]);
}

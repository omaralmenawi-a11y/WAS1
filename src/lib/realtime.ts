import type { Server, Socket } from 'socket.io';
import { prisma } from './db';
import { getSessionUser } from './auth/session';
import { assertBranchAccess } from './authz';
import { SESSION_COOKIE } from './http';
import { loadRequestForViews, toBoardEntry, toOwnerView, toStaffView } from './pickup/views';

type G = typeof globalThis & { __waslIo?: Server };

/** server.ts (compiled separately) stores the io handle on globalThis so bundled Next code can reach it. */
export function setIo(io: Server | undefined): void {
  (globalThis as G).__waslIo = io;
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function attachRealtime(io: Server): void {
  io.use(async (socket, next) => {
    try {
      const boardToken = socket.handshake.query.board;
      if (typeof boardToken === 'string' && boardToken) {
        const branch = await prisma.branch.findUnique({ where: { boardToken }, select: { id: true } });
        if (branch) {
          socket.data.boardBranchId = branch.id;
          return next();
        }
      }
      const user = await getSessionUser(cookieValue(socket.handshake.headers.cookie, SESSION_COOKIE));
      if (user) socket.data.user = user;
      next();
    } catch (e) {
      next(e instanceof Error ? e : new Error('handshake failed'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const { user, boardBranchId } = socket.data as { user?: import('@prisma/client').User; boardBranchId?: string };
    if (boardBranchId) {
      void socket.join(`board:${boardBranchId}`);
      return;
    }
    if (!user) return;
    void socket.join(`user:${user.id}`);
    if (user.role === 'STAFF' && user.branchId) void socket.join(`branch:${user.branchId}`);
    if (user.role === 'SCHOOL_ADMIN' || user.role === 'PLATFORM_ADMIN') {
      socket.on('join-branch', async (payload: unknown) => {
        const branchId = (payload as { branchId?: unknown } | null)?.branchId;
        try {
          if (typeof branchId !== 'string') throw new Error('bad branchId');
          await assertBranchAccess(user, branchId);
          await socket.join(`branch:${branchId}`);
        } catch {
          socket.emit('error:access', { branchId });
        }
      });
    }
  });
}

/** Called after every pickup mutation commits. Never throws; no-op when io is unset. */
export async function emitPickupChanged(requestId: string): Promise<void> {
  const io = (globalThis as G).__waslIo;
  if (!io) return;
  try {
    const r = await loadRequestForViews(requestId);
    if (!r) return;
    io.to(`branch:${r.branchId}`).emit('pickup:changed', toStaffView(r));
    io.to(`user:${r.requesterId}`).emit('pickup:changed', toOwnerView(r));
    io.to(`board:${r.branchId}`).emit('board:update', toBoardEntry(r));
  } catch (e) {
    console.error('emitPickupChanged failed', e);
  }
}

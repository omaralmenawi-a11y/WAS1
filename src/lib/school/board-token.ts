import { randomBytes } from 'node:crypto';

/** 24-char URL-safe token identifying a branch's public board. */
export function newBoardToken(): string {
  return randomBytes(18).toString('base64url');
}

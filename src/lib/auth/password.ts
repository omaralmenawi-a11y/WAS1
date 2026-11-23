import argon2 from 'argon2';

export function hashPassword(p: string): Promise<string> {
  return argon2.hash(p, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, p: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, p);
  } catch {
    return false;
  }
}

import { ValidationError } from '../errors';
import { normalizePhone } from '../phone';

export type Identifier = { kind: 'email' | 'phone'; value: string };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function parseIdentifier(input: string): Identifier {
  if (input.includes('@')) {
    const value = input.trim().toLowerCase();
    if (!EMAIL_RE.test(value)) throw new ValidationError('البريد الإلكتروني غير صالح');
    return { kind: 'email', value };
  }
  const phone = normalizePhone(input);
  if (!phone) throw new ValidationError('رقم الجوال أو البريد الإلكتروني غير صالح');
  return { kind: 'phone', value: phone };
}

/** Single place usernames are normalised (creation and login lookup). */
export function normalizeUsername(s: string): string {
  return s.trim().toLowerCase();
}

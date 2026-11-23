import { resetPassword } from '@/lib/auth/accounts';
import { handle, readJson } from '@/lib/http';

export async function POST(req: Request) {
  return handle(async () => {
    const b = await readJson(req);
    await resetPassword({
      identifier: String(b.identifier ?? ''),
      code: String(b.code ?? ''),
      password: String(b.password ?? ''),
    });
    return Response.json({ ok: true });
  });
}

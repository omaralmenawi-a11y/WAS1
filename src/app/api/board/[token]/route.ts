import { errorResponse } from '@/lib/http';
import { getBoard } from '@/lib/pickup/board';

export const dynamic = 'force-dynamic';

const HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

// Public: the board token is the only credential. Payload holds numbers and gates only.
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    return Response.json(await getBoard(token), { headers: HEADERS });
  } catch (e) {
    const res = errorResponse(e);
    for (const [k, v] of Object.entries(HEADERS)) res.headers.set(k, v);
    return res;
  }
}

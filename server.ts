import { createServer } from 'node:http';
import next from 'next';
import { Server } from 'socket.io';
import { attachRealtime, setIo } from './src/lib/realtime';
import { closeStaleRequests } from './src/lib/pickup/service';
import { assertPickupCodeSecret } from './src/lib/pickup/code';
import { checkProductionEnv, webPushStatus } from './src/lib/env-check';
import { runDismissalNotifications } from './src/lib/notify/dismissal';

const STALE_SWEEP_MS = 10 * 60_000;

/** Closes open requests of earlier days (cancels items, clears the parent's location). Never throws. */
function sweepStale(): void {
  closeStaleRequests()
    .then((n) => n > 0 && console.log(`closed ${n} stale pickup request(s)`))
    .catch((e) => console.error('stale request sweep failed', e));
}

const DEFAULT_NOTIFY_TICK_MS = 60_000;
let notifyRunning = false;

/** Dismissal reminders / end-of-day notices. Skips while the previous tick is still running. Never throws. */
async function notifyTick(): Promise<void> {
  if (notifyRunning) return;
  notifyRunning = true;
  try {
    const r = await runDismissalNotifications();
    if (r.reminders || r.endOfDay) console.log(`dismissal notifications: ${r.reminders} reminder(s), ${r.endOfDay} end-of-day`);
  } catch (e) {
    console.error('dismissal notification tick failed', e);
  } finally {
    notifyRunning = false;
  }
}

const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT ?? 3000);
const app = next({ dev });
const handle = app.getRequestHandler();

/** Refuses to start (exit 1) on unsafe configuration; runs after Next has loaded .env files. */
function checkEnvOrExit(): void {
  const { errors, warnings } = checkProductionEnv(process.env);
  try {
    assertPickupCodeSecret();
  } catch (e) {
    errors.push((e as Error).message);
  }
  for (const w of warnings) console.warn(`\n!!! WARNING: ${w}\n`);
  console.log(webPushStatus(process.env));
  if (errors.length) {
    for (const e of new Set(errors)) console.error(`Refusing to start: ${e}`);
    process.exit(1);
  }
}

app.prepare().then(() => {
  checkEnvOrExit();
  const httpServer = createServer((req, res) => handle(req, res));
  const io = new Server(httpServer, { path: '/socket.io' });
  setIo(io);
  attachRealtime(io);
  httpServer.listen(port, () => console.log(`> WASL ready on http://localhost:${port}`));
  sweepStale();
  setInterval(sweepStale, STALE_SWEEP_MS).unref();
  const tickMs = Number(process.env.NOTIFY_TICK_MS);
  void notifyTick();
  setInterval(() => void notifyTick(), Number.isFinite(tickMs) && tickMs > 0 ? tickMs : DEFAULT_NOTIFY_TICK_MS).unref();
});

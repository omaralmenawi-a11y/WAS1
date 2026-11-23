import { createServer } from 'node:http';
import next from 'next';
import { Server } from 'socket.io';
import { attachRealtime, setIo } from './src/lib/realtime';
import { closeStaleRequests } from './src/lib/pickup/service';

const STALE_SWEEP_MS = 10 * 60_000;

/** Closes open requests of earlier days (cancels items, clears the parent's location). Never throws. */
function sweepStale(): void {
  closeStaleRequests()
    .then((n) => n > 0 && console.log(`closed ${n} stale pickup request(s)`))
    .catch((e) => console.error('stale request sweep failed', e));
}

const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT ?? 3000);
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => handle(req, res));
  const io = new Server(httpServer, { path: '/socket.io' });
  setIo(io);
  attachRealtime(io);
  httpServer.listen(port, () => console.log(`> WASL ready on http://localhost:${port}`));
  sweepStale();
  setInterval(sweepStale, STALE_SWEEP_MS).unref();
});

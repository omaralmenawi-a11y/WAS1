'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useBoardLive, useOnReconnect } from '@/components/live';

type Tile = { number: number; gateName: string };
type Snapshot = { branchName: string; preparing: Tile[]; ready: Tile[] };
type Entry = { number: number; gateName: string; status: 'PREPARING' | 'READY' | 'GONE' };
type State = { preparing: Map<number, Tile>; ready: Map<number, Tile> };

const HIGHLIGHT_MS = 5000;
const FALLBACK_MS = 60_000;
const toMap = (l: Tile[]) => new Map(l.map((t) => [t.number, t]));
const sorted = (m: Map<number, Tile>) => [...m.values()].sort((a, b) => a.number - b.number);

const clockFmt = new Intl.DateTimeFormat('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

function Clock() {
  const [t, setT] = useState('');
  useEffect(() => {
    const tick = () => setT(clockFmt.format(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span dir="ltr" className="tabular-nums" suppressHydrationWarning>{t}</span>;
}

export function BoardClient({ token }: { token: string }) {
  const [branchName, setBranchName] = useState('');
  const [state, setState] = useState<State>({ preparing: new Map(), ready: new Map() });
  const [invalid, setInvalid] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const seeded = useRef(false);

  const highlight = useCallback((n: number) => {
    setFresh((s) => new Set(s).add(n));
    const old = timers.current.get(n);
    if (old) clearTimeout(old);
    timers.current.set(
      n,
      setTimeout(() => {
        timers.current.delete(n);
        setFresh((s) => {
          const c = new Set(s);
          c.delete(n);
          return c;
        });
      }, HIGHLIGHT_MS),
    );
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/board/${encodeURIComponent(token)}`, { cache: 'no-store' });
      if (res.status === 404) {
        setInvalid(true);
        return;
      }
      if (!res.ok) return;
      const d = (await res.json()) as Snapshot;
      const wasSeeded = seeded.current;
      setInvalid(false);
      setBranchName(d.branchName);
      setState((prev) => {
        const next = { preparing: toMap(d.preparing), ready: toMap(d.ready) };
        // Tiles that became READY since the last snapshot highlight too; the very first load does not.
        if (wasSeeded) for (const n of next.ready.keys()) if (!prev.ready.has(n)) queueMicrotask(() => highlight(n));
        return next;
      });
      seeded.current = true;
      setLoaded(true);
    } catch {
      /* offline: keep what is on screen; the next tick retries */
    }
  }, [token, highlight]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), FALLBACK_MS);
    const timerMap = timers.current;
    return () => {
      clearInterval(id);
      timerMap.forEach(clearTimeout);
      timerMap.clear();
    };
  }, [load]);

  useOnReconnect(() => void load(), token);

  useBoardLive<Entry>(token, 'board:update', (e) => {
    setState((prev) => {
      const preparing = new Map(prev.preparing);
      const ready = new Map(prev.ready);
      preparing.delete(e.number);
      ready.delete(e.number);
      const tile = { number: e.number, gateName: e.gateName };
      if (e.status === 'PREPARING') preparing.set(e.number, tile);
      else if (e.status === 'READY') {
        ready.set(e.number, tile);
        if (!prev.ready.has(e.number)) queueMicrotask(() => highlight(e.number));
      }
      return { preparing, ready };
    });
  });

  // Keep the screen awake; browsers may refuse (no support, battery saver, hidden tab).
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const request = async () => {
      try {
        if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
        const l = await navigator.wakeLock.request('screen');
        if (stopped) void l.release().catch(() => {});
        else lock = l;
      } catch {
        /* tolerated */
      }
    };
    void request();
    document.addEventListener('visibilitychange', request);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', request);
      void lock?.release().catch(() => {});
    };
  }, []);

  if (invalid) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-navy p-8 text-center text-white">
        <h1 className="text-4xl font-bold">رابط الشاشة غير صالح</h1>
      </main>
    );
  }

  const preparing = sorted(state.preparing);
  const ready = sorted(state.ready);

  return (
    <main className="flex h-screen min-h-screen flex-col overflow-hidden bg-navy text-white">
      <header className="flex items-center justify-between gap-4 px-6 py-4 lg:px-12 lg:py-6">
        <h1 className="truncate text-3xl font-bold lg:text-5xl">{branchName}</h1>
        <div className="text-3xl font-medium text-white/80 lg:text-5xl">
          <Clock />
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 px-4 pb-4 sm:grid-cols-2 lg:gap-8 lg:px-12 lg:pb-10">
        <Column title="قيد التجهيز" tiles={preparing} loaded={loaded} tone="preparing" fresh={fresh} />
        <Column title="جاهز للاستلام — توجّه إلى البوابة" tiles={ready} loaded={loaded} tone="ready" fresh={fresh} />
      </div>
    </main>
  );
}

function Column({ title, tiles, tone, fresh, loaded }: { title: string; tiles: Tile[]; tone: 'preparing' | 'ready'; fresh: Set<number>; loaded: boolean }) {
  const isReady = tone === 'ready';
  return (
    <section
      aria-label={title}
      className={`flex min-h-0 flex-col rounded-3xl border-2 p-4 lg:p-8 ${isReady ? 'border-teal bg-teal/25' : 'border-white/20 bg-white/5'}`}
    >
      <h2 className={`mb-4 text-2xl font-bold lg:mb-6 lg:text-4xl ${isReady ? 'text-white' : 'text-white/80'}`}>{title}</h2>
      <ul className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 content-start gap-3 -m-3 overflow-y-auto p-3 lg:grid-cols-3 lg:gap-5">
        {tiles.map((t) => (
          <li
            key={t.number}
            className={`flex flex-col items-center justify-center rounded-2xl px-2 py-4 text-center transition-colors lg:py-6 ${
              isReady ? 'bg-teal' : 'bg-white/10'
            } ${fresh.has(t.number) ? 'board-fresh' : ''}`}
          >
            <span className="font-heading text-6xl font-bold leading-none tabular-nums lg:text-9xl">{t.number}</span>
            <span className="mt-2 text-xl font-medium text-white/85 lg:text-3xl">{t.gateName}</span>
          </li>
        ))}
      </ul>
      {loaded && tiles.length === 0 && <p className="mt-auto pt-4 text-center text-xl text-white/40 lg:text-2xl">—</p>}
    </section>
  );
}

'use client';

/**
 * The main thread's side of the planner worker. One worker per tab, created on
 * first use, with every request tracked by id so a slider drag that outruns the
 * search resolves in order rather than racing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Envelope, Reply, Request } from './protocol';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (value: Reply) => void; reject: (e: Error) => void }>();

function ensureWorker(): Worker {
  if (worker !== null) return worker;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.addEventListener('message', (event: MessageEvent<Reply>) => {
    const reply = event.data;
    const waiting = pending.get(reply.id);
    if (waiting === undefined) return;
    pending.delete(reply.id);
    if (reply.ok) waiting.resolve(reply);
    else waiting.reject(new Error(reply.error ?? 'the planner failed without a message'));
  });
  return worker;
}

export function send(request: Request): Promise<Reply> {
  const instance = ensureWorker();
  const id = nextId;
  nextId += 1;
  return new Promise<Reply>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    instance.postMessage({ id, request } satisfies Envelope);
  });
}

export interface RunState<T> {
  data: T | null;
  error: string | null;
  running: boolean;
}

/**
 * Run a request whenever its inputs change, keeping the last good answer on
 * screen while the next one computes. A planner that blanked on every keystroke
 * would be unreadable, and a stale answer with a working indicator beside it is
 * more useful than an empty panel.
 */
export function usePlannerRun<T>(
  build: () => Request | null,
  select: (reply: Reply) => T,
  dependencies: readonly unknown[],
): RunState<T> {
  const [state, setState] = useState<RunState<T>>({ data: null, error: null, running: false });
  const latest = useRef(0);

  const run = useCallback(() => {
    const request = build();
    if (request === null) return;
    const ticket = latest.current + 1;
    latest.current = ticket;
    setState((previous) => ({ ...previous, running: true }));
    send(request)
      .then((reply) => {
        if (latest.current !== ticket) return;
        setState({ data: select(reply), error: null, running: false });
      })
      .catch((error: unknown) => {
        if (latest.current !== ticket) return;
        setState({
          data: null,
          error: error instanceof Error ? error.message : 'the planner failed',
          running: false,
        });
      });
    // The builder and selector are recreated every render by design: the
    // dependency list the caller passes is what decides when to rerun, because
    // a pool of six hundred players is not a dependency worth comparing.
  }, dependencies);

  useEffect(() => {
    run();
  }, [run]);

  return state;
}

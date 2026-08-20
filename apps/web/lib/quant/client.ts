'use client';

/**
 * The main thread's side of the worker. One worker per tab, created on first
 * use, with every request tracked by id so several panels can be in flight at
 * once without stepping on each other.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Envelope, Reply, Request } from './protocol';

export interface RunResult<T> {
  result: T;
  elapsed: number;
  rows: number;
}

interface Pending {
  resolve: (value: RunResult<unknown>) => void;
  reject: (error: Error) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function ensureWorker(): Worker {
  if (worker !== null) return worker;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.addEventListener('message', (event: MessageEvent<Reply>) => {
    const reply = event.data;
    const waiting = pending.get(reply.id);
    if (waiting === undefined) return;
    pending.delete(reply.id);
    if (reply.ok)
      waiting.resolve({ result: reply.result, elapsed: reply.elapsed, rows: reply.rows ?? 0 });
    else waiting.reject(new Error(reply.error ?? 'the engine failed without a message'));
  });
  return worker;
}

export function send<T>(request: Request): Promise<RunResult<T>> {
  const instance = ensureWorker();
  const id = nextId;
  nextId += 1;
  return new Promise<RunResult<T>>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: RunResult<unknown>) => void, reject });
    const envelope: Envelope = { id, request };
    instance.postMessage(envelope);
  });
}

export interface QueryState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  elapsed: number;
  rows: number;
}

/**
 * Run a request whenever its key changes. A superseded reply is discarded
 * rather than rendered, so a fast panel switch cannot leave the previous
 * panel's numbers on screen under the new panel's title.
 */
export function useQuery<T>(request: Request | null, key: string): QueryState<T> {
  const [state, setState] = useState<QueryState<T>>({
    data: null,
    error: null,
    loading: request !== null,
    elapsed: 0,
    rows: 0,
  });
  const latest = useRef(0);

  useEffect(() => {
    if (request === null) {
      setState({ data: null, error: null, loading: false, elapsed: 0, rows: 0 });
      return;
    }
    latest.current += 1;
    const ticket = latest.current;
    setState((previous) => ({ ...previous, loading: true, error: null }));

    send<T>(request)
      .then((run) => {
        if (ticket !== latest.current) return;
        setState({
          data: run.result,
          error: null,
          loading: false,
          elapsed: run.elapsed,
          rows: run.rows,
        });
      })
      .catch((error: unknown) => {
        if (ticket !== latest.current) return;
        setState({
          data: null,
          error: error instanceof Error ? error.message : String(error),
          loading: false,
          elapsed: 0,
          rows: 0,
        });
      });
    // The key is the serialised request. The request object itself changes
    // identity on every render, and depending on that would put the worker in
    // a loop, so the key is the dependency and the request is read through it.
  }, [key]);

  return state;
}

/** A one off run, for an action rather than a view: an export, a refit. */
export function useAction<T>(): {
  run: (request: Request) => Promise<T>;
  running: boolean;
  error: string | null;
} {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (request: Request): Promise<T> => {
    setRunning(true);
    setError(null);
    try {
      const result = await send<T>(request);
      return result.result;
    } catch (caught: unknown) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      throw caught;
    } finally {
      setRunning(false);
    }
  }, []);

  return { run, running, error };
}

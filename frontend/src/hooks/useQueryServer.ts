import { useCallback, useEffect, useRef, useState } from 'react';

// The local query server runs on 127.0.0.1:7799 by default (see
// scraper/query_server.py). Exposed here so a single constant feeds both
// the liveness check and the query call.
const QUERY_SERVER_URL = 'http://127.0.0.1:7799';

// Poll /health every 15s so the "Ask Claude" bar appears within one tick
// of the user starting the server (and disappears if it goes down).
const HEALTH_POLL_INTERVAL_MS = 15_000;

// Liveness check abort timeout — shorter than the poll interval. If the
// server is down, this is how long we wait before declaring unavailable.
const HEALTH_REQUEST_TIMEOUT_MS = 1_500;

export interface QueryMatch {
  id: string;
  reason: string;
}

export interface QueryResponse {
  question: string;
  model: string;
  matches: QueryMatch[];
  totalConsidered: number;
}

type Status = 'checking' | 'available' | 'unavailable';

/**
 * Talks to the local scraper/query_server.py — only useful in dev mode where
 * the developer has started the server manually. Pings /health on mount and
 * every HEALTH_POLL_INTERVAL_MS, plus on window focus, so the UI can surface
 * the feature as soon as the server comes up (and hide it if it goes away).
 */
export const useQueryServer = () => {
  const [status, setStatus] = useState<Status>('checking');
  const [model, setModel] = useState<string>('');
  const cancelledRef = useRef(false);

  const check = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HEALTH_REQUEST_TIMEOUT_MS);
      const res = await fetch(`${QUERY_SERVER_URL}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error('bad status');
      const body = (await res.json()) as {
        ok: boolean;
        claudeAvailable: boolean;
        model?: string;
      };
      if (cancelledRef.current) return;
      if (body.ok && body.claudeAvailable) {
        setStatus('available');
        setModel(body.model ?? '');
      } else {
        setStatus('unavailable');
      }
    } catch {
      if (!cancelledRef.current) setStatus('unavailable');
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    check();
    const interval = setInterval(check, HEALTH_POLL_INTERVAL_MS);
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelledRef.current = true;
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [check]);

  const ask = useCallback(
    async (
      question: string,
      limit = 15,
      projectContext?: string,
    ): Promise<QueryResponse> => {
      const body: Record<string, unknown> = { question, limit };
      if (projectContext && projectContext.trim()) {
        body.projectContext = projectContext;
      }
      const res = await fetch(`${QUERY_SERVER_URL}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }
      return (await res.json()) as QueryResponse;
    },
    [],
  );

  return { status, model, ask };
};

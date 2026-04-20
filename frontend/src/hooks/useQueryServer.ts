import { useCallback, useEffect, useState } from 'react';

// The local query server runs on 127.0.0.1:7799 by default (see
// scraper/query_server.py). Exposed here so a single constant feeds both
// the liveness check and the query call.
const QUERY_SERVER_URL = 'http://127.0.0.1:7799';

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
 * the developer has started the server manually. Pings /health on mount so
 * the UI can hide the feature entirely if the server isn't running.
 */
export const useQueryServer = () => {
  const [status, setStatus] = useState<Status>('checking');
  const [model, setModel] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 1500);
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
        if (cancelled) return;
        if (body.ok && body.claudeAvailable) {
          setStatus('available');
          setModel(body.model ?? '');
        } else {
          setStatus('unavailable');
        }
      } catch {
        if (!cancelled) setStatus('unavailable');
      }
    };
    check();
    return () => {
      cancelled = true;
    };
  }, []);

  const ask = useCallback(
    async (question: string, limit = 15): Promise<QueryResponse> => {
      const res = await fetch(`${QUERY_SERVER_URL}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, limit }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      return (await res.json()) as QueryResponse;
    },
    []
  );

  return { status, model, ask };
};

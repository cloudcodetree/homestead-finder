import { useState } from 'react';
import { useQueryServer, QueryResponse } from '../hooks/useQueryServer';

interface AskClaudeProps {
  onResult: (result: QueryResponse | null) => void;
  activeQuestion: string | null;
}

/**
 * Search bar that sends a natural-language question to the local
 * query_server.py and passes the ranked matches up to the parent. Only
 * renders when the server health check succeeds — in production (GitHub
 * Pages) the server isn't running, so this component collapses to null.
 */
export const AskClaude = ({ onResult, activeQuestion }: AskClaudeProps) => {
  const { status, model, ask } = useQueryServer();
  const [question, setQuestion] = useState(activeQuestion ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status !== 'available') return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await ask(trimmed);
      onResult(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Query failed';
      setError(msg);
      onResult(null);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setQuestion('');
    setError(null);
    onResult(null);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-4 max-w-6xl mx-auto rounded-lg border border-purple-200 bg-purple-50/40 p-3"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold text-purple-800">
          Ask Claude
        </span>
        <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded font-medium tracking-wide uppercase">
          Local · {model}
        </span>
        {activeQuestion && (
          <button
            type="button"
            onClick={handleClear}
            className="ml-auto text-xs text-purple-700 hover:text-purple-900 font-medium"
          >
            Clear query
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder='e.g. "cheap creek-front land with no HOA" or "build-ready 40+ acres under $100k"'
          maxLength={500}
          className="flex-1 border border-purple-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-purple-500 focus:outline-none"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
        >
          {loading ? 'Asking…' : 'Ask'}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-xs text-red-600">
          {error}. Is query_server.py still running?
        </p>
      )}
      <p className="mt-2 text-[11px] text-purple-600/70">
        Uses your Claude Max subscription via the local proxy. Results re-rank
        the full listing set — clear to return to the normal view.
      </p>
    </form>
  );
};

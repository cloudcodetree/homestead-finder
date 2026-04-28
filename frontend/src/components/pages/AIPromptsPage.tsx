import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useUserPreferences } from '../../hooks/useUserPreferences';
import { DEFAULT_PREFERENCES } from '../../types/preferences';

const VISION_MAX = 400;
const HINTS_MAX = 600;

/**
 * Vision #4 — tweakable AI prompts.
 *
 * Exposes two free-form text fields the user can edit any time to
 * shape how Claude ranks and answers questions about listings:
 *
 *   - **Your vision** — descriptive paragraph: "what would make a
 *     property perfect for you?" Feeds the AskClaude system prompt
 *     as a flavor-of-buyer fragment.
 *   - **Ranking hints** — imperative rules: "boost owner-financed
 *     listings", "deduct points for HOAs", etc. Concatenated into
 *     the system prompt as a numbered ruleset.
 *
 * Persists to the same `user_preferences` row that onboarding
 * captures. Anonymous users get a sign-in prompt instead.
 */
export const AIPromptsPage = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { preferences, save, loading: prefsLoading } = useUserPreferences();
  const [vision, setVision] = useState('');
  const [hints, setHints] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setVision(preferences.vision ?? '');
    setHints(preferences.rankingHints ?? '');
  }, [preferences.vision, preferences.rankingHints]);

  if (authLoading) return null;

  if (!user) {
    return (
      <div className="p-8 max-w-md mx-auto text-center">
        <h1 className="text-lg font-bold text-gray-900 mb-2">AI prompts</h1>
        <p className="text-sm text-gray-600 mb-4">
          Sign in to customize how Claude ranks and answers questions about
          listings for you.
        </p>
        <button
          onClick={() => navigate('/landing')}
          className="text-green-600 hover:text-green-700 text-sm font-medium"
        >
          ← Back to landing
        </button>
      </div>
    );
  }

  const onSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await save(
        {
          ...DEFAULT_PREFERENCES,
          ...preferences,
          vision: vision.trim().slice(0, VISION_MAX),
          rankingHints: hints.trim().slice(0, HINTS_MAX),
        },
        { complete: false },
      );
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <header className="mb-5">
        <h1 className="text-xl font-bold text-gray-900">AI prompts</h1>
        <p className="text-sm text-gray-600 mt-1">
          Customize how Claude thinks about listings on your behalf. These
          prompts apply every time the &ldquo;Recommended for you&rdquo;
          sort runs, every Ask-Claude question, and every personalized
          ranking. Saved per user — only you see them.
        </p>
      </header>

      <section className="mb-6">
        <label
          htmlFor="vision"
          className="block text-sm font-semibold text-gray-800 mb-1"
        >
          Your vision
        </label>
        <p className="text-xs text-gray-500 mb-2">
          A descriptive paragraph in your own words — the kind of property
          you&apos;re imagining.{' '}
          <em>e.g. &ldquo;Off-grid 20–40 acres with mature timber, a creek,
          and good south-facing slope for solar.&rdquo;</em>
        </p>
        <textarea
          id="vision"
          value={vision}
          onChange={(e) => setVision(e.target.value.slice(0, VISION_MAX))}
          rows={4}
          maxLength={VISION_MAX}
          placeholder="What does your homestead look like?"
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-green-500 focus:outline-none resize-y"
          disabled={prefsLoading}
        />
        <p className="text-[11px] text-gray-400 mt-1 text-right">
          {vision.length} / {VISION_MAX}
        </p>
      </section>

      <section className="mb-6">
        <label
          htmlFor="hints"
          className="block text-sm font-semibold text-gray-800 mb-1"
        >
          Ranking hints <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <p className="text-xs text-gray-500 mb-2">
          Specific rules for the ranker. One per line works well.{' '}
          <em>e.g.<br />
          &nbsp;&nbsp;Boost listings with owner financing.<br />
          &nbsp;&nbsp;Deduct points if HOA is mentioned.<br />
          &nbsp;&nbsp;Avoid floodplain — non-negotiable.</em>
        </p>
        <textarea
          id="hints"
          value={hints}
          onChange={(e) => setHints(e.target.value.slice(0, HINTS_MAX))}
          rows={6}
          maxLength={HINTS_MAX}
          placeholder="Each line is a rule. Imperative voice helps the model follow it."
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-green-500 focus:outline-none resize-y font-mono"
          disabled={prefsLoading}
        />
        <p className="text-[11px] text-gray-400 mt-1 text-right">
          {hints.length} / {HINTS_MAX}
        </p>
      </section>

      {error && (
        <p className="text-sm text-red-600 mb-3" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={() => void onSave()}
          disabled={saving || prefsLoading}
          className="bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-medium px-4 py-2 rounded-lg text-sm"
        >
          {saving ? 'Saving…' : 'Save prompts'}
        </button>
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-gray-600 hover:text-gray-900"
        >
          Back
        </button>
        {savedAt && Date.now() - savedAt < 4000 && (
          <span className="text-xs text-emerald-700">✓ Saved</span>
        )}
      </div>

      <p className="text-[11px] text-gray-400 mt-6 leading-snug">
        These prompts are appended to Claude&apos;s system prompt for every
        ranking and Ask-Claude call you make. They never affect other
        users. To clear, blank both fields and save.
      </p>
    </div>
  );
};

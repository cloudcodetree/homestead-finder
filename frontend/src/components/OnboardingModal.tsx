import { useMemo, useState } from 'react';
import { FEATURE_LABELS } from '../types/property';
import type { PropertyFeature } from '../types/property';
import { DEFAULT_PREFERENCES, UserPreferences } from '../types/preferences';
import { useAuth } from '../hooks/useAuth';
import { useUserPreferences } from '../hooks/useUserPreferences';

/**
 * First-time-user preference capture. Triggered once per user when
 * they sign in and have no `completed_at` stamp on their preferences
 * row. Dismissible — we stamp `completed_at` even on skip so we don't
 * pester them, but they can edit from the account menu any time.
 *
 * Design principles:
 *   * Every question optional. Skip at any step. Friction > accuracy.
 *   * 4-5 questions max. Each adds measurable ranking signal.
 *   * One screen, no multi-step wizard — we found users don't finish
 *     >3-step onboarding flows at our conversion rate.
 *   * Defaults to "any" everywhere so leaving fields blank is meaningful.
 */

const SHOPPER_OPTIONS: Array<{
  value: UserPreferences['shopperMode'];
  label: string;
  hint: string;
}> = [
  { value: 'any', label: 'Open to anything', hint: 'Show me the full range' },
  {
    value: 'move_in_ready',
    label: '🏠 Move-in ready',
    hint: 'Dwelling + water already there',
  },
  { value: 'improved', label: '🔧 Improved', hint: 'Some structures, utilities' },
  { value: 'bare_land', label: '🌲 Bare land', hint: "I'll build from scratch" },
];

const FEATURE_CHOICES: PropertyFeature[] = [
  'water_well',
  'water_creek',
  'water_pond',
  'electric',
  'road_paved',
  'timber',
  'pasture',
  'hunting',
];

const DRIVING_OPTIONS: Array<{
  value: NonNullable<UserPreferences['drivingToleranceMin']> | null;
  label: string;
}> = [
  { value: 10, label: '≤ 10 min to town' },
  { value: 30, label: '≤ 30 min' },
  { value: 60, label: '≤ 1 hour' },
  { value: null, label: "Doesn't matter" },
];

interface OnboardingModalProps {
  /** When true, the modal is forcibly open regardless of completion
   * state. Used by the "Preferences" account-menu item so users can
   * revise their answers after onboarding. */
  forceOpen?: boolean;
  /** Called when the user dismisses a force-opened modal (settings
   * mode). Undefined in first-time-use mode — that one only closes
   * via save/skip. */
  onClose?: () => void;
  /** Render inline in-page (no overlay) instead of a centered modal.
   * Used by the /onboarding route. */
  asPage?: boolean;
}

export const OnboardingModal = ({ forceOpen = false, onClose, asPage = false }: OnboardingModalProps = {}) => {
  const { user } = useAuth();
  const { preferences, isComplete, loading, save } = useUserPreferences();
  const [draft, setDraft] = useState<UserPreferences>({
    ...DEFAULT_PREFERENCES,
    ...preferences,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Two visibility paths:
  //   - First-time onboarding (default): show when user exists and
  //     isComplete is false; hide after save/skip.
  //   - Settings (forceOpen=true): show unconditionally when the
  //     parent says so; close via onClose.
  const shouldShow = useMemo(() => {
    if (!user || loading) return false;
    if (asPage || forceOpen) return true;
    return !isComplete;
  }, [user, loading, isComplete, forceOpen, asPage]);

  // When force-opened, re-seed the draft from the persisted row so the
  // user sees their existing answers instead of blank defaults.
  useMemo(() => {
    if (forceOpen) {
      setDraft({ ...DEFAULT_PREFERENCES, ...preferences });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceOpen]);

  if (!shouldShow) return null;

  const patch = <K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K],
  ) => setDraft((d) => ({ ...d, [key]: value }));

  const toggleFeature = (f: PropertyFeature) =>
    setDraft((d) => {
      const cur = new Set(d.mustHaveFeatures ?? []);
      if (cur.has(f)) cur.delete(f);
      else cur.add(f);
      return { ...d, mustHaveFeatures: Array.from(cur) };
    });

  const submit = async (complete: boolean) => {
    setError(null);
    setSaving(true);
    try {
      await save(draft, { complete });
      if ((forceOpen || asPage) && onClose) onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const wrapper = asPage
    ? 'p-6'
    : 'fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4';

  return (
    <div className={wrapper}>
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto mx-auto">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">
            Tell us what you&apos;re looking for
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Takes 30 seconds. Every question is optional. We use these to
            personalize your feed and the AI ranker. Edit any time from
            your account menu.
          </p>
        </div>

        <div className="p-6 space-y-6">
          {/* Budget */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-2">
              Budget
            </h3>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                value={draft.budgetMinUsd ?? ''}
                onChange={(e) =>
                  patch(
                    'budgetMinUsd',
                    e.target.value === '' ? null : Number(e.target.value),
                  )
                }
                placeholder="Min $"
                className="border border-gray-200 rounded px-2 py-1.5 text-sm w-32 focus:ring-1 focus:ring-green-500 focus:outline-none"
              />
              <span className="text-gray-400">–</span>
              <input
                type="number"
                min={0}
                value={draft.budgetMaxUsd ?? ''}
                onChange={(e) =>
                  patch(
                    'budgetMaxUsd',
                    e.target.value === '' ? null : Number(e.target.value),
                  )
                }
                placeholder="Max $"
                className="border border-gray-200 rounded px-2 py-1.5 text-sm w-32 focus:ring-1 focus:ring-green-500 focus:outline-none"
              />
            </div>
          </section>

          {/* Min acreage */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-2">
              Minimum acreage
            </h3>
            <input
              type="number"
              min={0}
              value={draft.minAcreage ?? ''}
              onChange={(e) =>
                patch(
                  'minAcreage',
                  e.target.value === '' ? null : Number(e.target.value),
                )
              }
              placeholder="e.g. 5"
              className="border border-gray-200 rounded px-2 py-1.5 text-sm w-32 focus:ring-1 focus:ring-green-500 focus:outline-none"
            />
          </section>

          {/* Shopper mode */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-2">
              How ready does the property need to be?
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {SHOPPER_OPTIONS.map((opt) => (
                <button
                  key={opt.value ?? 'any'}
                  type="button"
                  onClick={() => patch('shopperMode', opt.value)}
                  className={`text-left border rounded-lg px-3 py-2 transition-colors ${
                    draft.shopperMode === opt.value
                      ? 'bg-green-50 border-green-400 text-green-900'
                      : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="text-xs text-gray-500">{opt.hint}</div>
                </button>
              ))}
            </div>
          </section>

          {/* Must-have features */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-2">
              Must-have features
            </h3>
            <p className="text-xs text-gray-500 mb-2">
              Listings missing these rank lower. Pick 0-3.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {FEATURE_CHOICES.map((f) => {
                const on = (draft.mustHaveFeatures ?? []).includes(f);
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => toggleFeature(f)}
                    className={`text-xs rounded-full border px-2.5 py-1 transition-colors ${
                      on
                        ? 'bg-green-600 border-green-700 text-white'
                        : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {FEATURE_LABELS[f]}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Driving tolerance */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-2">
              How close to a town do you want to be?
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {DRIVING_OPTIONS.map((opt) => (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => patch('drivingToleranceMin', opt.value)}
                  className={`text-xs rounded-full border px-2.5 py-1 transition-colors ${
                    draft.drivingToleranceMin === opt.value
                      ? 'bg-green-600 border-green-700 text-white'
                      : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>

          {/* Free-form vision */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-2">
              What would make a property perfect for you?
            </h3>
            <textarea
              value={draft.vision ?? ''}
              onChange={(e) => patch('vision', e.target.value.slice(0, 400))}
              rows={3}
              maxLength={400}
              placeholder="Free-form. What does your homestead look like? We feed this to the AI ranker so your results reflect your own words."
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:ring-1 focus:ring-green-500 focus:outline-none resize-y"
            />
          </section>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-3 bg-gray-50 rounded-b-xl">
          <button
            type="button"
            onClick={() => {
              if ((forceOpen || asPage) && onClose) onClose();
              else void submit(true);
            }}
            disabled={saving}
            className="text-sm text-gray-500 hover:text-gray-900 underline disabled:opacity-50"
          >
            {forceOpen ? 'Cancel' : asPage ? 'Skip' : 'Skip for now'}
          </button>
          <button
            type="button"
            onClick={() => void submit(true)}
            disabled={saving}
            className="bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-medium px-4 py-2 rounded-lg text-sm"
          >
            {saving ? 'Saving…' : forceOpen ? 'Save changes' : 'Save & continue'}
          </button>
        </div>
      </div>
    </div>
  );
};

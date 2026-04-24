import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

interface AuthButtonProps {
  /** Called when the user clicks "Notification settings" — parent
   * owns the modal state (it's the same modal the bell icon opens)
   * so there's one notifications surface regardless of entry point. */
  onOpenNotifications?: () => void;
  /** Called when the user clicks "Saved searches" — parent owns the
   * modal so it can wire `currentFilters` + `onApply` to the dashboard
   * filter state. */
  onOpenSavedSearches?: () => void;
  /** Called when the user clicks "Preferences" — parent opens the
   * OnboardingModal in edit mode so the user can revise what they
   * told us during first-time setup. */
  onOpenPreferences?: () => void;
}

/**
 * Auth entry point for the top-right header. Three visual states:
 *
 *   - Supabase not configured → render nothing.
 *   - Not signed in → "Sign in" pill that opens a modal sheet with
 *     email magic-link (primary) and Google OAuth.
 *   - Signed in → avatar + account menu (name/email, quick links,
 *     notification settings, sign out). Menu items here consolidate
 *     the settings surface the user asked for in an hamburger-style
 *     dropdown.
 */
export const AuthButton = ({
  onOpenNotifications,
  onOpenSavedSearches,
  onOpenPreferences,
}: AuthButtonProps) => {
  const { user, loading, configured, loginWithGoogle, loginWithEmail, logout } = useAuth();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();

  if (!configured || loading) return null;

  if (!user) {
    return (
      <>
        <button
          onClick={() => setSheetOpen(true)}
          className="flex items-center gap-1.5 rounded-full bg-white border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          title="Sign in to save listings and create alerts"
        >
          Sign in
        </button>
        {sheetOpen && <SignInSheet onClose={() => setSheetOpen(false)} onGoogle={loginWithGoogle} onEmail={loginWithEmail} />}
      </>
    );
  }

  const avatarUrl = (user.user_metadata?.avatar_url as string | undefined) ?? null;
  const displayName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    user.email ??
    'Signed in';
  const initials = (displayName[0] ?? '?').toUpperCase();

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="relative">
      <button
        onClick={() => setMenuOpen((v) => !v)}
        aria-label="Account menu"
        aria-expanded={menuOpen}
        className={`flex items-center gap-1 rounded-full border bg-white pl-1 pr-1.5 py-1 transition-colors ${
          menuOpen ? 'border-gray-400 shadow-sm' : 'border-gray-200 hover:border-gray-300'
        }`}
        title={user.email ?? 'Account'}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="w-7 h-7 rounded-full" referrerPolicy="no-referrer" />
        ) : (
          <span className="w-7 h-7 rounded-full bg-gradient-to-br from-green-500 to-green-700 text-white text-xs font-bold flex items-center justify-center">
            {initials}
          </span>
        )}
        {/* Chevron — gives users the affordance that this is a menu.
            Earlier design was just a bare avatar; some users didn't
            realize it was clickable. */}
        <svg
          viewBox="0 0 20 20"
          className={`w-3.5 h-3.5 text-gray-500 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M5.8 7.5a.75.75 0 011.06 0L10 10.64l3.14-3.14a.75.75 0 111.06 1.06l-3.67 3.67a.75.75 0 01-1.06 0L5.8 8.56a.75.75 0 010-1.06z" />
        </svg>
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={closeMenu} />
          <div
            role="menu"
            className="absolute right-0 mt-1 z-40 w-64 rounded-lg bg-white border border-gray-200 shadow-xl overflow-hidden text-sm"
          >
            {/* Identity header */}
            <div className="px-3 py-3 border-b border-gray-100 flex items-center gap-2.5">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt=""
                  className="w-9 h-9 rounded-full"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="w-9 h-9 rounded-full bg-gradient-to-br from-green-500 to-green-700 text-white font-bold flex items-center justify-center">
                  {initials}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900 truncate">{displayName}</p>
                {displayName !== user.email && (
                  <p className="text-xs text-gray-500 truncate">{user.email}</p>
                )}
              </div>
            </div>

            {/* Actions */}
            <MenuItem
              onClick={() => {
                closeMenu();
                navigate('/?saved=1');
              }}
              icon={
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
                </svg>
              }
              label="My saved listings"
            />
            <MenuItem
              onClick={() => {
                closeMenu();
                navigate('/?hidden=1');
              }}
              icon={
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              }
              label="My hidden listings"
            />
            {onOpenSavedSearches && (
              <MenuItem
                onClick={() => {
                  closeMenu();
                  onOpenSavedSearches();
                }}
                icon={
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                }
                label="Saved searches"
              />
            )}
            {onOpenPreferences && (
              <MenuItem
                onClick={() => {
                  closeMenu();
                  onOpenPreferences();
                }}
                icon={
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
                    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                  </svg>
                }
                label="Preferences"
              />
            )}
            {onOpenNotifications && (
              <MenuItem
                onClick={() => {
                  closeMenu();
                  onOpenNotifications();
                }}
                icon={<span>🔔</span>}
                label="Notification settings"
              />
            )}
            <div className="border-t border-gray-100" />
            <MenuItem
              onClick={() => {
                closeMenu();
                void logout();
              }}
              icon={
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              }
              label="Sign out"
              tone="danger"
            />
          </div>
        </>
      )}
    </div>
  );
};

interface MenuItemProps {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  tone?: 'default' | 'danger';
}

const MenuItem = ({ onClick, icon, label, tone = 'default' }: MenuItemProps) => (
  <button
    onClick={onClick}
    role="menuitem"
    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
      tone === 'danger'
        ? 'text-red-600 hover:bg-red-50'
        : 'text-gray-700 hover:bg-gray-50'
    }`}
  >
    <span className={`w-5 flex items-center justify-center ${tone === 'danger' ? 'text-red-500' : 'text-gray-400'}`}>
      {icon}
    </span>
    <span>{label}</span>
  </button>
);

interface SignInSheetProps {
  onClose: () => void;
  onGoogle: () => Promise<void>;
  onEmail: (email: string) => Promise<void>;
}

/**
 * Modal sign-in sheet. Email magic-link is the primary input so
 * users without a Google account have a first-class path. Two
 * success / error states: "sending email" spinner + "check inbox"
 * confirmation. On magic-link success the modal stays open with a
 * friendly "check your inbox" message — closing early is fine
 * because the email link opens a fresh session.
 */
const SignInSheet = ({ onClose, onGoogle, onEmail }: SignInSheetProps) => {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    setError(null);
    try {
      await onEmail(email);
      setSentTo(email.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send link');
    } finally {
      setSending(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    try {
      await onGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm rounded-xl bg-white shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 text-xl leading-none"
        >
          ✕
        </button>
        <h2 className="font-bold text-gray-900 text-lg">Sign in to Homestead Finder</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Save listings, create alerts, and keep private notes on your favorites.
        </p>

        {sentTo ? (
          <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm">
            <p className="font-semibold text-emerald-900 mb-1">Check your inbox</p>
            <p className="text-emerald-800">
              We sent a sign-in link to <strong>{sentTo}</strong>. Click it on this device to
              finish signing in.
            </p>
          </div>
        ) : (
          <>
            {/* Email magic-link — primary */}
            <form onSubmit={handleEmailSubmit} className="mt-5">
              <label className="text-xs font-medium text-gray-700" htmlFor="signin-email">
                Email me a sign-in link
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  id="signin-email"
                  type="email"
                  required
                  autoFocus
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={sending}
                  className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 focus:outline-none disabled:bg-gray-50"
                />
                <button
                  type="submit"
                  disabled={sending || !email.trim()}
                  className="rounded-lg bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white text-sm font-medium px-4 py-2 transition-colors"
                >
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-gray-500">
                No password required. We&apos;ll email a one-click link that signs you in.
              </p>
            </form>

            {/* Divider */}
            <div className="my-5 flex items-center gap-3 text-xs text-gray-400">
              <div className="flex-1 h-px bg-gray-200" />
              <span>or</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            {/* Google OAuth */}
            <button
              onClick={() => void handleGoogle()}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-sm font-medium text-gray-700 py-2 transition-colors"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Continue with Google
            </button>
          </>
        )}

        {error && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}
      </div>
    </div>
  );
};

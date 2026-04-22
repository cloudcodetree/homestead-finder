import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';

/**
 * Auth entry point for the top-right header. Three visual states:
 *
 *   - Supabase not configured → render nothing. Keeps a public fork
 *     deploy clean when the env vars aren't set.
 *   - Not signed in → "Sign in" pill that opens a modal sheet with
 *     two options: email magic-link (primary) and Google OAuth. The
 *     sheet is modal so it's dismissable with a click outside.
 *   - Signed in → avatar + dropdown with the user's email + sign-out.
 */
export const AuthButton = () => {
  const { user, loading, configured, loginWithGoogle, loginWithEmail, logout } = useAuth();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

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
  const initials = (user.email ?? '?')[0]?.toUpperCase() ?? '?';

  return (
    <div className="relative">
      <button
        onClick={() => setMenuOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-1 py-1 hover:border-gray-300 transition-colors"
        title={user.email ?? 'Signed in'}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="w-7 h-7 rounded-full" />
        ) : (
          <span className="w-7 h-7 rounded-full bg-gradient-to-br from-green-500 to-green-700 text-white text-xs font-bold flex items-center justify-center">
            {initials}
          </span>
        )}
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 mt-1 z-40 w-56 rounded-lg bg-white border border-gray-200 shadow-lg py-1 text-sm">
            <div className="px-3 py-2 border-b border-gray-100">
              <p className="text-xs text-gray-500">Signed in as</p>
              <p className="font-medium text-gray-900 truncate">{user.email}</p>
            </div>
            <button
              onClick={() => {
                void logout();
                setMenuOpen(false);
              }}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700"
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
};

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

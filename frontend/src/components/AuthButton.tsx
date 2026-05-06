import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { SignInSheet } from './SignInSheet';

/**
 * Auth entry point for the top-right header. Three visual states:
 *
 *   - Supabase not configured → render nothing.
 *   - Not signed in → "Sign in" pill that opens a modal sheet with
 *     email magic-link (primary) and Google OAuth.
 *   - Signed in → avatar + account menu (name/email, quick links,
 *     notification settings, sign out). Menu items navigate to
 *     real routes — no modal wiring required from the parent.
 */
export const AuthButton = () => {
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

            {/* Actions. "For you" / /home is hidden as of 2026-05-06
                — autonomy-first reframe makes /browse the universal
                landing surface. Route still exists for deep links. */}
            <MenuItem
              onClick={() => {
                closeMenu();
                navigate('/swipe');
              }}
              icon={
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                  <path d="M7 12h10" />
                  <path d="M14 9l3 3-3 3" />
                </svg>
              }
              label="Swipe mode"
            />
            <MenuItem
              onClick={() => {
                closeMenu();
                navigate('/projects');
              }}
              icon={
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                </svg>
              }
              label="My projects"
            />
            <MenuItem
              onClick={() => {
                closeMenu();
                navigate('/browse?saved=1');
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
                navigate('/browse?hidden=1');
              }}
              icon={
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              }
              label="My hidden listings"
            />
            <MenuItem
              onClick={() => {
                closeMenu();
                navigate('/saved-searches');
              }}
              icon={
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              }
              label="Saved searches"
            />
            <MenuItem
              onClick={() => {
                closeMenu();
                navigate('/onboarding');
              }}
              icon={
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
                  <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                </svg>
              }
              label="Preferences"
            />
            <MenuItem
              onClick={() => {
                closeMenu();
                navigate('/settings/notifications');
              }}
              icon={<span>🔔</span>}
              label="Notification settings"
            />
            <MenuItem
              onClick={() => {
                closeMenu();
                navigate('/upgrade');
              }}
              icon={
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              }
              label="Upgrade"
            />
            {/* Render-once anchors satisfy older referencing routes;
                deep-links to /upgrade?reason=… still drive copy. */}
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


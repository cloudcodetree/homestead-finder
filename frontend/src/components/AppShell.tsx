import { useEffect, useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bookmark,
  Brain,
  ChevronLeft,
  ChevronRight,
  Compass,
  Folder,
  LayoutGrid,
  Menu,
  PanelLeftClose,
  Save,
  Search,
  Settings,
  Sparkles,
  Star,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../hooks/useAuth';
import { AuthButton } from './AuthButton';

/**
 * Persistent application shell. Owns:
 *   - Top bar (logo, global search, account menu) — same on every screen.
 *   - Left rail — collapsible at every screen size. Mini (icon-only,
 *     ~56px) ↔ full (~224px) on >=lg. Off-canvas drawer on smaller
 *     viewports, opened by the hamburger in the top bar.
 *   - Content area renders via <Outlet />.
 *
 * Logo click target depends on auth: signed-in → /home; anonymous →
 * /landing. Public marketing routes (/landing) render outside the
 * shell so they own their own chrome.
 *
 * Collapsed/expanded state for the desktop rail persists in
 * localStorage so a user who prefers the icon-only view keeps it
 * across sessions.
 */
/**
 * Three rail states drive the layout:
 *   - 'open'   — full-width with labels (~w-56)
 *   - 'mini'   — icon-only (~w-14)
 *   - 'hidden' — fully collapsed to 0 width; the top-bar hamburger
 *                is the only way to re-open
 *
 * The toggle in the rail footer cycles open ↔ mini for power users
 * who like the icon strip. A second "fully hide" button collapses
 * to hidden. Clicking the top-bar hamburger restores the last
 * non-hidden state.
 */
type RailState = 'open' | 'mini' | 'hidden';
const RAIL_KEY = 'hf:nav-rail';

interface NavLinkSpec {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** When true, only signed-in users see this entry. */
  authOnly?: boolean;
  /** When true, only matches when the URL path is exactly equal. */
  exact?: boolean;
}

const NAV_ITEMS: NavLinkSpec[] = [
  // "For you" / /home hidden 2026-05-06 — autonomy-first reframe puts
  // /browse as the universal landing surface. /home route still
  // exists (deep links + auth fallback) but is removed from nav.
  { to: '/browse', label: 'Browse', icon: LayoutGrid },
  { to: '/swipe', label: 'Swipe', icon: Compass, authOnly: true },
  { to: '/browse?saved=1', label: 'Saved', icon: Bookmark, authOnly: true },
  { to: '/projects', label: 'Projects', icon: Folder, authOnly: true },
  { to: '/browse?view=picks', label: 'Top picks', icon: Star },
  { to: '/browse?view=deals', label: 'Homestead deals', icon: Sparkles },
  { to: '/saved-searches', label: 'Saved searches', icon: Save, authOnly: true },
  { to: '/settings/ai-prompts', label: 'AI prompts', icon: Brain, authOnly: true },
  { to: '/settings/notifications', label: 'Settings', icon: Settings, authOnly: true },
];

export const AppShell = () => {
  const { user, loading, configured } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [railState, setRailState] = useState<RailState>(() => {
    try {
      const v = localStorage.getItem(RAIL_KEY);
      if (v === 'mini' || v === 'hidden' || v === 'open') return v;
    } catch {
      // ignore
    }
    // Default to icon-only with hover-peek (Supabase / Slack / Notion
    // pattern). Power users who want the labels pinned can flip to
    // 'open' via the rail's footer chevron — that preference persists.
    return 'mini';
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  // Hover-peek: when the persisted state is `mini`, hovering the
  // rail temporarily expands it to show labels — content underneath
  // does NOT shift (the wide overlay floats on top). Mouse-leave
  // contracts back. Pattern: Supabase, Slack, Notion sidebars.
  const [hovering, setHovering] = useState(false);
  const collapsed = railState === 'mini' && !hovering;
  const showWide = railState === 'open' || (railState === 'mini' && hovering);

  useEffect(() => {
    try {
      localStorage.setItem(RAIL_KEY, railState);
    } catch {
      // ignore
    }
  }, [railState]);

  // Close the mobile drawer whenever the route changes — otherwise
  // tapping a nav item would leave the overlay covering the new page.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Three-tier access model (2026-04-29):
  //   anonymous  → can browse /home, /browse, /p/:id, /upgrade with
  //                IP-revealing fields hidden (source URL, external
  //                research links, "View Full Listing"). Bounced to
  //                /landing for any account-only route below.
  //   signed-in  → unrestricted today (paid is unmodeled until
  //                billing ships — see useSubscription).
  //
  // The allow-list keeps shareable preview links working without
  // leaking enough metadata to reverse-search the source listing
  // from us. The actual link gating lives in PropertyDetail and the
  // useAccessTier hook, not here.
  //
  // While auth is loading we render nothing rather than briefly
  // flashing the shell's chrome.
  if (loading) return null;
  const path = location.pathname;
  const isPublicInShell =
    path === '/home' ||
    path === '/browse' ||
    path.startsWith('/p/') ||
    path === '/upgrade';
  if (configured && !user && !isPublicInShell) {
    return <Navigate to="/landing" replace />;
  }

  const logoTarget = '/browse';
  const items = NAV_ITEMS.filter((item) => !item.authOnly || user);

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Top bar */}
      <header className="relative z-50 flex-shrink-0 flex items-center gap-2 sm:gap-3 bg-white border-b border-gray-200 px-2 sm:px-4 h-14">
        {/* Hamburger is always present at every breakpoint. On mobile
            it opens the drawer; on desktop it toggles the rail
            visibility (open ↔ hidden). The rail's own footer button
            handles the open ↔ mini sub-toggle for power users. */}
        <button
          type="button"
          onClick={() => {
            if (window.matchMedia('(min-width: 1024px)').matches) {
              setRailState((s) => (s === 'hidden' ? 'open' : 'hidden'));
            } else {
              setMobileOpen(true);
            }
          }}
          className="p-2 -ml-1 rounded text-gray-500 hover:text-gray-900 hover:bg-gray-100"
          aria-label="Toggle navigation"
        >
          <Menu className="w-5 h-5" />
        </button>
        <Link
          to={logoTarget}
          className="flex items-center gap-2 font-bold text-gray-900 hover:opacity-80"
        >
          <span className="text-xl" aria-hidden="true">
            🌿
          </span>
          <span className="hidden sm:inline text-base">Homestead Finder</span>
        </Link>

        {/* Global search — present at every breakpoint. Mobile gets a
            shorter placeholder so the input doesn't truncate; desktop
            keeps the descriptive copy. Submitting navigates to /browse
            with ?q= which Dashboard consumes via its searchParams effect. */}
        <form
          className="ml-1 sm:ml-2 flex-1 max-w-md flex items-center relative"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const q = String(fd.get('q') ?? '').trim();
            navigate(q ? `/browse?q=${encodeURIComponent(q)}` : '/browse');
          }}
        >
          <Search className="absolute left-2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            name="q"
            type="search"
            placeholder="Search…"
            defaultValue={new URLSearchParams(location.search).get('q') ?? ''}
            className="w-full border border-gray-200 rounded-lg pl-7 pr-2 py-1.5 text-sm focus:ring-1 focus:ring-green-500 focus:border-green-500 focus:outline-none"
            aria-label="Search listings"
          />
        </form>

        <div className="ml-auto flex items-center gap-2">
          <AuthButton />
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Desktop rail — hover-peek pattern.
            The flex-flow placeholder reserves width 14 (mini), 56
            (pinned open), or 0 (hidden). The actual <aside> with the
            nav is absolutely-positioned so when the user is in mini
            mode and hovers, the rail expands to 56 floating ON TOP
            of content instead of pushing content right. Pinned-open
            mode fills the same 56 column but stays in flex flow
            visually because the placeholder matches its width. */}
        <div
          aria-hidden="true"
          className={clsx(
            'hidden lg:block flex-shrink-0 transition-[width] duration-200 ease-in-out',
            railState === 'open' && 'w-56',
            railState === 'mini' && 'w-14',
            railState === 'hidden' && 'w-0',
          )}
        />
        <aside
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
          className={clsx(
            'hidden lg:flex flex-col bg-white border-r border-gray-200 overflow-hidden transition-[width] duration-200 ease-in-out',
            'absolute top-0 bottom-0 left-0 z-20',
            showWide && 'w-56 shadow-lg',
            !showWide && railState === 'mini' && 'w-14',
            railState === 'hidden' && 'w-0 border-r-0 pointer-events-none',
          )}
        >
          <RailNav items={items} collapsed={collapsed} />
          <div className="mt-auto border-t border-gray-100 p-1.5 flex items-center gap-1">
            <button
              type="button"
              onClick={() => setRailState((s) => (s === 'open' ? 'mini' : 'open'))}
              className="flex-1 flex items-center justify-center gap-2 px-1 py-1.5 rounded text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-100"
              aria-label={
                railState === 'open'
                  ? 'Switch to icon-only rail'
                  : 'Pin rail open'
              }
              title={
                railState === 'open'
                  ? 'Switch to icon-only (hover to peek)'
                  : 'Pin rail open'
              }
            >
              {railState === 'open' ? (
                <>
                  <ChevronLeft className="w-4 h-4" />
                  <span>Collapse</span>
                </>
              ) : showWide ? (
                <>
                  <ChevronLeft className="w-4 h-4" />
                  <span>Pin open</span>
                </>
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setRailState('hidden')}
              className="flex-shrink-0 p-1.5 rounded text-gray-400 hover:text-gray-900 hover:bg-gray-100"
              aria-label="Hide navigation"
              title="Hide nav (click hamburger to restore)"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </div>
        </aside>


        {/* Mobile drawer */}
        <div
          className={clsx(
            'lg:hidden fixed inset-0 z-40 bg-black/50 transition-opacity',
            mobileOpen ? 'opacity-100' : 'opacity-0 pointer-events-none',
          )}
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
        <aside
          className={clsx(
            'lg:hidden fixed top-0 bottom-0 left-0 z-50 w-64 bg-white shadow-2xl flex flex-col transition-transform',
            mobileOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <div className="flex-shrink-0 h-14 px-4 flex items-center justify-between border-b border-gray-200">
            <span className="font-semibold text-gray-900">Menu</span>
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="p-1.5 text-gray-500 hover:text-gray-900 rounded hover:bg-gray-100"
              aria-label="Close navigation"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <RailNav items={items} collapsed={false} />
        </aside>

        {/* Main content. `isolate` creates a CSS stacking context so
            any GPU-composited descendants (Leaflet's transform layers,
            backdrop-filter chips, sticky elements) can't escape above
            the global page header during momentum scroll. Belt and
            suspenders alongside the header's z-50. */}
        <main className="flex-1 overflow-y-auto isolate">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

interface RailNavProps {
  items: NavLinkSpec[];
  collapsed: boolean;
}

/**
 * Pick the single nav item that should appear active for the current
 * URL. react-router's NavLink decides activity by pathname alone, so
 * `/browse`, `/browse?saved=1`, `/browse?view=picks`, and
 * `/browse?view=deals` all light up together when any of those URLs
 * is open. We replace that with a "best match" rule:
 *   1. Reject items whose pathname doesn't match (or, for items with
 *      no search params, isn't a parent of the current path).
 *   2. Of the survivors, prefer the one whose declared search params
 *      ALL appear in the current URL — that's the most-specific
 *      destination the user actually navigated to.
 *
 * Returns the index of the winning item, or -1 if nothing matches.
 */
const findActiveIndex = (
  items: NavLinkSpec[],
  pathname: string,
  search: string,
): number => {
  const cur = new URLSearchParams(search);
  let bestIdx = -1;
  let bestScore = -1;
  for (let i = 0; i < items.length; i++) {
    const [itemPath, itemSearch = ''] = items[i].to.split('?');
    // Pathname check. Allow nested paths to bubble up to a parent
    // entry only when the parent has no search params declared
    // (e.g. /settings/ai-prompts/edit → /settings/ai-prompts).
    let pathScore: number;
    if (pathname === itemPath) {
      pathScore = itemPath.length * 1000;
    } else if (!itemSearch && pathname.startsWith(itemPath + '/')) {
      pathScore = itemPath.length * 1000;
    } else {
      continue;
    }
    // Search-param check. Every declared param must match the
    // current URL. Extra params in the URL (e.g. ?q=foo) are fine.
    const itemParams = new URLSearchParams(itemSearch);
    let allMatch = true;
    let paramCount = 0;
    for (const [k, v] of itemParams) {
      if (cur.get(k) !== v) {
        allMatch = false;
        break;
      }
      paramCount++;
    }
    if (!allMatch) continue;
    // Score: same-pathname items beat ancestor matches; among
    // same-pathname items, more declared params = more specific.
    const score = pathScore + paramCount;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
};

const RailNav = ({ items, collapsed }: RailNavProps) => {
  const location = useLocation();
  const activeIdx = findActiveIndex(items, location.pathname, location.search);
  return (
    <nav className="flex-1 overflow-y-auto py-2">
      <ul className="space-y-0.5 px-2">
        {items.map((item, i) => {
          const isActive = i === activeIdx;
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                // The link is just a flex container — no background of
                // its own. All visual treatment (active highlight, hover
                // bg) lives on a fixed 32×32 icon pill, so the highlight
                // shape is identical in mini and open states. Expanding
                // the rail just reveals the label sibling next to the
                // unchanged pill — it shouldn't morph the pill from a
                // small square into a long bar. This is the "open panel
                // is just the mini panel with the rest unmasked" model.
                className="group flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg text-sm font-medium"
                title={collapsed ? item.label : undefined}
              >
                <span
                  className={clsx(
                    'flex items-center justify-center w-8 h-8 flex-shrink-0 rounded-lg transition-colors',
                    isActive
                      ? 'bg-green-50 text-green-700'
                      : 'text-gray-600 group-hover:bg-gray-100 group-hover:text-gray-900',
                  )}
                >
                  <item.icon className="w-4 h-4" />
                </span>
                {!collapsed && (
                  <span
                    className={clsx(
                      'truncate transition-colors',
                      isActive
                        ? 'text-green-700'
                        : 'text-gray-600 group-hover:text-gray-900',
                    )}
                  >
                    {item.label}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

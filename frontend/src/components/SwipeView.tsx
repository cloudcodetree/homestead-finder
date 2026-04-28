import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useHiddenListings } from '../hooks/useHiddenListings';
import { useListingRatings } from '../hooks/useListingRatings';
import { useProperties } from '../hooks/useProperties';
import { useSavedListings } from '../hooks/useSavedListings';
import { DEFAULT_FILTERS, Property } from '../types/property';
import {
  formatAcreage,
  formatCountyState,
  formatPrice,
  formatPricePerAcre,
} from '../utils/formatters';
import { PropertyThumbnail } from './PropertyThumbnail';

/**
 * Tinder-mode swipe UX (vision #15). Full-screen card stack;
 * thumb-friendly. Each gesture maps to one of our 4 signal axes:
 *
 *   right     → save (bookmark)
 *   left      → hide (not interested)
 *   up        → 🙂 Like rating
 *   down      → 🙁 Dislike rating
 *
 * Plus keyboard equivalents on desktop (← → ↑ ↓).
 *
 * Beyond being engagement-friendly, this is the densest training-data
 * path for `rank_fit` — every swipe is a clean +/- signal.
 *
 * Implementation is pointer-events + transforms, no swipe lib (to
 * keep the bundle clean). v1 doesn't capture velocity → magnitude;
 * adding "fast swipe = Love/Hate" is a natural follow-up.
 */
const SWIPE_THRESHOLD = 80;

type Direction = 'right' | 'left' | 'up' | 'down' | null;

export const SwipeView = () => {
  const { user, loginWithGoogle } = useAuth();
  const { allProperties } = useProperties(DEFAULT_FILTERS);
  const { savedIds, toggle: toggleSaved } = useSavedListings();
  const { hiddenIds, toggle: toggleHidden } = useHiddenListings();
  const { ratings, setRating } = useListingRatings();
  const navigate = useNavigate();

  // Build the queue: every listing the user hasn't reacted to yet,
  // newest first (so fresh inventory floats up first session).
  const queue = useMemo<Property[]>(() => {
    const reactedTo = new Set<string>([
      ...savedIds,
      ...hiddenIds,
      ...ratings.keys(),
    ]);
    return allProperties
      .filter(
        (p) =>
          !reactedTo.has(p.id) &&
          p.status !== 'expired' &&
          p.status !== 'pending',
      )
      .sort(
        (a, b) =>
          new Date(b.dateFound).getTime() - new Date(a.dateFound).getTime(),
      );
  }, [allProperties, savedIds, hiddenIds, ratings]);

  const [index, setIndex] = useState(0);
  const [drag, setDrag] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [exit, setExit] = useState<Direction>(null);
  // Two-phase entry: 'mount' parks a fresh card off-screen below;
  // an rAF flips to 'rest', triggering the slide-up transition.
  // useLayoutEffect ensures the off-screen position is in place
  // before the browser paints, so we don't see a flash at rest.
  const [enterPhase, setEnterPhase] = useState<'mount' | 'rest'>('mount');
  const [lastAction, setLastAction] = useState<{
    listingId: string;
    action: 'save' | 'hide' | 'like' | 'dislike';
  } | null>(null);

  const cardRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const current = queue[index];

  useLayoutEffect(() => {
    if (!current) return;
    setEnterPhase('mount');
    let rafId = requestAnimationFrame(() => {
      rafId = requestAnimationFrame(() => setEnterPhase('rest'));
    });
    return () => cancelAnimationFrame(rafId);
    // We deliberately key on the listing id only — re-running this
    // on every Property reference change (which can happen when the
    // queue memo recomputes) would re-park the card off-screen and
    // cancel an animation already in flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const commit = async (dir: Direction, p: Property) => {
    if (!user) {
      // Anonymous — bounce to OAuth instead of swiping anonymously
      void loginWithGoogle();
      return;
    }
    if (!dir) return;
    try {
      if (dir === 'right') {
        await toggleSaved(p.id);
        setLastAction({ listingId: p.id, action: 'save' });
      } else if (dir === 'left') {
        await toggleHidden(p.id);
        setLastAction({ listingId: p.id, action: 'hide' });
      } else if (dir === 'up') {
        await setRating(p.id, 1);
        setLastAction({ listingId: p.id, action: 'like' });
      } else if (dir === 'down') {
        await setRating(p.id, -1);
        setLastAction({ listingId: p.id, action: 'dislike' });
      }
    } catch {
      // Free-tier limit etc — silently advance, the next card still works
    }
    setIndex((i) => i + 1);
    setDrag({ x: 0, y: 0 });
    setExit(null);
  };

  const undoLast = async () => {
    if (!lastAction) return;
    try {
      if (lastAction.action === 'save') await toggleSaved(lastAction.listingId);
      else if (lastAction.action === 'hide')
        await toggleHidden(lastAction.listingId);
      else if (lastAction.action === 'like' || lastAction.action === 'dislike')
        await setRating(lastAction.listingId, null);
    } catch {
      /* swallow */
    }
    setIndex((i) => Math.max(0, i - 1));
    setLastAction(null);
  };

  // Pointer / touch handling — single-finger drag, threshold-based release.
  const onDown = (e: React.PointerEvent) => {
    startRef.current = { x: e.clientX, y: e.clientY };
    cardRef.current?.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!startRef.current) return;
    setDrag({
      x: e.clientX - startRef.current.x,
      y: e.clientY - startRef.current.y,
    });
  };
  const onUp = () => {
    if (!startRef.current || !current) return;
    const { x, y } = drag;
    const absX = Math.abs(x);
    const absY = Math.abs(y);
    let dir: Direction = null;
    if (absX > SWIPE_THRESHOLD && absX >= absY) {
      dir = x > 0 ? 'right' : 'left';
    } else if (absY > SWIPE_THRESHOLD) {
      dir = y > 0 ? 'down' : 'up';
    }
    if (dir) {
      setExit(dir);
      void commit(dir, current);
    } else {
      // Snap back
      setDrag({ x: 0, y: 0 });
    }
    startRef.current = null;
  };

  // Keyboard shortcuts ← → ↑ ↓ for desktop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!current) return;
      if (e.target instanceof HTMLInputElement) return;
      let dir: Direction = null;
      if (e.key === 'ArrowRight') dir = 'right';
      else if (e.key === 'ArrowLeft') dir = 'left';
      else if (e.key === 'ArrowUp') dir = 'up';
      else if (e.key === 'ArrowDown') dir = 'down';
      else if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void undoLast();
        return;
      }
      if (dir) {
        e.preventDefault();
        setExit(dir);
        void commit(dir, current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const rotation = drag.x * 0.05; // gentle tilt while dragging
  const overlayDir: Direction =
    Math.abs(drag.x) > 40 && Math.abs(drag.x) >= Math.abs(drag.y)
      ? drag.x > 0
        ? 'right'
        : 'left'
      : Math.abs(drag.y) > 40
        ? drag.y > 0
          ? 'down'
          : 'up'
        : null;

  const cardStyle = exit
    ? {
        transform: _exitTransform(exit),
        transition: 'transform 250ms ease-out, opacity 250ms ease-out',
        opacity: 0,
      }
    : enterPhase === 'mount'
      ? {
          transform: 'translate(0, 100%)',
          transition: 'none',
        }
      : {
          transform: `translate(${drag.x}px, ${drag.y}px) rotate(${rotation}deg)`,
          transition:
            drag.x === 0 && drag.y === 0
              ? 'transform 300ms cubic-bezier(0.2, 0.8, 0.2, 1)'
              : 'none',
        };

  return (
    <div className="h-full bg-gray-100 flex flex-col">
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="font-semibold text-gray-900 text-sm">Swipe mode</h1>
          {queue.length > 0 && (
            <span className="text-xs text-gray-500">
              {Math.min(index + 1, queue.length)} / {queue.length}
            </span>
          )}
        </div>
        <button
          onClick={() => void undoLast()}
          disabled={!lastAction}
          className="text-sm text-gray-500 hover:text-gray-900 disabled:opacity-40"
          title="Undo last (⌘Z)"
        >
          ↶ Undo
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center p-4 select-none">
        {!current ? (
          <div className="bg-white border border-gray-200 rounded-xl p-10 max-w-md text-center">
            <p className="text-gray-700 font-semibold text-lg mb-1">
              All caught up.
            </p>
            <p className="text-sm text-gray-500 mb-4">
              You&apos;ve reacted to every listing in the current corpus.
              Tomorrow&apos;s scrape will bring fresh ones.
            </p>
            <Link
              to="/home"
              className="inline-block bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
            >
              See your personalized feed →
            </Link>
          </div>
        ) : (
          <div className="relative w-full max-w-md aspect-[3/4]">
            {/* Next card peeking under the active one for visual depth */}
            {queue[index + 1] && (
              <div className="absolute inset-0 bg-white rounded-xl border border-gray-200 shadow scale-95 opacity-50" />
            )}
            <div
              ref={cardRef}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              style={cardStyle}
              className="absolute inset-0 bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden cursor-grab active:cursor-grabbing touch-none"
            >
              <PropertyThumbnail property={current} className="w-full h-1/2" />
              <div className="p-4 space-y-2">
                <h2 className="font-bold text-gray-900 leading-tight">
                  {current.title}
                </h2>
                <p className="text-sm text-gray-500">
                  {formatCountyState(current.location.county, current.location.state)}
                </p>
                <div className="flex items-baseline gap-3 pt-1">
                  <span className="text-2xl font-bold text-gray-900">
                    {formatPrice(current.price)}
                  </span>
                  <span className="text-gray-400">·</span>
                  <span className="text-sm text-gray-700">
                    {formatAcreage(current.acreage)}
                  </span>
                  <span className="text-gray-400">·</span>
                  <span className="text-sm text-gray-700">
                    {formatPricePerAcre(current.pricePerAcre)}
                  </span>
                </div>
                {current.moveInReady && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 border border-emerald-300 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                    🏠 Move-in Ready
                  </span>
                )}
                {current.aiSummary && (
                  <p className="text-sm text-gray-600 italic">
                    &ldquo;{current.aiSummary}&rdquo;
                  </p>
                )}
                <button
                  onClick={() => navigate(`/p/${current.id}`)}
                  className="text-xs text-gray-500 hover:text-gray-900 underline mt-1"
                >
                  Open full detail →
                </button>
              </div>

              {/* Direction overlays — fade in as the user drags past 40px */}
              {overlayDir === 'right' && (
                <div className="absolute top-6 left-6 px-3 py-1.5 border-2 border-amber-500 text-amber-700 font-bold rounded rotate-[-12deg] bg-amber-50/90">
                  ★ SAVE
                </div>
              )}
              {overlayDir === 'left' && (
                <div className="absolute top-6 right-6 px-3 py-1.5 border-2 border-red-500 text-red-700 font-bold rounded rotate-[12deg] bg-red-50/90">
                  HIDE
                </div>
              )}
              {overlayDir === 'up' && (
                <div className="absolute top-6 left-1/2 -translate-x-1/2 px-3 py-1.5 border-2 border-blue-500 text-blue-700 font-bold rounded bg-blue-50/90">
                  🙂 LIKE
                </div>
              )}
              {overlayDir === 'down' && (
                <div className="absolute bottom-32 left-1/2 -translate-x-1/2 px-3 py-1.5 border-2 border-orange-500 text-orange-700 font-bold rounded bg-orange-50/90">
                  🙁 DISLIKE
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Legend / tap-buttons for users who don't immediately get the
          gesture model. Mirrors the same 4 signals. */}
      {current && (
        <div className="bg-white border-t border-gray-200 px-4 py-3">
          <div className="max-w-md mx-auto grid grid-cols-4 gap-2">
            <ActionButton
              emoji="🚫"
              label="Hide"
              hint="←"
              onClick={() => {
                setExit('left');
                void commit('left', current);
              }}
            />
            <ActionButton
              emoji="🙁"
              label="Dislike"
              hint="↓"
              onClick={() => {
                setExit('down');
                void commit('down', current);
              }}
            />
            <ActionButton
              emoji="🙂"
              label="Like"
              hint="↑"
              onClick={() => {
                setExit('up');
                void commit('up', current);
              }}
            />
            <ActionButton
              emoji="★"
              label="Save"
              hint="→"
              onClick={() => {
                setExit('right');
                void commit('right', current);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

const ActionButton = ({
  emoji,
  label,
  hint,
  onClick,
}: {
  emoji: string;
  label: string;
  hint: string;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className="flex flex-col items-center gap-0.5 py-2 rounded-lg border border-gray-200 hover:border-gray-400 hover:bg-gray-50"
  >
    <span className="text-xl">{emoji}</span>
    <span className="text-[11px] font-medium text-gray-700">{label}</span>
    <span className="text-[10px] text-gray-400">{hint}</span>
  </button>
);

const _exitTransform = (dir: Direction): string => {
  switch (dir) {
    case 'right':
      return 'translate(150%, 0) rotate(15deg)';
    case 'left':
      return 'translate(-150%, 0) rotate(-15deg)';
    case 'up':
      return 'translate(0, -150%)';
    case 'down':
      return 'translate(0, 150%)';
    default:
      return '';
  }
};

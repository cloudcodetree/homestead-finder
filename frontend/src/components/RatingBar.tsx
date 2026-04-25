import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useListingRatings } from '../hooks/useListingRatings';
import type { ListingRating } from '../lib/api';

/**
 * 5-point reaction bar: 🚫 Hate / 👎 Dislike / 😐 Meh / 👍 Like / 🔥 Love.
 *
 * Click sets the rating; clicking the current rating clears it back
 * to Meh. Optimistic update via the ListingRatingsProvider — the click
 * registers visually before the network round-trip lands.
 *
 * Per the BACKLOG plan: Meh is the cleared state (no row in
 * listing_ratings). The frontend treats absent == 0.
 */

interface RatingOption {
  value: ListingRating | 0;
  emoji: string;
  label: string;
  /** Border color when selected. */
  active: string;
  /** Background tint when selected. */
  bg: string;
}

const OPTIONS: RatingOption[] = [
  { value: -2, emoji: '🚫', label: 'Hate', active: 'border-red-500', bg: 'bg-red-50' },
  { value: -1, emoji: '👎', label: 'Dislike', active: 'border-orange-400', bg: 'bg-orange-50' },
  { value: 0, emoji: '😐', label: 'Meh', active: 'border-gray-400', bg: 'bg-gray-100' },
  { value: 1, emoji: '👍', label: 'Like', active: 'border-blue-400', bg: 'bg-blue-50' },
  { value: 2, emoji: '🔥', label: 'Love', active: 'border-amber-500', bg: 'bg-amber-50' },
];

interface RatingBarProps {
  listingId: string;
}

export const RatingBar = ({ listingId }: RatingBarProps) => {
  const { user } = useAuth();
  const { getRating, setRating } = useListingRatings();
  const current = getRating(listingId);
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const onClick = async (val: ListingRating | 0) => {
    if (busy) return;
    setBusy(true);
    try {
      // Clicking the current rating, or clicking Meh, clears it.
      if (val === 0 || val === current) {
        await setRating(listingId, null);
      } else {
        await setRating(listingId, val as ListingRating);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <p className="text-xs text-gray-500 mr-1">How do you feel about it?</p>
      {OPTIONS.map((opt) => {
        const selected = current === opt.value || (opt.value === 0 && current === 0);
        return (
          <button
            key={opt.value}
            onClick={() => void onClick(opt.value)}
            disabled={busy}
            title={opt.label}
            aria-label={opt.label}
            className={`text-lg w-9 h-9 rounded-full border-2 flex items-center justify-center transition-all hover:scale-110 disabled:opacity-50 ${
              selected
                ? `${opt.active} ${opt.bg}`
                : 'border-transparent hover:bg-gray-50'
            }`}
          >
            {opt.emoji}
          </button>
        );
      })}
    </div>
  );
};

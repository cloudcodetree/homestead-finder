import type { ListingStatus } from '@/types/property';

interface ValidationBadgeProps {
  status?: ListingStatus;
  /** Size variant — compact for cards, normal for detail page */
  size?: 'sm' | 'md';
}

/**
 * Shows a listing's validation status as a colored pill.
 * Defaults to 'unverified' (yellow) when status is undefined.
 */
export const ValidationBadge = ({
  status,
  size = 'sm',
}: ValidationBadgeProps) => {
  const s = status ?? 'unverified';
  const padding = size === 'md' ? 'px-2 py-0.5' : 'px-1.5 py-0.5';
  const gap = size === 'md' ? 'gap-1' : 'gap-0.5';

  if (s === 'active') {
    return (
      <span
        className={`inline-flex items-center ${gap} rounded-full bg-green-50 border border-green-200 ${padding} text-xs font-medium text-green-700`}
      >
        ✓ Verified
      </span>
    );
  }

  if (s === 'expired') {
    return (
      <span
        className={`inline-flex items-center ${gap} rounded-full bg-red-50 border border-red-200 ${padding} text-xs font-medium text-red-600`}
      >
        ✗ Expired
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center ${gap} rounded-full bg-yellow-50 border border-yellow-200 ${padding} text-xs font-medium text-yellow-700`}
    >
      ⚠ Unverified
    </span>
  );
};

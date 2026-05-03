interface DualRangeSliderProps {
  label: string;
  min: number;
  max: number;
  /** Hard min/max of the track (typically 0 and 100). */
  bound: { min: number; max: number };
  step?: number;
  /** Tailwind accent classes — applies to thumbs and the active range fill. */
  accent: 'green' | 'purple' | 'emerald';
  /** Optional custom formatter for the display value next to the label
   * AND the three tick marks under the track. Defaults to the raw
   * number. Use this for currency / unit-suffixed sliders. */
  formatValue?: (v: number) => string;
  onChange: (next: { min: number; max: number }) => void;
}

const ACCENT_FILL: Record<DualRangeSliderProps['accent'], string> = {
  green: 'bg-green-500',
  purple: 'bg-purple-500',
  emerald: 'bg-emerald-500',
};

const ACCENT_TEXT: Record<DualRangeSliderProps['accent'], string> = {
  green: 'text-green-600',
  purple: 'text-purple-600',
  emerald: 'text-emerald-600',
};

const ACCENT_THUMB: Record<DualRangeSliderProps['accent'], string> = {
  green: 'accent-green-600',
  purple: 'accent-purple-600',
  emerald: 'accent-emerald-600',
};

/**
 * Dual-range slider built from two overlaid <input type="range"> elements.
 * The two thumbs stay independently draggable thanks to a CSS trick:
 *   - both inputs are absolutely positioned and pointer-events-none
 *   - each thumb opts back in via pointer-events-auto so only the
 *     thumbs receive mouse events, never the (overlapping) tracks.
 *
 * `min` and `max` are clamped on commit — a drag that would cross the
 * other handle pushes the other handle along instead of swapping order.
 */
export const DualRangeSlider = ({
  label,
  min,
  max,
  bound,
  step = 5,
  accent,
  formatValue,
  onChange,
}: DualRangeSliderProps) => {
  const range = bound.max - bound.min;
  const minPct = ((min - bound.min) / range) * 100;
  const maxPct = ((max - bound.min) / range) * 100;
  const fmt = formatValue ?? ((v: number) => String(v));

  const handleMinChange = (v: number) => {
    const clamped = Math.min(v, max);
    onChange({ min: clamped, max });
  };
  const handleMaxChange = (v: number) => {
    const clamped = Math.max(v, min);
    onChange({ min, max: clamped });
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">
        {label}:{' '}
        <span className={`${ACCENT_TEXT[accent]} font-bold`}>
          {fmt(min)} – {fmt(max)}
        </span>
      </label>
      <div className="relative h-6">
        {/* Track */}
        <div className="absolute top-1/2 left-0 right-0 h-1 bg-gray-200 rounded -translate-y-1/2" />
        {/* Active range fill */}
        <div
          className={`absolute top-1/2 h-1 ${ACCENT_FILL[accent]} rounded -translate-y-1/2`}
          style={{ left: `${minPct}%`, right: `${100 - maxPct}%` }}
        />
        {/* Min handle */}
        <input
          type="range"
          min={bound.min}
          max={bound.max}
          step={step}
          value={min}
          onChange={(e) => handleMinChange(Number(e.target.value))}
          className={`absolute inset-0 w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-moz-range-thumb]:pointer-events-auto ${ACCENT_THUMB[accent]}`}
        />
        {/* Max handle */}
        <input
          type="range"
          min={bound.min}
          max={bound.max}
          step={step}
          value={max}
          onChange={(e) => handleMaxChange(Number(e.target.value))}
          className={`absolute inset-0 w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-moz-range-thumb]:pointer-events-auto ${ACCENT_THUMB[accent]}`}
        />
      </div>
      <div className="flex justify-between text-xs text-gray-400 mt-1">
        <span>{fmt(bound.min)}</span>
        <span>{fmt(Math.round((bound.min + bound.max) / 2))}</span>
        <span>{fmt(bound.max)}</span>
      </div>
    </div>
  );
};

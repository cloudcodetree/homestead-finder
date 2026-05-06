import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ExternalLink, X } from 'lucide-react';
import { useProperties } from '../../hooks/useProperties';
import { DEFAULT_FILTERS, Property } from '../../types/property';
import {
  formatAcreage,
  formatPrice,
  formatPricePerAcre,
} from '../../utils/formatters';
import { computeSelfSufficiency } from '../../utils/selfSufficiency';
import { Ring, tier, tierClasses } from '../InvestmentScore';

/**
 * Side-by-side comparison preview at /preview/compare?ids=a,b,c
 *
 * Closes the IA gap from the persona critique: "no way to compare
 * two listings side-by-side." Up to 4 listings, one column per
 * listing, one row per metric. Sticky header so labels stay visible
 * as you scroll the metrics list.
 *
 * IDs come from a `?ids=` query param. When empty, we pre-populate
 * a sensible default so the preview is immediately useful for visual
 * review. Production wiring would add a "Compare" button on each
 * card that pushes to localStorage / URL params.
 */
const DEFAULT_IDS = [
  'landhub_75707376', // Breezy River Ranch (Travis)
  'landhub_42732399', // Industrial possibilities (Travis)
  'landhub_38247667', // Circle 3-S Ranch (Travis)
];

export const ComparePreview = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const idsParam = searchParams.get('ids');
  const ids = useMemo(
    () => (idsParam ? idsParam.split(',').filter(Boolean) : DEFAULT_IDS),
    [idsParam],
  );
  const { allProperties, loading } = useProperties(DEFAULT_FILTERS);
  const properties = useMemo(
    () =>
      ids
        .map((id) => allProperties.find((p) => p.id === id))
        .filter((p): p is Property => !!p),
    [ids, allProperties],
  );

  const removeId = (id: string) => {
    const next = ids.filter((x) => x !== id);
    if (next.length > 0) setSearchParams({ ids: next.join(',') });
    else setSearchParams({});
  };

  if (loading && properties.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-emerald-200 border-t-emerald-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (properties.length === 0) {
    return (
      <div className="p-10 text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">Compare</h1>
        <p className="text-sm text-gray-500 mb-4">
          Add up to 4 listings from the Browse page to see them side-by-side.
        </p>
        <Link
          to="/preview/redesigned-browse"
          className="text-emerald-700 hover:text-emerald-900 text-sm font-medium"
        >
          ← Back to Browse
        </Link>
      </div>
    );
  }

  const reports = properties.map((p) => ({
    p,
    ss: computeSelfSufficiency(p),
  }));

  return (
    <div className="max-w-7xl mx-auto p-3 sm:p-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Compare</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {properties.length} of 4 listings · sticky header keeps labels visible
        </p>
      </header>

      <div className="overflow-x-auto bg-white border border-gray-200 rounded-xl">
        <table className="w-full text-sm">
          {/* Sticky header — listing cards across the top */}
          <thead className="sticky top-0 z-20 bg-white border-b border-gray-200">
            <tr>
              <th className="text-left text-xs uppercase tracking-wide text-gray-400 font-medium p-3 w-40">
                Metric
              </th>
              {reports.map(({ p, ss }) => (
                <th key={p.id} className="p-3 align-top min-w-[200px]">
                  <CardHead property={p} ss={ss.composite} onRemove={() => removeId(p.id)} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <Row label="Self-Sufficiency" cells={reports.map(({ ss }) => `${ss.composite}`)} bold />
            <Row label="Bottleneck" cells={reports.map(({ ss }) => `${ss.weakest.label} (${ss.weakest.score})`)} muted />
            <Row label="Buildout cost" cells={reports.map(({ ss }) => `${formatPrice(ss.costToFullLowUsd)}–${formatPrice(ss.costToFullHighUsd)}`)} />

            <SectionRow label="Autonomy axes" colSpan={reports.length + 1} />
            {(['food', 'water', 'energy', 'shelter', 'resilience'] as const).map((key) => (
              <Row
                key={key}
                label={key[0].toUpperCase() + key.slice(1)}
                cells={reports.map(({ ss }) => `${ss.axes.find((a) => a.key === key)!.score}`)}
              />
            ))}

            <SectionRow label="Headlines" colSpan={reports.length + 1} />
            <Row label="Asking" cells={reports.map(({ p }) => formatPrice(p.price))} bold />
            <Row label="$/acre" cells={reports.map(({ p }) => formatPricePerAcre(p.pricePerAcre))} />
            <Row label="Acreage" cells={reports.map(({ p }) => formatAcreage(p.acreage))} />

            <SectionRow label="Financial lens" colSpan={reports.length + 1} />
            <Row label="Deal Score" cells={reports.map(({ p }) => `${Math.round(p.dealScore ?? 0)}`)} muted />
            <Row label="Investment Score" cells={reports.map(({ p }) => `${Math.round(p.investmentScore ?? 0)}`)} muted />
            <Row label="Homestead Fit" cells={reports.map(({ p }) => `${Math.round(p.homesteadFitScore ?? 0)}`)} muted />
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-gray-500">
        Production version would add: print-as-PDF button, "Add to compare"
        chip on each card, localStorage persistence, max-4-listings cap with
        FIFO eviction, and a per-row "best in this comparison" highlight.
      </p>
    </div>
  );
};

const CardHead = ({
  property,
  ss,
  onRemove,
}: {
  property: Property;
  ss: number;
  onRemove: () => void;
}) => {
  const klass = tierClasses[tier(ss)];
  return (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-1">
        <Link
          to={`/preview/redesigned-detail/${property.id}`}
          className="text-sm font-semibold text-gray-900 hover:text-emerald-700 hover:underline line-clamp-2 flex-1"
        >
          {property.title}
        </Link>
        <button
          onClick={onRemove}
          aria-label="Remove from comparison"
          className="text-gray-400 hover:text-rose-600 flex-shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <p className="text-[11px] text-gray-500 normal-case font-normal">
        {property.location.county}, {property.location.state}
      </p>
      <div className="flex items-center gap-2">
        <Ring score={ss} size={32} strokeWidth={3.5}>
          <span className="text-[10px] font-bold">{ss}</span>
        </Ring>
        <span className={`text-xs font-medium ${klass.text} normal-case`}>
          Self-Sufficiency
        </span>
      </div>
      <Link
        to={`/preview/redesigned-detail/${property.id}`}
        className="inline-flex items-center gap-0.5 text-[11px] text-emerald-700 hover:text-emerald-900 normal-case font-normal"
      >
        Open detail
        <ExternalLink className="w-2.5 h-2.5" />
      </Link>
    </div>
  );
};

const Row = ({
  label,
  cells,
  bold,
  muted,
}: {
  label: string;
  cells: string[];
  bold?: boolean;
  muted?: boolean;
}) => (
  <tr>
    <td className="text-xs uppercase tracking-wide text-gray-500 font-medium p-3 align-top">
      {label}
    </td>
    {cells.map((c, i) => (
      <td
        key={i}
        className={`p-3 tabular-nums align-top ${
          bold ? 'text-base font-bold text-gray-900' : muted ? 'text-xs text-gray-500' : 'text-sm text-gray-800'
        }`}
      >
        {c}
      </td>
    ))}
  </tr>
);

const SectionRow = ({ label, colSpan }: { label: string; colSpan: number }) => (
  <tr>
    <td
      colSpan={colSpan}
      className="text-[10px] uppercase tracking-wider font-bold text-gray-400 bg-gray-50 px-3 py-1.5"
    >
      {label}
    </td>
  </tr>
);

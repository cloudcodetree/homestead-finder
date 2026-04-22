import { CuratedPick, Property } from '../types/property';
import {
  formatAcreage,
  formatPrice,
  formatPricePerAcre,
  formatCountyState,
  formatSourceName,
} from '../utils/formatters';
import { getDealScoreColor } from '../utils/scoring';

interface TopPicksProps {
  picks: CuratedPick[];
  properties: Property[];
  curatedAt: string;
  model: string;
  onSelectProperty: (id: string) => void;
}

const formatCuratedAt = (iso: string) => {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
};

export const TopPicks = ({
  picks,
  properties,
  curatedAt,
  model,
  onSelectProperty,
}: TopPicksProps) => {
  const byId = new Map(properties.map((p) => [p.id, p]));

  if (picks.length === 0) {
    return (
      <div className="p-6 text-center">
        <p className="text-4xl mb-3">✨</p>
        <p className="text-gray-600 font-medium">No curated picks yet</p>
        <p className="text-sm text-gray-500 mt-1">
          Run{' '}
          <code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">
            python -m scraper.curate
          </code>{' '}
          locally to generate top picks.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Top Picks</h2>
            <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded font-medium tracking-wide uppercase">
              AI Curated
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {picks.length} hand-picked listings · Claude {model} · {formatCuratedAt(curatedAt)}
          </p>
        </div>

        {/* Picks list */}
        <div className="space-y-3">
          {picks.map((pick) => {
            const p = byId.get(pick.id);
            return (
              <article
                key={pick.id}
                onClick={() => p && onSelectProperty(pick.id)}
                className={`group relative bg-white rounded-lg border border-gray-200 p-4 sm:p-5 flex gap-4 transition-all ${
                  p ? 'cursor-pointer hover:border-purple-300 hover:shadow-md' : 'opacity-60'
                }`}
              >
                {/* Rank */}
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-gradient-to-br from-purple-600 to-purple-800 text-white font-bold text-lg sm:text-xl flex items-center justify-center shadow-sm">
                    {pick.rank}
                  </div>
                </div>

                {/* Body */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900 text-base leading-snug">
                      {pick.headline}
                    </h3>
                    {p && (
                      <div
                        className={`rounded-full px-2 py-0.5 text-xs font-bold flex-shrink-0 ${getDealScoreColor(
                          p.dealScore
                        )}`}
                        title={`Deal Score: ${p.dealScore}`}
                      >
                        {p.dealScore}
                      </div>
                    )}
                  </div>

                  {p ? (
                    <p className="text-xs text-gray-500 mb-2">
                      {p.title.length > 80 ? p.title.slice(0, 77) + '…' : p.title} ·{' '}
                      {formatCountyState(p.location.county, p.location.state)} ·{' '}
                      {formatSourceName(p.source)}
                    </p>
                  ) : (
                    <p className="text-xs text-gray-400 italic mb-2">
                      (Listing {pick.id} not currently loaded)
                    </p>
                  )}

                  <p className="text-sm text-gray-700 leading-relaxed mb-3">{pick.reason}</p>

                  {p && (
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-gray-900 font-semibold">{formatPrice(p.price)}</span>
                      <span className="text-gray-400">·</span>
                      <span className="text-gray-700">{formatAcreage(p.acreage)}</span>
                      <span className="text-gray-400">·</span>
                      <span className="text-gray-600 text-xs">
                        {formatPricePerAcre(p.pricePerAcre)}
                      </span>
                      {p.homesteadFitScore !== undefined && (
                        <span className="ml-auto text-xs text-purple-700 bg-purple-50 border border-purple-200 rounded-full px-2 py-0.5 font-medium">
                          Fit {p.homesteadFitScore}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
};

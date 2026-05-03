import { Property } from '../types/property';
import { useCadRecord } from '../hooks/useCadRecord';
import { formatPrice } from '../utils/formatters';

interface CadRecordPanelProps {
  property: Property;
}

const yearsSince = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
};

/**
 * "County records" panel — stamps the official Travis CAD parcel
 * record onto the property detail page when we have a join.
 *
 * Surfaces the signals public records actually expose, including
 * what TX *doesn't* reveal (no recorded sale price — TX is a
 * non-disclosure state, so all you get is the deed date). Renders
 * nothing for non-Travis listings or listings whose lat/lng didn't
 * fall on a TCAD parcel polygon.
 */
export const CadRecordPanel = ({ property }: CadRecordPanelProps) => {
  const rec = useCadRecord(property.id);
  if (!rec) return null;

  const yrs = yearsSince(rec.lastDeedDate);
  const ownerKind = rec.owner
    ? /\b(LLC|LP|LTD|TRUST|CORP|INC|HOLDINGS|PARTNERS)\b/i.test(rec.owner)
      ? 'entity'
      : 'individual'
    : null;

  const acres = rec.acreage ?? 0;
  const landValuePerAc = acres > 0 ? (rec.landValue ?? 0) / acres : 0;

  return (
    <section
      className="rounded-xl border border-slate-200 bg-slate-50 p-4"
      aria-labelledby="cad-heading"
    >
      <header className="flex items-baseline justify-between gap-2 mb-2">
        <h3
          id="cad-heading"
          className="text-base font-semibold text-gray-900"
        >
          County records
        </h3>
        <span className="text-[11px] uppercase tracking-wide text-gray-400">
          Travis CAD {rec.valYear ?? ''}
        </span>
      </header>
      <p className="text-xs text-gray-500 mb-3">
        Public-records snapshot from the Travis County Appraisal District&apos;s
        annual roll. TX is a non-disclosure state — deeds record the date of
        every transfer but not the sale price.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
        <Cell label="Parcel ID" value={rec.geoId} mono />
        <Cell
          label="Owner"
          value={rec.owner || '—'}
          hint={ownerKind === 'entity' ? 'Entity owner' : undefined}
        />
        <Cell
          label="Last deed"
          value={rec.lastDeedDate ?? '—'}
          hint={yrs !== null ? `${yrs.toFixed(1)} yrs ago` : undefined}
        />
        <Cell
          label="CAD acreage"
          value={
            rec.acreage != null ? `${rec.acreage.toFixed(2)} ac` : '—'
          }
        />
        <Cell
          label="Appraised"
          value={formatPrice(rec.appraisedValue ?? 0)}
        />
        <Cell
          label="Assessed (taxable)"
          value={formatPrice(rec.assessedValue ?? 0)}
        />
        <Cell
          label="Land value"
          value={formatPrice(rec.landValue ?? 0)}
          hint={
            landValuePerAc > 0
              ? `$${Math.round(landValuePerAc).toLocaleString()}/ac`
              : undefined
          }
        />
        <Cell
          label="Improvements"
          value={formatPrice(rec.improvementValue ?? 0)}
          hint={
            (rec.improvementValue ?? 0) === 0 ? 'no detected structures' : undefined
          }
        />
        <Cell label="ZIP" value={rec.zip || '—'} />
      </div>

      {yrs !== null && yrs > 10 && (
        <p className="mt-3 text-xs text-amber-700">
          Long hold ({yrs.toFixed(0)} years) — current owner has held this
          parcel for over a decade. Often correlates with paid-off land and
          softer pricing flexibility.
        </p>
      )}
      {ownerKind === 'entity' && (
        <p className="mt-3 text-xs text-sky-700">
          LLC/holding company owner — sometimes a developer flip,
          sometimes long-term investor parking. Check the deed date below.
        </p>
      )}
    </section>
  );
};

const Cell = ({
  label,
  value,
  hint,
  mono,
}: {
  label: string;
  value: string | number;
  hint?: string;
  mono?: boolean;
}) => (
  <div>
    <p className="text-[11px] text-gray-500 uppercase tracking-wide">{label}</p>
    <p
      className={`text-sm font-medium text-gray-900 ${mono ? 'font-mono tabular-nums' : ''}`}
    >
      {value}
    </p>
    {hint && <p className="text-[11px] text-gray-500 mt-0.5">{hint}</p>}
  </div>
);

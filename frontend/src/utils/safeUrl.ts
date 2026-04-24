/**
 * Sanitize an `href` value that comes from scraped or user-supplied data.
 *
 * Scraped listing URLs flow from Python sources (LandWatch, Craigslist,
 * LandHub, Mossy Oak, discovery scaffolds) into clickable links on the
 * dashboard. None of the scraper normalize layers validate the scheme,
 * so a malicious listing returning `{"url": "javascript:alert(...)"}`
 * would execute JS on click. `rel="noopener noreferrer"` blocks
 * window.opener abuse but does NOT sanitize the scheme — `target="_blank"`
 * doesn't either.
 *
 * This helper returns the URL unchanged iff it parses as `http:` or
 * `https:` (mailto + tel refused too — we never legitimately ship those
 * from scrapers). Anything else yields `"#"` so React still has a valid
 * href. Logs to console in dev so we notice if a scraper starts emitting
 * junk.
 */
const SAFE_SCHEMES = new Set(["http:", "https:"]);

export const safeUrl = (raw: string | null | undefined): string => {
  if (!raw) return "#";
  const trimmed = raw.trim();
  if (!trimmed) return "#";
  try {
    const u = new URL(trimmed);
    if (!SAFE_SCHEMES.has(u.protocol)) {
      if (import.meta.env.DEV) {
        console.warn(`safeUrl: rejected non-http(s) scheme "${u.protocol}" in`, raw);
      }
      return "#";
    }
    return u.toString();
  } catch {
    // Relative paths or malformed URLs — if it at least *looks* like an
    // absolute http(s) prefix, pass it through; otherwise refuse.
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return "#";
  }
};

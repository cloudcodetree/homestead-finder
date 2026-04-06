// URL validation utility for listing sources.
//
// CORS limitation: Browsers block cross-origin fetch requests from static
// GitHub Pages sites, so client-side validation is not possible. The real
// implementation should run server-side in the scraper
// (scraper/utils/validator.py), which can issue HTTP HEAD requests without
// CORS constraints and write validation results (validated, validatedAt,
// status) back into listings.json as part of the daily scrape cycle.

export interface ValidationResult {
  valid: boolean;
  status: 'active' | 'expired' | 'error';
  checkedAt: string;
}

/**
 * Stub — always returns an error result because client-side URL validation
 * is blocked by CORS. Real validation runs in the scraper on the server.
 */
export const validateListingUrl = (_url: string): ValidationResult => {
  return {
    valid: false,
    status: 'error',
    checkedAt: new Date().toISOString(),
  };
};

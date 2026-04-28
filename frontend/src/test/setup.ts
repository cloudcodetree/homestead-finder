// Vitest setup — runs once before every test file.
//
// Adds @testing-library/jest-dom matchers (e.g. `toBeInTheDocument`,
// `toHaveClass`, `toBeVisible`) so component assertions read like the
// rest of the React Testing Library ecosystem.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// React Testing Library mounts each test into a portal; `cleanup`
// tears it down between tests so the DOM doesn't accumulate. With
// vitest's `globals: true` we wire it through `afterEach`.
afterEach(() => {
  cleanup();
});

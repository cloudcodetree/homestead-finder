#!/usr/bin/env node
/**
 * Copies data/listings.json from the repo root into web/data/
 * so Next.js/Turbopack can import it (project root boundary enforcement).
 *
 * Runs as a prebuild hook. The copied file is gitignored because
 * the source of truth is data/listings.json at the repo root.
 */
import { cp, mkdir, access, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, '..');
const SOURCE = resolve(WEB_ROOT, '..', 'data', 'listings.json');
const TARGET_DIR = resolve(WEB_ROOT, 'data');
const TARGET = resolve(TARGET_DIR, 'listings.json');

async function main() {
  await mkdir(TARGET_DIR, { recursive: true });

  try {
    await access(SOURCE, constants.R_OK);
    await cp(SOURCE, TARGET);
    console.log(`[copy-data] ${SOURCE} → ${TARGET}`);
  } catch {
    // Source file doesn't exist — write an empty array so the import
    // still resolves. The listings loader will fall back to sample data.
    await writeFile(TARGET, '[]\n');
    console.log(`[copy-data] source missing, wrote empty array to ${TARGET}`);
  }
}

main().catch((err) => {
  console.error('[copy-data] failed:', err);
  process.exit(1);
});

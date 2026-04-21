/// <reference types="vite/client" />

// Build-time constant injected by vite.config.ts via `define`. ISO 8601
// UTC string captured at build start; the footer formats it for display.
declare const __BUILD_TIME__: string;

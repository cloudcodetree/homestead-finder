/**
 * Small build-time debug footer. Renders DD:MM:YYYY:HH:MM:SS derived from
 * the ISO string baked in at build time by vite.config.ts. Useful for
 * confirming which deploy is live in the browser without opening DevTools.
 */
const pad = (n: number) => String(n).padStart(2, '0');

const formatBuildTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return (
    `${pad(d.getDate())}:${pad(d.getMonth() + 1)}:${d.getFullYear()}:` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
};

export const BuildFooter = () => {
  const display = formatBuildTime(__BUILD_TIME__);
  return (
    <footer
      className="pointer-events-none fixed bottom-1 right-2 text-[10px] font-mono text-gray-400/70 select-none"
      title={`Built at ${__BUILD_TIME__} (UTC ISO)`}
    >
      build {display}
    </footer>
  );
};

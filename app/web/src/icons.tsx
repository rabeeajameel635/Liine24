// Simple line icons drawn for this app (no Apple glyphs or SF Symbols).
const P: Record<string, string> = {
  library: 'M4 5h6v14H4zM12 5h3v14h-3zM17.5 5.5l2.6.7-3.4 12.8-2.6-.7z',
  character: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5',
  song: 'M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  clip: 'M4 6h16v12H4zM4 10h16M8 6v4M12 6v4M16 6v4',
  reels: 'M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM10.5 9.5l4 2.5-4 2.5z',
  release: 'M12 15V4M8 8l4-4 4 4M5 14v5h14v-5',
  connections: 'M9 7H6a3 3 0 0 0 0 6h3M15 7h3a3 3 0 0 1 0 6h-3M8 10h8',
  skills: 'M6 4h9l3 3v13H6zM15 4v3h3M9 11h6M9 14h6M9 17h4',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6.5 6.5l2.5 2.5M15 15l2.5 2.5M6.5 17.5 9 15M15 9l2.5-2.5',
  theme: 'M12 4a8 8 0 1 0 0 16z M12 4a8 8 0 0 1 0 16',
  inspector: 'M4 5h16v14H4zM14 5v14',
  drop: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5'
};
export function Icon({ name }: { name: keyof typeof P | string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name] ?? ''} />
    </svg>
  );
}

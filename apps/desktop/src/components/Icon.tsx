// Ícones de traço, iguais aos dos mockups. Decorativos por omissão.
const PATHS: Record<string, string> = {
  overview: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  workspaces: "M3 7h6l2 2h10v10H3z",
  workloads: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9",
  images: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
  build: "M14 3l7 7-4 4-7-7zM10 11l-6 6v3h3l6-6M13 8l3 3",
  volumes: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  kubernetes: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 3v6M12 15v6M3 12h6M15 12h6",
  declarative: "M6 3h9l5 5v13H6zM14 3v5h5M9 13h7M9 17h7",
  networks: "M5 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM19 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM19 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 12h5M12 12l5-5M12 12l5 5",
  registries: "M3 4h18v6H3zM3 14h18v6H3zM7 7h.01M7 17h.01",
  secrets: "M15 7a4 4 0 1 0-3.9 5l.9.9 2 2-1.5 1.5 1.5 1.5-2 2-2-2V12.1A4 4 0 0 0 15 7zM15 7h.01",
  backups: "M3 7l2-3h14l2 3M3 7h18v12H3zM3 7v0M9 11h6",
  events: "M3 12h4l3-7 4 14 3-7h4",
  assistant: "M4 5h16v11H9l-5 4zM9 10h.01M12 10h.01M15 10h.01",
  capabilities: "M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6zM8.5 12l2.5 2.5 4.5-5",
  extensions: "M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5",
  settings: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M16 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM10 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM18 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5",
  // Explorador de ficheiros e ícones por tipo de entrada.
  files: "M3 6l2-2h5l2 2h7v13H3zM3 10h18",
  folder: "M3 6l2-2h5l2 2h7v13H3z",
  file: "M6 3h9l5 5v13H6zM14 3v5h5",
  download: "M12 3v12M7 11l5 5 5-5M5 20h14",
  up: "M12 20V6M6 12l6-6 6 6",
  terminal: "M5 7l5 5-5 5M12 18h7",
  logs: "M5 6h14M5 12h14M5 18h9",
  activity: "M12 4v11M7 10l5 5 5-5M5 20h14",
  play: "M7 5l12 7-12 7z",
  stop: "M6 6h12v12H6z",
  restart: "M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  plus: "M12 5v14M5 12h14",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  copy: "M8 8h12v12H8zM16 8V4H4v12h4",
  chevron: "M6 9l6 6 6-6",
  menu: "M4 7h16M4 12h16M4 17h16",
  min: "M6 12h12",
  max: "M6 6h12v12H6z",
  close: "M7 7l10 10M17 7L7 17",
};

export function Icon({ name, size = 16, label }: { name: keyof typeof PATHS | string; size?: number; label?: string }) {
  return (
    <svg className="ic" viewBox="0 0 24 24" width={size} height={size} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}

export function Logo({ size = 16 }: { size?: number }) {
  const petals = [0, 1, 2, 3, 4].map((i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    return <circle key={i} cx={12 + 5.8 * Math.cos(a)} cy={12 + 5.8 * Math.sin(a)} r={3.2} fill="var(--brand-petal)" />;
  });
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {petals}
      <circle cx="12" cy="12" r="2.2" fill="var(--brand-core)" />
    </svg>
  );
}

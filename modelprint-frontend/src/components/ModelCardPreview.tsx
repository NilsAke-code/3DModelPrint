import type { Model3D } from "../types";
import { getThumbnailUrl, getModelFileUrl } from "../services/api";

// Premium neutral palette — all desaturated, no neon.
// Background is always very dark; accent is a muted tone for visual distinction only.
const CATEGORY_CONFIG: Record<string, { bg: string; accent: string }> = {
  "Toys & Games":  { bg: "#141414", accent: "#9ca3af" },
  "Mechanical":    { bg: "#111318", accent: "#8b97a8" },
  "Education":     { bg: "#131318", accent: "#9da3b4" },
  "Art":           { bg: "#151213", accent: "#a89da5" },
  "Household":     { bg: "#121414", accent: "#8fa8a0" },
  "Gadgets":       { bg: "#151311", accent: "#a8a08f" },
  "Tools":         { bg: "#141310", accent: "#aba590" },
  "Miniatures":    { bg: "#111316", accent: "#8f97a8" },
};

const DEFAULT_CONFIG = { bg: "#141414", accent: "#909090" };

export default function ModelCardPreview({ model }: { model: Model3D }) {
  const thumbnailUrl = getThumbnailUrl(model);
  const hasStlFile = !!getModelFileUrl(model);
  const cfg = CATEGORY_CONFIG[model.category] ?? DEFAULT_CONFIG;

  if (thumbnailUrl) {
    return (
      <div className="relative w-full h-full">
        <img
          src={thumbnailUrl}
          alt={model.title}
          className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
          loading="lazy"
        />
        {hasStlFile && <Badge3D />}
      </div>
    );
  }

  const tipX   = 20 + (model.id * 53)  % 160;
  const crossY = 55 + (model.id * 37)  % 40;
  const diagX1 = (model.id * 71)       % 100;
  const diagX2 = 100 + (model.id * 41) % 100;

  return (
    <div
      className="relative w-full h-full flex flex-col items-center justify-center gap-1.5 px-3 overflow-hidden"
      style={{ backgroundColor: cfg.bg }}
    >
      <svg
        className="absolute inset-0 w-full h-full opacity-[0.13]"
        viewBox="0 0 200 125"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <line x1="0"     y1="125" x2={tipX} y2="18"  stroke={cfg.accent} strokeWidth="0.6" />
        <line x1="200"   y1="125" x2={tipX} y2="18"  stroke={cfg.accent} strokeWidth="0.6" />
        <line x1="60"    y1="125" x2={tipX} y2="18"  stroke={cfg.accent} strokeWidth="0.5" />
        <line x1="140"   y1="125" x2={tipX} y2="18"  stroke={cfg.accent} strokeWidth="0.5" />
        <line x1="0"     y1={crossY} x2="200" y2={crossY} stroke={cfg.accent} strokeWidth="0.4" />
        <line x1="0"     y1="100"   x2="200" y2="100"     stroke={cfg.accent} strokeWidth="0.3" />
        <line x1={diagX1} y1="125" x2={diagX2} y2="18" stroke={cfg.accent} strokeWidth="0.4" />
        <circle cx={tipX} cy="18" r="4" fill="none" stroke={cfg.accent} strokeWidth="0.6" />
      </svg>

      <span
        className="relative z-10 text-[9px] font-bold uppercase tracking-[0.15em] text-center"
        style={{ color: cfg.accent }}
      >
        {model.category}
      </span>

      <span className="relative z-10 text-text-primary/35 text-[9px] text-center leading-tight line-clamp-2 max-w-full">
        {model.title}
      </span>

      {hasStlFile && <Badge3D />}
    </div>
  );
}

function Badge3D() {
  return (
    <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-accent/90 text-bg-primary text-[9px] font-bold tracking-wider">
      3D
    </div>
  );
}

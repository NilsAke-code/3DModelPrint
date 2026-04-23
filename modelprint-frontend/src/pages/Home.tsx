import { useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import {
  Library,
  Download,
  Wrench,
  Puzzle,
  Layers,
  ScanLine,
  Box,
  ShieldCheck,
  ArrowRight,
  Sparkles,
} from "lucide-react";

// ── Intersection-observer fade/slide hook ──────────────────────────────────
function useReveal(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

// ── Feature cards ──────────────────────────────────────────────────────────
const FEATURES = [
  {
    icon: Puzzle,
    title: "Import from MakerWorld",
    desc: "Use the browser extension to pull any model straight from your MakerWorld session — no manual downloading required.",
  },
  {
    icon: Library,
    title: "Private model library",
    desc: "Every model you import is stored in your own private library. Clean thumbnails, categories, and tags keep things organised.",
  },
  {
    icon: Wrench,
    title: "Print-ready processing",
    desc: "Models are automatically centred, seated on the bed, and rendered from multiple angles so you always know what you're printing.",
  },
];

// ── Roadmap items ──────────────────────────────────────────────────────────
const ROADMAP = [
  { icon: ScanLine,    label: "Auto-slicing preview", desc: "See estimated print time and layer count before you slice." },
  { icon: Layers,      label: "Print profiles",        desc: "Save per-model profiles for your printer and material settings." },
  { icon: Box,         label: "Multi-format export",   desc: "Export any model as STL, 3MF, or OBJ from the library." },
  { icon: Download,    label: "Batch download",         desc: "Download multiple models in one ZIP for offline use." },
  { icon: ShieldCheck, label: "Per-model notes",       desc: "Attach print notes, warnings, and settings to any model." },
  { icon: Sparkles,    label: "AI print tips",          desc: "Smart suggestions for orientation, supports, and infill." },
];

// ── Animated gradient orbs (decorative) ───────────────────────────────────
function HeroOrbs() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div
        className="absolute -top-32 -left-32 w-[480px] h-[480px] rounded-full opacity-[0.07]"
        style={{
          background: "radial-gradient(circle, #80430E 0%, transparent 70%)",
          animation: "orb1 18s ease-in-out infinite alternate",
        }}
      />
      <div
        className="absolute -bottom-24 right-0 w-[360px] h-[360px] rounded-full opacity-[0.06]"
        style={{
          background: "radial-gradient(circle, #A98759 0%, transparent 70%)",
          animation: "orb2 22s ease-in-out infinite alternate",
        }}
      />
    </div>
  );
}

export default function Home() {
  const navigate = useNavigate();

  const [heroVisible, setHeroVisible] = useState(false);
  useEffect(() => { const t = setTimeout(() => setHeroVisible(true), 60); return () => clearTimeout(t); }, []);

  const features = useReveal(0.1);
  const roadmap  = useReveal(0.1);
  const cta      = useReveal(0.1);

  return (
    <div className="relative min-h-screen flex flex-col">

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="relative flex flex-col items-center justify-center text-center pt-24 pb-28 px-6 overflow-hidden">
        <HeroOrbs />

        <div
          className="relative z-10 flex flex-col items-center gap-6"
          style={{
            opacity: heroVisible ? 1 : 0,
            transform: heroVisible ? "translateY(0)" : "translateY(24px)",
            transition: "opacity 0.7s ease, transform 0.7s ease",
          }}
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-bg-card px-4 py-1.5 text-xs font-medium text-text-secondary">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500/70 animate-pulse" />
            Personal 3D model library
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-text-primary leading-tight tracking-tight max-w-3xl">
            Your private library for<br />
            <span
              className="text-transparent bg-clip-text"
              style={{ backgroundImage: "linear-gradient(135deg, #E2BE80 0%, #A98759 100%)" }}
            >
              3D printing models
            </span>
          </h1>

          <p className="text-text-secondary text-base sm:text-lg max-w-xl leading-relaxed">
            Import from MakerWorld, organise everything in one place, and get your models print-ready — automatically.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
            <button
              onClick={() => navigate("/library")}
              className="flex items-center gap-2 rounded-xl bg-accent text-white font-semibold px-6 py-3 text-sm hover:bg-accent-hover hover:-translate-y-0.5 transition-all duration-150 shadow-lg shadow-black/30"
            >
              Go to Library <ArrowRight size={16} />
            </button>
            <button
              onClick={() => navigate("/import")}
              className="flex items-center gap-2 rounded-xl border border-border bg-bg-card text-text-secondary font-semibold px-6 py-3 text-sm hover:border-accent/40 hover:bg-accent/10 hover:text-text-primary hover:-translate-y-0.5 transition-all duration-150"
            >
              Import a model
            </button>
          </div>
        </div>
      </section>

      {/* ── What you can do ───────────────────────────────────────────────── */}
      <section className="px-6 pb-24">
        <div
          ref={features.ref}
          className="max-w-5xl mx-auto"
          style={{
            opacity: features.visible ? 1 : 0,
            transform: features.visible ? "translateY(0)" : "translateY(32px)",
            transition: "opacity 0.7s ease, transform 0.7s ease",
          }}
        >
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-widest text-center mb-8">
            What you can do
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {FEATURES.map(({ icon: Icon, title, desc }, i) => (
              <div
                key={title}
                className="rounded-2xl bg-bg-card border border-border p-6 flex flex-col gap-3 hover:border-accent/25 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/30 transition-all duration-200"
                style={{
                  opacity: features.visible ? 1 : 0,
                  transform: features.visible ? "translateY(0)" : "translateY(20px)",
                  transition: `opacity 0.5s ease ${i * 80}ms, transform 0.5s ease ${i * 80}ms, border-color 0.2s, box-shadow 0.2s, translate 0.2s`,
                }}
              >
                <div className="w-10 h-10 rounded-xl bg-bg-secondary border border-border flex items-center justify-center shrink-0">
                  <Icon size={18} className="text-text-secondary" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
                  <p className="text-xs text-text-secondary mt-1.5 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Coming soon / Roadmap ─────────────────────────────────────────── */}
      <section className="px-6 pb-24">
        <div
          ref={roadmap.ref}
          className="max-w-5xl mx-auto"
          style={{
            opacity: roadmap.visible ? 1 : 0,
            transform: roadmap.visible ? "translateY(0)" : "translateY(32px)",
            transition: "opacity 0.7s ease, transform 0.7s ease",
          }}
        >
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-widest text-center mb-2">
            Coming soon
          </p>
          <h2 className="text-2xl font-bold text-text-primary text-center mb-8">
            We're just getting started
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {ROADMAP.map(({ icon: Icon, label, desc }, i) => (
              <div
                key={label}
                className="flex items-start gap-4 rounded-xl bg-bg-card border border-border px-5 py-4 hover:border-accent/25 transition-colors duration-150"
                style={{
                  opacity: roadmap.visible ? 1 : 0,
                  transform: roadmap.visible ? "translateX(0)" : "translateX(-16px)",
                  transition: `opacity 0.5s ease ${i * 60}ms, transform 0.5s ease ${i * 60}ms, border-color 0.15s`,
                }}
              >
                <div className="w-8 h-8 rounded-lg bg-bg-secondary border border-border flex items-center justify-center shrink-0 mt-0.5">
                  <Icon size={15} className="text-text-secondary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-text-primary leading-tight">{label}</p>
                  <p className="text-xs text-text-secondary mt-1 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ────────────────────────────────────────────────────── */}
      <section className="px-6 pb-28">
        <div
          ref={cta.ref}
          className="max-w-2xl mx-auto rounded-2xl border border-border bg-bg-card p-10 flex flex-col items-center text-center gap-5"
          style={{
            opacity: cta.visible ? 1 : 0,
            transform: cta.visible ? "translateY(0)" : "translateY(24px)",
            transition: "opacity 0.7s ease, transform 0.7s ease",
          }}
        >
          <h2 className="text-2xl font-bold text-text-primary">Ready to build your library?</h2>
          <p className="text-text-secondary text-sm leading-relaxed">
            Install the MakerWorld extension, browse a model you like, and hit import. It lands straight in your private library.
          </p>
          <button
            onClick={() => navigate("/import")}
            className="flex items-center gap-2 rounded-xl bg-accent text-white font-semibold px-7 py-3 text-sm hover:bg-accent-hover hover:-translate-y-0.5 transition-all duration-150 shadow-lg shadow-black/30"
          >
            Get started <ArrowRight size={16} />
          </button>
        </div>
      </section>

      <style>{`
        @keyframes orb1 {
          from { transform: translate(0, 0) scale(1); }
          to   { transform: translate(60px, 40px) scale(1.15); }
        }
        @keyframes orb2 {
          from { transform: translate(0, 0) scale(1); }
          to   { transform: translate(-50px, -30px) scale(1.1); }
        }
      `}</style>
    </div>
  );
}

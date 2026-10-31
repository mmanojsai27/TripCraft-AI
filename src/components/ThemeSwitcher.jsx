import { useEffect, useRef, useState } from "react";

export const THEMES = [
  { id: "midnight", label: "Midnight", emoji: "🌌", swatch: "linear-gradient(135deg,#0ea5e9,#6366f1)" },
  { id: "ocean", label: "Ocean", emoji: "🌊", swatch: "linear-gradient(135deg,#14b8a6,#3b82f6)" },
  { id: "sunset", label: "Sunset", emoji: "🌇", swatch: "linear-gradient(135deg,#f97316,#ec4899)" },
  { id: "forest", label: "Forest", emoji: "🌲", swatch: "linear-gradient(135deg,#22c55e,#14b8a6)" },
  { id: "royal", label: "Royal", emoji: "👑", swatch: "linear-gradient(135deg,#a855f7,#ec4899)" },
  { id: "graphite", label: "Graphite", emoji: "🌑", swatch: "linear-gradient(135deg,#94a3b8,#475569)" },
];

const KEY = "tc_theme";
const read = () => { try { return localStorage.getItem(KEY) || "midnight"; } catch { return "midnight"; } };
const apply = (id) => { document.documentElement.dataset.theme = id; };

// Apply the saved theme as soon as the app loads (also on the login screen)
apply(read());

export default function ThemeSwitcher() {
  const [theme, setTheme] = useState(read);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    apply(theme);
    try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const current = THEMES.find((t) => t.id === theme) || THEMES[0];

  return (
    <div ref={ref} className="relative">
      <button type="button" className="btn-ghost" onClick={() => setOpen(!open)} aria-haspopup="true" aria-expanded={open}>
        🎨 <span className="hidden sm:inline">{current.label}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-56 animate-rise rounded-2xl border border-white/10 p-2 shadow-2xl" style={{ background: "rgba(15,23,42,.97)" }}>
          <p className="px-2 pb-1 pt-1 text-xs font-semibold text-slate-400">🎨 Choose background colour</p>
          {THEMES.map((t) => (
            <button key={t.id} type="button" onClick={() => { setTheme(t.id); setOpen(false); }}
              className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm font-medium text-slate-100 transition hover:bg-white/10 ${theme === t.id ? "bg-white/10" : ""}`}>
              <span className="h-6 w-6 rounded-full border border-white/20" style={{ background: t.swatch }} />
              <span className="flex-1">{t.emoji} {t.label}</span>
              {theme === t.id && <span>✅</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
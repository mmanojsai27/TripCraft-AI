import { useEffect, useState } from "react";

/*
 * Full-screen background slideshow.
 * HOW TO ADD YOUR IMAGES: drop .jpg/.jpeg/.png/.webp files into  src/assets/bg/
 * They are picked up automatically (sorted by file name) - no code change needed.
 * If the folder is empty, the REMOTE list below is used, then a themed gradient fallback.
 * The colours come from the theme chosen in the header (see ThemeSwitcher.jsx / index.css).
 */
const local = Object.values(
  import.meta.glob("../assets/bg/*.{jpg,jpeg,png,webp,avif}", { eager: true, query: "?url", import: "default" })
);

// Optional fallback: put your own image URLs here (used only when src/assets/bg is empty)
const REMOTE = [];

const IMAGES = local.length ? local : REMOTE;
const INTERVAL_MS = 7000; // <- change slide speed here

export default function Background() {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (IMAGES.length < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % IMAGES.length), INTERVAL_MS);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="no-print fixed inset-0 -z-10 overflow-hidden" style={{ background: "var(--bg)", transition: "background .6s ease" }} aria-hidden="true">
      {IMAGES.length === 0 && (
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at 20% 0%, rgba(var(--g1),.24), transparent 55%), radial-gradient(ellipse at 90% 20%, rgba(var(--g2),.24), transparent 50%), radial-gradient(ellipse at 50% 100%, rgba(var(--g3),.16), transparent 55%)",
          }}
        />
      )}

      {IMAGES.map((src, idx) => (
        <div key={src} className={`bg-slide ${idx === i ? "active" : ""}`} style={{ backgroundImage: `url(${src})` }} />
      ))}

      {/* Dark overlay keeps text readable when photos are used */}
      <div className="absolute inset-0 bg-gradient-to-b from-slate-950/70 via-slate-950/60 to-slate-950/90" />

      {/* Fine dot grid */}
      <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "radial-gradient(#fff 1px, transparent 1px)", backgroundSize: "28px 28px" }} />

      {/* Soft floating colour blobs (follow the theme) */}
      <div className="absolute -left-24 top-1/4 h-80 w-80 animate-float rounded-full blur-3xl" style={{ background: "rgba(var(--g1),.22)" }} />
      <div className="absolute -right-24 bottom-1/4 h-96 w-96 animate-float rounded-full blur-3xl [animation-delay:1.5s]" style={{ background: "rgba(var(--g2),.22)" }} />
      <div className="absolute bottom-0 left-1/3 h-72 w-72 animate-float rounded-full blur-3xl [animation-delay:3s]" style={{ background: "rgba(var(--g3),.14)" }} />
    </div>
  );
}
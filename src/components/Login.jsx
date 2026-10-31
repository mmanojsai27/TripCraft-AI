import { useEffect, useRef, useState } from "react";
import api, { errMsg, ROLE_LABEL } from "../api";

/* ---- easy things to customise ---- */
const DESTINATIONS = [
  ["🏖️", "Goa"], ["🏔️", "Manali"], ["🏯", "Jaipur"], ["🌴", "Kerala"],
  ["🗼", "Paris"], ["🌋", "Bali"], ["🌃", "Tokyo"], ["🏜️", "Dubai"],
];
const FEATURES = [
  ["🎯", "AI destination matching"],
  ["💸", "Smart cost estimates"],
  ["🗓️", "Itineraries the whole group agrees on"],
  ["🧾", "Expenses that settle themselves"],
];
const DEMOS = [
  ["🧭", "Organiser", "organiser@tripcraft.ai"],
  ["🙋", "Member", "riya@tripcraft.ai"],
  ["🏨", "Partner", "partner@tripcraft.ai"],
  ["🛡️", "Admin", "admin@tripcraft.ai"],
];
const ROLES = [["organiser", "🧭"], ["member", "🙋"], ["partner", "🏨"]];

const CSS = `
@keyframes lgSpin { to { transform: rotate(360deg); } }
@keyframes lgWord { 0% { opacity:0; transform: translateY(70%) scale(.9); filter: blur(6px); } 100% { opacity:1; transform:none; filter:none; } }
@keyframes lgFloatA { 0%,100% { transform: translateY(0) rotate(-2deg); } 50% { transform: translateY(-14px) rotate(2deg); } }
@keyframes lgFloatB { 0%,100% { transform: translateY(0) rotate(2deg); } 50% { transform: translateY(-10px) rotate(-2deg); } }
@keyframes lgRise { 0% { opacity:0; transform: translateY(30px) scale(.97); } 100% { opacity:1; transform:none; } }
@keyframes lgInL { 0% { opacity:0; transform: translateX(-28px); } 100% { opacity:1; transform:none; } }
@keyframes lgInR { 0% { opacity:0; transform: translateX(28px); } 100% { opacity:1; transform:none; } }
@keyframes lgShake { 0%,100% { transform: translateX(0); } 20% { transform: translateX(-8px); } 40% { transform: translateX(8px); } 60% { transform: translateX(-5px); } 80% { transform: translateX(5px); } }
@keyframes lgDash { to { stroke-dashoffset: -40; } }
@keyframes lgPulse { 0% { r: 4; opacity: .9; } 100% { r: 16; opacity: 0; } }
@keyframes lgShimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
@keyframes lgShine { 0% { transform: translateX(-120%) skewX(-20deg); } 100% { transform: translateX(260%) skewX(-20deg); } }

.lg-spin { animation: lgSpin 6s linear infinite; }
.lg-word { display:inline-block; animation: lgWord .6s cubic-bezier(.22,1,.36,1) both; }
.lg-floatA { animation: lgFloatA 5s ease-in-out infinite; }
.lg-floatB { animation: lgFloatB 6.5s ease-in-out infinite; }
.lg-rise { animation: lgRise .8s cubic-bezier(.22,1,.36,1) both; }
.lg-inL { animation: lgInL .45s cubic-bezier(.22,1,.36,1) both; }
.lg-inR { animation: lgInR .45s cubic-bezier(.22,1,.36,1) both; }
.lg-shake { animation: lgShake .45s ease; }
.lg-dash { animation: lgDash 1.4s linear infinite; }
.lg-title { background: linear-gradient(90deg,#fff,#7dd3fc,#fff,#fcd34d,#fff); background-size: 300% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: lgShimmer 6s linear infinite; }
.lg-btn::after { content:""; position:absolute; top:0; left:0; height:100%; width:40%; background: rgba(255,255,255,.35); transform: translateX(-120%) skewX(-20deg); }
.lg-btn:hover::after { animation: lgShine .9s ease; }
`;

export default function Login({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [dir, setDir] = useState("L");
  const [f, setF] = useState({ email: "", password: "", full_name: "", role: "member" });
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [w, setW] = useState(0);
  const card = useRef(null);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  // rotating destination word
  useEffect(() => {
    const t = setInterval(() => setW((n) => (n + 1) % DESTINATIONS.length), 2200);
    return () => clearInterval(t);
  }, []);

  const switchMode = (m) => {
    if (m === mode) return;
    setDir(m === "register" ? "R" : "L");
    setMode(m);
    setErr("");
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const body = mode === "login" ? { email: f.email, password: f.password } : f;
      const { data } = await api.post(`/auth/${mode}`, body);
      localStorage.setItem("tc_token", data.access_token);
      onAuth(data.user);
    } catch (x) {
      setErr(errMsg(x));
    } finally {
      setBusy(false);
    }
  };

  // gentle 3D tilt that follows the mouse
  const move = (e) => {
    const el = card.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(1100px) rotateY(${x * 5}deg) rotateX(${-y * 5}deg)`;
  };
  const leave = () => { if (card.current) card.current.style.transform = ""; };

  const [emoji, name] = DESTINATIONS[w];
  const slide = dir === "R" ? "lg-inR" : "lg-inL";
  const roleIdx = Math.max(0, ROLES.findIndex(([r]) => r === f.role));

  return (
    <div className="mx-auto grid min-h-screen max-w-6xl items-center gap-12 px-6 py-10 md:grid-cols-2">
      <style>{CSS}</style>

      {/* ============================ LEFT: hero ============================ */}
      <div className="text-white drop-shadow-lg">
        <div className="lg-rise flex items-center gap-3" style={{ animationDelay: ".05s" }}>
          <span className="lg-floatA inline-block text-5xl">🧭</span>
          <span className="rounded-full border border-white/30 bg-white/10 px-3 py-1 text-xs font-semibold backdrop-blur">AI-powered group travel</span>
        </div>

        <h1 className="lg-title lg-rise mt-4 text-5xl font-extrabold tracking-tight sm:text-6xl" style={{ animationDelay: ".15s" }}>
          TripCraft AI
        </h1>

        <p className="lg-rise mt-4 text-2xl font-bold sm:text-3xl" style={{ animationDelay: ".25s" }}>
          Your next trip to{" "}
          <span key={w} className="lg-word bg-gradient-to-r from-amber-300 to-pink-400 bg-clip-text text-transparent">
            {emoji} {name}
          </span>
        </p>

        <p className="lg-rise mt-3 max-w-md text-white/85" style={{ animationDelay: ".35s" }}>
          Plan group trips everyone agrees on: smart suggestions, fair budgets and expenses that split themselves.
        </p>

        <ul className="mt-6 grid max-w-md gap-2.5 text-sm">
          {FEATURES.map(([ic, t], i) => (
            <li
              key={t}
              className="lg-inL flex items-center gap-3 rounded-xl border border-white/20 bg-white/10 px-3 py-2 backdrop-blur transition hover:translate-x-1 hover:bg-white/20"
              style={{ animationDelay: `${0.45 + i * 0.1}s` }}
            >
              <span className="text-lg">{ic}</span>{t}
            </li>
          ))}
        </ul>

        {/* flight path scene */}
        <div className="relative mt-8 hidden h-44 max-w-md md:block">
          <svg viewBox="0 0 400 170" className="absolute inset-0 h-full w-full overflow-visible">
            <path id="lgFlight" d="M12 150 C 90 10, 220 20, 290 95 S 380 140, 392 40" fill="none" stroke="rgba(255,255,255,.55)" strokeWidth="2" strokeDasharray="6 8" className="lg-dash" />
            <circle cx="12" cy="150" r="5" fill="#fcd34d" />
            <circle cx="12" cy="150" r="4" fill="none" stroke="#fcd34d" strokeWidth="2" style={{ animation: "lgPulse 2s ease-out infinite" }} />
            <circle cx="392" cy="40" r="5" fill="#34d399" />
            <circle cx="392" cy="40" r="4" fill="none" stroke="#34d399" strokeWidth="2" style={{ animation: "lgPulse 2s ease-out .8s infinite" }} />
            <g>
              <path d="M0 0 L-14 -7 L-9 0 L-14 7 Z" fill="#fff" />
              <animateMotion dur="7s" repeatCount="indefinite" rotate="auto">
                <mpath href="#lgFlight" />
              </animateMotion>
            </g>
          </svg>
          <div className="lg-floatA absolute left-0 top-0 rounded-xl border border-white/30 bg-white/15 px-3 py-1.5 text-xs font-semibold backdrop-blur-md">💰 ₹12,400 saved</div>
          <div className="lg-floatB absolute right-2 top-14 rounded-xl border border-white/30 bg-white/15 px-3 py-1.5 text-xs font-semibold backdrop-blur-md" style={{ animationDelay: "1s" }}>🗳️ 4 of 5 voted</div>
          <div className="lg-floatA absolute bottom-0 left-24 rounded-xl border border-white/30 bg-white/15 px-3 py-1.5 text-xs font-semibold backdrop-blur-md" style={{ animationDelay: "2s" }}>🌦️ Rain-proof plan B</div>
        </div>
      </div>

      {/* ============================ RIGHT: form ============================ */}
      <div className="lg-rise" style={{ animationDelay: ".3s" }}>
        <div
          ref={card}
          onMouseMove={move}
          onMouseLeave={leave}
          className="relative overflow-hidden rounded-3xl p-[2px] shadow-2xl shadow-black/40"
          style={{ transition: "transform .2s ease-out" }}
        >
          {/* spinning rainbow border */}
          <div className="lg-spin absolute inset-[-60%] bg-[conic-gradient(from_0deg,#0ea5e9,#10b981,#f97316,#a855f7,#0ea5e9)]" />

          <form onSubmit={submit} className="relative space-y-4 rounded-[22px] bg-white/90 p-6 backdrop-blur-2xl sm:p-7">
            <div>
              <h2 className="text-2xl font-extrabold text-slate-800">{mode === "login" ? "Welcome back 👋" : "Start your journey ✨"}</h2>
              <p className="text-sm text-slate-500">{mode === "login" ? "Sign in to continue planning." : "Create your free TripCraft account."}</p>
            </div>

            {/* sliding Sign in / Create account switch */}
            <div className="relative grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm font-semibold">
              <span
                className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-lg bg-white shadow transition-transform duration-300 ease-out"
                style={{ transform: mode === "register" ? "translateX(100%)" : "none" }}
              />
              {[["login", "Sign in"], ["register", "Create account"]].map(([m, label]) => (
                <button type="button" key={m} onClick={() => switchMode(m)}
                  className={`relative z-10 rounded-lg py-2 transition-colors ${mode === m ? "text-brand-700" : "text-slate-500 hover:text-slate-700"}`}>
                  {label}
                </button>
              ))}
            </div>

            {/* fields slide in from the side matching the switch direction */}
            <div key={mode} className={`space-y-3 ${slide}`}>
              {mode === "register" && (
                <>
                  <div>
                    <label className="label">Full name</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2">👤</span>
                      <input className="input !pl-10" required value={f.full_name} onChange={set("full_name")} placeholder="Your name" />
                    </div>
                  </div>
                  <div>
                    <label className="label">I am a…</label>
                    <div className="relative grid grid-cols-3 rounded-xl bg-slate-100 p-1 text-xs font-semibold">
                      <span
                        className="absolute inset-y-1 left-1 w-[calc(33.333%-3px)] rounded-lg bg-brand-600 shadow transition-transform duration-300 ease-out"
                        style={{ transform: `translateX(${roleIdx * 100}%)` }}
                      />
                      {ROLES.map(([r, ic]) => (
                        <button type="button" key={r} onClick={() => setF({ ...f, role: r })}
                          className={`relative z-10 rounded-lg py-2 transition-colors ${f.role === r ? "text-white" : "text-slate-600 hover:text-slate-800"}`}>
                          {ic} {ROLE_LABEL[r].replace("Trip ", "").replace("Group ", "").replace("Travel ", "")}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
              <div>
                <label className="label">Email</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2">✉️</span>
                  <input className="input !pl-10" type="email" required value={f.email} onChange={set("email")} placeholder="you@example.com" />
                </div>
              </div>
              <div>
                <label className="label">Password</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2">🔒</span>
                  <input className="input !pl-10 !pr-11" type={showPw ? "text" : "password"} required minLength={8} value={f.password} onChange={set("password")} placeholder="At least 8 characters" />
                  <button type="button" onClick={() => setShowPw((s) => !s)} title={showPw ? "Hide password" : "Show password"}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-1.5 py-1 text-base transition hover:bg-slate-100 active:scale-90">
                    {showPw ? "🙈" : "👁️"}
                  </button>
                </div>
              </div>
            </div>

            {err && <p key={err} className="lg-shake rounded-lg bg-red-50 p-2.5 text-sm font-medium text-red-700">⚠️ {err}</p>}

            <button
              disabled={busy}
              className="lg-btn relative w-full overflow-hidden rounded-xl bg-gradient-to-r from-brand-600 via-sky-500 to-emerald-500 py-3 text-sm font-bold text-white shadow-lg shadow-brand-600/30 transition duration-200 hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0 active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Please wait…
                </span>
              ) : mode === "login" ? "Sign in →" : "Create account →"}
            </button>

            {mode === "login" && (
              <div className="border-t pt-4">
                <p className="mb-2 text-xs text-slate-500">Quick demo accounts · password <code className="rounded bg-slate-100 px-1">TripCraft@123</code></p>
                <div className="grid grid-cols-2 gap-2">
                  {DEMOS.map(([ic, label, email], i) => (
                    <button type="button" key={email}
                      onClick={() => setF({ ...f, email, password: "TripCraft@123" })}
                      className={`lg-rise flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition hover:-translate-y-0.5 hover:bg-white hover:shadow active:scale-95 ${f.email === email ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 bg-white/70 text-slate-700"}`}
                      style={{ animationDelay: `${0.5 + i * 0.08}s` }}>
                      <span className="text-base">{ic}</span>{label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
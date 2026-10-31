import { useCallback, useEffect, useState } from "react";
import api, { errMsg, ROLE_LABEL } from "./api";
import Dashboard from "./components/Dashboard.jsx";
import ItineraryBuilder from "./components/ItineraryBuilder.jsx";
import ExpenseTracker from "./components/ExpenseTracker.jsx";
import Background from "./components/Background.jsx";
import Explore from "./components/Explore.jsx";
import Login from "./components/Login.jsx";
import ThemeSwitcher from "./components/ThemeSwitcher.jsx";

const ROLE_STYLE = {
  admin: "bg-purple-100 text-purple-700",
  organiser: "bg-brand-100 text-brand-700",
  member: "bg-emerald-100 text-emerald-700",
  partner: "bg-amber-100 text-amber-700",
};

const DEMOS = [
  ["Organiser", "organiser@tripcraft.ai"],
  ["Member", "riya@tripcraft.ai"],
  ["Partner", "partner@tripcraft.ai"],
  ["Admin", "admin@tripcraft.ai"],
];

function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [f, setF] = useState({ email: "", password: "", full_name: "", role: "member" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const body = mode === "login" ? { email: f.email, password: f.password } : f;
      const { data } = await api.post(`/auth/${mode}`, body);
      localStorage.setItem("tc_token", data.access_token);
      onAuth(data.user);
    } catch (e2) {
      setErr(errMsg(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto grid min-h-screen max-w-5xl items-center gap-10 px-6 md:grid-cols-2">
      <div className="stagger text-white drop-shadow-lg">
        <div className="animate-float text-6xl">🧭</div>
        <h1 className="mt-3 bg-gradient-to-r from-white via-sky-200 to-white bg-[length:200%_100%] bg-clip-text text-5xl font-extrabold tracking-tight text-transparent animate-shimmer">TripCraft AI</h1>
        <p className="mt-3 text-white/85">
          Plan group trips everyone agrees on: AI destination matching, ML cost estimates, GenAI itineraries built for
          consensus, and shared expenses that settle themselves.
        </p>
        <ul className="mt-5 space-y-2 text-sm text-white/85">
          <li>🎯 KNN destination recommender</li>
          <li>💸 Random-forest cost estimator</li>
          <li>🗓️ Consensus itinerary + weather-aware changes</li>
          <li>🧾 Exact-cent expense splitting &amp; settle-up</li>
        </ul>
      </div>
      <form onSubmit={submit} className="card space-y-3">
        <div className="flex gap-2 text-sm font-semibold">
          {["login", "register"].map((m) => (
            <button type="button" key={m} onClick={() => setMode(m)}
              className={`rounded-lg px-3 py-1.5 ${mode === m ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}>
              {m === "login" ? "Sign in" : "Create account"}
            </button>
          ))}
        </div>
        {mode === "register" && (
          <>
            <div><label className="label">Full name</label><input className="input" required value={f.full_name} onChange={set("full_name")} /></div>
            <div>
              <label className="label">I am a…</label>
              <select className="input" value={f.role} onChange={set("role")}>
                {["organiser", "member", "partner"].map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </div>
          </>
        )}
        <div><label className="label">Email</label><input className="input" type="email" required value={f.email} onChange={set("email")} /></div>
        <div><label className="label">Password</label><input className="input" type="password" required minLength={8} value={f.password} onChange={set("password")} /></div>
        {err && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{err}</p>}
        <button className="btn w-full" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
        {mode === "login" && (
          <div className="border-t pt-3">
            <p className="mb-2 text-xs text-slate-500">Demo accounts (password <code>TripCraft@123</code>)</p>
            <div className="flex flex-wrap gap-2">
              {DEMOS.map(([label, email]) => (
                <button type="button" key={email} className="btn-ghost" onClick={() => setF({ ...f, email, password: "TripCraft@123" })}>{label}</button>
              ))}
            </div>
          </div>
        )}
      </form>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [trips, setTrips] = useState([]);
  const [tripId, setTripId] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [ai, setAi] = useState(null);

  const logout = useCallback(() => {
    localStorage.removeItem("tc_token");
    setUser(null);
    setTrips([]);
    setTripId(null);
  }, []);

  useEffect(() => {
    window.addEventListener("tc:logout", logout);
    return () => window.removeEventListener("tc:logout", logout);
  }, [logout]);

  useEffect(() => {
    if (!localStorage.getItem("tc_token")) return setBooting(false);
    api.get("/auth/me").then((r) => setUser(r.data)).catch(() => {}).finally(() => setBooting(false));
  }, []);

  const loadTrips = useCallback(async () => {
    const { data } = await api.get("/trips");
    setTrips(data);
    setTripId((cur) => (data.some((t) => t.id === cur) ? cur : data[0]?.id ?? null));
  }, []);

  useEffect(() => {
    if (!user) return;
    loadTrips().catch(() => {});
    if (user.role !== "partner") api.get("/ai/status").then((r) => setAi(r.data)).catch(() => {});
  }, [user, loadTrips]);

  if (booting) return <><Background /><div className="grid min-h-screen place-items-center text-white/80"><span className="animate-pulse text-lg">🧭 Loading…</span></div></>;
  if (!user) return <><Background /><Login onAuth={setUser} /></>;

  const trip = trips.find((t) => t.id === tripId) || null;
  const tabs = [
    ["dashboard", "🏠 Dashboard"],
    ["itinerary", "🗺️ Itinerary"],
    ["explore", "🧭 Explore"], // FIX 1: adds the Explore button to the top bar
    ...(user.role !== "partner" ? [["expenses", "💸 Expenses"]] : []),
  ];

  return (
    <div className="min-h-screen">
      <Background />
      <header className="no-print sticky top-0 z-10 animate-rise border-b border-white/10 bg-slate-900/50 text-white backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <span className="text-lg font-extrabold tracking-tight"><span className="inline-block animate-float">🧭</span> TripCraft AI</span>
          <nav className="ml-4 flex flex-wrap gap-1">
            {tabs.map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition duration-200 active:scale-95 ${tab === id ? "tab-active" : "text-white/80 hover:bg-white/15 hover:text-white"}`}>
                {label}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {trips.length > 0 && (
              <select className="input !w-auto" value={tripId ?? ""} onChange={(e) => setTripId(Number(e.target.value))}>
                {trips.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
            {ai && <span className={`badge ${ai.genai_live ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
              GenAI: {ai.genai_live ? ai.genai_provider : "offline template"}</span>}
            <span className={`badge ${ROLE_STYLE[user.role]}`}>{ROLE_LABEL[user.role]}</span>
            <span className="hidden text-sm text-white/80 sm:inline">{user.full_name}</span>
            <ThemeSwitcher />
            <button className="btn-ghost" onClick={logout}>👋 Sign out</button>
          </div>
        </div>
      </header>
      <main key={tab + (tripId ?? "")} className="mx-auto max-w-6xl px-4 py-6">
        {tab === "dashboard" && <Dashboard user={user} trips={trips} trip={trip} onSelectTrip={setTripId} onReload={loadTrips} />}
        {tab === "itinerary" && (trip ? <ItineraryBuilder key={trip.id} user={user} trip={trip} onChanged={loadTrips} /> : <Empty />)}
        {/* FIX 2: renders the Explore screen when its tab is clicked */}
        {tab === "explore" && <Explore trip={trip} />}
        {tab === "expenses" && (trip ? <ExpenseTracker key={trip.id} user={user} trip={trip} /> : <Empty />)}
      </main>
    </div>
  );
}

function Empty() {
  return <div className="card text-center text-slate-500">🧳 No trip selected. Create or join a trip from the Dashboard.</div>;
}
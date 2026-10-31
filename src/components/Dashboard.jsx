import { useEffect, useState } from "react";
import api, { errMsg, money, ROLE_LABEL } from "../api";
import { BarChart, DonutChart } from "./Charts.jsx";

const INTERESTS = ["beach", "adventure", "culture", "nature", "food", "nightlife", "relaxation", "shopping"];
const EMO = { beach: "🏖️", adventure: "🧗", culture: "🏛️", nature: "🌿", food: "🍜", nightlife: "🌃", relaxation: "🧘", shopping: "🛍️", budget: "🪙", standard: "⭐", premium: "💎", train: "🚆", road: "🚗", flight: "✈️", relaxed: "🧘", balanced: "⚖️", packed: "⚡" };
const today = () => new Date().toISOString().slice(0, 10);

function Err({ msg }) {
  return msg ? <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{msg}</p> : null;
}

/* ------------------------------------------------------------ Create trip (organiser/admin) */
function CreateTrip({ onCreated }) {
  const [f, setF] = useState({ name: "", destination: "", origin: "", start_date: today(), end_date: today(), budget_total: 100000, description: "" });
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    try {
      await api.post("/trips", { ...f, budget_total: Number(f.budget_total) });
      setF({ ...f, name: "", destination: "" });
      onCreated();
    } catch (x) { setErr(errMsg(x)); }
  };
  return (
    <form onSubmit={submit} className="card space-y-3">
      <h3 className="text-lg font-extrabold">🧳 Create a trip</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label">🏷️ Trip name</label><input placeholder="🏝️ e.g. Goa Getaway 2026" className="input" required value={f.name} onChange={set("name")} /></div>
        <div><label className="label">📍 Destination</label><input className="input" required value={f.destination} onChange={set("destination")} placeholder="📍 e.g. Goa, Manali, Kashmir" /></div>
        <div><label className="label">🛫 Start</label><input type="date" className="input" required value={f.start_date} onChange={set("start_date")} /></div>
        <div><label className="label">🛬 End</label><input type="date" className="input" required value={f.end_date} onChange={set("end_date")} /></div>
        <div><label className="label">🏙️ Origin city</label><input placeholder="🏙️ e.g. Hyderabad" className="input" value={f.origin} onChange={set("origin")} /></div>
        <div><label className="label">💰 Group budget (₹)</label><input placeholder="💰 e.g. 100000" type="number" min="1" className="input" required value={f.budget_total} onChange={set("budget_total")} /></div>
      </div>
      <Err msg={err} />
      <button className="btn">🚀 Create trip</button>
    </form>
  );
}

/* ------------------------------------------------------------ Members panel */
function Members({ trip, user, onReload }) {
  const [email, setEmail] = useState("");
  const [err, setErr] = useState("");
  const canManage = user.role === "admin" || trip.organiser_id === user.id;
  const act = async (fn) => { setErr(""); try { await fn(); onReload(); } catch (x) { setErr(errMsg(x)); } };
  return (
    <div className="card space-y-3">
      <h3 className="text-lg font-extrabold">👥 Group &amp; partners</h3>
      <ul className="divide-y text-sm">
        {trip.members.map((m) => (
          <li key={m.user_id} className="flex flex-wrap items-center gap-2 py-2">
            <span className={`font-medium ${m.is_active ? "" : "text-slate-400 line-through"}`}>{m.full_name}</span>
            <span className="badge bg-slate-100 text-slate-600">{ROLE_LABEL[m.role]}</span>
            {!m.splits_expenses && <span className="badge bg-amber-50 text-amber-700">not in splits</span>}
            {m.user_id === trip.organiser_id && <span className="badge bg-brand-50 text-brand-700">organiser</span>}
            {canManage && m.user_id !== trip.organiser_id && (
              <span className="ml-auto flex gap-2">
                <button className="btn-ghost" onClick={() => act(() => api.patch(`/trips/${trip.id}/members/${m.user_id}`, { is_active: !m.is_active }))}>
                  {m.is_active ? "Deactivate" : "Reactivate"}
                </button>
                <button className="btn-danger" onClick={() => act(() => api.delete(`/trips/${trip.id}/members/${m.user_id}`))}>🗑️ Remove</button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {canManage && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); act(async () => { await api.post(`/trips/${trip.id}/members`, { email }); setEmail(""); }); }}>
          <input className="input" type="email" required placeholder="📧 Invite by email (must be registered)" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn">➕ Add</button>
        </form>
      )}
      <Err msg={err} />
    </div>
  );
}

/* ------------------------------------------------------------ AI 1: KNN recommender */
function Recommender({ trip }) {
  const [f, setF] = useState({ interests: ["beach", "food"], budget_min: 15000, budget_max: 30000, days: trip?.days || 5, travelers: trip?.members.filter((m) => m.splits_expenses).length || 2, month: new Date().getMonth() + 1 });
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const toggle = (i) => setF({ ...f, interests: f.interests.includes(i) ? f.interests.filter((x) => x !== i) : [...f.interests, i] });
  const num = (k) => (e) => setF({ ...f, [k]: Number(e.target.value) });
  const run = async () => {
    setBusy(true); setErr("");
    try { setRes((await api.post("/ai/recommend-destinations", { ...f, top_k: 5 })).data); }
    catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between"><h3 className="font-bold">🎯 Destination recommender</h3><span className="badge bg-brand-50 text-brand-700">KNN</span></div>
      <div className="flex flex-wrap gap-2">
        {INTERESTS.map((i) => (
          <button key={i} onClick={() => toggle(i)} className={`badge cursor-pointer capitalize ${f.interests.includes(i) ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}>{EMO[i]} {i}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div><label className="label">🪙 Min ₹/person</label><input placeholder="🪙 e.g. 15000" type="number" className="input" value={f.budget_min} onChange={num("budget_min")} /></div>
        <div><label className="label">💎 Max ₹/person</label><input placeholder="💎 e.g. 30000" type="number" className="input" value={f.budget_max} onChange={num("budget_max")} /></div>
        <div><label className="label">📅 Days</label><input placeholder="📅 e.g. 5" type="number" min="1" className="input" value={f.days} onChange={num("days")} /></div>
        <div><label className="label">👥 Travellers</label><input placeholder="👥 e.g. 4" type="number" min="1" className="input" value={f.travelers} onChange={num("travelers")} /></div>
        <div><label className="label">🗓️ Month</label><input placeholder="🗓️ 1 to 12" type="number" min="1" max="12" className="input" value={f.month} onChange={num("month")} /></div>
      </div>
      <button className="btn" onClick={run} disabled={busy}>{busy ? "🔎 Matching…" : "🔍 Find destinations"}</button>
      <Err msg={err} />
      {res && (
        <ul className="space-y-2">
          {res.matches.map((m, idx) => (
            <li key={m.name} className="rounded-xl border p-3">
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-slate-400">#{idx + 1}</span>
                <span className="font-semibold">{m.name}</span><span className="text-xs text-slate-500">{m.country}</span>
                <span className="ml-auto badge bg-emerald-100 text-emerald-700">{m.match_score}% match</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-100"><div className="bar-grow h-full bg-gradient-to-r from-brand-500 to-sky-400" style={{ width: `${m.match_score}%` }} /></div>
              <p className="mt-2 text-xs text-slate-500">≈ {money(m.estimated_cost_per_person)}/person · {m.within_budget ? "within budget" : "over budget"} · top traits: {m.top_traits.join(", ")}</p>
              <ul className="mt-1 list-disc pl-5 text-xs text-slate-600">{m.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ AI 2: cost estimator */
function CostEstimator({ trip }) {
  const [f, setF] = useState({ destination: trip?.destination || "Goa", days: trip?.days || 5, travelers: trip?.members.filter((m) => m.splits_expenses).length || 2, style: "standard", transport_mode: "train", origin_distance_km: 800, month: new Date().getMonth() + 1, budget_total: trip?.budget_total || 100000 });
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k, num) => (e) => setF({ ...f, [k]: num ? Number(e.target.value) : e.target.value });
  const run = async () => {
    setBusy(true); setErr("");
    try { setRes((await api.post("/ai/estimate-cost", f)).data); }
    catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  const tone = { within_budget: "bg-emerald-100 text-emerald-700", tight: "bg-amber-100 text-amber-700", over_budget: "bg-red-100 text-red-700" };
  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between"><h3 className="font-bold">💸 Cost estimator</h3><span className="badge bg-brand-50 text-brand-700">Random Forest</span></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div><label className="label">📍 Destination</label><input placeholder="📍 e.g. Goa" className="input" value={f.destination} onChange={set("destination")} /></div>
        <div><label className="label">📅 Days</label><input placeholder="📅 e.g. 5" type="number" min="1" className="input" value={f.days} onChange={set("days", true)} /></div>
        <div><label className="label">👥 Travellers</label><input placeholder="👥 e.g. 4" type="number" min="1" className="input" value={f.travelers} onChange={set("travelers", true)} /></div>
        <div><label className="label">🗓️ Month</label><input placeholder="🗓️ 1 to 12" type="number" min="1" max="12" className="input" value={f.month} onChange={set("month", true)} /></div>
        <div><label className="label">✨ Style</label><select className="input" value={f.style} onChange={set("style")}>{["budget", "standard", "premium"].map((s) => <option key={s} value={s}>{EMO[s]} {s}</option>)}</select></div>
        <div><label className="label">🚆 Transport</label><select className="input" value={f.transport_mode} onChange={set("transport_mode")}>{["train", "road", "flight"].map((s) => <option key={s} value={s}>{EMO[s]} {s}</option>)}</select></div>
        <div><label className="label">🛣️ Distance (km)</label><input placeholder="🛣️ e.g. 800" type="number" className="input" value={f.origin_distance_km} onChange={set("origin_distance_km", true)} /></div>
        <div><label className="label">💰 Budget (₹)</label><input placeholder="💰 e.g. 120000" type="number" className="input" value={f.budget_total} onChange={set("budget_total", true)} /></div>
      </div>
      <button className="btn" onClick={run} disabled={busy}>{busy ? "🔮 Estimating…" : "🔮 Estimate total cost"}</button>
      <Err msg={err} />
      {res && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-4">
            <div><p className="label">🔮 Predicted total</p><p className="text-3xl font-extrabold text-brand-900">{money(res.total_cost)}</p></div>
            <div><p className="label">🙋 Per person</p><p className="text-xl font-bold">{money(res.per_person_cost)}</p></div>
            <div><p className="label">📉 80% range</p><p className="text-sm font-semibold">{money(res.low)} – {money(res.high)}</p></div>
            {res.budget_status && <span className={`badge ${tone[res.budget_status]}`}>{res.budget_status.replace("_", " ")} ({money(res.budget_delta)})</span>}
          </div>
          <div className="space-y-1">
            {Object.entries(res.breakdown).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 text-xs">
                <span className="w-28 text-slate-600">{k}</span>
                <div className="h-2 flex-1 overflow-hidden rounded bg-slate-100"><div className="bar-grow h-full bg-gradient-to-r from-brand-500 to-sky-400" style={{ width: `${(v / res.total_cost) * 100}%` }} /></div>
                <span className="w-24 text-right font-medium">{money(v)}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-400">Model: {res.model_info.algorithm} · R² {res.model_info.holdout_r2} · MAPE {res.model_info.holdout_mape_pct}% on held-out {res.model_info.data}.</p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ Admin panel */
function AdminPanel() {
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [err, setErr] = useState("");
  const load = () => Promise.all([api.get("/admin/stats"), api.get("/admin/users")])
    .then(([s, u]) => { setStats(s.data); setUsers(u.data); }).catch((x) => setErr(errMsg(x)));
  useEffect(() => { load(); }, []);
  const patch = (id, body) => api.patch(`/admin/users/${id}`, body).then(load).catch((x) => setErr(errMsg(x)));
  return (
    <div className="card space-y-3">
      <h3 className="font-bold">🛡️ Admin console</h3>
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm">
          <div className="rounded-xl bg-slate-50 p-3"><p className="label">👤 Users</p><p className="text-xl font-bold">{stats.users.total}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="label">🧳 Trips</p><p className="text-xl font-bold">{stats.trips.total}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="label">🧾 Expenses</p><p className="text-xl font-bold">{stats.expenses.count}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="label">💸 Tracked spend</p><p className="text-xl font-bold">{money(stats.expenses.total_amount)}</p></div>
        </div>
      )}

      {users.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl bg-slate-50/80 p-4">
            <h4 className="mb-3 text-sm font-bold">Users by role</h4>
            <DonutChart
              centerLabel={users.length}
              data={Object.keys(ROLE_LABEL).map((r) => ({ label: ROLE_LABEL[r], value: users.filter((u) => u.role === r).length }))}
            />
          </div>
          <div className="rounded-xl bg-slate-50/80 p-4">
            <h4 className="mb-3 text-sm font-bold">Active vs inactive</h4>
            <DonutChart
              centerLabel={users.length}
              data={[
                { label: "Active", value: users.filter((u) => u.is_active).length, color: "#10b981" },
                { label: "Inactive", value: users.filter((u) => !u.is_active).length, color: "#f97316" },
              ]}
            />
          </div>
        </div>
      )}

      <Err msg={err} />
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr className="text-xs uppercase text-slate-500"><th className="py-1">User</th><th>Role</th><th>Status</th></tr></thead>
          <tbody className="divide-y">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="py-2">{u.full_name}<div className="text-xs text-slate-500">{u.email}</div></td>
                <td><select className="input !w-auto" value={u.role} onChange={(e) => patch(u.id, { role: e.target.value })}>{Object.keys(ROLE_LABEL).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></td>
                <td><button className="btn-ghost" onClick={() => patch(u.id, { is_active: !u.is_active })}>{u.is_active ? "Active – deactivate" : "Inactive – activate"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Preferences */
function Preferences({ user }) {
  const [f, setF] = useState({ interests: user.interests || [], budget_min: user.budget_min, budget_max: user.budget_max, pace: user.pace, dietary: user.dietary });
  const [saved, setSaved] = useState("");
  const toggle = (i) => setF({ ...f, interests: f.interests.includes(i) ? f.interests.filter((x) => x !== i) : [...f.interests, i] });
  const save = async () => { try { await api.put("/auth/me/preferences", { ...f, budget_min: Number(f.budget_min), budget_max: Number(f.budget_max) }); setSaved("Saved ✓ – used by the group-consensus itinerary"); } catch (x) { setSaved(errMsg(x)); } };
  return (
    <div className="card space-y-3">
      <h3 className="text-lg font-extrabold">🎒 My travel preferences</h3>
      <div className="flex flex-wrap gap-2">
        {INTERESTS.map((i) => <button key={i} onClick={() => toggle(i)} className={`badge cursor-pointer capitalize ${f.interests.includes(i) ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}>{EMO[i]} {i}</button>)}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div><label className="label">🪙 Min ₹/trip</label><input placeholder="🪙 e.g. 15000" type="number" className="input" value={f.budget_min} onChange={(e) => setF({ ...f, budget_min: e.target.value })} /></div>
        <div><label className="label">💎 Max ₹/trip</label><input placeholder="💎 e.g. 30000" type="number" className="input" value={f.budget_max} onChange={(e) => setF({ ...f, budget_max: e.target.value })} /></div>
        <div><label className="label">⏱️ Pace</label><select className="input" value={f.pace} onChange={(e) => setF({ ...f, pace: e.target.value })}>{["relaxed", "balanced", "packed"].map((p) => <option key={p} value={p}>{EMO[p]} {p}</option>)}</select></div>
        <div><label className="label">🥗 Dietary</label><input className="input" value={f.dietary} onChange={(e) => setF({ ...f, dietary: e.target.value })} placeholder="🥗 e.g. vegetarian, no pork…" /></div>
      </div>
      <div className="flex items-center gap-3"><button className="btn" onClick={save}>💾 Save preferences</button><span className="text-sm text-slate-500">{saved}</span></div>
    </div>
  );
}

/* ------------------------------------------------------------ My trip charts */
function MyCharts({ trips }) {
  if (!trips.length) return null;
  const byStatus = Object.entries(
    trips.reduce((a, t) => ({ ...a, [t.status]: (a[t.status] || 0) + 1 }), {})
  ).map(([label, value]) => ({ label, value }));
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className="card md:col-span-2">
        <h3 className="mb-3 font-bold">📊 Budget by trip</h3>
        <BarChart data={trips.map((t) => ({ label: t.name, value: t.budget_total }))} format={money} />
      </div>
      <div className="card">
        <h3 className="mb-3 font-bold">🧭 Trips by status</h3>
        <DonutChart data={byStatus} centerLabel={trips.length} />
      </div>
      <div className="card md:col-span-3">
        <h3 className="mb-3 font-bold">👥 People per trip</h3>
        <BarChart data={trips.map((t) => ({ label: t.name, value: t.members.length }))} format={(v) => `${v} people`} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Dashboard */
export default function Dashboard({ user, trips, trip, onSelectTrip, onReload }) {
  const canCreate = user.role === "organiser" || user.role === "admin";
  const canPlan = user.role !== "partner";
  const totalBudget = trips.reduce((s, t) => s + t.budget_total, 0);
  return (
    <div className="stagger space-y-6">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 p-7 sm:p-9" style={{ background: "linear-gradient(120deg, rgba(14,165,233,.25), rgba(99,102,241,.25) 55%, rgba(16,185,129,.18))" }}>
        <div className="pointer-events-none absolute -right-4 -top-6 animate-float text-[9rem] leading-none opacity-20">✈️</div>
        <p className="text-sm font-medium text-sky-200">👋 Welcome back</p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">{user.full_name}, where to next? 🌍</h1>
        <p className="mt-2 max-w-xl text-sm text-slate-300">Plan together 🤝 split fairly 💸 and travel stress-free 🎒</p>
      </div>
      <div className="stagger grid gap-4 sm:grid-cols-3">
        <div className="card"><p className="label">🧳 My trips</p><p className="text-4xl font-extrabold bg-gradient-to-r from-sky-300 to-emerald-300 bg-clip-text text-transparent">{trips.length}</p></div>
        <div className="card"><p className="label">💰 Combined budget</p><p className="text-4xl font-extrabold bg-gradient-to-r from-sky-300 to-emerald-300 bg-clip-text text-transparent">{money(totalBudget)}</p></div>
        <div className="card"><p className="label">🧭 Active trip</p><p className="truncate text-xl font-bold">{trip ? `${trip.name} · ${trip.days}d` : "—"}</p></div>
      </div>

      <MyCharts trips={trips} />

      <div className="grid gap-4 md:grid-cols-2">
        {trips.map((t) => (
          <button key={t.id} onClick={() => onSelectTrip(t.id)} className={`card text-left transition hover:shadow-md ${trip?.id === t.id ? "ring-2 ring-sky-400/70" : ""}`}>
            <div className="flex items-center gap-2"><h3 className="font-bold">{t.name}</h3><span className="badge ml-auto bg-slate-100 text-slate-600">{t.status}</span></div>
            <p className="text-sm text-slate-600">📍 {t.destination} · {t.start_date} → {t.end_date} ({t.days} days)</p>
            <p className="text-sm text-slate-600">💰 {money(t.budget_total, t.currency)} · 👥 {t.members.length} people {t.has_itinerary && "· 🗓️ itinerary ready"}</p>
          </button>
        ))}
        {trips.length === 0 && <div className="card text-slate-500">No trips yet. {canCreate ? "Create your first one below." : "Ask an organiser to add you by email."}</div>}
      </div>

      {canCreate && <CreateTrip onCreated={onReload} />}
      {trip && <Members trip={trip} user={user} onReload={onReload} />}
      {canPlan && <div className="grid gap-4 lg:grid-cols-2"><Recommender key={`r${trip?.id}`} trip={trip} /><CostEstimator key={`c${trip?.id}`} trip={trip} /></div>}
      {canPlan && <Preferences user={user} />}
      {user.role === "admin" && <AdminPanel />}
    </div>
  );
}
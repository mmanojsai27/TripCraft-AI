import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import api, { errMsg } from "../api";

const RISK = { ok: "bg-emerald-100 text-emerald-700", rain: "bg-sky-100 text-sky-700", heat: "bg-orange-100 text-orange-700", cold: "bg-indigo-100 text-indigo-700" };
const RISK_ICON = { ok: "☀️", rain: "🌧️", heat: "🔥", cold: "❄️" };

function Markdown({ children }) {
  return (
    <article className="prose prose-slate max-w-none prose-headings:scroll-mt-20 prose-table:text-sm prose-h3:text-brand-700">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </article>
  );
}

export default function ItineraryBuilder({ trip, user, onChanged }) {
  const canEdit = user.role === "admin" || trip.organiser_id === user.id;
  const canUseAi = user.role !== "partner";
  const [it, setIt] = useState(null);
  const [extra, setExtra] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [consensus, setConsensus] = useState(null);
  const [weather, setWeather] = useState(null);   // preview from weather-adjust
  const [packing, setPacking] = useState(null);
  const [checked, setChecked] = useState({});

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/ai/trips/${trip.id}/itinerary`);
      setIt(data);
      if (canUseAi) {
        const p = await api.get(`/ai/trips/${trip.id}/packing-list`);
        setPacking(p.data || null);
      }
    } catch (x) { setErr(errMsg(x)); }
  }, [trip.id, canUseAi]);
  useEffect(() => { load(); }, [load]);

  const run = async (label, fn) => {
    setBusy(label); setErr("");
    try { await fn(); } catch (x) { setErr(errMsg(x)); } finally { setBusy(""); }
  };

  const generate = () => run("generate", async () => {
    const { data } = await api.post(`/ai/trips/${trip.id}/itinerary`, { extra_instructions: extra });
    setIt(data); setConsensus(data.consensus); setWeather(null); onChanged?.();
  });
  const save = () => run("save", async () => {
    const { data } = await api.put(`/ai/trips/${trip.id}/itinerary`, { markdown: draft });
    setIt(data); setEditing(false);
  });
  const previewWeather = () => run("weather", async () => {
    const { data } = await api.post(`/ai/trips/${trip.id}/weather-adjust`, { apply: false, use_live_forecast: true });
    setWeather(data);
  });
  const applyWeather = () => run("apply", async () => {
    const { data } = await api.post(`/ai/trips/${trip.id}/weather-adjust`, { apply: true, use_live_forecast: true });
    setIt((p) => ({ ...p, markdown: data.markdown, source: data.source })); setWeather(null);
  });
  const genPacking = () => run("packing", async () => {
    const { data } = await api.post(`/ai/trips/${trip.id}/packing-list`);
    setPacking(data); setChecked({});
  });

  const has = !!it?.markdown;
  const total = packing ? packing.categories.reduce((s, c) => s + c.items.length, 0) : 0;
  const done = Object.values(checked).filter(Boolean).length;

  return (
    <div className="space-y-6">
      <div className="card flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-extrabold">{trip.name}: itinerary builder</h2>
          <p className="text-sm text-slate-600">📍 {trip.destination} · {trip.days} days · built from every active member's interests, budget, pace and diet.</p>
          {it?.source && <p className="mt-1 text-xs text-slate-400">Source: {it.source}{it.generated_at && ` · ${new Date(it.generated_at).toLocaleString()}`}</p>}
        </div>
        {canEdit && (
          <div className="w-full space-y-2 sm:w-96">
            <textarea className="input" rows={2} maxLength={600} placeholder="Optional notes for the AI (e.g. 'one slow morning, sunset on day 2')" value={extra} onChange={(e) => setExtra(e.target.value)} />
            <button className="btn w-full" onClick={generate} disabled={!!busy}>{busy === "generate" ? "Building consensus plan…" : has ? "↻ Regenerate itinerary" : "✨ Generate itinerary"}</button>
          </div>
        )}
      </div>

      {err && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</p>}

      {consensus && (
        <div className="card grid gap-3 text-sm sm:grid-cols-4">
          <div><p className="label">Shared priorities</p>{consensus.shared_priorities.join(", ") || "—"}</div>
          <div><p className="label">Binding budget</p>₹{consensus.binding_budget_per_person.toLocaleString("en-IN")} / person</div>
          <div><p className="label">Pace</p>{consensus.pace}</div>
          <div><p className="label">Dietary</p>{consensus.dietary_restrictions.join(", ") || "none"}</div>
        </div>
      )}

      {!has && !busy && <div className="card text-center text-slate-500">No itinerary yet.{canEdit ? " Generate one above." : " The organiser hasn't generated one."}</div>}

      {has && (
        <div className="card">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="font-bold">Day-by-day plan</h3>
            <div className="ml-auto flex flex-wrap gap-2">
              <button className="btn-ghost" onClick={() => window.print()}>🖨️ Print / PDF</button>
              {canEdit && !editing && <button className="btn-ghost" onClick={() => { setDraft(it.markdown); setEditing(true); }}>✏️ Edit</button>}
              {canEdit && <button className="btn-ghost" onClick={previewWeather} disabled={!!busy}>{busy === "weather" ? "Checking forecast…" : "🌦 Weather-aware adjust"}</button>}
            </div>
          </div>
          {editing ? (
            <div className="space-y-2">
              <textarea className="input font-mono" rows={22} value={draft} onChange={(e) => setDraft(e.target.value)} />
              <div className="flex gap-2"><button className="btn" onClick={save} disabled={!!busy}>Save</button><button className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button></div>
            </div>
          ) : <Markdown>{it.markdown}</Markdown>}
        </div>
      )}

      {weather && (
        <div className="card space-y-4 border-sky-200">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold">🌦 Weather-aware revision (preview)</h3>
            <span className="badge bg-slate-100 text-slate-600">forecast: {weather.forecast_source}</span>
            <span className="badge bg-slate-100 text-slate-600">{weather.source}</span>
            <div className="ml-auto flex gap-2">
              <button className="btn" onClick={applyWeather} disabled={!!busy}>Apply to itinerary</button>
              <button className="btn-ghost" onClick={() => setWeather(null)}>Discard</button>
            </div>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {weather.forecast.map((w) => (
              <div key={w.date} className="min-w-32 rounded-xl border p-2 text-center text-xs">
                <p className="font-semibold">{new Date(w.date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</p>
                <p className="text-2xl">{RISK_ICON[w.risk]}</p>
                <p>{w.tmin.toFixed(0)}–{w.tmax.toFixed(0)}°C</p>
                <p className="text-slate-500">{w.summary}</p>
                <span className={`badge mt-1 ${RISK[w.risk]}`}>rain {w.rain_probability}%</span>
              </div>
            ))}
          </div>
          <Markdown>{weather.markdown}</Markdown>
        </div>
      )}

      {canUseAi && (
        <div className="card space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold">🎒 Smart packing checklist</h3>
            {packing && <span className="badge bg-slate-100 text-slate-600">{packing.weather_summary}</span>}
            {packing && <span className="badge bg-emerald-100 text-emerald-700">{done}/{total} packed</span>}
            <button className="btn ml-auto" onClick={genPacking} disabled={!!busy}>{busy === "packing" ? "Generating…" : packing ? "↻ Regenerate" : "Generate checklist"}</button>
          </div>
          {packing && (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {packing.categories.map((c) => (
                <div key={c.name} className="rounded-xl border p-3">
                  <p className="mb-2 text-sm font-bold">{c.name}</p>
                  <ul className="space-y-1.5 text-sm">
                    {c.items.map((i) => {
                      const k = `${c.name}:${i.item}`;
                      return (
                        <li key={k}>
                          <label className="flex cursor-pointer items-start gap-2">
                            <input type="checkbox" className="mt-1" checked={!!checked[k]} onChange={() => setChecked({ ...checked, [k]: !checked[k] })} />
                            <span className={checked[k] ? "text-slate-400 line-through" : ""}>
                              {i.item} {i.essential && <span className="badge bg-red-50 text-red-600">essential</span>}
                              {i.reason && <span className="block text-xs text-slate-400">{i.reason}</span>}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

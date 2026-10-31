import { useCallback, useEffect, useMemo, useState } from "react";
import api, { errMsg, money2 } from "../api";

const CATS = ["stay", "food", "transport", "activities", "shopping", "other"];
const CAT_ICON = { stay: "🏨", food: "🍽️", transport: "🚕", activities: "🎟️", shopping: "🛍️", other: "📦" };
const SPLIT_HELP = {
  equal: "Split equally between the selected people.",
  exact: "Enter the exact amount each person owes; they must add up to the total.",
  percent: "Enter each person's percentage; they must add up to 100.",
  shares: "Enter relative weights (e.g. 2 for a double room, 1 for a single).",
};

export default function ExpenseTracker({ trip, user }) {
  const cur = trip.currency;
  const people = useMemo(() => trip.members.filter((m) => m.is_active && m.splits_expenses), [trip]);
  const [expenses, setExpenses] = useState([]);
  const [summary, setSummary] = useState(null);
  const [err, setErr] = useState("");
  const [f, setF] = useState({ description: "", amount: "", category: "food", paid_by: user.id, split_type: "equal" });
  const [picked, setPicked] = useState(() => Object.fromEntries(people.map((p) => [p.user_id, true])));
  const [vals, setVals] = useState({});

  const load = useCallback(async () => {
    try {
      const [e, s] = await Promise.all([api.get(`/trips/${trip.id}/expenses`), api.get(`/trips/${trip.id}/expenses/summary`)]);
      setExpenses(e.data); setSummary(s.data);
    } catch (x) { setErr(errMsg(x)); }
  }, [trip.id]);
  useEffect(() => { load(); }, [load]);

  const isMember = people.some((p) => p.user_id === user.id);
  const canAdd = isMember || user.role === "admin";
  const amount = Number(f.amount) || 0;
  const valueSum = people.reduce((s, p) => s + (Number(vals[p.user_id]) || 0), 0);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    const body = { description: f.description, amount, category: f.category, paid_by: Number(f.paid_by), split_type: f.split_type };
    if (f.split_type === "equal") body.participants = people.filter((p) => picked[p.user_id]).map((p) => p.user_id);
    else body.splits = people.filter((p) => Number(vals[p.user_id]) > 0).map((p) => ({ user_id: p.user_id, value: Number(vals[p.user_id]) }));
    try {
      await api.post(`/trips/${trip.id}/expenses`, body);
      setF({ ...f, description: "", amount: "" }); setVals({});
      load();
    } catch (x) { setErr(errMsg(x)); }
  };
  const remove = async (id) => { try { await api.delete(`/trips/${trip.id}/expenses/${id}`); load(); } catch (x) { setErr(errMsg(x)); } };

  const pct = summary ? Math.min(summary.budget_used_pct, 100) : 0;
  const barTone = !summary ? "" : summary.budget_used_pct > 100 ? "bg-red-500" : summary.budget_used_pct > 80 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="space-y-6">
      {summary && (
        <div className="grid gap-4 md:grid-cols-4">
          <div className="card"><p className="label">Total spent</p><p className="text-2xl font-extrabold">{money2(summary.total_spent, cur)}</p></div>
          <div className="card"><p className="label">Budget left</p><p className={`text-2xl font-extrabold ${summary.budget_remaining < 0 ? "text-red-600" : ""}`}>{money2(summary.budget_remaining, cur)}</p></div>
          <div className="card"><p className="label">Per person (avg)</p><p className="text-2xl font-extrabold">{money2(summary.per_person_average, cur)}</p><p className="text-xs text-slate-400">{summary.active_members} active members</p></div>
          <div className="card"><p className="label">Budget used · {summary.budget_used_pct}%</p>
            <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100"><div className={`h-full ${barTone}`} style={{ width: `${pct}%` }} /></div></div>
        </div>
      )}
      {err && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</p>}

      <div className="grid gap-6 lg:grid-cols-5">
        {canAdd && (
          <form onSubmit={submit} className="card space-y-3 lg:col-span-2">
            <h3 className="font-bold">Add expense</h3>
            <div><label className="label">What was it for?</label><input className="input" required value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Dinner at the beach shack" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Amount ({cur})</label><input type="number" step="0.01" min="0.01" required className="input" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
              <div><label className="label">Category</label><select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map((c) => <option key={c} value={c}>{CAT_ICON[c]} {c}</option>)}</select></div>
              <div><label className="label">Paid by</label><select className="input" value={f.paid_by} onChange={(e) => setF({ ...f, paid_by: e.target.value })}>{people.map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name}</option>)}</select></div>
              <div><label className="label">Split</label><select className="input" value={f.split_type} onChange={(e) => setF({ ...f, split_type: e.target.value })}>{Object.keys(SPLIT_HELP).map((s) => <option key={s}>{s}</option>)}</select></div>
            </div>
            <p className="text-xs text-slate-500">{SPLIT_HELP[f.split_type]}</p>
            <div className="space-y-1.5 rounded-xl bg-slate-50 p-3">
              {people.map((p) => (
                <div key={p.user_id} className="flex items-center gap-2 text-sm">
                  {f.split_type === "equal" ? (
                    <label className="flex flex-1 cursor-pointer items-center gap-2">
                      <input type="checkbox" checked={!!picked[p.user_id]} onChange={() => setPicked({ ...picked, [p.user_id]: !picked[p.user_id] })} />{p.full_name}
                    </label>
                  ) : (
                    <>
                      <span className="flex-1">{p.full_name}</span>
                      <input type="number" step="0.01" min="0" className="input !w-28" value={vals[p.user_id] ?? ""} onChange={(e) => setVals({ ...vals, [p.user_id]: e.target.value })} />
                    </>
                  )}
                </div>
              ))}
              {f.split_type === "exact" && <p className={`text-xs ${Math.abs(valueSum - amount) < 0.005 ? "text-emerald-600" : "text-amber-600"}`}>Allocated {money2(valueSum, cur)} of {money2(amount, cur)}</p>}
              {f.split_type === "percent" && <p className={`text-xs ${Math.abs(valueSum - 100) < 0.01 ? "text-emerald-600" : "text-amber-600"}`}>Total {valueSum}% of 100%</p>}
            </div>
            <button className="btn w-full">Add &amp; split</button>
          </form>
        )}

        <div className={`space-y-6 ${canAdd ? "lg:col-span-3" : "lg:col-span-5"}`}>
          {summary && (
            <div className="card space-y-3">
              <h3 className="font-bold">🤝 Settle up</h3>
              {summary.settlements.length === 0 ? <p className="text-sm text-emerald-600">Everyone is square. 🎉</p> : (
                <ul className="space-y-2">
                  {summary.settlements.map((s, i) => (
                    <li key={i} className="flex items-center gap-2 rounded-xl border p-2 text-sm">
                      <b>{s.from_name}</b> <span className="text-slate-400">pays</span> <b>{s.to_name}</b>
                      <span className="ml-auto font-bold text-brand-700">{money2(s.amount, cur)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs uppercase text-slate-500"><th>Member</th><th className="text-right">Paid</th><th className="text-right">Share</th><th className="text-right">Net</th></tr></thead>
                <tbody className="divide-y">
                  {summary.balances.map((b) => (
                    <tr key={b.user_id}><td className="py-1.5">{b.full_name}</td><td className="text-right">{money2(b.paid, cur)}</td><td className="text-right">{money2(b.owed, cur)}</td>
                      <td className={`text-right font-semibold ${b.net > 0 ? "text-emerald-600" : b.net < 0 ? "text-red-600" : ""}`}>{b.net > 0 ? "+" : ""}{money2(b.net, cur)}</td></tr>
                  ))}
                </tbody>
              </table>
              <div className="flex flex-wrap gap-2 pt-1">
                {Object.entries(summary.by_category).map(([c, v]) => <span key={c} className="badge bg-slate-100 text-slate-600">{CAT_ICON[c]} {c}: {money2(v, cur)}</span>)}
              </div>
            </div>
          )}

          <div className="card">
            <h3 className="mb-2 font-bold">Expenses ({expenses.length})</h3>
            <ul className="divide-y">
              {expenses.map((x) => (
                <li key={x.id} className="py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{CAT_ICON[x.category] || "📦"}</span>
                    <div className="min-w-0 flex-1"><p className="truncate font-medium">{x.description}</p>
                      <p className="text-xs text-slate-500">{x.expense_date} · paid by {x.paid_by_name} · {x.split_type} split</p></div>
                    <span className="font-bold">{money2(x.amount, cur)}</span>
                    {(user.role === "admin" || user.id === x.paid_by || user.id === trip.organiser_id) && <button className="btn-danger" onClick={() => remove(x.id)}>✕</button>}
                  </div>
                  <p className="mt-1 pl-8 text-xs text-slate-500">{x.splits.map((s) => `${s.full_name.split(" ")[0]} ${money2(s.share, cur)}`).join(" · ")}</p>
                </li>
              ))}
              {expenses.length === 0 && <li className="py-4 text-sm text-slate-500">No expenses yet.</li>}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

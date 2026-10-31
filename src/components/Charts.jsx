import { useEffect, useState } from "react";

export const COLORS = ["#0ea5e9", "#10b981", "#f97316", "#a855f7", "#ec4899", "#eab308"];

/** Animated donut chart. data = [{ label, value, color? }] */
export function DonutChart({ data, centerLabel, size = 150 }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setOn(true), 100);
    return () => clearTimeout(t);
  }, []);
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = 52;
  const C = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox="0 0 140 140" className="-rotate-90">
          <circle cx="70" cy="70" r={r} fill="none" stroke="#e2e8f0" strokeWidth="18" />
          {total > 0 &&
            data.map((d, i) => {
              const len = (d.value / total) * C;
              const el = (
                <circle
                  key={d.label}
                  cx="70" cy="70" r={r} fill="none"
                  stroke={d.color || COLORS[i % COLORS.length]}
                  strokeWidth="18"
                  strokeDasharray={`${on ? len : 0} ${C}`}
                  strokeDashoffset={-offset}
                  style={{ transition: "stroke-dasharray 1.2s cubic-bezier(.22,1,.36,1)" }}
                />
              );
              offset += len;
              return el;
            })}
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-2xl font-extrabold text-slate-800">{centerLabel ?? total}</p>
            <p className="text-[10px] uppercase tracking-wide text-slate-500">total</p>
          </div>
        </div>
      </div>
      <ul className="space-y-1.5 text-sm">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ background: d.color || COLORS[i % COLORS.length] }} />
            <span className="text-slate-600">{d.label}</span>
            <b className="ml-2 text-slate-800">{d.value}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Animated horizontal bar chart. data = [{ label, value }] */
export function BarChart({ data, format = (v) => v }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-2.5">
      {data.map((d, i) => (
        <div key={d.label} className="flex items-center gap-3 text-sm">
          <span className="w-28 truncate text-slate-600" title={d.label}>{d.label}</span>
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-200/70">
            <div
              className="bar-grow h-full rounded-full"
              style={{ width: `${(d.value / max) * 100}%`, background: COLORS[i % COLORS.length], animationDelay: `${i * 0.08}s` }}
            />
          </div>
          <span className="w-24 text-right font-semibold text-slate-800">{format(d.value)}</span>
        </div>
      ))}
    </div>
  );
}
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/* ---------------------------------------------------------------- categories */
const CATS = {
  attractions: { label: "Attractions", icon: "🏛️", color: "#0ea5e9" },
  food: { label: "Food", icon: "🍽️", color: "#f97316", radius: 2000, filter: '["amenity"~"^(restaurant|cafe|fast_food)$"]["name"]' },
  stay: { label: "Stays", icon: "🏨", color: "#a855f7", radius: 4000, filter: '["tourism"~"^(hotel|guest_house|hostel|resort)$"]["name"]' },
  health: { label: "Hospitals", icon: "🏥", color: "#ef4444", radius: 5000, filter: '["amenity"~"^(hospital|clinic|pharmacy)$"]["name"]' },
  fuel: { label: "Fuel & ATM", icon: "⛽", color: "#10b981", radius: 5000, filter: '["amenity"~"^(fuel|atm|bank)$"]' },
};

/* Popular destinations: shown instantly in the dropdown (no network needed) */
const POPULAR = [
  { name: "Goa", sub: "India", lat: 15.2993, lon: 74.124 },
  { name: "Manali", sub: "Himachal Pradesh, India", lat: 32.2396, lon: 77.1887 },
  { name: "Jaipur", sub: "Rajasthan, India", lat: 26.9124, lon: 75.7873 },
  { name: "Hampi", sub: "Karnataka, India", lat: 15.335, lon: 76.46 },
  { name: "Visakhapatnam", sub: "Andhra Pradesh, India", lat: 17.6868, lon: 83.2185 },
  { name: "Araku Valley", sub: "Andhra Pradesh, India", lat: 18.3273, lon: 82.8775 },
  { name: "Tirupati", sub: "Andhra Pradesh, India", lat: 13.6288, lon: 79.4192 },
  { name: "Munnar", sub: "Kerala, India", lat: 10.0889, lon: 77.0595 },
  { name: "Udaipur", sub: "Rajasthan, India", lat: 24.5854, lon: 73.7125 },
  { name: "Rishikesh", sub: "Uttarakhand, India", lat: 30.0869, lon: 78.2676 },
  { name: "Leh", sub: "Ladakh, India", lat: 34.1526, lon: 77.5771 },
  { name: "Darjeeling", sub: "West Bengal, India", lat: 27.041, lon: 88.2663 },
  { name: "Port Blair", sub: "Andaman Islands, India", lat: 11.6234, lon: 92.7265 },
  { name: "Paris", sub: "France", lat: 48.8566, lon: 2.3522 },
  { name: "Bali", sub: "Indonesia", lat: -8.4095, lon: 115.1889 },
  { name: "Dubai", sub: "United Arab Emirates", lat: 25.2048, lon: 55.2708 },
  { name: "Tokyo", sub: "Japan", lat: 35.6762, lon: 139.6503 },
];

/* ---------------------------------------------------------------- helpers */
const km = (lat1, lon1, lat2, lon2) => {
  const rad = (x) => (x * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
};
const fmtKm = (v) => (v < 1 ? `${Math.round(v * 1000)} m` : `${v.toFixed(1)} km`);
const dirUrl = (s) => `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`;
const prep = (list, p) =>
  list.map((s) => ({ ...s, dist: km(p.lat, p.lon, s.lat, s.lon) })).sort((a, b) => a.dist - b.dist).slice(0, 24);

async function getJson(url, signal) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`Request failed (${r.status})`);
  return r.json();
}

async function geocode(q) {
  const d = await getJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=en&q=${encodeURIComponent(q)}`);
  if (!d.length) throw new Error("Couldn't find that place. Try adding the state or country.");
  return { lat: Number(d[0].lat), lon: Number(d[0].lon), name: d[0].display_name };
}

/* Autocomplete suggestions (Photon, free, built for search-as-you-type) */
async function suggestPlaces(q, signal) {
  const d = await getJson(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en`, signal);
  return (d.features || [])
    .filter((f) => f.geometry?.coordinates?.length === 2)
    .map((f) => {
      const p = f.properties || {};
      const [lon, lat] = f.geometry.coordinates;
      const sub = [p.city && p.city !== p.name ? p.city : null, p.state, p.country].filter(Boolean).join(", ");
      return { name: p.name || p.street || "Unnamed place", sub, lat, lon, popular: false };
    });
}

async function wikiSummary(q) {
  const p = new URLSearchParams({
    action: "query", format: "json", origin: "*", generator: "search", gsrsearch: q, gsrlimit: "1",
    prop: "pageimages|extracts", piprop: "thumbnail", pithumbsize: "1400", exintro: "1", explaintext: "1", exsentences: "3",
  });
  const d = await getJson(`https://en.wikipedia.org/w/api.php?${p}`);
  const page = Object.values(d.query?.pages || {})[0];
  return page ? { title: page.title, image: page.thumbnail?.source, text: page.extract } : null;
}

async function wikiNearby(lat, lon) {
  const p = new URLSearchParams({
    action: "query", format: "json", origin: "*", generator: "geosearch", ggscoord: `${lat}|${lon}`, ggsradius: "10000", ggslimit: "40",
    prop: "pageimages|coordinates|description", piprop: "thumbnail", pithumbsize: "500", pilimit: "50", coprimary: "primary", colimit: "50",
  });
  const d = await getJson(`https://en.wikipedia.org/w/api.php?${p}`);
  return Object.values(d.query?.pages || {})
    .filter((pg) => pg.coordinates?.length)
    .map((pg) => ({ id: `w${pg.pageid}`, name: pg.title, desc: pg.description || "", image: pg.thumbnail?.source, lat: pg.coordinates[0].lat, lon: pg.coordinates[0].lon }));
}

async function overpass(cat, lat, lon) {
  const c = CATS[cat];
  const q = `[out:json][timeout:20];node(around:${c.radius},${lat},${lon})${c.filter};out body 60;`;
  const d = await getJson(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`);
  return d.elements.map((e) => {
    const t = e.tags || {};
    const kind = (t.amenity || t.tourism || "place").replace(/_/g, " ");
    const cuisine = t.cuisine ? t.cuisine.replace(/[;_]/g, ", ") : "";
    return { id: `o${e.id}`, name: t.name || kind, desc: [cuisine, kind].filter(Boolean).join(" · "), lat: e.lat, lon: e.lon };
  });
}

// DOM-built popup (never inject raw HTML from map data)
function popupEl(s) {
  const d = document.createElement("div");
  const b = document.createElement("b");
  b.textContent = s.name;
  d.appendChild(b);
  if (s.desc) { const p = document.createElement("div"); p.textContent = s.desc; d.appendChild(p); }
  const a = document.createElement("a");
  a.href = dirUrl(s); a.target = "_blank"; a.rel = "noreferrer";
  a.textContent = `Directions · ${fmtKm(s.dist)}`;
  a.style.color = "#1d63d8";
  d.appendChild(a);
  return d;
}
const textEl = (t) => { const d = document.createElement("div"); d.textContent = t; return d; };

/* Bold the part of the suggestion that matches what the user typed */
function Hl({ text, term }) {
  const i = term ? text.toLowerCase().indexOf(term.toLowerCase()) : -1;
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <b className="text-brand-700">{text.slice(i, i + term.length)}</b>
      {text.slice(i + term.length)}
    </>
  );
}

/* ---------------------------------------------------------------- component */
export default function Explore({ trip }) {
  const [q, setQ] = useState(trip?.destination || "");
  const [place, setPlace] = useState(null);
  const [cat, setCat] = useState("attractions");
  const [attractions, setAttractions] = useState([]);
  const [others, setOthers] = useState([]);
  const [loadA, setLoadA] = useState(false);
  const [loadB, setLoadB] = useState(false);
  const [errA, setErrA] = useState("");
  const [errB, setErrB] = useState("");
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // suggestions dropdown
  const [sugg, setSugg] = useState([]);
  const [sLoading, setSLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef(null);
  const skipFetch = useRef(false);

  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const markers = useRef({});
  const reqA = useRef(0);
  const reqB = useRef(0);

  const spots = cat === "attractions" ? attractions : others;
  const loading = cat === "attractions" ? loadA : loadB;
  const listErr = cat === "attractions" ? errA : errB;
  const gallery = attractions.filter((s) => s.image).slice(0, 12);

  /* ---- what the dropdown shows ---- */
  const term = q.trim();
  const showPopular = term.length < 2;
  const items = (() => {
    if (showPopular) return POPULAR.slice(0, 8).map((p) => ({ ...p, popular: true }));
    const local = POPULAR.filter((p) => p.name.toLowerCase().includes(term.toLowerCase())).map((p) => ({ ...p, popular: true }));
    const merged = [...local];
    sugg.forEach((s) => {
      const dupe = merged.some((m) => m.name.toLowerCase() === s.name.toLowerCase() && km(m.lat, m.lon, s.lat, s.lon) < 50);
      if (!dupe) merged.push(s);
    });
    return merged.slice(0, 8);
  })();

  /* ---- search (by text, or directly from a picked suggestion) ---- */
  const search = async (query = q, pre = null) => {
    if (!query.trim()) return;
    setBusy(true); setErr(""); setOpen(false);
    try {
      const wikiQuery = pre ? `${pre.name} ${(pre.sub || "").split(", ").pop()}`.trim() : query;
      const [g, w] = await Promise.all([
        pre
          ? Promise.resolve({ lat: pre.lat, lon: pre.lon, name: [pre.name, pre.sub].filter(Boolean).join(", ") })
          : geocode(query),
        wikiSummary(wikiQuery).catch(() => null),
      ]);
      setPlace({ ...g, title: pre ? pre.name : w?.title || query, image: w?.image, text: w?.text });
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  const choose = (s) => {
    if (s.name !== q) skipFetch.current = true; // don't re-fetch suggestions for the text we just filled in
    setQ(s.name);
    setActive(-1);
    search(s.name, s);
  };

  /* ---- search by GPS ---- */
  const locate = () => {
    if (!navigator.geolocation) return setErr("Your browser doesn't support location.");
    setErr("");
    navigator.geolocation.getCurrentPosition(
      (pos) => setPlace({ lat: pos.coords.latitude, lon: pos.coords.longitude, name: "Your current location", title: "Near you", image: null, text: "Spots around your current position." }),
      () => setErr("Location permission was denied.")
    );
  };

  useEffect(() => { if (q) search(q); /* eslint-disable-next-line */ }, []);

  /* ---- live suggestions while typing (debounced) ---- */
  useEffect(() => {
    if (skipFetch.current) { skipFetch.current = false; return; }
    const t0 = q.trim();
    if (t0.length < 2) { setSugg([]); setSLoading(false); return; }
    setSLoading(true);
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      suggestPlaces(t0, ctl.signal)
        .then((r) => !ctl.signal.aborted && setSugg(r))
        .catch((e) => { if (e.name !== "AbortError") setSugg([]); })
        .finally(() => !ctl.signal.aborted && setSLoading(false));
    }, 350);
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [q]);

  /* ---- close the dropdown when clicking outside ---- */
  useEffect(() => {
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  /* ---- keep the highlighted suggestion visible ---- */
  useEffect(() => {
    if (active >= 0) document.getElementById(`sg-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) return setOpen(true);
      setActive((a) => (items.length ? (a + 1) % items.length : -1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (items.length ? (a <= 0 ? items.length - 1 : a - 1) : -1));
    } else if (e.key === "Enter") {
      if (open && active >= 0 && items[active]) { e.preventDefault(); choose(items[active]); }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  /* ---- load attractions (Wikipedia, with photos) ---- */
  useEffect(() => {
    if (!place) return;
    const id = ++reqA.current;
    setLoadA(true); setAttractions([]); setErrA("");
    wikiNearby(place.lat, place.lon)
      .then((l) => id === reqA.current && setAttractions(prep(l, place)))
      .catch(() => id === reqA.current && setErrA("Couldn't load nearby attractions. Try again."))
      .finally(() => id === reqA.current && setLoadA(false));
  }, [place]);

  /* ---- load food / stays / hospitals / fuel (OpenStreetMap) ---- */
  useEffect(() => {
    if (!place || cat === "attractions") return;
    const id = ++reqB.current;
    setLoadB(true); setOthers([]); setErrB("");
    overpass(cat, place.lat, place.lon)
      .then((l) => id === reqB.current && setOthers(prep(l, place)))
      .catch(() => id === reqB.current && setErrB("The nearby-places server is busy. Please try again in a moment."))
      .finally(() => id === reqB.current && setLoadB(false));
  }, [place, cat]);

  /* ---- create the map when a place is chosen ---- */
  useEffect(() => {
    if (!place || !mapEl.current) return;
    const map = L.map(mapEl.current, { scrollWheelZoom: false }).setView([place.lat, place.lon], 13);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    return () => { map.remove(); mapRef.current = null; layerRef.current = null; };
  }, [place]);

  /* ---- draw markers ---- */
  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current;
    if (!map || !layer || !place) return;
    layer.clearLayers();
    markers.current = {};
    setSelected(null);

    L.marker([place.lat, place.lon], {
      zIndexOffset: 1000,
      icon: L.divIcon({
        className: "",
        html: '<div style="font-size:30px;line-height:30px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.5))">📍</div>',
        iconSize: [30, 30], iconAnchor: [15, 30],
      }),
    }).addTo(layer).bindTooltip(textEl(place.title));

    const c = CATS[cat];
    spots.forEach((s) => {
      const m = L.circleMarker([s.lat, s.lon], { radius: 8, color: "#ffffff", weight: 2, fillColor: c.color, fillOpacity: 1 })
        .addTo(layer)
        .bindPopup(popupEl(s));
      m.on("click", () => setSelected(s.id));
      markers.current[s.id] = m;
    });

    const pts = [[place.lat, place.lon], ...spots.map((s) => [s.lat, s.lon])];
    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 15 });
    else map.setView([place.lat, place.lon], 13);
  }, [place, spots, cat]);

  /* ---- fly to a spot chosen from the list ---- */
  useEffect(() => {
    const m = markers.current[selected], map = mapRef.current;
    if (!m || !map) return;
    map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 15), { duration: 0.8 });
    m.openPopup();
  }, [selected]);

  const pick = (id) => {
    setSelected(id);
    mapEl.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="stagger space-y-6">
      {/* search (relative z-20 so the dropdown floats above the cards below) */}
      <form onSubmit={(e) => { e.preventDefault(); search(); }} className="card relative z-20 space-y-3">
        <h2 className="text-xl font-extrabold">🗺️ Explore a location</h2>
        <div className="flex flex-wrap gap-2">
          <div ref={wrapRef} className="relative min-w-[220px] flex-1">
            <input
              className="input pr-9"
              placeholder="Type a city, beach or landmark (e.g. Goa, Hampi, Paris)"
              value={q}
              autoComplete="off"
              role="combobox"
              aria-expanded={open}
              aria-autocomplete="list"
              onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(-1); }}
              onFocus={() => setOpen(true)}
              onKeyDown={onKeyDown}
            />
            {sLoading && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 animate-pulse text-xs text-slate-400">●●●</span>}

            {open && (
              <div className="absolute left-0 right-0 top-full z-30 mt-2 animate-rise overflow-hidden rounded-xl border border-white/50 bg-white/95 shadow-2xl backdrop-blur-xl">
                <p className="border-b bg-slate-50/80 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {showPopular ? "🔥 Popular destinations" : "Suggestions"}
                </p>
                <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
                  {items.map((s, i) => (
                    <li
                      key={`${s.name}-${s.lat}-${s.lon}`}
                      id={`sg-${i}`}
                      role="option"
                      aria-selected={i === active}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => choose(s)}
                      className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm transition ${i === active ? "bg-brand-50" : "hover:bg-slate-50"}`}
                    >
                      <span className="text-lg">{s.popular ? "⭐" : "📍"}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-slate-800"><Hl text={s.name} term={showPopular ? "" : term} /></span>
                        {s.sub && <span className="block truncate text-xs text-slate-500">{s.sub}</span>}
                      </span>
                      <span className="text-xs text-slate-300">↵</span>
                    </li>
                  ))}
                  {!showPopular && items.length === 0 && (
                    <li className="px-3 py-3 text-sm text-slate-500">
                      {sLoading ? "Looking for places…" : "No suggestions. Press Search to try anyway."}
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>
          <button className="btn" disabled={busy}>{busy ? "Searching…" : "🔍 Search"}</button>
          <button type="button" className="btn-ghost" onClick={locate}>📍 Use my location</button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          Try:
          {POPULAR.slice(0, 5).map((p) => (
            <button type="button" key={p.name} className="badge cursor-pointer bg-slate-100 text-slate-600" onClick={() => choose(p)}>{p.name}</button>
          ))}
        </div>
        {err && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{err}</p>}
      </form>

      {!place && !busy && (
        <div className="card text-center text-slate-500">Search a place to see photos, a map and the nearest spots.</div>
      )}

      {place && (
        <>
          {/* hero */}
          <div className="card overflow-hidden !p-0">
            <div className="relative h-56 overflow-hidden sm:h-72">
              {place.image
                ? <img src={place.image} alt={place.title} className="h-full w-full object-cover transition duration-700 hover:scale-105" />
                : <div className="h-full w-full bg-gradient-to-br from-brand-600 to-teal-500" />}
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-transparent to-transparent" />
              <div className="absolute bottom-0 p-5 text-white">
                <h3 className="text-3xl font-extrabold drop-shadow">{place.title}</h3>
                <p className="line-clamp-1 text-xs text-white/80">{place.name}</p>
              </div>
            </div>
            {place.text && <p className="p-5 text-sm text-slate-700">{place.text}</p>}
          </div>

          {/* category tabs */}
          <div className="flex flex-wrap gap-2">
            {Object.entries(CATS).map(([k, c]) => (
              <button key={k} onClick={() => setCat(k)}
                className={`badge cursor-pointer px-3 py-1.5 text-sm ${cat === k ? "bg-brand-600 text-white shadow-lg" : "bg-white/80 text-slate-700"}`}>
                {c.icon} {c.label}
              </button>
            ))}
          </div>

          {/* map + list */}
          <div className="grid gap-4 lg:grid-cols-5">
            <div className="card !p-2 lg:col-span-3">
              <div ref={mapEl} className="isolate z-0 h-[420px] w-full overflow-hidden rounded-xl lg:h-[560px]" />
            </div>

            <div className="card lg:col-span-2">
              <h3 className="mb-3 font-bold">{CATS[cat].icon} Nearest {CATS[cat].label.toLowerCase()}</h3>
              {loading && (
                <div className="space-y-2">
                  {[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-200/70" />)}
                </div>
              )}
              {!loading && listErr && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-700">{listErr}</p>}
              {!loading && !listErr && spots.length === 0 && <p className="text-sm text-slate-500">Nothing found nearby. Try another category.</p>}
              <ul className="stagger max-h-[500px] space-y-2 overflow-y-auto pr-1">
                {spots.map((s) => (
                  <li key={s.id}>
                    <div role="button" tabIndex={0} onClick={() => pick(s.id)} onKeyDown={(e) => e.key === "Enter" && pick(s.id)}
                      className={`flex w-full cursor-pointer items-center gap-3 rounded-xl border bg-white/70 p-2 text-left transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md ${selected === s.id ? "ring-2 ring-brand-500" : ""}`}>
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                        {s.image
                          ? <img src={s.image} alt={s.name} loading="lazy" className="h-full w-full object-cover" />
                          : <div className="grid h-full place-items-center text-2xl">{CATS[cat].icon}</div>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{s.name}</p>
                        <p className="truncate text-xs text-slate-500">{s.desc || CATS[cat].label}</p>
                        <p className="text-xs font-semibold text-brand-700">{fmtKm(s.dist)} away</p>
                      </div>
                      <a href={dirUrl(s)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="btn-ghost !px-2 !py-1 text-xs" title="Directions">➜</a>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* photo strip */}
          {gallery.length > 0 && (
            <div className="card">
              <h3 className="mb-3 font-bold">📸 Photos from around here</h3>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {gallery.map((s) => (
                  <figure key={s.id} className="group relative h-40 w-56 shrink-0 overflow-hidden rounded-xl">
                    <img src={s.image} alt={s.name} loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-110" />
                    <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 text-xs font-semibold text-white">{s.name}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          )}
          <p className="text-center text-xs text-white/70">Photos &amp; descriptions: Wikipedia · Map, places &amp; suggestions: © OpenStreetMap contributors (Photon)</p>
        </>
      )}
    </div>
  );
}
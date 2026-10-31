"""AI features.

Classical ML (pandas + scikit-learn)
  1. Destination recommender  - K-Nearest-Neighbours over preference vectors + budget fit + seasonality
  2. Trip cost estimator      - RandomForest trained on synthetic historical packages (with 10-90% interval)

GenAI (async httpx, OpenAI-compatible or Gemini; deterministic template fallback when no key / on failure)
  1. Group-consensus day-by-day markdown itinerary
  2. Weather-aware itinerary modifier (Open-Meteo live forecast or climatology)  [bonus]
  3. Smart packing checklist                                                      [bonus]
"""
import asyncio
import json
import logging
import math
import re
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache

import httpx
import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.neighbors import NearestNeighbors
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder
from sqlalchemy.orm import Session

from ..auth import get_current_user, get_trip_access
from ..config import get_settings
from ..database import get_db
from ..models import Role, Trip, User
from ..routers.trips import _load as load_trip
from ..schemas import (CostEstimateRequest, CostEstimateResponse, DestinationMatch, ItineraryRequest,
                       ItineraryResponse, ItineraryUpdate, PackingCategory, PackingItem, PackingResponse,
                       RecommendRequest, RecommendResponse, WeatherAdjustRequest, WeatherAdjustResponse,
                       WeatherDay)

log = logging.getLogger("tripcraft.ai")
settings = get_settings()
router = APIRouter(prefix="/ai", tags=["ai"])


def _no_partners(user: User = Depends(get_current_user)) -> User:
    if user.role == Role.PARTNER:
        raise HTTPException(403, "Travel partners cannot use planning AI tools")
    return user


# =====================================================================================
# Mock destination dataset (per-person mid-range daily cost in INR: stay + food + local travel)
# =====================================================================================
DIMS = ["beach", "adventure", "culture", "nature", "food", "nightlife", "relaxation", "shopping"]
# name, country, lat, lon, daily_cost, climate, best_months, [DIMS scores], highlights
_RAW = [
    ("Goa", "India", 15.30, 74.12, 4500, "tropical", [11, 12, 1, 2], [.95, .5, .4, .3, .8, .95, .7, .5],
     ["Baga & Palolem beaches", "Old Goa churches", "Dudhsagar falls day trip", "Fontainhas heritage walk", "Sunset at Chapora Fort"]),
    ("Manali", "India", 32.24, 77.19, 3800, "hill", [3, 4, 5, 6, 10], [0, .9, .5, .9, .5, .4, .6, .4],
     ["Solang Valley adventure sports", "Old Manali cafes", "Hadimba Temple", "Rohtang/Atal Tunnel drive", "Jogini falls trek"]),
    ("Jaipur", "India", 26.91, 75.79, 3500, "desert", [10, 11, 12, 1, 2, 3], [0, .3, .95, .2, .85, .4, .4, .9],
     ["Amber Fort", "City Palace & Hawa Mahal", "Johari Bazaar shopping", "Chokhi Dhani dinner", "Nahargarh sunset"]),
    ("Kerala", "India", 9.93, 76.27, 4200, "tropical", [9, 10, 11, 12, 1, 2, 3], [.5, .4, .6, .9, .8, .2, .95, .4],
     ["Alleppey houseboat", "Munnar tea gardens", "Kathakali show in Fort Kochi", "Periyar wildlife", "Varkala cliff beach"]),
    ("Rishikesh", "India", 30.09, 78.27, 2800, "hill", [2, 3, 4, 9, 10, 11], [0, .95, .7, .8, .5, .1, .8, .2],
     ["White-water rafting", "Ganga aarti at Triveni Ghat", "Beatles Ashram", "Neer Garh waterfall trek", "Yoga session"]),
    ("Varanasi", "India", 25.32, 82.97, 2500, "subtropical", [10, 11, 12, 1, 2, 3], [0, .1, .98, .2, .8, .2, .4, .5],
     ["Dawn boat ride on the Ganga", "Ganga aarti at Dashashwamedh", "Sarnath", "Kachori-jalebi food walk", "Silk weaving lanes"]),
    ("Ladakh", "India", 34.15, 77.58, 5500, "cold", [5, 6, 7, 8, 9], [0, .95, .7, .95, .4, .1, .5, .3],
     ["Pangong Lake", "Nubra Valley dunes", "Leh Palace & Shanti Stupa", "Khardung La drive", "Monastery circuit"]),
    ("Andaman Islands", "India", 11.62, 92.73, 6500, "tropical", [11, 12, 1, 2, 3, 4, 5], [.98, .7, .2, .8, .5, .1, .8, .1],
     ["Radhanagar Beach", "Scuba at Havelock", "Cellular Jail light show", "Neil Island", "Ross Island ruins"]),
    ("Udaipur", "India", 24.59, 73.71, 4800, "desert", [9, 10, 11, 12, 1, 2, 3], [0, .2, .9, .4, .8, .4, .8, .7],
     ["Lake Pichola boat ride", "City Palace", "Sajjangarh sunset", "Rooftop dining", "Shilpgram crafts"]),
    ("Darjeeling", "India", 27.04, 88.26, 3200, "hill", [3, 4, 5, 10, 11], [0, .5, .6, .9, .6, .1, .8, .4],
     ["Tiger Hill sunrise", "Toy train ride", "Tea estate tour", "Peace Pagoda", "Himalayan Zoo"]),
    ("Hampi", "India", 15.34, 76.46, 2200, "tropical", [10, 11, 12, 1, 2], [0, .5, .95, .5, .4, .1, .5, .3],
     ["Virupaksha Temple", "Coracle ride on Tungabhadra", "Hemakuta sunset", "Vittala Temple stone chariot", "Bouldering"]),
    ("Mumbai", "India", 19.08, 72.88, 6000, "tropical", [11, 12, 1, 2, 3], [.3, .2, .7, .1, .95, .95, .3, .95],
     ["Gateway of India & Colaba", "Street food crawl", "Marine Drive sunset", "Elephanta Caves", "Bandra nightlife"]),
    ("Coorg", "India", 12.34, 75.81, 3600, "hill", [10, 11, 12, 1, 2, 3], [0, .6, .3, .95, .7, .1, .9, .2],
     ["Coffee plantation walk", "Abbey Falls", "Dubare elephant camp", "Raja's Seat sunset", "Tadiandamol trek"]),
    ("Bali", "Indonesia", -8.41, 115.19, 7500, "tropical", [4, 5, 6, 7, 8, 9, 10], [.9, .7, .8, .8, .8, .8, .9, .7],
     ["Ubud rice terraces", "Uluwatu temple & Kecak dance", "Nusa Penida day trip", "Seminyak beach clubs", "Mount Batur sunrise trek"]),
    ("Bangkok & Phuket", "Thailand", 13.76, 100.50, 7000, "tropical", [11, 12, 1, 2, 3], [.8, .6, .7, .4, .95, .95, .7, .9],
     ["Grand Palace", "Chatuchak market", "Phi Phi island hopping", "Street food in Chinatown", "Thai cooking class"]),
    ("Dubai", "UAE", 25.20, 55.27, 12000, "desert", [11, 12, 1, 2, 3], [.6, .7, .5, .1, .8, .85, .6, .98],
     ["Burj Khalifa", "Desert safari", "Dubai Mall & fountain show", "Old Dubai souks", "Marina dhow dinner"]),
    ("Singapore", "Singapore", 1.35, 103.82, 11000, "tropical", [2, 3, 4, 7, 8], [.3, .4, .6, .5, .95, .8, .5, .95],
     ["Gardens by the Bay", "Hawker centre tour", "Sentosa", "Night Safari", "Little India & Chinatown"]),
    ("Kashmir", "India", 34.08, 74.80, 4800, "hill", [4, 5, 6, 9, 10], [0, .5, .7, .95, .7, .1, .9, .6],
     ["Dal Lake shikara", "Gulmarg gondola", "Mughal Gardens", "Pahalgam valley", "Wazwan dinner"]),
    ("Pondicherry", "India", 11.94, 79.81, 3000, "tropical", [11, 12, 1, 2, 3], [.7, .2, .7, .2, .85, .5, .85, .6],
     ["French Quarter cycling", "Auroville", "Promenade Beach sunrise", "Paradise Beach", "Cafe hopping"]),
    ("Meghalaya", "India", 25.58, 91.89, 3400, "hill", [10, 11, 12, 1, 2, 3, 4], [0, .7, .5, .98, .6, .2, .8, .2],
     ["Living root bridges", "Dawki river boating", "Mawlynnong village", "Cave exploring", "Cherrapunji waterfalls"]),
]
DESTINATIONS = [
    dict(zip(["name", "country", "lat", "lon", "daily_cost", "climate", "best_months", "traits", "highlights"], r))
    for r in _RAW
]
DEST_DF = pd.DataFrame([{**d, **dict(zip(DIMS, d["traits"]))} for d in DESTINATIONS])
_LOG_LO, _LOG_HI = math.log(1500), math.log(15000)


def find_destination(name: str | None) -> dict | None:
    if not name:
        return None
    n = name.strip().lower()
    for d in DESTINATIONS:
        dn = d["name"].lower()
        if n == dn or n in dn or dn in n or dn.split()[0] in n:
            return d
    return None


# =====================================================================================
# AI Feature 1 - KNN destination recommender
# =====================================================================================
def _cost_norm(cost: float | np.ndarray):
    return (np.log(np.clip(cost, 1500, 15000)) - _LOG_LO) / (_LOG_HI - _LOG_LO)


def recommend_destinations(req: RecommendRequest) -> list[DestinationMatch]:
    """Embed destinations and the user into [8 interest dims + weighted budget axis]; rank by KNN distance."""
    wanted = {i.strip().lower() for i in req.interests}
    user_pref = np.array([1.0 if d in wanted else 0.25 for d in DIMS])
    budget_ceiling = req.budget_max / req.days                       # INR / person / day
    budget_floor = (req.budget_min / req.days) if req.budget_min > 0 else budget_ceiling * 0.6
    target_daily = (budget_ceiling + budget_floor) / 2
    BUDGET_W = 1.5

    X = np.hstack([DEST_DF[DIMS].to_numpy(), BUDGET_W * _cost_norm(DEST_DF["daily_cost"].to_numpy())[:, None]])
    q = np.hstack([user_pref, [BUDGET_W * float(_cost_norm(target_daily))]])[None, :]

    n_candidates = min(len(DEST_DF), max(req.top_k * 2, 10))
    knn = NearestNeighbors(n_neighbors=n_candidates, metric="euclidean").fit(X)
    dist, idx = knn.kneighbors(q)

    out = []
    for d, i in zip(dist[0], idx[0]):
        row = DEST_DF.iloc[int(i)]
        est_pp = float(row.daily_cost * req.days)
        within = est_pp <= req.budget_max
        in_season = (req.month in row.best_months) if req.month else None
        score = 1 / (1 + d)                                         # similarity in (0,1]
        if not within:
            score *= max(0.3, 1 - (est_pp - req.budget_max) / req.budget_max)
        if in_season:
            score = min(1.0, score * 1.08)
        traits = [t for t, _ in sorted(zip(DIMS, row.traits), key=lambda x: -x[1])[:3]]
        reasons = []
        hit = [t for t in traits if t in wanted]
        if hit:
            reasons.append(f"Strong on your interests: {', '.join(hit)}")
        reasons.append(f"Est. {settings.currency} {est_pp:,.0f}/person for {req.days} days "
                       + ("fits your budget" if within else f"exceeds your {req.budget_max:,.0f} ceiling"))
        if in_season:
            reasons.append("Great season for your travel month")
        elif in_season is False:
            reasons.append("Off-season for your month - expect weather trade-offs")
        out.append(DestinationMatch(
            name=row["name"], country=row.country, match_score=round(float(score) * 100, 1),
            daily_cost=float(row.daily_cost), estimated_cost_per_person=round(est_pp), within_budget=within,
            in_season=in_season, best_months=list(row.best_months), top_traits=traits,
            highlights=list(row.highlights)[:3], reasons=reasons))
    out.sort(key=lambda m: -m.match_score)
    return out[:req.top_k]


# =====================================================================================
# AI Feature 2 - Cost estimator (RandomForest on synthetic historical packages)
# =====================================================================================
STYLE_MULT = {"budget": 0.7, "standard": 1.0, "premium": 1.7}
TRANSPORT_RATE = {"train": 1.6, "road": 2.4, "flight": 5.5}   # INR per km per person (return trip included below)
CAT_COLS, NUM_COLS = ["style", "transport"], ["base_daily", "days", "travelers", "distance_km", "in_season", "intl"]


def _transport_cost(mode: str, km: float) -> float:
    return TRANSPORT_RATE[mode] * km * 2 + (1500 if mode == "flight" else 0)  # return fare + airport/transfer fees


def generate_synthetic_packages(n: int = 3000, seed: int = 42) -> pd.DataFrame:
    """Synthetic 'historical' package bookings: noisy, non-linear function of drivers (group discount, season...)."""
    rng = np.random.default_rng(seed)
    d = DEST_DF.sample(n, replace=True, random_state=seed).reset_index(drop=True)
    df = pd.DataFrame({
        "base_daily": d.daily_cost.to_numpy() * rng.normal(1, 0.06, n),
        "days": rng.integers(2, 15, n), "travelers": rng.integers(1, 13, n),
        "style": rng.choice(list(STYLE_MULT), n, p=[.3, .5, .2]),
        "transport": rng.choice(list(TRANSPORT_RATE), n, p=[.35, .25, .4]),
        "distance_km": rng.uniform(100, 3500, n),
        "in_season": rng.integers(0, 2, n), "intl": (d.country != "India").astype(int).to_numpy(),
    })
    season = np.where(df.in_season == 1, 1.12, 0.92)                 # peak season costs more
    group_disc = 1 - 0.012 * np.minimum(df.travelers, 10)           # bulk rates
    intl_fee = df.intl * rng.uniform(8000, 15000, n)                # visas, insurance, forex
    ground = df.base_daily * df.days * df["style"].map(STYLE_MULT) * season * group_disc
    trans = [_transport_cost(m, k) for m, k in zip(df.transport, df.distance_km)]
    noise = rng.lognormal(0, 0.06, n)
    df["total_cost"] = (ground + trans + intl_fee) * df.travelers * noise
    return df


@lru_cache(maxsize=1)
def get_cost_model() -> tuple[Pipeline, dict]:
    """Model predicts PER-PERSON cost (lower variance); group total = prediction x travelers."""
    df = generate_synthetic_packages()
    X, y = df[CAT_COLS + NUM_COLS], df["total_cost"] / df["travelers"]
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=7)
    pipe = Pipeline([
        ("prep", ColumnTransformer([("cat", OneHotEncoder(handle_unknown="ignore"), CAT_COLS)], remainder="passthrough")),
        ("rf", RandomForestRegressor(n_estimators=150, min_samples_leaf=3, random_state=0, n_jobs=-1)),
    ]).fit(Xtr, ytr)
    pred = pipe.predict(Xte)
    total_true, total_pred = yte * Xte["travelers"], pred * Xte["travelers"]
    info = {"algorithm": "RandomForestRegressor (150 trees, per-person target)", "training_rows": int(len(df)),
            "holdout_r2": round(float(r2_score(total_true, total_pred)), 3),
            "holdout_mape_pct": round(float(np.mean(np.abs(total_true - total_pred) / total_true)) * 100, 1),
            "data": "synthetic historical trip packages"}
    return pipe, info


def estimate_cost(req: CostEstimateRequest) -> CostEstimateResponse:
    dest = find_destination(req.destination)
    if dest is None and req.daily_cost_override is None:
        raise HTTPException(422, "Provide a known destination or daily_cost_override")
    base = req.daily_cost_override or dest["daily_cost"]
    in_season = int(bool(dest and req.month and req.month in dest["best_months"]))
    intl = int(bool(dest and dest["country"] != "India"))
    row = pd.DataFrame([{"style": req.style, "transport": req.transport_mode, "base_daily": base, "days": req.days,
                         "travelers": req.travelers, "distance_km": req.origin_distance_km,
                         "in_season": in_season, "intl": intl}])[CAT_COLS + NUM_COLS]
    pipe, info = get_cost_model()
    total = float(pipe.predict(row)[0]) * req.travelers
    Xt = pipe.named_steps["prep"].transform(row)
    per_tree = np.array([t.predict(Xt)[0] for t in pipe.named_steps["rf"].estimators_]) * req.travelers
    low, high = np.percentile(per_tree, [10, 90])

    transport = _transport_cost(req.transport_mode, req.origin_distance_km) * req.travelers
    rest = max(total - transport, 0)
    breakdown = {"Transport": transport, "Stay": rest * .45, "Food": rest * .27, "Activities": rest * .18, "Misc & buffer": rest * .10}
    status = delta = None
    if req.budget_total:
        delta = req.budget_total - total
        status = ("within_budget" if total <= req.budget_total * 0.9 else
                  "tight" if total <= req.budget_total else "over_budget")
    return CostEstimateResponse(
        destination=dest["name"] if dest else req.destination, currency=settings.currency,
        total_cost=round(total), per_person_cost=round(total / req.travelers), low=round(float(low)), high=round(float(high)),
        breakdown={k: round(v) for k, v in breakdown.items()}, budget_total=req.budget_total,
        budget_status=status, budget_delta=round(delta) if delta is not None else None, model_info=info)


# =====================================================================================
# GenAI client (async)
# =====================================================================================
async def call_llm(system: str, user: str, *, json_mode: bool = False, temperature: float = 0.7,
                   max_tokens: int = 3500) -> tuple[str | None, str]:
    """Returns (text, source). text is None when no provider is configured or all retries failed."""
    provider = settings.active_llm
    if provider == "none":
        return None, "template-fallback"
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=settings.llm_timeout) as client:
                if provider == "openai":
                    payload = {"model": settings.openai_model, "temperature": temperature, "max_tokens": max_tokens,
                               "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
                    if json_mode:
                        payload["response_format"] = {"type": "json_object"}
                    r = await client.post(f"{settings.openai_base_url}/chat/completions", json=payload,
                                          headers={"Authorization": f"Bearer {settings.openai_api_key}"})
                    r.raise_for_status()
                    return r.json()["choices"][0]["message"]["content"].strip(), f"llm:openai:{settings.openai_model}"
                gen_cfg = {"temperature": temperature, "maxOutputTokens": max_tokens}
                if json_mode:
                    gen_cfg["responseMimeType"] = "application/json"
                r = await client.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{settings.gemini_model}:generateContent",
                    headers={"x-goog-api-key": settings.gemini_api_key},
                    json={"systemInstruction": {"parts": [{"text": system}]},
                          "contents": [{"role": "user", "parts": [{"text": user}]}], "generationConfig": gen_cfg})
                r.raise_for_status()
                parts = r.json()["candidates"][0]["content"]["parts"]
                return "".join(p.get("text", "") for p in parts).strip(), f"llm:gemini:{settings.gemini_model}"
        except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
            log.warning("LLM call failed (attempt %s/3): %s", attempt + 1, exc)
            await asyncio.sleep(0.8 * (attempt + 1))
    return None, "template-fallback"


def _strip_fences(text: str) -> str:
    return re.sub(r"^```(?:json|markdown|md)?\s*|\s*```$", "", text.strip(), flags=re.I)


# =====================================================================================
# Group consensus profile
# =====================================================================================
def build_group_profile(trip: Trip) -> dict:
    travellers = [m.user for m in trip.members if m.is_active and m.splits_expenses]
    n = max(len(travellers), 1)
    days = (trip.end_date - trip.start_date).days + 1
    counts = Counter(i.lower() for u in travellers for i in (u.interests or []))
    threshold = 1 if n == 1 else max(2, math.ceil(n / 2))
    shared = [i for i, c in counts.most_common() if c >= threshold]
    individual = {u.full_name: [i for i in (u.interests or []) if i.lower() not in shared] for u in travellers}
    individual = {k: v for k, v in individual.items() if v}
    caps = [u.budget_max for u in travellers if u.budget_max > 0]
    per_person = trip.budget_total / n
    binding = min([per_person] + caps)
    paces = Counter(u.pace for u in travellers)
    top = paces.most_common()
    pace = "balanced" if not top or (len(top) > 1 and top[0][1] == top[1][1]) else top[0][0]
    dietary = sorted({d.strip().lower() for u in travellers for d in (u.dietary or "").split(",") if d.strip()})
    return {"travellers": [u.full_name for u in travellers], "group_size": n, "days": days,
            "shared_priorities": shared, "individual_wishes": individual,
            "binding_budget_per_person": round(binding), "daily_budget_per_person": round(binding / days),
            "pace": pace, "dietary_restrictions": dietary, "currency": trip.currency}


ITINERARY_SYSTEM = """You are TripCraft AI, an expert group-travel planner who optimises for CONSENSUS.
Rules: (1) Every shared priority must appear on multiple days. (2) Every individual wish must be honoured at least once,
rotating fairly between travellers (show this in a Fairness Ledger). (3) Respect the binding per-person budget, pace and
dietary restrictions; never exceed the budget. (4) Be concrete: real place names, realistic timings, travel times and per-person
costs in the trip currency. (5) Output ONLY valid GitHub-flavoured markdown, no preamble."""


def itinerary_prompt(trip: Trip, profile: dict, dest: dict | None, extra: str) -> str:
    return f"""Plan this group trip.

TRIP: {trip.name} | destination: {trip.destination} | origin: {trip.origin or 'n/a'}
DATES: {trip.start_date} to {trip.end_date} ({profile['days']} days) | total group budget: {trip.currency} {trip.budget_total:,.0f}
KNOWN HIGHLIGHTS (optional inspiration): {', '.join(dest['highlights']) if dest else 'use your own knowledge'}
GROUP CONSENSUS PROFILE (JSON): {json.dumps(profile, ensure_ascii=False)}
EXTRA ORGANISER NOTES: {extra or 'none'}

Required markdown structure:
# <catchy trip title>
## Group Snapshot  (who is travelling, shared priorities, binding budget, pace)
## Day-by-Day Plan  -> for each day: `### Day N - <date> - <theme>` then **Morning / Afternoon / Evening** bullets, each with
   estimated cost per person, plus one line `Consensus note:` explaining who/what this slot serves.
## Budget Summary  (markdown table: category | per person | group total; must fit the binding budget)
## Fairness Ledger  (markdown table: traveller | wishes | day(s) honoured)
## Backup Plans  (rainy-day / tired-group alternatives)"""


def fallback_itinerary(trip: Trip, profile: dict, dest: dict | None) -> str:
    days, n = profile["days"], profile["group_size"]
    highlights = dest["highlights"] if dest else [f"Explore {trip.destination} old town", "Local market walk",
                                                  "Signature viewpoint at sunset", "Cooking class / food tour", "Nature day trip"]
    daily = profile["daily_budget_per_person"]
    cur = trip.currency
    wishes = list(profile["individual_wishes"].items())
    shared = ", ".join(profile["shared_priorities"]) or "general sightseeing"
    L = [f"# {trip.name}: {days} days in {trip.destination}", "", "## Group Snapshot",
         f"- **Travellers ({n}):** {', '.join(profile['travellers']) or 'TBD'}",
         f"- **Shared priorities:** {shared}",
         f"- **Pace:** {profile['pace']} | **Binding budget:** {cur} {profile['binding_budget_per_person']:,}/person "
         f"(~{cur} {daily:,}/day)",
         f"- **Dietary needs:** {', '.join(profile['dietary_restrictions']) or 'none stated'}", "",
         "> Template itinerary generated offline. Add an `OPENAI_API_KEY` or `GEMINI_API_KEY` for AI-written plans.", "",
         "## Day-by-Day Plan"]
    ledger = []
    for i in range(days):
        day = trip.start_date + timedelta(days=i)
        a, b = highlights[i % len(highlights)], highlights[(i + 2) % len(highlights)]
        wish_line = "Group favourite slot (shared priorities)"
        if wishes:
            who, w = wishes[i % len(wishes)]
            wish_line = f"Free choice slot for **{who}** ({', '.join(w)}) - everyone joins or splits up for 2 hours"
            ledger.append((who, ", ".join(w), f"Day {i + 1}"))
        L += [f"### Day {i + 1} - {day:%a, %d %b} - {'Arrival & easy start' if i == 0 else 'Departure day' if i == days - 1 and days > 1 else 'Explore'}",
              f"- **Morning:** {a} (~{cur} {round(daily * .30):,} pp)",
              f"- **Afternoon:** Long lunch & rest, then {b} (~{cur} {round(daily * .35):,} pp)",
              f"- **Evening:** Group dinner at a well-reviewed local spot (~{cur} {round(daily * .35):,} pp)",
              f"- *Consensus note:* {wish_line}.", ""]
    L += ["## Budget Summary", "| Category | Per person | Group total |", "|---|---|---|"]
    for cat, share in (("Stay", .40), ("Food", .25), ("Activities", .20), ("Local transport", .10), ("Buffer", .05)):
        pp = round(profile["binding_budget_per_person"] * share)
        L.append(f"| {cat} | {cur} {pp:,} | {cur} {pp * n:,} |")
    L += ["", "## Fairness Ledger", "| Traveller | Wishes | Honoured on |", "|---|---|---|"]
    L += [f"| {w} | {x} | {d} |" for w, x, d in ledger] or ["| Everyone | shared priorities | All days |"]
    L += ["", "## Backup Plans", "- **Rain:** swap outdoor stops for a museum, cafe or cooking class.",
          "- **Tired group:** keep only the evening group activity and sleep in."]
    return "\n".join(L)


# =====================================================================================
# Weather (Open-Meteo live forecast + climatology fallback)
# =====================================================================================
_BASE_TEMP = {"tropical": (32, 24), "hill": (21, 10), "desert": (34, 19), "cold": (17, 2), "subtropical": (31, 18)}


def _wmo(code: int) -> str:
    if code == 0:
        return "Clear sky"
    if code <= 3:
        return "Partly cloudy"
    if code in (45, 48):
        return "Fog"
    if 51 <= code <= 57:
        return "Drizzle"
    if 61 <= code <= 67:
        return "Rain"
    if 71 <= code <= 77 or code in (85, 86):
        return "Snow"
    if 80 <= code <= 82:
        return "Rain showers"
    return "Thunderstorm" if code >= 95 else "Mixed"


def _risk(tmax: float, tmin: float, rain: int, code: int = 0) -> str:
    if rain >= 60 or code >= 95 or 61 <= code <= 82:
        return "rain"
    if tmax >= 38:
        return "heat"
    if tmin <= 3:
        return "cold"
    return "ok"


def climatology_day(climate: str, d: date) -> WeatherDay:
    tmax, tmin = _BASE_TEMP.get(climate, (28, 18))
    if d.month in (12, 1, 2) and climate != "tropical":
        tmax, tmin = tmax - 6, tmin - 6
    if d.month in (4, 5, 6) and climate in ("desert", "subtropical", "tropical"):
        tmax, tmin = tmax + 5, tmin + 3
    monsoon = d.month in (6, 7, 8, 9)
    rain = {"cold": 8, "desert": 20}.get(climate, 70) if monsoon else 12
    return WeatherDay(date=d, tmax=tmax, tmin=tmin, rain_probability=rain,
                      summary="Typical monsoon showers" if rain >= 60 else "Typical seasonal weather",
                      risk=_risk(tmax, tmin, rain))


async def get_forecast(trip: Trip, dest: dict | None, live: bool) -> tuple[list[WeatherDay], str]:
    dates = [trip.start_date + timedelta(days=i) for i in range((trip.end_date - trip.start_date).days + 1)]
    climate = dest["climate"] if dest else "tropical"
    result: dict[date, WeatherDay] = {}
    live_ok = False
    today = date.today()
    if live and dest and trip.start_date <= today + timedelta(days=15) and trip.end_date >= today:
        s, e = max(trip.start_date, today), min(trip.end_date, today + timedelta(days=15))
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get("https://api.open-meteo.com/v1/forecast", params={
                    "latitude": dest["lat"], "longitude": dest["lon"], "timezone": "auto",
                    "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode",
                    "start_date": s.isoformat(), "end_date": e.isoformat()})
                r.raise_for_status()
                dd = r.json()["daily"]
                for i, ds in enumerate(dd["time"]):
                    rain = int(dd["precipitation_probability_max"][i] or 0)
                    code = int(dd["weathercode"][i] or 0)
                    tmax, tmin = float(dd["temperature_2m_max"][i]), float(dd["temperature_2m_min"][i])
                    result[date.fromisoformat(ds)] = WeatherDay(
                        date=date.fromisoformat(ds), tmax=tmax, tmin=tmin, rain_probability=rain,
                        summary=_wmo(code), risk=_risk(tmax, tmin, rain, code))
                live_ok = bool(result)
        except (httpx.HTTPError, KeyError, ValueError, TypeError) as exc:
            log.warning("Open-Meteo unavailable, using climatology: %s", exc)
    days = [result.get(d) or climatology_day(climate, d) for d in dates]
    source = ("open-meteo" if len(result) == len(dates) else "open-meteo+climatology") if live_ok else "climatology"
    return days, source


def _weather_table(days: list[WeatherDay]) -> str:
    return "\n".join(f"- {w.date} ({w.date:%a}): {w.summary}, {w.tmin:.0f}-{w.tmax:.0f}C, rain {w.rain_probability}%, risk={w.risk}"
                     for w in days)


def weather_fallback(markdown: str, days: list[WeatherDay]) -> str:
    tips = {"rain": "Move outdoor activities indoors (museum, market hall, cooking class) and carry rain gear.",
            "heat": "Shift outdoor plans to early morning / late afternoon; hydrate and rest 12:00-16:00.",
            "cold": "Start later, layer up, and keep outdoor stops short with hot-drink breaks.",
            "ok": "Conditions look good - keep the original plan."}
    rows = [f"| Day {i + 1} ({w.date:%d %b}) | {w.summary}, {w.tmin:.0f}-{w.tmax:.0f}C, rain {w.rain_probability}% | {tips[w.risk]} |"
            for i, w in enumerate(days)]
    return (markdown.rstrip() + "\n\n## Weather Adjustments\n| Day | Forecast | Recommended change |\n|---|---|---|\n"
            + "\n".join(rows) + "\n")


# =====================================================================================
# Packing fallback
# =====================================================================================
def packing_fallback(trip: Trip, profile: dict, days: list[WeatherDay]) -> list[PackingCategory]:
    P = lambda item, e=False, r="": PackingItem(item=item, essential=e, reason=r)  # noqa: E731
    n_days = len(days)
    cold = any(w.tmin <= 10 for w in days)
    hot = any(w.tmax >= 33 for w in days)
    rainy = any(w.risk == "rain" for w in days)
    interests = set(profile["shared_priorities"]) | {i for v in profile["individual_wishes"].values() for i in v}
    clothing = [P(f"{min(n_days, 6) + 1} tops & {max(2, min(n_days // 2 + 1, 4))} bottoms", True), P("Comfortable walking shoes", True),
                P("Sleepwear & innerwear"), P("Warm layers / fleece" if cold else "Light cotton layers", cold)]
    if rainy:
        clothing.append(P("Rain jacket or compact umbrella", True, "Rain likely on some days"))
    if hot:
        clothing.append(P("Hat & sunglasses", True, "High temperatures forecast"))
    cats = [PackingCategory(name="Documents & money", items=[
        P("Government ID / passport", True), P("Tickets & hotel confirmations", True), P("Cash + UPI/cards", True), P("Travel insurance copy")]),
        PackingCategory(name="Clothing", items=clothing),
        PackingCategory(name="Health & toiletries", items=[
            P("Personal medicines", True), P("Sunscreen (SPF 30+)", hot), P("First-aid basics", True), P("Hand sanitiser & wet wipes"),
            P("Reusable water bottle")]),
        PackingCategory(name="Tech", items=[P("Phone + charger", True), P("Power bank", True), P("Universal adapter"), P("Offline maps downloaded")])]
    extras = []
    if "beach" in interests:
        extras += [P("Swimwear x2"), P("Quick-dry towel"), P("Reef-safe sunscreen")]
    if "adventure" in interests or "nature" in interests:
        extras += [P("Trekking shoes", True), P("Daypack"), P("Insect repellent"), P("Headlamp")]
    if "culture" in interests:
        extras += [P("Modest clothing for temples", True), P("Scarf / shawl")]
    if extras:
        cats.append(PackingCategory(name="For your activities", items=extras))
    return cats


# =====================================================================================
# Endpoints
# =====================================================================================
@router.get("/status")
def ai_status(_: User = Depends(get_current_user)):
    return {"genai_provider": settings.active_llm, "genai_live": settings.active_llm != "none",
            "cost_model": get_cost_model()[1], "destinations_in_dataset": len(DESTINATIONS)}


@router.get("/destinations")
def list_destinations(_: User = Depends(get_current_user)):
    return {"interests": DIMS, "destinations": [{"name": d["name"], "country": d["country"], "daily_cost": d["daily_cost"]}
                                                 for d in DESTINATIONS]}


@router.post("/recommend-destinations", response_model=RecommendResponse)
def recommend_endpoint(body: RecommendRequest, _: User = Depends(_no_partners)):
    return RecommendResponse(algorithm="K-Nearest-Neighbours (euclidean) over interest vector + log-scaled budget axis, "
                                       "re-ranked by budget fit and seasonality",
                             currency=settings.currency, matches=recommend_destinations(body))


@router.post("/estimate-cost", response_model=CostEstimateResponse)
def estimate_endpoint(body: CostEstimateRequest, _: User = Depends(_no_partners)):
    return estimate_cost(body)


@router.get("/trips/{trip_id}/itinerary", response_model=ItineraryResponse)
def get_itinerary(trip_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    trip = get_trip_access(db, trip_id, user)
    return ItineraryResponse(trip_id=trip.id, markdown=trip.itinerary_md, source=trip.itinerary_source,
                             generated_at=trip.itinerary_generated_at)


@router.post("/trips/{trip_id}/itinerary", response_model=ItineraryResponse)
async def generate_itinerary(trip_id: int, body: ItineraryRequest, user: User = Depends(get_current_user),
                             db: Session = Depends(get_db)):
    get_trip_access(db, trip_id, user, organiser_only=True)
    trip = load_trip(db, trip_id)
    profile = build_group_profile(trip)
    dest = find_destination(trip.destination)
    text, source = await call_llm(ITINERARY_SYSTEM, itinerary_prompt(trip, profile, dest, body.extra_instructions),
                                  temperature=0.7, max_tokens=4000)
    md = _strip_fences(text) if text else fallback_itinerary(trip, profile, dest)
    if not text:
        source = "template-fallback"
    trip.itinerary_md, trip.itinerary_source = md, source
    trip.itinerary_generated_at = datetime.now(timezone.utc)
    db.commit()
    return ItineraryResponse(trip_id=trip.id, markdown=md, source=source,
                             generated_at=trip.itinerary_generated_at, consensus=profile)


@router.put("/trips/{trip_id}/itinerary", response_model=ItineraryResponse)
def save_itinerary(trip_id: int, body: ItineraryUpdate, user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)):
    trip = get_trip_access(db, trip_id, user, organiser_only=True)
    trip.itinerary_md, trip.itinerary_source = body.markdown, "manual-edit"
    trip.itinerary_generated_at = datetime.now(timezone.utc)
    db.commit()
    return ItineraryResponse(trip_id=trip.id, markdown=trip.itinerary_md, source=trip.itinerary_source,
                             generated_at=trip.itinerary_generated_at)


@router.post("/trips/{trip_id}/weather-adjust", response_model=WeatherAdjustResponse)
async def weather_adjust(trip_id: int, body: WeatherAdjustRequest, user: User = Depends(get_current_user),
                         db: Session = Depends(get_db)):
    get_trip_access(db, trip_id, user, organiser_only=True)
    trip = load_trip(db, trip_id)
    if not trip.itinerary_md:
        raise HTTPException(409, "Generate an itinerary first")
    dest = find_destination(trip.destination)
    if body.manual_forecast:
        forecast, fsource = body.manual_forecast, "manual"
    else:
        forecast, fsource = await get_forecast(trip, dest, body.use_live_forecast)
    prompt = f"""Revise this group itinerary for the weather forecast below. Keep the same markdown structure, day count,
consensus notes and budget. Only swap or re-time activities on days with risk != ok (rain -> indoor alternatives of similar cost,
heat -> early/late outdoor + midday rest, cold -> later starts). Mark each change with `🌦 Weather change:` and a short reason.
Return the FULL revised markdown only.

FORECAST:
{_weather_table(forecast)}

ITINERARY:
{trip.itinerary_md}"""
    text, source = await call_llm(ITINERARY_SYSTEM, prompt, temperature=0.4, max_tokens=4500)
    md = _strip_fences(text) if text else weather_fallback(trip.itinerary_md, forecast)
    if body.apply:
        trip.itinerary_md, trip.itinerary_source = md, source if text else "weather-template"
        trip.itinerary_generated_at = datetime.now(timezone.utc)
        db.commit()
    return WeatherAdjustResponse(trip_id=trip.id, forecast=forecast, forecast_source=fsource, markdown=md,
                                 source=source, applied=body.apply)


@router.post("/trips/{trip_id}/packing-list", response_model=PackingResponse)
async def packing_list(trip_id: int, user: User = Depends(_no_partners), db: Session = Depends(get_db)):
    get_trip_access(db, trip_id, user)
    trip = load_trip(db, trip_id)
    profile = build_group_profile(trip)
    dest = find_destination(trip.destination)
    forecast, fsource = await get_forecast(trip, dest, live=True)
    wsum = (f"{min(w.tmin for w in forecast):.0f}-{max(w.tmax for w in forecast):.0f}C, "
            f"max rain chance {max(w.rain_probability for w in forecast)}% ({fsource})")
    prompt = f"""Create a smart packing checklist for a group trip to {trip.destination} ({profile['days']} days).
Weather: {wsum}. Daily forecast:\n{_weather_table(forecast)}
Group interests: {json.dumps(profile['shared_priorities'])} + individual {json.dumps(profile['individual_wishes'])}.
Dietary: {profile['dietary_restrictions']}. Pace: {profile['pace']}.
Return ONLY JSON: {{"categories":[{{"name":str,"items":[{{"item":str,"essential":bool,"reason":str}}]}}]}}
with 5-7 categories (Documents, Clothing, Health, Tech, Activity gear, ...) and at most 8 items each; `reason` links the item to weather/activities."""
    text, source = await call_llm("You are a meticulous travel packing assistant. Reply with strict JSON only.", prompt,
                                  json_mode=True, temperature=0.4, max_tokens=2500)
    categories = None
    if text:
        try:
            raw = json.loads(_strip_fences(text))["categories"]
            categories = [PackingCategory(name=c["name"], items=[PackingItem(**i) for i in c["items"]]) for c in raw]
        except (ValueError, KeyError, TypeError) as exc:
            log.warning("Bad packing JSON, using fallback: %s", exc)
    if not categories:
        categories, source = packing_fallback(trip, profile, forecast), "template-fallback"
    trip.packing = {"categories": [c.model_dump() for c in categories], "source": source, "weather": wsum}
    db.commit()
    return PackingResponse(trip_id=trip.id, categories=categories, source=source, weather_summary=wsum)


@router.get("/trips/{trip_id}/packing-list", response_model=PackingResponse | None)
def get_packing_list(trip_id: int, user: User = Depends(_no_partners), db: Session = Depends(get_db)):
    trip = get_trip_access(db, trip_id, user)
    if not trip.packing:
        return None
    return PackingResponse(trip_id=trip.id, categories=trip.packing["categories"], source=trip.packing["source"],
                           weather_summary=trip.packing["weather"])

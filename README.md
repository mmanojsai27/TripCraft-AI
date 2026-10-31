# 🧭 TripCraft AI

> Problem **NN-10 · Travel Planning** - budget-aware group trip planning that everyone agrees on.

**Stack:** FastAPI · SQLite + SQLAlchemy 2 · pandas + scikit-learn · async OpenAI/Gemini GenAI · React (Vite) + Tailwind CSS

## Features at a glance

| Requirement | Implementation | Where |
|---|---|---|
| **RBAC - 4 roles** | Organiser, Member, Partner, Admin; JWT auth, role dependencies **and** object-level trip checks | `backend/app/auth.py` |
| **Shared expense tracker** | Integer-cent ledger, equal / exact / percent / share splits via largest-remainder allocation, min-cash-flow "settle up" | `backend/app/routers/expenses.py` |
| **AI 1 - Destination recommender** | KNN (`NearestNeighbors`) over an 8-dim interest vector + log-scaled budget axis, re-ranked by budget fit & season | `ai_features.py → recommend_destinations` |
| **AI 2 - Cost estimator** | RandomForest trained on 3,000 synthetic historical packages; per-person target; 10-90% interval from tree spread; reports hold-out R²/MAPE | `ai_features.py → estimate_cost` |
| **GenAI 1 - Consensus itinerary** | Async LLM call. A *group consensus profile* (shared priorities, rotating individual wishes, binding budget, pace, diet) drives a prompt that outputs day-by-day markdown with a Fairness Ledger | `POST /api/ai/trips/{id}/itinerary` |
| **GenAI 2 (bonus)** | **Weather-aware itinerary modifier** (Open-Meteo live forecast → climatology fallback, preview/apply/discard) **and** **smart packing checklist** | `…/weather-adjust`, `…/packing-list` |
| **Resilience** | Every GenAI endpoint has a deterministic template fallback, so the demo never breaks without a key or network | `call_llm()` |

## Quick start

### 1) Backend (Python 3.10+)
```bash
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                   # optionally add OPENAI_API_KEY or GEMINI_API_KEY
python init_db.py                                      # creates SQLite DB + demo data (use --reset to rebuild)
uvicorn app.main:app --reload --port 8000              # Swagger UI: http://localhost:8000/docs
```

### 2) Frontend (Node 18+)
```bash
cd frontend
npm install
npm run dev                                            # http://localhost:5173  (proxies /api -> :8000)
```

### Demo accounts - password `TripCraft@123`
| Email | Role |
|---|---|
| `organiser@tripcraft.ai` | Trip Organiser |
| `riya@tripcraft.ai`, `arjun@tripcraft.ai`, `meera@tripcraft.ai` | Group Member |
| `partner@tripcraft.ai` | Travel Partner |
| `admin@tripcraft.ai` | Admin |

## GenAI configuration (`backend/.env`)
| Variable | Meaning |
|---|---|
| `LLM_PROVIDER` | `auto` (default - uses whichever key exists), `openai`, `gemini`, `none` |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` | Works with any OpenAI-compatible API (OpenAI, Groq, Together, Ollama…) |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | Google Gemini `generateContent` |

The header badge in the UI shows whether GenAI is live or running on the offline template.

## RBAC matrix
| Capability | Organiser | Member | Partner | Admin |
|---|:--:|:--:|:--:|:--:|
| Create trip, manage members, edit/delete trip | ✅ (own) | | | ✅ |
| View trip & itinerary (if participant) | ✅ | ✅ | ✅ | ✅ |
| Add / view shared expenses | ✅ | ✅ | ⛔ | ✅ |
| Generate / edit itinerary, weather-adjust | ✅ (own) | | | ✅ |
| Recommender, cost estimator, packing list | ✅ | ✅ | ⛔ | ✅ |
| User management & platform stats | | | | ✅ |

Partners are never included in expense splits. Admin accounts cannot be self-registered.

## How the key algorithms work

**Expense splitting** - all money is stored as integer minor units. `allocate(total, weights)` computes exact fractional quotas
(`fractions.Fraction`), floors them, then hands leftover cents to the largest remainders, so shares **always sum to the total**
(₹100 ÷ 3 → 33.34 / 33.33 / 33.33). Balances are `paid − owed`; `simplify_debts` greedily matches the largest debtor with the
largest creditor for minimal transfers.

**Recommender** - each destination is a vector `[beach, adventure, culture, nature, food, nightlife, relaxation, shopping, w·cost]`.
The user vector uses 1.0 for chosen interests (0.25 otherwise) and the midpoint of their per-day budget. KNN returns the nearest
candidates, then scores are scaled down when the destination exceeds the budget ceiling and nudged up when in season.

**Cost estimator** - synthetic bookings are generated from drivers (daily cost, days, group size with bulk discounts, style, transport mode,
distance, season, international fees) with log-normal noise. The forest predicts per-person cost; the 10th–90th percentile of
individual tree predictions gives the range. Transport is shown from a rule model and the remainder is split across stay/food/activities/misc.

**Group consensus** - `build_group_profile()` counts interests across active travellers: ≥ half the group ⇒ *shared priority*
(appears on multiple days); otherwise an *individual wish* that is rotated fairly across days and logged in the Fairness Ledger.
The binding budget is `min(trip budget ÷ travellers, every member's personal cap)`.

## API overview (all under `/api`)
```
POST /auth/register · POST /auth/login · GET /auth/me · PUT /auth/me/preferences
GET/POST /trips · GET/PATCH/DELETE /trips/{id} · POST /trips/{id}/members · PATCH/DELETE /trips/{id}/members/{uid}
POST/GET /trips/{id}/expenses · GET /trips/{id}/expenses/summary · DELETE /trips/{id}/expenses/{eid}
POST /ai/recommend-destinations · POST /ai/estimate-cost · GET /ai/status · GET /ai/destinations
GET/POST/PUT /ai/trips/{id}/itinerary · POST /ai/trips/{id}/weather-adjust · GET/POST /ai/trips/{id}/packing-list
GET /admin/users · PATCH /admin/users/{id} · GET /admin/stats
```

## Project layout
```
backend/   app/{main,config,database,models,schemas,auth}.py · app/routers/{trips,expenses,ai_features}.py · init_db.py
frontend/  public/index.html · src/{main,App}.jsx · src/components/{Dashboard,ItineraryBuilder,ExpenseTracker}.jsx
           src/api.js, src/index.css, vite/tailwind/postcss config (required by the toolchain)
```

## Production notes
Set a strong `SECRET_KEY`, restrict `CORS_ORIGINS`, and switch `DATABASE_URL` to PostgreSQL if you outgrow SQLite
(models use only portable SQLAlchemy types). Build the SPA with `npm run build` and serve `frontend/dist` from any static host,
setting `VITE_API_URL` to the API origin.

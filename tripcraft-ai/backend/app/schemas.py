"""Pydantic v2 request/response schemas for every router."""
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

from .models import Role

Pace = Literal["relaxed", "balanced", "packed"]
TripStatus = Literal["planning", "confirmed", "completed", "cancelled"]
SplitType = Literal["equal", "exact", "percent", "shares"]
ExpenseCategory = Literal["stay", "food", "transport", "activities", "shopping", "other"]
TravelStyle = Literal["budget", "standard", "premium"]
TransportMode = Literal["train", "flight", "road"]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ------------------------------------------------------------------ auth / users
class UserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=8, max_length=128)
    role: Role = Role.MEMBER
    interests: list[str] = Field(default_factory=list)
    budget_min: float = Field(0, ge=0)
    budget_max: float = Field(0, ge=0)
    pace: Pace = "balanced"
    dietary: str = Field("", max_length=200)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserOut(ORM):
    id: int
    email: EmailStr
    full_name: str
    role: Role
    is_active: bool
    interests: list[str]
    budget_min: float
    budget_max: float
    pace: Pace
    dietary: str
    created_at: datetime


class PreferencesUpdate(BaseModel):
    full_name: str | None = Field(None, min_length=2, max_length=120)
    interests: list[str] | None = None
    budget_min: float | None = Field(None, ge=0)
    budget_max: float | None = Field(None, ge=0)
    pace: Pace | None = None
    dietary: str | None = Field(None, max_length=200)


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class AdminUserUpdate(BaseModel):
    role: Role | None = None
    is_active: bool | None = None


# ------------------------------------------------------------------ trips
class TripCreate(BaseModel):
    name: str = Field(min_length=2, max_length=140)
    destination: str = Field(min_length=2, max_length=140)
    origin: str = Field("", max_length=140)
    start_date: date
    end_date: date
    budget_total: float = Field(gt=0, le=1e9)
    currency: str = Field("INR", min_length=3, max_length=5)
    description: str = Field("", max_length=2000)

    @model_validator(mode="after")
    def _check_dates(self):
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        if (self.end_date - self.start_date).days > 60:
            raise ValueError("A trip can span at most 61 days")
        return self


class TripUpdate(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=140)
    destination: str | None = Field(None, min_length=2, max_length=140)
    origin: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    budget_total: float | None = Field(None, gt=0, le=1e9)
    description: str | None = None
    status: TripStatus | None = None


class MemberOut(BaseModel):
    user_id: int
    full_name: str
    email: EmailStr
    role: Role
    is_active: bool
    splits_expenses: bool


class TripOut(BaseModel):
    id: int
    name: str
    destination: str
    origin: str
    start_date: date
    end_date: date
    days: int
    budget_total: float
    currency: str
    status: str
    description: str
    organiser_id: int
    has_itinerary: bool
    members: list[MemberOut]
    created_at: datetime


class MemberAdd(BaseModel):
    email: EmailStr


class MemberUpdate(BaseModel):
    is_active: bool


# ------------------------------------------------------------------ expenses
class SplitInput(BaseModel):
    user_id: int
    value: float = Field(ge=0)  # exact amount | percentage | share weight depending on split_type


class ExpenseCreate(BaseModel):
    description: str = Field(min_length=1, max_length=200)
    amount: float = Field(gt=0, le=1e8)
    category: ExpenseCategory = "other"
    paid_by: int | None = None  # defaults to the caller
    split_type: SplitType = "equal"
    participants: list[int] | None = None   # equal split subset (default: all active members)
    splits: list[SplitInput] | None = None  # required for exact / percent / shares
    expense_date: date | None = None


class SplitOut(BaseModel):
    user_id: int
    full_name: str
    share: float


class ExpenseOut(BaseModel):
    id: int
    trip_id: int
    description: str
    category: str
    amount: float
    paid_by: int
    paid_by_name: str
    split_type: str
    expense_date: date
    created_at: datetime
    splits: list[SplitOut]


class BalanceOut(BaseModel):
    user_id: int
    full_name: str
    paid: float
    owed: float
    net: float  # >0 is owed money, <0 owes money


class SettlementOut(BaseModel):
    from_user_id: int
    from_name: str
    to_user_id: int
    to_name: str
    amount: float


class ExpenseSummary(BaseModel):
    currency: str
    total_spent: float
    budget_total: float
    budget_remaining: float
    budget_used_pct: float
    active_members: int
    per_person_average: float
    by_category: dict[str, float]
    balances: list[BalanceOut]
    settlements: list[SettlementOut]


# ------------------------------------------------------------------ AI (classical ML)
class RecommendRequest(BaseModel):
    interests: list[str] = Field(default_factory=list)
    budget_min: float = Field(0, ge=0)           # per person, whole trip
    budget_max: float = Field(..., gt=0)
    days: int = Field(5, ge=1, le=30)
    travelers: int = Field(2, ge=1, le=50)
    month: int | None = Field(None, ge=1, le=12)
    top_k: int = Field(5, ge=1, le=10)


class DestinationMatch(BaseModel):
    name: str
    country: str
    match_score: float
    daily_cost: float
    estimated_cost_per_person: float
    within_budget: bool
    in_season: bool | None
    best_months: list[int]
    top_traits: list[str]
    highlights: list[str]
    reasons: list[str]


class RecommendResponse(BaseModel):
    algorithm: str
    currency: str
    matches: list[DestinationMatch]


class CostEstimateRequest(BaseModel):
    destination: str | None = None
    daily_cost_override: float | None = Field(None, gt=0)
    days: int = Field(5, ge=1, le=60)
    travelers: int = Field(2, ge=1, le=50)
    style: TravelStyle = "standard"
    transport_mode: TransportMode = "train"
    origin_distance_km: float = Field(800, ge=0, le=20000)
    month: int | None = Field(None, ge=1, le=12)
    budget_total: float | None = Field(None, gt=0)


class CostEstimateResponse(BaseModel):
    destination: str | None
    currency: str
    total_cost: float
    per_person_cost: float
    low: float
    high: float
    breakdown: dict[str, float]
    budget_total: float | None
    budget_status: str | None
    budget_delta: float | None
    model_info: dict


# ------------------------------------------------------------------ GenAI
class ItineraryRequest(BaseModel):
    extra_instructions: str = Field("", max_length=600)


class ItineraryUpdate(BaseModel):
    markdown: str = Field(min_length=1, max_length=60000)


class ItineraryResponse(BaseModel):
    trip_id: int
    markdown: str | None
    source: str | None
    generated_at: datetime | None
    consensus: dict | None = None


class WeatherDay(BaseModel):
    date: date
    tmax: float
    tmin: float
    rain_probability: int = Field(ge=0, le=100)
    summary: str
    risk: Literal["ok", "rain", "heat", "cold"] = "ok"


class WeatherAdjustRequest(BaseModel):
    apply: bool = False
    use_live_forecast: bool = True
    manual_forecast: list[WeatherDay] | None = None


class WeatherAdjustResponse(BaseModel):
    trip_id: int
    forecast: list[WeatherDay]
    forecast_source: str
    markdown: str
    source: str
    applied: bool


class PackingItem(BaseModel):
    item: str
    essential: bool = False
    reason: str = ""


class PackingCategory(BaseModel):
    name: str
    items: list[PackingItem]


class PackingResponse(BaseModel):
    trip_id: int
    categories: list[PackingCategory]
    source: str
    weather_summary: str

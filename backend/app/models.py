"""ORM models. Money is stored as integer minor units (paise/cents) to avoid float drift."""
import enum
from datetime import date, datetime, timezone

from sqlalchemy import (JSON, Boolean, Date, DateTime, Enum as SAEnum, ForeignKey,
                        Integer, String, Text, UniqueConstraint, Float)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Role(str, enum.Enum):
    ORGANISER = "organiser"   # Trip Organiser
    MEMBER = "member"         # Group Member
    PARTNER = "partner"       # Travel Partner (hotel / guide / agency)
    ADMIN = "admin"           # Platform Admin


_role_type = SAEnum(Role, native_enum=False, length=20, values_callable=lambda e: [m.value for m in e])


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120))
    hashed_password: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(_role_type, default=Role.MEMBER)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Preference vector inputs used by the recommender and the group-consensus prompt
    interests: Mapped[list] = mapped_column(JSON, default=list)
    budget_min: Mapped[float] = mapped_column(Float, default=0.0)   # per person, whole trip
    budget_max: Mapped[float] = mapped_column(Float, default=0.0)
    pace: Mapped[str] = mapped_column(String(12), default="balanced")  # relaxed|balanced|packed
    dietary: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    memberships: Mapped[list["TripMember"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Trip(Base):
    __tablename__ = "trips"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(140))
    destination: Mapped[str] = mapped_column(String(140))
    origin: Mapped[str] = mapped_column(String(140), default="")
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    budget_total: Mapped[float] = mapped_column(Float)   # whole group, major units
    currency: Mapped[str] = mapped_column(String(5), default="INR")
    status: Mapped[str] = mapped_column(String(20), default="planning")  # planning|confirmed|completed|cancelled
    description: Mapped[str] = mapped_column(Text, default="")
    organiser_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    itinerary_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    itinerary_source: Mapped[str | None] = mapped_column(String(40), nullable=True)
    itinerary_generated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    packing: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    organiser: Mapped[User] = relationship(foreign_keys=[organiser_id])
    members: Mapped[list["TripMember"]] = relationship(
        back_populates="trip", cascade="all, delete-orphan", order_by="TripMember.id")
    expenses: Mapped[list["Expense"]] = relationship(
        back_populates="trip", cascade="all, delete-orphan", order_by="Expense.id.desc()")


class TripMember(Base):
    __tablename__ = "trip_members"
    __table_args__ = (UniqueConstraint("trip_id", "user_id", name="uq_trip_user"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)           # still part of the group?
    splits_expenses: Mapped[bool] = mapped_column(Boolean, default=True)     # False for travel partners
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    trip: Mapped[Trip] = relationship(back_populates="members")
    user: Mapped[User] = relationship(back_populates="memberships")


class Expense(Base):
    __tablename__ = "expenses"

    id: Mapped[int] = mapped_column(primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    paid_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    description: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(30), default="other")
    amount_cents: Mapped[int] = mapped_column(Integer)
    split_type: Mapped[str] = mapped_column(String(10), default="equal")  # equal|exact|percent|shares
    expense_date: Mapped[date] = mapped_column(Date, default=date.today)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    trip: Mapped[Trip] = relationship(back_populates="expenses")
    payer: Mapped[User] = relationship(foreign_keys=[paid_by_id])
    splits: Mapped[list["ExpenseSplit"]] = relationship(
        back_populates="expense", cascade="all, delete-orphan", order_by="ExpenseSplit.id")


class ExpenseSplit(Base):
    __tablename__ = "expense_splits"

    id: Mapped[int] = mapped_column(primary_key=True)
    expense_id: Mapped[int] = mapped_column(ForeignKey("expenses.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    share_cents: Mapped[int] = mapped_column(Integer)

    expense: Mapped[Expense] = relationship(back_populates="splits")
    user: Mapped[User] = relationship()

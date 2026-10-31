"""Create tables and seed demo data.   Usage: python init_db.py [--reset]

Demo logins (password from DEMO_PASSWORD, default TripCraft@123):
  admin@tripcraft.ai      -> Admin
  organiser@tripcraft.ai  -> Trip Organiser
  riya@tripcraft.ai, arjun@tripcraft.ai, meera@tripcraft.ai -> Group Members
  partner@tripcraft.ai    -> Travel Partner
"""
import sys
from datetime import date, timedelta

from sqlalchemy import select

from app import models  # noqa: F401
from app.auth import hash_password
from app.config import get_settings
from app.database import Base, SessionLocal, engine
from app.models import Expense, ExpenseSplit, Role, Trip, TripMember, User
from app.routers.expenses import allocate, to_cents

settings = get_settings()

USERS = [
    ("admin@tripcraft.ai", "Platform Admin", Role.ADMIN, [], 0, 0, "balanced", ""),
    ("organiser@tripcraft.ai", "Aarav Organiser", Role.ORGANISER, ["beach", "food", "nightlife"], 15000, 30000, "balanced", ""),
    ("riya@tripcraft.ai", "Riya Sharma", Role.MEMBER, ["beach", "relaxation", "food"], 10000, 25000, "relaxed", "vegetarian"),
    ("arjun@tripcraft.ai", "Arjun Mehta", Role.MEMBER, ["adventure", "nightlife", "beach"], 12000, 28000, "packed", ""),
    ("meera@tripcraft.ai", "Meera Iyer", Role.MEMBER, ["culture", "food", "shopping"], 8000, 22000, "balanced", "no pork"),
    ("partner@tripcraft.ai", "Sunrise Stays (Partner)", Role.PARTNER, [], 0, 0, "balanced", ""),
]


def main(reset: bool = False) -> None:
    if reset:
        Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        if db.scalar(select(User).limit(1)):
            print("Database already seeded (use --reset to rebuild).")
            return
        users = {}
        for email, name, role, interests, bmin, bmax, pace, diet in USERS:
            u = User(email=email, full_name=name, role=role, hashed_password=hash_password(settings.demo_password),
                     interests=interests, budget_min=bmin, budget_max=bmax, pace=pace, dietary=diet)
            db.add(u)
            users[email] = u
        db.flush()

        org = users["organiser@tripcraft.ai"]
        start = date.today() + timedelta(days=30)
        trip = Trip(name="Goa Getaway", destination="Goa", origin="Hyderabad", start_date=start,
                    end_date=start + timedelta(days=4), budget_total=120000, currency="INR",
                    description="Long weekend with friends: beaches, seafood and sunsets.", organiser_id=org.id)
        db.add(trip)
        db.flush()
        for email in ("organiser@tripcraft.ai", "riya@tripcraft.ai", "arjun@tripcraft.ai", "meera@tripcraft.ai"):
            db.add(TripMember(trip_id=trip.id, user_id=users[email].id, is_active=True, splits_expenses=True))
        db.add(TripMember(trip_id=trip.id, user_id=users["partner@tripcraft.ai"].id, is_active=True, splits_expenses=False))
        db.flush()

        group = [users[e].id for e in ("organiser@tripcraft.ai", "riya@tripcraft.ai", "arjun@tripcraft.ai", "meera@tripcraft.ai")]
        demo = [("Beach villa deposit", "stay", 24000.00, "organiser@tripcraft.ai"),
                ("Welcome dinner at Fisherman's Wharf", "food", 5333.33, "riya@tripcraft.ai"),
                ("Scooter rentals (3 days)", "transport", 4500.00, "arjun@tripcraft.ai"),
                ("Water sports package", "activities", 7999.99, "arjun@tripcraft.ai")]
        for desc, cat, amt, payer in demo:
            cents = to_cents(amt)
            exp = Expense(trip_id=trip.id, paid_by_id=users[payer].id, created_by_id=users[payer].id,
                          description=desc, category=cat, amount_cents=cents, split_type="equal",
                          expense_date=start - timedelta(days=5))
            exp.splits = [ExpenseSplit(user_id=u, share_cents=c) for u, c in zip(group, allocate(cents, [1] * len(group)))]
            db.add(exp)
        db.commit()
        print(f"Seeded {len(USERS)} users, 1 trip, {len(demo)} expenses -> {settings.database_url}")
        print(f"Login with any demo email and password: {settings.demo_password}")


if __name__ == "__main__":
    main(reset="--reset" in sys.argv)

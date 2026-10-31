"""Shared expense tracker with exact (integer-cent) split maths and debt simplification."""
from collections import defaultdict
from collections.abc import Sequence
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from fractions import Fraction

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..auth import get_current_user, get_trip_access
from ..database import get_db
from ..models import Expense, ExpenseSplit, Role, Trip, TripMember, User
from ..schemas import (BalanceOut, ExpenseCreate, ExpenseOut, ExpenseSummary, SettlementOut, SplitOut)

router = APIRouter(prefix="/trips/{trip_id}/expenses", tags=["expenses"])


# ------------------------------------------------------------------ money maths
def to_cents(amount: float | Decimal) -> int:
    return int((Decimal(str(amount)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def from_cents(cents: int) -> float:
    return round(cents / 100, 2)


def allocate(total_cents: int, weights: Sequence[float]) -> list[int]:
    """Split `total_cents` proportionally to `weights` using the largest-remainder method.

    Guarantees: shares are integers, sum exactly to total_cents, zero-weight parties get 0,
    and rounding leftovers go to the largest fractional remainders (ties -> earlier index).
    """
    fr = [Fraction(str(w)) for w in weights]
    total_w = sum(fr)
    if total_w <= 0:
        raise ValueError("Weights must sum to a positive number")
    quotas = [Fraction(total_cents) * w / total_w for w in fr]
    shares = [int(q) for q in quotas]
    leftover = total_cents - sum(shares)
    order = sorted(range(len(fr)), key=lambda i: (quotas[i] - shares[i], -i), reverse=True)
    for i in order[:leftover]:
        shares[i] += 1
    return shares


def simplify_debts(net: dict[int, int]) -> list[tuple[int, int, int]]:
    """Greedy minimum-cash-flow settlement. Returns (debtor_id, creditor_id, cents)."""
    debtors = sorted(([u, -n] for u, n in net.items() if n < 0), key=lambda x: -x[1])
    creditors = sorted(([u, n] for u, n in net.items() if n > 0), key=lambda x: -x[1])
    out, i, j = [], 0, 0
    while i < len(debtors) and j < len(creditors):
        pay = min(debtors[i][1], creditors[j][1])
        out.append((debtors[i][0], creditors[j][0], pay))
        debtors[i][1] -= pay
        creditors[j][1] -= pay
        if debtors[i][1] == 0:
            i += 1
        if creditors[j][1] == 0:
            j += 1
    return out


def eligible_member_ids(db: Session, trip_id: int) -> list[int]:
    """Active group members who share costs (partners excluded)."""
    return list(db.scalars(select(TripMember.user_id).where(
        TripMember.trip_id == trip_id, TripMember.is_active.is_(True),
        TripMember.splits_expenses.is_(True)).order_by(TripMember.id)).all())


def compute_splits(body: ExpenseCreate, amount_cents: int, eligible: list[int]) -> list[tuple[int, int]]:
    def bad(msg: str):
        raise HTTPException(422, msg)

    if body.split_type == "equal":
        ids = body.participants if body.participants else eligible
        if len(set(ids)) != len(ids):
            bad("Duplicate participants")
        if not ids or not set(ids) <= set(eligible):
            bad("Participants must be active group members of this trip")
        return list(zip(ids, allocate(amount_cents, [1] * len(ids))))

    if not body.splits:
        bad(f"'splits' is required for split_type '{body.split_type}'")
    ids = [s.user_id for s in body.splits]
    if len(set(ids)) != len(ids):
        bad("Duplicate user in splits")
    if not set(ids) <= set(eligible):
        bad("Every split user must be an active group member of this trip")
    values = [s.value for s in body.splits]

    if body.split_type == "exact":
        cents = [to_cents(v) for v in values]
        if sum(cents) != amount_cents:
            bad(f"Exact amounts add up to {from_cents(sum(cents))} but expense is {from_cents(amount_cents)}")
        return list(zip(ids, cents))
    if body.split_type == "percent" and abs(sum(values) - 100) > 0.01:
        bad(f"Percentages must add up to 100 (got {sum(values):g})")
    if sum(values) <= 0:
        bad("Split values must sum to a positive number")
    return list(zip(ids, allocate(amount_cents, values)))


def expense_to_out(e: Expense) -> ExpenseOut:
    return ExpenseOut(
        id=e.id, trip_id=e.trip_id, description=e.description, category=e.category,
        amount=from_cents(e.amount_cents), paid_by=e.paid_by_id, paid_by_name=e.payer.full_name,
        split_type=e.split_type, expense_date=e.expense_date, created_at=e.created_at,
        splits=[SplitOut(user_id=s.user_id, full_name=s.user.full_name, share=from_cents(s.share_cents))
                for s in e.splits])


def _expenses(db: Session, trip_id: int) -> list[Expense]:
    return list(db.scalars(
        select(Expense).where(Expense.trip_id == trip_id).order_by(Expense.expense_date.desc(), Expense.id.desc())
        .options(selectinload(Expense.splits).selectinload(ExpenseSplit.user), selectinload(Expense.payer))).all())


# ------------------------------------------------------------------ routes
@router.post("", response_model=ExpenseOut, status_code=201)
def add_expense(trip_id: int, body: ExpenseCreate, user: User = Depends(get_current_user),
                db: Session = Depends(get_db)):
    get_trip_access(db, trip_id, user, no_partners=True)
    eligible = eligible_member_ids(db, trip_id)
    if user.role != Role.ADMIN and user.id not in eligible:
        raise HTTPException(403, "Only active group members can add expenses")
    payer_id = body.paid_by or user.id
    if payer_id not in eligible:
        raise HTTPException(422, "Payer must be an active group member of this trip")

    amount_cents = to_cents(body.amount)
    if amount_cents <= 0:
        raise HTTPException(422, "Amount too small")
    splits = compute_splits(body, amount_cents, eligible)

    exp = Expense(trip_id=trip_id, paid_by_id=payer_id, created_by_id=user.id, description=body.description.strip(),
                  category=body.category, amount_cents=amount_cents, split_type=body.split_type,
                  expense_date=body.expense_date or date.today())
    exp.splits = [ExpenseSplit(user_id=uid, share_cents=c) for uid, c in splits]
    db.add(exp)
    db.commit()
    return expense_to_out(next(e for e in _expenses(db, trip_id) if e.id == exp.id))


@router.get("", response_model=list[ExpenseOut])
def list_expenses(trip_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    get_trip_access(db, trip_id, user, no_partners=True)
    return [expense_to_out(e) for e in _expenses(db, trip_id)]


@router.get("/summary", response_model=ExpenseSummary)
def expense_summary(trip_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    trip: Trip = get_trip_access(db, trip_id, user, no_partners=True)
    expenses = _expenses(db, trip_id)
    paid, owed, by_cat = defaultdict(int), defaultdict(int), defaultdict(int)
    for e in expenses:
        paid[e.paid_by_id] += e.amount_cents
        by_cat[e.category] += e.amount_cents
        for s in e.splits:
            owed[s.user_id] += s.share_cents

    names = {m.user_id: m.user.full_name for m in db.scalars(
        select(TripMember).where(TripMember.trip_id == trip_id).options(selectinload(TripMember.user))).all()}
    active = eligible_member_ids(db, trip_id)
    ids = list(dict.fromkeys(active + list(paid) + list(owed)))
    net = {u: paid[u] - owed[u] for u in ids}

    total = sum(e.amount_cents for e in expenses)
    budget_cents = to_cents(trip.budget_total)
    return ExpenseSummary(
        currency=trip.currency, total_spent=from_cents(total), budget_total=trip.budget_total,
        budget_remaining=from_cents(budget_cents - total),
        budget_used_pct=round(100 * total / budget_cents, 1) if budget_cents else 0.0,
        active_members=len(active), per_person_average=from_cents(total // len(active)) if active else 0.0,
        by_category={k: from_cents(v) for k, v in sorted(by_cat.items(), key=lambda kv: -kv[1])},
        balances=[BalanceOut(user_id=u, full_name=names.get(u, f"User {u}"), paid=from_cents(paid[u]),
                             owed=from_cents(owed[u]), net=from_cents(net[u])) for u in ids],
        settlements=[SettlementOut(from_user_id=d, from_name=names.get(d, str(d)), to_user_id=c,
                                   to_name=names.get(c, str(c)), amount=from_cents(a))
                     for d, c, a in simplify_debts(net)])


@router.delete("/{expense_id}", status_code=204)
def delete_expense(trip_id: int, expense_id: int, user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)):
    trip = get_trip_access(db, trip_id, user, no_partners=True)
    exp = db.get(Expense, expense_id)
    if exp is None or exp.trip_id != trip_id:
        raise HTTPException(404, "Expense not found")
    if user.role != Role.ADMIN and user.id not in (exp.created_by_id, exp.paid_by_id, trip.organiser_id):
        raise HTTPException(403, "Only the payer, creator or organiser can delete an expense")
    db.delete(exp)
    db.commit()

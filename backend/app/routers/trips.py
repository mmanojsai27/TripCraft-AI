"""Trip lifecycle, membership management and admin endpoints."""
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..auth import get_current_user, get_trip_access, require_roles
from ..database import get_db
from ..models import Expense, Role, Trip, TripMember, User
from ..schemas import (AdminUserUpdate, MemberAdd, MemberOut, MemberUpdate, TripCreate, TripOut,
                       TripUpdate, UserOut)

router = APIRouter(prefix="/trips", tags=["trips"])
admin_router = APIRouter(prefix="/admin", tags=["admin"])


def trip_to_out(trip: Trip) -> TripOut:
    return TripOut(
        id=trip.id, name=trip.name, destination=trip.destination, origin=trip.origin,
        start_date=trip.start_date, end_date=trip.end_date,
        days=(trip.end_date - trip.start_date).days + 1,
        budget_total=trip.budget_total, currency=trip.currency, status=trip.status,
        description=trip.description, organiser_id=trip.organiser_id,
        has_itinerary=bool(trip.itinerary_md), created_at=trip.created_at,
        members=[MemberOut(user_id=m.user_id, full_name=m.user.full_name, email=m.user.email,
                           role=m.user.role, is_active=m.is_active, splits_expenses=m.splits_expenses)
                 for m in trip.members])


def _load(db: Session, trip_id: int) -> Trip:
    return db.scalar(select(Trip).where(Trip.id == trip_id)
                     .options(selectinload(Trip.members).selectinload(TripMember.user)))


# ------------------------------------------------------------------ trips
@router.post("", response_model=TripOut, status_code=201)
def create_trip(body: TripCreate, user: User = Depends(require_roles(Role.ORGANISER, Role.ADMIN)),
                db: Session = Depends(get_db)):
    trip = Trip(**body.model_dump(), organiser_id=user.id)
    trip.members.append(TripMember(user_id=user.id, is_active=True, splits_expenses=True))
    db.add(trip)
    db.commit()
    return trip_to_out(_load(db, trip.id))


@router.get("", response_model=list[TripOut])
def list_trips(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = select(Trip).options(selectinload(Trip.members).selectinload(TripMember.user)).order_by(Trip.start_date.desc())
    if user.role != Role.ADMIN:
        q = q.where(Trip.id.in_(select(TripMember.trip_id).where(TripMember.user_id == user.id)))
    return [trip_to_out(t) for t in db.scalars(q).all()]


@router.get("/{trip_id}", response_model=TripOut)
def get_trip(trip_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    get_trip_access(db, trip_id, user)
    return trip_to_out(_load(db, trip_id))


@router.patch("/{trip_id}", response_model=TripOut)
def update_trip(trip_id: int, body: TripUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    trip = get_trip_access(db, trip_id, user, organiser_only=True)
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        if v is not None:
            setattr(trip, k, v)
    if trip.end_date < trip.start_date:
        raise HTTPException(422, "end_date must be on or after start_date")
    db.commit()
    return trip_to_out(_load(db, trip_id))


@router.delete("/{trip_id}", status_code=204)
def delete_trip(trip_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    trip = get_trip_access(db, trip_id, user, organiser_only=True)
    db.delete(trip)
    db.commit()


# ------------------------------------------------------------------ members
@router.get("/{trip_id}/members", response_model=list[MemberOut])
def list_members(trip_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    get_trip_access(db, trip_id, user)
    return trip_to_out(_load(db, trip_id)).members


@router.post("/{trip_id}/members", response_model=TripOut, status_code=201)
def add_member(trip_id: int, body: MemberAdd, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    trip = get_trip_access(db, trip_id, user, organiser_only=True)
    target = db.scalar(select(User).where(User.email == body.email.lower()))
    if target is None or not target.is_active:
        raise HTTPException(404, "No active user with that email. Ask them to register first.")
    if target.role == Role.ADMIN:
        raise HTTPException(422, "Admins cannot be added as trip members")
    if db.scalar(select(TripMember).where(TripMember.trip_id == trip.id, TripMember.user_id == target.id)):
        raise HTTPException(409, "User is already part of this trip")
    db.add(TripMember(trip_id=trip.id, user_id=target.id, is_active=True,
                      splits_expenses=target.role != Role.PARTNER))  # partners never share costs
    db.commit()
    return trip_to_out(_load(db, trip_id))


@router.patch("/{trip_id}/members/{user_id}", response_model=TripOut)
def set_member_active(trip_id: int, user_id: int, body: MemberUpdate,
                      user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    trip = get_trip_access(db, trip_id, user, organiser_only=True)
    if user_id == trip.organiser_id:
        raise HTTPException(422, "The organiser cannot be deactivated")
    m = db.scalar(select(TripMember).where(TripMember.trip_id == trip_id, TripMember.user_id == user_id))
    if m is None:
        raise HTTPException(404, "Member not found")
    m.is_active = body.is_active
    db.commit()
    return trip_to_out(_load(db, trip_id))


@router.delete("/{trip_id}/members/{user_id}", response_model=TripOut)
def remove_member(trip_id: int, user_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    trip = get_trip_access(db, trip_id, user, organiser_only=True)
    if user_id == trip.organiser_id:
        raise HTTPException(422, "The organiser cannot be removed")
    m = db.scalar(select(TripMember).where(TripMember.trip_id == trip_id, TripMember.user_id == user_id))
    if m is None:
        raise HTTPException(404, "Member not found")
    involved = db.scalar(select(func.count()).select_from(Expense).where(
        Expense.trip_id == trip_id, Expense.paid_by_id == user_id))
    if involved:
        raise HTTPException(409, "Member has paid expenses; deactivate instead of removing")
    db.delete(m)
    db.commit()
    return trip_to_out(_load(db, trip_id))


# ------------------------------------------------------------------ admin
@admin_router.get("/users", response_model=list[UserOut])
def admin_list_users(_: User = Depends(require_roles(Role.ADMIN)), db: Session = Depends(get_db)):
    return db.scalars(select(User).order_by(User.id)).all()


@admin_router.patch("/users/{user_id}", response_model=UserOut)
def admin_update_user(user_id: int, body: AdminUserUpdate, admin: User = Depends(require_roles(Role.ADMIN)),
                      db: Session = Depends(get_db)):
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(404, "User not found")
    if target.id == admin.id and (body.is_active is False or (body.role and body.role != Role.ADMIN)):
        raise HTTPException(422, "Admins cannot demote or deactivate themselves")
    if body.role is not None:
        target.role = body.role
    if body.is_active is not None:
        target.is_active = body.is_active
    db.commit()
    return target


@admin_router.get("/stats")
def admin_stats(_: User = Depends(require_roles(Role.ADMIN)), db: Session = Depends(get_db)):
    roles = Counter(r.value for r in db.scalars(select(User.role)).all())
    statuses = Counter(db.scalars(select(Trip.status)).all())
    spent = db.scalar(select(func.coalesce(func.sum(Expense.amount_cents), 0))) or 0
    return {
        "users": {"total": sum(roles.values()), "by_role": dict(roles)},
        "trips": {"total": sum(statuses.values()), "by_status": dict(statuses)},
        "expenses": {"count": db.scalar(select(func.count()).select_from(Expense)) or 0, "total_amount": spent / 100},
    }

"""Authentication (JWT) and Role-Based Access Control.

Permission matrix
-----------------
| Capability                              | Organiser | Member | Partner | Admin |
|-----------------------------------------|:---------:|:------:|:-------:|:-----:|
| Create trip / manage members / finalise |     Y     |        |         |   Y   |
| View trip + itinerary (if participant)  |     Y     |   Y    |    Y    |   Y   |
| Add & view shared expenses              |     Y     |   Y    |         |   Y   |
| Generate itinerary / weather adjust     |     Y     |        |         |   Y   |
| Packing list, recommender, estimator    |     Y     |   Y    |         |   Y   |
| Platform stats / user management        |           |        |         |   Y   |
"""
import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .database import get_db
from .models import Role, Trip, TripMember, User
from .schemas import PreferencesUpdate, Token, UserCreate, UserLogin, UserOut

settings = get_settings()
bearer = HTTPBearer(auto_error=False)
router = APIRouter(prefix="/auth", tags=["auth"])

_PBKDF2_ROUNDS = 240_000


# ------------------------------------------------------------------ passwords & tokens
def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _PBKDF2_ROUNDS)
    return f"pbkdf2_sha256${_PBKDF2_ROUNDS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, rounds, salt_hex, hash_hex = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(rounds))
        return hmac.compare_digest(dk.hex(), hash_hex)
    except (ValueError, TypeError):
        return False


def create_access_token(user: User) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": str(user.id), "role": user.role.value, "exp": exp}
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


# ------------------------------------------------------------------ dependencies
def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    unauthorized = HTTPException(
        status.HTTP_401_UNAUTHORIZED, "Not authenticated", headers={"WWW-Authenticate": "Bearer"})
    if creds is None:
        raise unauthorized
    try:
        payload = jwt.decode(creds.credentials, settings.secret_key, algorithms=[settings.algorithm])
        user = db.get(User, int(payload["sub"]))
    except (jwt.PyJWTError, KeyError, ValueError):
        raise unauthorized
    if user is None or not user.is_active:
        raise unauthorized
    return user


def require_roles(*roles: Role):
    """Dependency factory: `Depends(require_roles(Role.ORGANISER, Role.ADMIN))`."""
    allowed = set(roles)

    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Role '{user.role.value}' is not permitted. Required: {sorted(r.value for r in allowed)}")
        return user

    return checker


def get_trip_access(
    db: Session, trip_id: int, user: User, *, organiser_only: bool = False, no_partners: bool = False
) -> Trip:
    """Load a trip enforcing object-level permissions on top of role checks."""
    trip = db.get(Trip, trip_id)
    if trip is None:
        raise HTTPException(404, "Trip not found")
    if user.role == Role.ADMIN:
        return trip
    if organiser_only:
        if trip.organiser_id != user.id:
            raise HTTPException(403, "Only the trip organiser can do this")
        return trip
    membership = db.scalar(select(TripMember).where(TripMember.trip_id == trip_id, TripMember.user_id == user.id))
    if membership is None and trip.organiser_id != user.id:
        raise HTTPException(403, "You are not part of this trip")
    if no_partners and user.role == Role.PARTNER:
        raise HTTPException(403, "Travel partners cannot access this resource")
    return trip


# ------------------------------------------------------------------ routes
@router.post("/register", response_model=Token, status_code=201)
def register(body: UserCreate, db: Session = Depends(get_db)):
    if body.role == Role.ADMIN:
        raise HTTPException(403, "Admin accounts cannot be self-registered")
    if db.scalar(select(User).where(User.email == body.email.lower())):
        raise HTTPException(409, "Email already registered")
    user = User(
        email=body.email.lower(), full_name=body.full_name.strip(), hashed_password=hash_password(body.password),
        role=body.role, interests=[i.strip().lower() for i in body.interests if i.strip()],
        budget_min=body.budget_min, budget_max=body.budget_max, pace=body.pace, dietary=body.dietary)
    db.add(user)
    db.commit()
    return Token(access_token=create_access_token(user), user=UserOut.model_validate(user))


@router.post("/login", response_model=Token)
def login(body: UserLogin, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(401, "Invalid email or password")
    if not user.is_active:
        raise HTTPException(403, "Account is deactivated")
    return Token(access_token=create_access_token(user), user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.put("/me/preferences", response_model=UserOut)
def update_preferences(body: PreferencesUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    data = body.model_dump(exclude_unset=True)
    if "interests" in data and data["interests"] is not None:
        data["interests"] = [i.strip().lower() for i in data["interests"] if i.strip()]
    for k, v in data.items():
        if v is not None:
            setattr(user, k, v)
    db.add(user)
    db.commit()
    return user

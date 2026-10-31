"""TripCraft AI - FastAPI application entrypoint.  Run: uvicorn app.main:app --reload"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import auth, models  # noqa: F401  (models import registers tables on Base.metadata)
from .config import get_settings
from .database import Base, engine
from .routers import ai_features, expenses, trips

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    # Warm the ML model so the first estimate request is instant
    ai_features.get_cost_model()
    yield


app = FastAPI(
    title="TripCraft AI",
    version="1.0.0",
    description="Group trip planning with RBAC, shared expenses, ML recommendations and GenAI itineraries.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"])

API = "/api"
app.include_router(auth.router, prefix=API)
app.include_router(trips.router, prefix=API)
app.include_router(trips.admin_router, prefix=API)
app.include_router(expenses.router, prefix=API)
app.include_router(ai_features.router, prefix=API)


@app.get("/api/health", tags=["meta"])
def health():
    return {"status": "ok", "app": settings.app_name, "genai_provider": settings.active_llm}


@app.get("/", include_in_schema=False)
def root():
    return {"app": settings.app_name, "docs": "/docs", "health": "/api/health"}

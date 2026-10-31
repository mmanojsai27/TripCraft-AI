"""Central configuration. All values come from environment variables (or backend/.env)."""
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def _csv(name: str, default: str) -> list[str]:
    return [v.strip() for v in os.getenv(name, default).split(",") if v.strip()]


@dataclass(frozen=True)
class Settings:
    app_name: str
    secret_key: str
    algorithm: str
    access_token_expire_minutes: int
    database_url: str
    cors_origins: list[str]
    currency: str
    llm_provider: str
    openai_api_key: str
    openai_base_url: str
    openai_model: str
    gemini_api_key: str
    gemini_model: str
    llm_timeout: float
    demo_password: str

    @property
    def active_llm(self) -> str:
        """Resolve which GenAI provider is usable: 'openai', 'gemini' or 'none'."""
        p = self.llm_provider.lower()
        if p == "openai" and self.openai_api_key:
            return "openai"
        if p == "gemini" and self.gemini_api_key:
            return "gemini"
        if p == "auto":
            if self.openai_api_key:
                return "openai"
            if self.gemini_api_key:
                return "gemini"
        return "none"


@lru_cache
def get_settings() -> Settings:
    return Settings(
        app_name="TripCraft AI",
        secret_key=os.getenv("SECRET_KEY", "dev-only-secret-change-me-please-32-bytes-min"),
        algorithm="HS256",
        access_token_expire_minutes=int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "720")),
        database_url=os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'tripcraft.db'}"),
        cors_origins=_csv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"),
        currency=os.getenv("CURRENCY", "INR"),
        llm_provider=os.getenv("LLM_PROVIDER", "auto"),
        openai_api_key=os.getenv("OPENAI_API_KEY", ""),
        openai_base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/"),
        openai_model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        gemini_api_key=os.getenv("GEMINI_API_KEY", ""),
        gemini_model=os.getenv("GEMINI_MODEL", "gemini-2.0-flash"),
        llm_timeout=float(os.getenv("LLM_TIMEOUT_SECONDS", "60")),
        demo_password=os.getenv("DEMO_PASSWORD", "TripCraft@123"),
    )

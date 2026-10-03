from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _csv(value: str) -> list[str]:
    return [v.strip() for v in (value or "").split(",") if v.strip()]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "dev"
    cors_origins: str = "http://localhost:3000"
    jwt_secret: str = ""
    auth_required: bool = True
    allowed_roles: str = "owner,admin"
    service_api_keys: str = ""
    rate_limit_per_min: int = Field(default=30, ge=0, le=100_000)
    redis_url: str = ""

    # Odoo
    odoo_url: str = ""
    odoo_db: str = ""
    odoo_username: str = ""
    odoo_api_key: str = ""
    odoo_allow_client_credentials: bool = False
    odoo_allowed_hosts: str = ""
    odoo_allowed_models: str = ""
    odoo_blocked_models: str = ""
    odoo_blocked_fields: str = ""
    odoo_timeout_s: float = Field(default=20.0, gt=0, le=300)
    odoo_max_concurrency_per_host: int = Field(default=6, ge=1, le=100)
    odoo_queue_timeout_s: float = Field(default=2.0, gt=0, le=60)
    max_rows: int = Field(default=200, ge=1, le=1000)
    cache_ttl_schema_s: int = 3600
    cache_ttl_data_s: int = 60

    # LLM
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    gemini_api_key: str = ""
    xai_api_key: str = ""
    groq_api_key: str = ""
    provider_priority: str = "anthropic,openai,xai,groq,gemini"
    model_catalog_file: str = ""
    timezone: str = "UTC"            # business timezone for "today / this month" (e.g. Asia/Karachi)
    auto_min_tier: str = "smart"     # accuracy floor for tier=auto (fast | smart | deep)
    metrics_file: str = ""           # JSON with your own KPI definitions (see README)
    audit_log_file: str = ""         # JSONL of every question / tool call / answer (for accuracy reviews)
    max_tool_hops: int = Field(default=8, ge=1, le=20)
    max_output_tokens: int = Field(default=4096, ge=1, le=32_000)
    tool_timeout_s: float = Field(default=45.0, gt=0, le=300)
    max_chat_concurrency: int = Field(default=32, ge=1, le=1000)
    chat_queue_timeout_s: float = Field(default=0.05, gt=0, le=5)

    @property
    def cors_list(self) -> list[str]:
        return _csv(self.cors_origins)

    @property
    def roles(self) -> set[str]:
        return set(_csv(self.allowed_roles))

    @property
    def api_keys(self) -> set[str]:
        return set(_csv(self.service_api_keys))

    @property
    def allowed_hosts(self) -> list[str]:
        return _csv(self.odoo_allowed_hosts)

    @property
    def priority(self) -> list[str]:
        return _csv(self.provider_priority)

    def provider_key(self, provider: str) -> str:
        return {
            "anthropic": self.anthropic_api_key,
            "openai": self.openai_api_key,
            "gemini": self.gemini_api_key,
            "xai": self.xai_api_key,
            "groq": self.groq_api_key,
        }.get(provider, "")


@lru_cache
def get_settings() -> Settings:
    return Settings()

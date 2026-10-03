from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=8000)


class OdooCreds(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    url: str = Field(min_length=1, max_length=2048)
    db: str = Field(min_length=1, max_length=256)
    username: str = Field(min_length=1, max_length=320)
    api_key: str = Field(alias="apiKey", min_length=1, max_length=2048)


class ChatRequest(BaseModel):
    messages: list[Message] = Field(min_length=1, max_length=40)
    model: str | None = Field(default=None, max_length=120)
    tier: Literal["auto", "fast", "smart", "deep"] = "auto"
    stream: bool = True
    odoo: OdooCreds | None = None  # only honoured if ODOO_ALLOW_CLIENT_CREDENTIALS=true

    @model_validator(mode="after")
    def check_total_message_size(self):
        if sum(len(message.content) for message in self.messages) > 32_000:
            raise ValueError("Combined message content must not exceed 32000 characters.")
        return self


class Feedback(BaseModel):
    request_id: str = Field(min_length=1, max_length=64)
    rating: Literal["up", "down"]
    comment: str = Field(default="", max_length=1000)
    expected: str = Field(default="", max_length=1000)  # what the right answer should have been

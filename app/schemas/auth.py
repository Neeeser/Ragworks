from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field
from uuid import UUID

from app.schemas.base import DateTimeConfigMixin


class UserBase(DateTimeConfigMixin, BaseModel):
    model_config = ConfigDict(**DateTimeConfigMixin.model_config, from_attributes=True)

    email: EmailStr
    full_name: Optional[str] = None


class UserCreate(UserBase):
    password: str = Field(min_length=8)


class UserRead(UserBase):
    id: UUID
    is_active: bool
    created_at: datetime
    updated_at: datetime


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LoginRequest(BaseModel):
    email: EmailStr
    password: str

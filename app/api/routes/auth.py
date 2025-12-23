"""Authentication API routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestFormStrict
from sqlmodel import Session

from app.api.dependencies import get_current_user, get_session
from app.core.security import hash_password, verify_password, create_access_token
from app.db import models
from app.db.repositories import UserRepository
from app.schemas.auth import Token, UserCreate, UserRead
from app.services.pipelines import PipelineService

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def register_user(payload: UserCreate, session: Session = Depends(get_session)) -> UserRead:
    """Register a new user account."""
    repo = UserRepository(session)
    existing = repo.get_by_email(payload.email)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered.",
        )
    user = models.User(
        email=payload.email,
        full_name=payload.full_name,
        hashed_password=hash_password(payload.password),
    )
    repo.add(user)
    PipelineService(session).ensure_default_pipelines(user)
    session.commit()
    session.refresh(user)
    return UserRead.model_validate(user)


@router.post("/token", response_model=Token)
def login_for_access_token(
    form_data: OAuth2PasswordRequestFormStrict = Depends(),
    session: Session = Depends(get_session),
) -> Token:
    """Authenticate a user and return an access token."""
    repo = UserRepository(session)
    user = repo.get_by_email(form_data.username)
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )
    access_token = create_access_token(subject=str(user.id))
    return Token(access_token=access_token)


@router.get("/me", response_model=UserRead)
def read_current_user(current_user: models.User = Depends(get_current_user)) -> UserRead:
    """Return the authenticated user's profile."""
    return UserRead.model_validate(current_user)

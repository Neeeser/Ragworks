from __future__ import annotations

from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlmodel import Session

from app.api.config import get_settings
from app.core.security import create_access_token
from app.db.models import User
from app.db.repositories import UserRepository
from app.db.session import get_session

settings = get_settings()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")


def get_db_session() -> Session:
    yield from get_session()


def get_user_repository(session: Session = Depends(get_session)) -> UserRepository:
    return UserRepository(session)


def get_current_user(
    token: str = Depends(oauth2_scheme),
    session: Session = Depends(get_session),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise credentials_exception from exc

    subject = payload.get("sub")
    if subject is None:
        raise credentials_exception

    repo = UserRepository(session)
    try:
        subject_uuid = UUID(str(subject))
    except ValueError as exc:
        raise credentials_exception from exc

    user = repo.get(subject_uuid)
    if user is None or not user.is_active:
        raise credentials_exception
    return user


def issue_access_token(user: User) -> str:
    return create_access_token(str(user.id))

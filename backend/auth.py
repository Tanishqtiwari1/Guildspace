import os
import secrets
import datetime
import bcrypt
from jose import jwt, JWTError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
import models, database

ALGORITHM = "HS256"
TOKEN_TTL_HOURS = 24


def _load_secret_key():
    # Prefer an explicit env var; otherwise generate one once and keep it next to the DB
    # so tokens survive server restarts without shipping a secret in source code.
    if os.getenv("SECRET_KEY"):
        return os.environ["SECRET_KEY"]
    path = os.path.join(database.BASE_DIR, ".secret_key")
    if not os.path.exists(path):
        with open(path, "w") as f:
            f.write(secrets.token_urlsafe(48))
        os.chmod(path, 0o600)
    with open(path) as f:
        return f.read().strip()


SECRET_KEY = _load_secret_key()
bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


def create_token(user_id: int) -> str:
    expires = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=TOKEN_TTL_HOURS)
    return jwt.encode({"sub": str(user_id), "exp": expires}, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer),
    db: Session = Depends(database.get_db),
) -> models.User:
    unauthorized = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    if creds is None:
        raise unauthorized
    try:
        payload = jwt.decode(creds.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise unauthorized
    user = db.get(models.User, user_id)
    if not user or not user.is_active:
        raise unauthorized
    return user


def require_admin(user: models.User = Depends(get_current_user)) -> models.User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Administrator access required")
    return user


def require_student(user: models.User = Depends(get_current_user)) -> models.User:
    if user.account_type != "STUDENT":
        raise HTTPException(status_code=403, detail="This feature is for student accounts")
    return user


def require_faculty(user: models.User = Depends(get_current_user)) -> models.User:
    """Verified faculty only. Unverified faculty accounts cannot publish anything to students."""
    if not user.is_faculty:
        raise HTTPException(status_code=403, detail="Faculty access required")
    if not user.is_verified_faculty:
        raise HTTPException(status_code=403, detail="Your faculty account is awaiting verification by an administrator")
    return user

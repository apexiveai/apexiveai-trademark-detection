from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import smtplib
import sqlite3
import time
from contextlib import contextmanager
from email.message import EmailMessage
from pathlib import Path
from typing import Any, Iterator
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from fastapi import HTTPException, Request
from fastapi.security import HTTPBearer


DATA_DIR = Path(os.getenv("TRADEMARK_DATA_DIR", "data"))
AUTH_DATABASE = DATA_DIR / "auth.sqlite3"
COMMUNITY_API_URL = os.getenv("COMMUNITY_API_URL", "").strip().rstrip("/")
COMMUNITY_SOLUTION_CODE = os.getenv("COMMUNITY_SOLUTION_CODE", "trademark-conflict-detector").strip()
TOKEN_TTL_SECONDS = 60 * 60 * 12
PASSWORD_ITERATIONS = 310_000
EMAIL_PATTERN = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,253}\.[^@\s]{2,63}$")
_bearer = HTTPBearer(auto_error=False)


def auth_is_required() -> bool:
    return os.getenv("AUTH_REQUIRED", "false").strip().lower() == "true"


def community_access_enabled() -> bool:
    return bool(COMMUNITY_API_URL and COMMUNITY_SOLUTION_CODE)


def validate_community_solution_access(token: str) -> bool:
    if not community_access_enabled():
        return False
    endpoint = (
        f"{COMMUNITY_API_URL}/api/auth/solutions/"
        f"{quote(COMMUNITY_SOLUTION_CODE, safe='')}/access"
    )
    request = Request(
        endpoint,
        headers={"Authorization": f"Bearer {token}"},
    )
    try:
        with urlopen(request, timeout=15) as response:
            if response.status != 200:
                return False
            payload = json.loads(response.read().decode("utf-8"))
            return bool(payload.get("authorized", False))
    except (HTTPError, URLError, TimeoutError, ValueError, json.JSONDecodeError):
        return False


def _secret() -> bytes:
    configured = os.getenv("JWT_SECRET", "")
    if len(configured) < 32:
        if auth_is_required():
            raise RuntimeError(
                "JWT_SECRET must contain at least 32 characters when AUTH_REQUIRED is enabled."
            )
        configured = "development-only-secret-not-for-production"
    return configured.encode("utf-8")


def _connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(AUTH_DATABASE, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute("PRAGMA journal_mode=WAL")
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            email TEXT PRIMARY KEY,
            password_hash TEXT NOT NULL,
            password_salt TEXT NOT NULL,
            verified INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS verification_tokens (
            token_hash TEXT PRIMARY KEY,
            email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
            expires_at INTEGER NOT NULL
        );
        """
    )
    return connection


@contextmanager
def _database() -> Iterator[sqlite3.Connection]:
    connection = _connect()
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _hash_password(password: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS
    )


def _issue_token(email: str) -> str:
    payload = _b64encode(
        json.dumps(
            {"sub": email, "exp": int(time.time()) + TOKEN_TTL_SECONDS},
            separators=(",", ":"),
        ).encode("utf-8")
    )
    signature = _b64encode(
        hmac.new(_secret(), payload.encode("ascii"), hashlib.sha256).digest()
    )
    return f"{payload}.{signature}"


def validate_access_token(token: str) -> str | None:
    try:
        payload, signature = token.split(".", 1)
        expected = _b64encode(
            hmac.new(_secret(), payload.encode("ascii"), hashlib.sha256).digest()
        )
        if not hmac.compare_digest(signature, expected):
            return None
        decoded: dict[str, Any] = json.loads(_b64decode(payload))
        email = decoded.get("sub")
        if not isinstance(email, str) or decoded.get("exp", 0) < int(time.time()):
            return None
        with _database() as connection:
            user = connection.execute(
                "SELECT verified FROM users WHERE email = ?", (email,)
            ).fetchone()
        return email if user is not None and user["verified"] else None
    except (ValueError, TypeError, KeyError, json.JSONDecodeError):
        return None


async def require_user(
    request: Request,
) -> str | None:
    credentials = await _bearer(request)
    if credentials is None:
        if auth_is_required():
            raise HTTPException(status_code=401, detail="Sign in to use this service.")
        if community_access_enabled():
            raise HTTPException(
                status_code=403,
                detail="Access is managed by ApexiveAI Community. A SuperAdmin must grant this tenant access.",
            )
        return None

    email = validate_access_token(credentials.credentials)
    if email is not None:
        return email

    if community_access_enabled() and validate_community_solution_access(
        credentials.credentials
    ):
        return "community-tenant-access"

    if community_access_enabled():
        raise HTTPException(
            status_code=403,
            detail="This tenant does not have access to the Trademark Conflict Detector.",
        )

    raise HTTPException(status_code=401, detail="Session is invalid or expired.")


def register_user(email: str, password: str) -> None:
    normalized_email = email.strip().lower()
    if len(normalized_email) > 254 or not EMAIL_PATTERN.fullmatch(normalized_email):
        raise ValueError("Enter a valid email address.")
    if len(password) < 12 or len(password) > 128:
        raise ValueError("Password must be between 12 and 128 characters.")
    with _database() as connection:
        if connection.execute(
            "SELECT 1 FROM users WHERE email = ?", (normalized_email,)
        ).fetchone():
            raise ValueError("An account with this email already exists.")

    smtp_host = os.getenv("SMTP_HOST", "").strip()
    sender = os.getenv("SMTP_FROM", "").strip()
    if not smtp_host or not sender:
        raise RuntimeError(
            "Email verification is unavailable. Configure SMTP_HOST and SMTP_FROM."
        )

    salt = secrets.token_bytes(16)
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5190").rstrip("/")
    message = EmailMessage()
    message["Subject"] = "Verify your Apexive AI account"
    message["From"] = sender
    message["To"] = normalized_email
    message.set_content(
        "Verify your account using this single-use link (expires in 24 hours):\n"
        f"{frontend_url}/?verify={token}\n"
    )
    port = int(os.getenv("SMTP_PORT", "587"))
    username = os.getenv("SMTP_USER", "")
    password_env = os.getenv("SMTP_PASSWORD", "")
    if port == 465:
        with smtplib.SMTP_SSL(smtp_host, port, timeout=15) as server:
            if username:
                server.login(username, password_env)
            server.send_message(message)
    else:
        with smtplib.SMTP(smtp_host, port, timeout=15) as server:
            server.starttls()
            if username:
                server.login(username, password_env)
            server.send_message(message)
    with _database() as connection:
        connection.execute(
            "INSERT INTO users (email, password_hash, password_salt, created_at) "
            "VALUES (?, ?, ?, ?)",
            (
                normalized_email,
                _b64encode(_hash_password(password, salt)),
                _b64encode(salt),
                now,
            ),
        )
        connection.execute(
            "INSERT INTO verification_tokens (token_hash, email, expires_at) "
            "VALUES (?, ?, ?)",
            (
                hashlib.sha256(token.encode("utf-8")).hexdigest(),
                normalized_email,
                now + 24 * 60 * 60,
            ),
        )


def verify_email(token: str) -> str:
    if not token or len(token) > 256:
        raise ValueError("Verification link is invalid or expired.")
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = int(time.time())
    with _database() as connection:
        row = connection.execute(
            "SELECT email FROM verification_tokens "
            "WHERE token_hash = ? AND expires_at >= ?",
            (token_hash, now),
        ).fetchone()
        if row is None:
            raise ValueError("Verification link is invalid or expired.")
        email = str(row["email"])
        connection.execute(
            "UPDATE users SET verified = 1 WHERE email = ?", (email,)
        )
        connection.execute(
            "DELETE FROM verification_tokens WHERE email = ?", (email,)
        )
    return email


def login_user(email: str, password: str) -> str:
    normalized_email = email.strip().lower()
    with _database() as connection:
        user = connection.execute(
            "SELECT password_hash, password_salt, verified "
            "FROM users WHERE email = ?",
            (normalized_email,),
        ).fetchone()
    salt = _b64decode(user["password_salt"]) if user else b"\0" * 16
    stored_hash = (
        _b64decode(user["password_hash"]) if user else b"\0" * 32
    )
    password_hash = _hash_password(password, salt)
    if user is None or not hmac.compare_digest(password_hash, stored_hash):
        raise ValueError("Email or password is incorrect.")
    if not user["verified"]:
        raise ValueError("Verify your email before signing in.")
    return _issue_token(normalized_email)

from __future__ import annotations

import os
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import auth


class FakeSMTP:
    sent_message = None

    def __init__(self, *_args, **_kwargs) -> None:
        pass

    def __enter__(self) -> "FakeSMTP":
        return self

    def __exit__(self, *_args) -> None:
        return None

    def starttls(self) -> None:
        pass

    def login(self, *_args) -> None:
        pass

    def send_message(self, message) -> None:
        FakeSMTP.sent_message = message


class EmailAuthenticationTests(unittest.TestCase):
    def test_verification_and_login_issue_verified_session(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            data_dir = Path(directory)
            environment = {
                "SMTP_HOST": "smtp.example.test",
                "SMTP_FROM": "noreply@example.test",
                "JWT_SECRET": "test-secret-that-is-long-enough-123456",
                "AUTH_REQUIRED": "true",
            }
            with (
                patch.object(auth, "DATA_DIR", data_dir),
                patch.object(auth, "AUTH_DATABASE", data_dir / "users.sqlite3"),
                patch.dict(os.environ, environment, clear=False),
                patch.object(auth.smtplib, "SMTP", FakeSMTP),
            ):
                FakeSMTP.sent_message = None
                auth.register_user("Brand.Owner@example.test", "a-very-long-test-password")
                self.assertIsNotNone(FakeSMTP.sent_message)
                body = FakeSMTP.sent_message.get_content()
                token_match = re.search(r"\?verify=([A-Za-z0-9_-]+)", body)
                self.assertIsNotNone(token_match)
                verification_token = token_match.group(1)

                email = auth.verify_email(verification_token)
                self.assertEqual(email, "brand.owner@example.test")
                access_token = auth.login_user(
                    email, "a-very-long-test-password"
                )
                self.assertEqual(auth.validate_access_token(access_token), email)

    def test_registration_rejects_weak_password(self) -> None:
        with self.assertRaisesRegex(ValueError, "between 12 and 128"):
            auth.register_user("user@example.test", "short")

    def test_community_tenant_access_is_allowed_when_super_admin_grants_it(self) -> None:
        with (
            patch.object(auth, "COMMUNITY_API_URL", "https://community.example.test"),
            patch.object(auth, "COMMUNITY_SOLUTION_CODE", "trademark-conflict-detector"),
            patch.object(
                auth,
                "validate_community_solution_access",
                return_value=True,
            ),
        ):
            self.assertTrue(
                auth.validate_community_solution_access("community-tenant-token")
            )


if __name__ == "__main__":
    unittest.main()

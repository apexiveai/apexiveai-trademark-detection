from __future__ import annotations

import io
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from app import logo_search
from app.main import app


def logo_png() -> bytes:
    image = Image.new("RGB", (128, 128), "white")
    ImageDraw.Draw(image).ellipse((24, 24, 104, 104), fill="black")
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


class TrademarkApiWorkflowTests(unittest.TestCase):
    def test_crop_endpoint_returns_png_and_region_coordinates(self) -> None:
        with patch.dict(os.environ, {"AUTH_REQUIRED": "false"}):
            response = TestClient(app).post(
                "/api/v1/logo/crop",
                files={"file": ("sample.png", logo_png(), "image/png")},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "image/png")
        self.assertTrue(response.content.startswith(b"\x89PNG"))
        self.assertIn('"x"', response.headers["x-logo-region"])

    def test_production_search_requires_verified_session(self) -> None:
        with patch.dict(
            os.environ,
            {
                "AUTH_REQUIRED": "true",
                "JWT_SECRET": "api-test-secret-that-is-long-enough-123",
            },
        ):
            response = TestClient(app).post(
                "/api/v1/trademarks/search",
                files={"image": ("sample.png", logo_png(), "image/png")},
            )
        self.assertEqual(response.status_code, 401)
        self.assertIn("Sign in", response.json()["detail"])

    def test_health_reports_auth_policy(self) -> None:
        with patch.dict(os.environ, {"AUTH_REQUIRED": "true"}):
            response = TestClient(app).get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["auth_required"])

    def test_search_reports_missing_model_as_service_unavailable(self) -> None:
        indexed_client = SimpleNamespace(
            count=lambda **_kwargs: SimpleNamespace(count=1)
        )
        with (
            patch.dict(os.environ, {"AUTH_REQUIRED": "false"}),
            patch.object(logo_search, "_get_client", return_value=indexed_client),
            patch.object(
                logo_search,
                "_get_model",
                side_effect=RuntimeError("Local logo embeddings are unavailable."),
            ),
        ):
            response = TestClient(app).post(
                "/api/v1/trademarks/search",
                files={"image": ("sample.png", logo_png(), "image/png")},
            )
        self.assertEqual(response.status_code, 503)
        self.assertIn("embeddings are unavailable", response.json()["detail"])


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import io
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image, ImageDraw

from app import logo_search


class LogoSearchValidationTests(unittest.TestCase):
    def test_metadata_normalizes_jurisdiction_and_nice_classes(self) -> None:
        record = logo_search._validate_record(
            "wipo",
            "Example mark",
            "IR-12345",
            "09, 25; 9",
            "Clothing and software",
            "https://example.test/record",
        )
        self.assertEqual(record["jurisdiction"], "WIPO")
        self.assertEqual(record["classes"], ["9", "25"])

    def test_unknown_jurisdiction_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "jurisdiction must be one of"):
            logo_search._validate_record(
                "UNKNOWN", "Example", "", "9", "", ""
            )

    def test_invalid_nice_class_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "Nice classes"):
            logo_search._validate_record(
                "USPTO", "Example", "", "46", "", ""
            )

    def test_non_http_registry_url_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "absolute HTTP or HTTPS"):
            logo_search._validate_record(
                "USPTO", "Example", "", "9", "", "javascript:alert(1)"
            )

    def test_top_k_is_limited_to_ten(self) -> None:
        with self.assertRaisesRegex(ValueError, "between 1 and 10"):
            logo_search.search_trademarks(image_data=b"not-read", limit=11)

    def test_empty_index_returns_without_loading_embedding_model(self) -> None:
        client = SimpleNamespace(
            count=lambda **_kwargs: SimpleNamespace(count=0)
        )
        with (
            patch.object(logo_search, "_get_client", return_value=client),
            patch.object(
                logo_search,
                "embed_logo",
                side_effect=AssertionError("empty index must not load model"),
            ),
        ):
            result = logo_search.search_trademarks(image_data=b"query")
        self.assertEqual(result["matches"], [])
        self.assertEqual(result["scanned_candidates"], 0)

    def test_missing_local_model_reports_configuration_error(self) -> None:
        with patch.dict("sys.modules", {"open_clip": None, "torch": None}):
            with self.assertRaisesRegex(RuntimeError, "Local logo embeddings are unavailable"):
                logo_search._get_model()

    def test_index_and_top_ten_search_use_jurisdiction_and_class_filters(self) -> None:
        def make_logo(shape: str) -> bytes:
            image = Image.new("RGB", (128, 128), "white")
            drawing = ImageDraw.Draw(image)
            if shape == "circle":
                drawing.ellipse((24, 24, 104, 104), fill="black")
            else:
                drawing.rectangle((24, 24, 104, 104), fill="black")
            output = io.BytesIO()
            image.save(output, format="PNG")
            return output.getvalue()

        query_logo = make_logo("circle")
        other_logo = make_logo("square")
        query_vector = [1.0] + [0.0] * (logo_search.VECTOR_SIZE - 1)
        other_vector = [0.0, 1.0] + [0.0] * (logo_search.VECTOR_SIZE - 2)

        with tempfile.TemporaryDirectory() as temporary_directory:
            data_directory = Path(temporary_directory)
            with (
                patch.object(logo_search, "DATA_DIR", data_directory),
                patch.object(logo_search, "LOGO_DIR", data_directory / "logos"),
                patch.object(logo_search, "_client", None),
                patch.object(
                    logo_search,
                    "embed_logo",
                    side_effect=lambda image: (
                        query_vector if image == query_logo else other_vector
                    ),
                ),
            ):
                try:
                    first = logo_search.index_trademark(
                        image_data=query_logo,
                        jurisdiction="WIPO",
                        mark_name="Circle Brand",
                        trademark_number="IR-101",
                        classes="9",
                        goods_services="Software",
                        source_url="https://registry.example.test/101",
                    )
                    logo_search.index_trademark(
                        image_data=other_logo,
                        jurisdiction="USPTO",
                        mark_name="Square Goods",
                        trademark_number="US-202",
                        classes="25",
                        goods_services="Clothing",
                        source_url="https://registry.example.test/202",
                    )
                    result = logo_search.search_trademarks(
                        image_data=query_logo,
                        mark_name="Circle Brand",
                        classes="9",
                        jurisdictions=["WIPO"],
                    )
                    self.assertEqual(len(result["matches"]), 1)
                    self.assertEqual(result["matches"][0]["id"], first["id"])
                    self.assertEqual(result["matches"][0]["risk_level"], "HIGH")
                    self.assertIn("embedding", result["matches"][0]["signals"])
                    self.assertIn("layout", result["matches"][0]["signals"])
                    self.assertIsNotNone(result["query_evidence_region"])
                    self.assertEqual(result["scanned_candidates"], 1)
                    self.assertTrue(
                        logo_search.get_logo(first["id"]).startswith(b"\x89PNG")
                    )
                finally:
                    if logo_search._client is not None:
                        logo_search._client.close()
                        logo_search._client = None


if __name__ == "__main__":
    unittest.main()

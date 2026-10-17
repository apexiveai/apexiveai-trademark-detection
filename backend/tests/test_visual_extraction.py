import asyncio
import io
import unittest

import pymupdf
from openpyxl import Workbook
from openpyxl.drawing.image import Image as SpreadsheetImage
from PIL import Image, ImageDraw
from starlette.datastructures import UploadFile

from app.main import analyze_file, compare_files, compare_image_collections


def make_logo_png(shape: str = "circle") -> bytes:
    image = Image.new("RGB", (256, 256), "white")
    drawing = ImageDraw.Draw(image)

    if shape == "circle":
        drawing.ellipse((48, 48, 208, 208), fill="black")
        drawing.ellipse((88, 88, 168, 168), fill="white")
    else:
        drawing.rectangle((48, 48, 208, 208), fill="black")
        drawing.rectangle((88, 88, 168, 168), fill="white")

    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def make_pdf(document_text: str) -> bytes:
    document = pymupdf.open()
    page = document.new_page(width=512, height=512)
    page.draw_circle((256, 256), 80, color=None, fill=(0, 0, 0))
    page.draw_circle((256, 256), 40, color=None, fill=(1, 1, 1))
    page.insert_text((24, 32), document_text, fontsize=12)
    output = document.tobytes()
    document.close()
    return output


def make_xlsx(document_text: str, logo: bytes) -> bytes:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet["A1"] = document_text
    worksheet.add_image(SpreadsheetImage(io.BytesIO(logo)), "C3")
    output = io.BytesIO()
    workbook.save(output)
    workbook.close()
    return output.getvalue()


def get_images(filename: str, data: bytes) -> list[bytes]:
    return analyze_file(filename, data)["images"]


class VisualExtractionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.logo_png = make_logo_png()
        cls.pdf_reference = make_pdf("Reference contract A")
        cls.pdf_different_text = make_pdf("Unrelated document B")
        cls.xlsx_reference = make_xlsx("Reference contract A", cls.logo_png)
        cls.xlsx_different_text = make_xlsx("Unrelated document B", cls.logo_png)
        cls.pdf_images = get_images("reference.pdf", cls.pdf_reference)
        cls.pdf_other_text_images = get_images(
            "comparison.pdf", cls.pdf_different_text
        )
        cls.xlsx_images = get_images("reference.xlsx", cls.xlsx_reference)
        cls.xlsx_other_text_images = get_images(
            "comparison.xlsx", cls.xlsx_different_text
        )

    def test_pdf_vector_page_is_rendered_for_logo_comparison(self) -> None:
        self.assertTrue(self.pdf_images)

    def test_svg_is_rasterized_for_visual_comparison(self) -> None:
        svg = (
            b'<svg xmlns="http://www.w3.org/2000/svg" '
            b'width="256" height="256" viewBox="0 0 256 256">'
            b'<circle cx="128" cy="128" r="80" fill="black"/>'
            b'<circle cx="128" cy="128" r="40" fill="white"/>'
            b"</svg>"
        )
        images = get_images("company-logo.svg", svg)
        self.assertEqual(len(images), 1)
        match = compare_image_collections(images, self.xlsx_images)
        self.assertIsNotNone(match)
        self.assertGreaterEqual(match["similarity"], 80)

    def test_invalid_svg_is_rejected_with_a_clear_error(self) -> None:
        with self.assertRaisesRegex(ValueError, "Invalid SVG/XML"):
            analyze_file("broken.svg", b"<svg")

    def test_jpg_is_loaded_as_a_visual_image(self) -> None:
        output = io.BytesIO()
        Image.open(io.BytesIO(self.logo_png)).save(output, format="JPEG")
        images = get_images("company-logo.jpg", output.getvalue())
        self.assertEqual(len(images), 1)

    def test_same_logo_matches_across_document_types_and_text(self) -> None:
        comparisons = (
            (self.pdf_images, self.pdf_images),
            (self.pdf_images, self.pdf_other_text_images),
            (self.xlsx_images, self.xlsx_images),
            (self.xlsx_images, self.xlsx_other_text_images),
            (self.pdf_images, self.xlsx_other_text_images),
            (self.xlsx_images, self.pdf_other_text_images),
        )

        for images_a, images_b in comparisons:
            with self.subTest(
                reference_count=len(images_a),
                comparison_count=len(images_b),
            ):
                match = compare_image_collections(images_a, images_b)
                self.assertIsNotNone(match)
                self.assertGreaterEqual(match["similarity"], 80)

    def test_compare_endpoint_returns_logo_scores_for_document_pairs(self) -> None:
        comparisons = (
            (
                "reference.pdf",
                self.pdf_reference,
                "comparison.pdf",
                self.pdf_reference,
            ),
            (
                "reference.pdf",
                self.pdf_reference,
                "comparison.pdf",
                self.pdf_different_text,
            ),
            (
                "reference.xlsx",
                self.xlsx_reference,
                "comparison.xlsx",
                self.xlsx_reference,
            ),
            (
                "reference.xlsx",
                self.xlsx_reference,
                "comparison.xlsx",
                self.xlsx_different_text,
            ),
            (
                "reference.pdf",
                self.pdf_reference,
                "comparison.xlsx",
                self.xlsx_different_text,
            ),
            (
                "reference.xlsx",
                self.xlsx_reference,
                "comparison.pdf",
                self.pdf_different_text,
            ),
        )

        for name_a, data_a, name_b, data_b in comparisons:
            with self.subTest(reference=name_a, comparison=name_b):
                result = asyncio.run(
                    compare_files(
                        file_a=UploadFile(
                            filename=name_a,
                            file=io.BytesIO(data_a),
                        ),
                        file_b=UploadFile(
                            filename=name_b,
                            file=io.BytesIO(data_b),
                        ),
                    )
                )
                self.assertGreaterEqual(
                    result["result"]["visual_similarity"],
                    80,
                )

    def test_compare_endpoint_returns_original_image_logo_regions(self) -> None:
        result = asyncio.run(
            compare_files(
                file_a=UploadFile(
                    filename="reference.png",
                    file=io.BytesIO(self.logo_png),
                ),
                file_b=UploadFile(
                    filename="comparison.png",
                    file=io.BytesIO(self.logo_png),
                ),
            )
        )

        evidence = result["result"]["visual_evidence"]
        regions = evidence["regions"]

        self.assertEqual(evidence["status"], "REGIONS_DETECTED")
        self.assertEqual(
            evidence["coordinate_space"],
            "original_extracted_image_pixels",
        )
        self.assertEqual(len(regions), 2)
        self.assertEqual(
            {region["side"] for region in regions},
            {"reference", "comparison"},
        )

        for region in regions:
            with self.subTest(side=region["side"]):
                self.assertEqual(region["image_index"], 1)
                self.assertEqual(region["image_width"], 256)
                self.assertEqual(region["image_height"], 256)
                self.assertGreater(region["width"], 0)
                self.assertGreater(region["height"], 0)
                self.assertGreaterEqual(region["x"], 0)
                self.assertGreaterEqual(region["y"], 0)
                self.assertLessEqual(
                    region["x"] + region["width"],
                    region["image_width"],
                )
                self.assertLessEqual(
                    region["y"] + region["height"],
                    region["image_height"],
                )

    def test_different_logo_shapes_score_lower(self) -> None:
        different_logo = make_logo_png("square")
        different_xlsx = get_images(
            "different-logo.xlsx",
            make_xlsx("Same company data", different_logo),
        )

        match = compare_image_collections(self.xlsx_images, different_xlsx)

        self.assertIsNotNone(match)
        self.assertLess(match["similarity"], 80)


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import argparse
import csv
from pathlib import Path

from app.logo_search import index_trademark
from app.main import MAX_FILE_BYTES, analyze_file


REQUIRED_COLUMNS = {
    "jurisdiction",
    "mark_name",
    "trademark_number",
    "classes",
    "goods_services",
    "source_url",
    "image_file",
}


def import_manifest(manifest_path: Path) -> tuple[int, list[str]]:
    errors: list[str] = []
    imported = 0
    with manifest_path.open("r", encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        columns = set(reader.fieldnames or [])
        missing = REQUIRED_COLUMNS.difference(columns)
        if missing:
            raise ValueError(
                f"Manifest is missing required columns: {', '.join(sorted(missing))}."
            )

        for line_number, row in enumerate(reader, start=2):
            filename = (row.get("image_file") or "").strip()
            image_path = manifest_path.parent / filename
            try:
                if not filename or not image_path.is_file():
                    raise ValueError(f"logo file not found: {filename or '(empty)'}")
                if image_path.stat().st_size > MAX_FILE_BYTES:
                    raise ValueError("logo file exceeds the 50 MB upload limit")
                extracted = analyze_file(image_path.name, image_path.read_bytes())
                if not extracted["images"]:
                    raise ValueError("logo file did not contain an image")
                index_trademark(
                    image_data=extracted["images"][0],
                    jurisdiction=row.get("jurisdiction") or "",
                    mark_name=row.get("mark_name") or "",
                    trademark_number=row.get("trademark_number") or "",
                    classes=row.get("classes") or "",
                    goods_services=row.get("goods_services") or "",
                    source_url=row.get("source_url") or "",
                )
                imported += 1
            except (OSError, ValueError, RuntimeError) as exc:
                errors.append(f"line {line_number}: {exc}")
    return imported, errors


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Import licensed trademark image records into local Qdrant."
    )
    parser.add_argument("manifest", type=Path)
    arguments = parser.parse_args()
    try:
        imported, errors = import_manifest(arguments.manifest)
    except (OSError, ValueError) as exc:
        parser.error(str(exc))
    print(f"Imported records: {imported}")
    for error in errors:
        print(f"ERROR {error}")
    if errors:
        print(f"Rejected rows: {len(errors)}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())

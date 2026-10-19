from __future__ import annotations

import io
import os
import threading
import uuid
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import numpy as np
from PIL import Image

from app.main import compare_images, detect_logo_region, extract_logo_crop, load_pil_image


VECTOR_SIZE = 512
COLLECTION = os.getenv("QDRANT_COLLECTION", "trademarks")
DATA_DIR = Path(os.getenv("TRADEMARK_DATA_DIR", "data"))
LOGO_DIR = DATA_DIR / "logos"
JURISDICTIONS = {"MYANMAR", "WIPO", "EUIPO", "TMVIEW", "USPTO"}

_lock = threading.RLock()
_client: Any = None
_model: Any = None
_preprocess: Any = None
_torch: Any = None


def _get_qdrant_modules() -> tuple[Any, Any]:
    try:
        from qdrant_client import QdrantClient, models
    except ImportError as exc:
        raise RuntimeError(
            "Qdrant is unavailable. Install the backend dependencies from requirements.txt."
        ) from exc
    return QdrantClient, models


def _get_client() -> Any:
    global _client
    if _client is None:
        with _lock:
            if _client is None:
                QdrantClient, models = _get_qdrant_modules()
                url = os.getenv("QDRANT_URL")
                if url:
                    _client = QdrantClient(
                        url=url,
                        api_key=os.getenv("QDRANT_API_KEY"),
                        timeout=15,
                    )
                else:
                    DATA_DIR.mkdir(parents=True, exist_ok=True)
                    _client = QdrantClient(path=str(DATA_DIR / "qdrant"))
                collections = {
                    item.name for item in _client.get_collections().collections
                }
                if COLLECTION not in collections:
                    _client.create_collection(
                        collection_name=COLLECTION,
                        vectors_config=models.VectorParams(
                            size=VECTOR_SIZE,
                            distance=models.Distance.COSINE,
                        ),
                    )
    return _client


def _get_model() -> tuple[Any, Any, Any]:
    global _model, _preprocess, _torch
    if _model is None:
        with _lock:
            if _model is None:
                try:
                    import open_clip
                    import torch
                except ImportError as exc:
                    raise RuntimeError(
                        "Local logo embeddings are unavailable. Install the "
                        "backend AI dependencies from requirements.txt."
                    ) from exc
                model, _, preprocess = open_clip.create_model_and_transforms(
                    "ViT-B-32",
                    pretrained=os.getenv(
                        "CLIP_PRETRAINED", "laion2b_s34b_b79k"
                    ),
                    device="cpu",
                )
                model.eval()
                _model = model
                _preprocess = preprocess
                _torch = torch
    return _model, _preprocess, _torch


def _image_from_bytes(data: bytes) -> Image.Image:
    with Image.open(io.BytesIO(data)) as image:
        image.load()
        return image.convert("RGB")


def embed_logo(data: bytes) -> list[float]:
    model, preprocess, torch = _get_model()
    image = _image_from_bytes(data)
    crop = extract_logo_crop(data)
    prepared = crop.convert("RGB") if crop is not None else load_pil_image(image)
    with _lock, torch.inference_mode():
        vector = model.encode_image(preprocess(prepared).unsqueeze(0))
        vector = vector / vector.norm(dim=-1, keepdim=True)
        return vector[0].cpu().tolist()


def _normalized_text(value: str) -> str:
    return " ".join(value.casefold().split())


def _text_similarity(query: str, candidate: str) -> float | None:
    query = _normalized_text(query)
    candidate = _normalized_text(candidate)
    if not query or not candidate:
        return None
    return round(100 * SequenceMatcher(None, query, candidate).ratio(), 2)


def _class_similarity(query: set[str], candidate: list[str]) -> float | None:
    if not query or not candidate:
        return None
    candidate_set = {str(item).strip() for item in candidate}
    return 100.0 if query.intersection(candidate_set) else 0.0


def _histogram_similarity(left: bytes, right: bytes) -> float:
    image_a = np.asarray(_image_from_bytes(left).convert("HSV"))
    image_b = np.asarray(_image_from_bytes(right).convert("HSV"))
    histograms = []
    for image in (image_a, image_b):
        histogram, _ = np.histogramdd(
            image.reshape(-1, 3),
            bins=(12, 8, 8),
            range=((0, 180), (0, 256), (0, 256)),
        )
        histograms.append(histogram.ravel() / max(1, image.shape[0] * image.shape[1]))
    distance = np.abs(histograms[0] - histograms[1]).sum()
    return float(round(max(0.0, 100.0 * (1.0 - distance / 2.0)), 2))


def _layout_similarity(left: bytes, right: bytes) -> float:
    regions = [detect_logo_region(item) for item in (left, right)]
    first, second = regions
    if first is None or second is None:
        return 50.0
    aspect_a = first["width"] / max(1, first["height"])
    aspect_b = second["width"] / max(1, second["height"])
    aspect_score = 100.0 * np.exp(-abs(np.log(aspect_a / aspect_b)))
    center_a = (
        (first["x"] + first["width"] / 2) / first["image_width"],
        (first["y"] + first["height"] / 2) / first["image_height"],
    )
    center_b = (
        (second["x"] + second["width"] / 2) / second["image_width"],
        (second["y"] + second["height"] / 2) / second["image_height"],
    )
    center_distance = np.linalg.norm(np.subtract(center_a, center_b))
    center_score = 100.0 * max(0.0, 1.0 - center_distance / np.sqrt(2))
    return float(round(float(0.7 * aspect_score + 0.3 * center_score), 2))


def _validate_record(
    jurisdiction: str,
    mark_name: str,
    trademark_number: str,
    classes: str,
    goods_services: str,
    source_url: str,
) -> dict[str, Any]:
    jurisdiction = jurisdiction.strip().upper()
    if jurisdiction not in JURISDICTIONS:
        raise ValueError(
            "jurisdiction must be one of MYANMAR, WIPO, EUIPO, TMVIEW, USPTO."
        )
    if not mark_name.strip():
        raise ValueError("mark_name is required.")
    if len(mark_name) > 300 or len(trademark_number) > 100:
        raise ValueError("Mark name or trademark number is too long.")
    if len(goods_services) > 4000 or len(source_url) > 1000:
        raise ValueError("Goods/services or source URL is too long.")
    source_url = source_url.strip()
    if source_url:
        parsed_url = urlsplit(source_url)
        if parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc:
            raise ValueError("source_url must be an absolute HTTP or HTTPS URL.")
    raw_classes = {
        item.strip()
        for item in classes.replace(";", ",").split(",")
        if item.strip()
    }
    if any(not item.isdigit() or not 1 <= int(item) <= 45 for item in raw_classes):
        raise ValueError("Nice classes must be comma-separated values from 1 to 45.")
    class_numbers = sorted({str(int(item)) for item in raw_classes}, key=int)
    return {
        "jurisdiction": jurisdiction,
        "mark_name": mark_name.strip(),
        "trademark_number": trademark_number.strip(),
        "classes": class_numbers,
        "goods_services": goods_services.strip(),
        "source_url": source_url.strip(),
    }


def index_trademark(
    *,
    image_data: bytes,
    jurisdiction: str,
    mark_name: str,
    trademark_number: str,
    classes: str,
    goods_services: str,
    source_url: str,
) -> dict[str, Any]:
    _, models = _get_qdrant_modules()
    metadata = _validate_record(
        jurisdiction, mark_name, trademark_number, classes,
        goods_services, source_url,
    )
    vector = embed_logo(image_data)
    trademark_id = str(uuid.uuid4())
    LOGO_DIR.mkdir(parents=True, exist_ok=True)
    logo_path = LOGO_DIR / f"{trademark_id}.png"
    _image_from_bytes(image_data).save(logo_path, format="PNG", optimize=True)
    metadata.update({"id": trademark_id, "logo_path": str(logo_path)})

    try:
        with _lock:
            _get_client().upsert(
                collection_name=COLLECTION,
                points=[
                    models.PointStruct(
                        id=trademark_id,
                        vector=vector,
                        payload=metadata,
                    )
                ],
                wait=True,
            )
    except Exception:
        logo_path.unlink(missing_ok=True)
        raise
    return {key: value for key, value in metadata.items() if key != "logo_path"}


def search_trademarks(
    *,
    image_data: bytes,
    mark_name: str = "",
    goods_services: str = "",
    classes: str = "",
    jurisdictions: list[str] | None = None,
    limit: int = 10,
) -> dict[str, Any]:
    if not 1 <= limit <= 10:
        raise ValueError("limit must be between 1 and 10.")
    _, models = _get_qdrant_modules()
    selected_jurisdictions = {
        item.strip().upper()
        for item in (jurisdictions or [])
        if item.strip()
    }
    unknown = selected_jurisdictions.difference(JURISDICTIONS)
    if unknown:
        raise ValueError(f"Unsupported jurisdictions: {', '.join(sorted(unknown))}.")
    raw_classes = {
        item.strip()
        for item in classes.replace(";", ",").split(",")
        if item.strip()
    }
    if any(not item.isdigit() or not 1 <= int(item) <= 45 for item in raw_classes):
        raise ValueError("Nice classes must be comma-separated values from 1 to 45.")
    selected_classes = {str(int(item)) for item in raw_classes}
    client = _get_client()
    total_records = client.count(collection_name=COLLECTION).count
    if total_records == 0:
        return {
            "matches": [],
            "scanned_candidates": 0,
            "query_evidence_region": detect_logo_region(image_data),
            "jurisdictions": (
                sorted(selected_jurisdictions)
                if selected_jurisdictions
                else sorted(JURISDICTIONS)
            ),
            "embedding_model": "ViT-B-32 / laion2b_s34b_b79k",
            "coverage_note": (
                "The trademark vector index is empty. Import licensed records "
                "before searching."
            ),
        }
    query_vector = embed_logo(image_data)
    conditions = []
    if selected_jurisdictions:
        conditions.append(
            models.FieldCondition(
                key="jurisdiction",
                match=models.MatchAny(any=sorted(selected_jurisdictions)),
            )
        )
    if selected_classes:
        conditions.append(
            models.FieldCondition(
                key="classes",
                match=models.MatchAny(any=sorted(selected_classes)),
            )
        )

    with _lock:
        response = client.query_points(
            collection_name=COLLECTION,
            query=query_vector,
            query_filter=models.Filter(must=conditions) if conditions else None,
            limit=100,
            with_payload=True,
        )

    matches: list[dict[str, Any]] = []
    for point in response.points:
        payload = point.payload or {}
        logo_path = Path(str(payload.get("logo_path", "")))
        if not logo_path.is_file() or LOGO_DIR.resolve() not in logo_path.resolve().parents:
            continue
        candidate_image = logo_path.read_bytes()
        embedding_score = round(max(0.0, min(100.0, float(point.score) * 100)), 2)
        shape_score = compare_images(image_data, candidate_image)
        color_score = _histogram_similarity(image_data, candidate_image)
        layout_score = _layout_similarity(image_data, candidate_image)
        mark_score = _text_similarity(mark_name, str(payload.get("mark_name", "")))
        goods_score = _text_similarity(
            goods_services, str(payload.get("goods_services", ""))
        )
        text_values = [value for value in (mark_score, goods_score) if value is not None]
        text_score = round(sum(text_values) / len(text_values), 2) if text_values else None
        class_score = _class_similarity(
            selected_classes, payload.get("classes", [])
        )
        visual_score = round(
            0.62 * embedding_score + 0.15 * shape_score
            + 0.10 * color_score + 0.13 * layout_score,
            2,
        )
        score_parts = [(visual_score, 0.70)]
        if text_score is not None:
            score_parts.append((text_score, 0.15))
        if class_score is not None:
            score_parts.append((class_score, 0.15))
        weight = sum(item[1] for item in score_parts)
        overall_score = round(
            sum(score * item_weight for score, item_weight in score_parts) / weight,
            2,
        )
        matches.append(
            {
                "id": payload.get("id"),
                "jurisdiction": payload.get("jurisdiction"),
                "mark_name": payload.get("mark_name"),
                "trademark_number": payload.get("trademark_number"),
                "classes": payload.get("classes", []),
                "goods_services": payload.get("goods_services"),
                "source_url": payload.get("source_url"),
                "logo_url": f"/api/v1/trademarks/{payload.get('id')}/logo",
                "similarity": overall_score,
                "risk_level": (
                    "HIGH" if overall_score >= 80
                    else "MEDIUM" if overall_score >= 55
                    else "LOW"
                ),
                "signals": {
                    "embedding": embedding_score,
                    "shape": float(shape_score),
                    "color": color_score,
                    "layout": layout_score,
                    "text": text_score,
                    "class": class_score,
                    "visual": float(visual_score),
                },
                "evidence_region": detect_logo_region(candidate_image),
            }
        )
    matches.sort(key=lambda item: item["similarity"], reverse=True)
    return {
        "matches": matches[:limit],
        "scanned_candidates": len(response.points),
        "query_evidence_region": detect_logo_region(image_data),
        "jurisdictions": sorted(selected_jurisdictions) if selected_jurisdictions else sorted(JURISDICTIONS),
        "embedding_model": "ViT-B-32 / laion2b_s34b_b79k",
        "coverage_note": (
            "Search includes only records already imported into this index. "
            "No registry records are fetched automatically."
        ),
    }


def get_logo(trademark_id: str) -> bytes | None:
    try:
        normalized_id = str(uuid.UUID(trademark_id))
    except ValueError:
        return None
    path = LOGO_DIR / f"{normalized_id}.png"
    if not path.is_file() or LOGO_DIR.resolve() not in path.resolve().parents:
        return None
    return path.read_bytes()


def get_index_count() -> int:
    with _lock:
        return int(_get_client().count(collection_name=COLLECTION).count)

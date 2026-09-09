"""Deterministic catalog-only model name resolution."""

from __future__ import annotations

from dataclasses import dataclass
import unicodedata
from typing import Any, Iterable


MIN_FUZZY_SIMILARITY = 0.67
MIN_RUNNER_UP_MARGIN = 0.15


@dataclass(frozen=True)
class ModelMatch:
    model: dict[str, Any] | None
    match_type: str | None
    distance: int | None


def normalize_model_name(value: str) -> str:
    """Normalize spelling differences that do not identify a distinct model."""
    normalized = unicodedata.normalize("NFKC", value).strip().casefold()
    normalized = normalized.replace("ё", "е").replace("э", "е")
    return " ".join(normalized.split())


def levenshtein_distance(left: str, right: str) -> int:
    """Return the edit distance using insertion, deletion and substitution."""
    if len(left) < len(right):
        left, right = right, left
    previous = list(range(len(right) + 1))
    for left_index, left_character in enumerate(left, start=1):
        current = [left_index]
        for right_index, right_character in enumerate(right, start=1):
            current.append(
                min(
                    current[-1] + 1,
                    previous[right_index] + 1,
                    previous[right_index - 1]
                    + (left_character != right_character),
                )
            )
        previous = current
    return previous[-1]


def _maximum_distance(length: int) -> int:
    if length <= 4:
        return 1
    if length <= 8:
        return 2
    return 3


def _similarity(left: str, right: str, distance: int) -> float:
    length = max(len(left), len(right))
    return 1.0 if length == 0 else 1.0 - distance / length


def resolve_model(
    requested_model: str,
    models: Iterable[dict[str, Any]],
) -> ModelMatch:
    """Resolve one model from supplied catalog records, or decline to guess."""
    candidates = list(models)
    requested = requested_model.strip()

    exact = [
        candidate
        for candidate in candidates
        if str(candidate.get("model") or "").strip() == requested
    ]
    if len(exact) == 1:
        return ModelMatch(exact[0], "exact", 0)

    normalized_requested = normalize_model_name(requested)
    normalized_candidates = [
        (candidate, normalize_model_name(str(candidate.get("model") or "")))
        for candidate in candidates
    ]
    if not normalized_candidates:
        return ModelMatch(None, None, None)
    normalized = [
        candidate
        for candidate, candidate_name in normalized_candidates
        if candidate_name == normalized_requested
    ]
    if len(normalized) == 1:
        return ModelMatch(normalized[0], "normalized", 0)
    if len(normalized) > 1 or not normalized_requested:
        return ModelMatch(None, None, 0 if normalized else None)

    scored = []
    for candidate, candidate_name in normalized_candidates:
        distance = levenshtein_distance(
            normalized_requested,
            candidate_name,
        )
        similarity = _similarity(
            normalized_requested,
            candidate_name,
            distance,
        )
        scored.append((distance, -similarity, candidate, candidate_name))
    scored.sort(key=lambda item: (item[0], item[1], item[3]))

    best_distance, negative_best_similarity, best, best_name = scored[0]
    best_similarity = -negative_best_similarity
    comparison_length = max(len(normalized_requested), len(best_name))
    if (
        best_distance > _maximum_distance(comparison_length)
        or best_similarity < MIN_FUZZY_SIMILARITY
    ):
        return ModelMatch(None, None, best_distance)

    same_distance = [
        item for item in scored if item[0] == best_distance
    ]
    if len(same_distance) != 1:
        return ModelMatch(None, None, best_distance)

    if len(scored) > 1:
        runner_similarity = max(
            -item[1] for item in scored if item[2] is not best
        )
        if best_similarity - runner_similarity < MIN_RUNNER_UP_MARGIN:
            return ModelMatch(None, None, best_distance)

    return ModelMatch(best, "fuzzy", best_distance)

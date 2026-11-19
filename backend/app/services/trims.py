"""Decorative trim catalog, consumption and client pricing.

Purchase prices stay in ``data/trims.json``. Public calculation details
contain only the client price, and only after the category markup is set.
Sewing is added only when ``labor_by_category`` points at an operation.
"""

from __future__ import annotations

import json
import re
from decimal import Decimal
from pathlib import Path
from typing import Any

from .model_matching import normalize_model_name
from .pricing import build_pricing, money


DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "trims.json"
OPERATIONS_PATH = Path(__file__).resolve().parents[1] / "data" / "operations.json"
PHOTO_DIR = Path(__file__).resolve().parents[1] / "data" / "trim_photos"
COMPLETE_REQUEST_EXAMPLE = (
    "Римская штора Вандер с бахромой Сальса по низу 150×170 см"
)

PLACEMENT_LABELS = {
    "bottom": "по низу",
    "top": "по верху",
    "left": "слева",
    "right": "справа",
    "both_sides": "по двум боковым краям",
    "perimeter": "по периметру",
}
FIELD_LABELS = {
    "trim_model": "модель фурнитуры",
    "trim_color": "цвет или артикул",
    "placement": "расположение",
    "markup": "коэффициент наценки",
    "labor_tariff": "тариф пришивания",
}
_CATEGORY_PATTERNS = (
    ("декоративная лента", re.compile(r"декоративн\w*\s+лент")),
    ("бахрома", re.compile(r"бахром")),
    ("тесьма", re.compile(r"тесьм")),
    ("бордюр", re.compile(r"бордюр")),
    ("кант", re.compile(r"(?<!\w)кант")),
)
_PLACEMENT_PATTERNS = (
    (
        ("ambiguous_side",),
        re.compile(r"снизу и сбоку|сбоку и снизу|по низу и сбоку|сбоку и по низу"),
    ),
    (
        ("bottom", "both_sides"),
        re.compile(
            r"снизу и по бокам|по низу и по бокам|с боков и снизу|по бокам и снизу|по бокам и по низу"
        ),
    ),
    (
        ("both_sides",),
        re.compile(
            r"по обоим боковым краям|по двум боковым краям|по обоим боковым|по двум боковым|по обоим бокам|по двум бокам|по боковым краям|по бокам|с двух сторон|по двум сторонам"
        ),
    ),
    (("perimeter",), re.compile(r"по периметру")),
    (("bottom",), re.compile(r"по нижнему краю|по низу|снизу")),
    (("top",), re.compile(r"по верхнему краю|по верху|сверху")),
    (("left",), re.compile(r"с левой стороны|слева")),
    (("right",), re.compile(r"с правой стороны|справа")),
)


def catalog() -> dict[str, Any]:
    return json.loads(DATA_PATH.read_text(encoding="utf-8"))


def records() -> list[dict[str, Any]]:
    return list(catalog()["records"])


def normalize(value: str) -> str:
    text = normalize_model_name(value)
    text = text.replace("ё", "е")
    text = re.sub(r"(?<=\d)\s*[xх×*]\s*(?=\d)", "x", text)
    return " ".join(text.replace("«", " ").replace("»", " ").split())


def _operations() -> list[dict[str, Any]]:
    payload = json.loads(OPERATIONS_PATH.read_text(encoding="utf-8"))
    return payload["records"]


def photo_file(article: str) -> str | None:
    for extension in (".webp", ".jpg", ".jpeg", ".png"):
        candidate = PHOTO_DIR / f"{article}{extension}"
        if candidate.is_file():
            return candidate.name
    return None


def client_price(record: dict[str, Any]) -> Decimal | None:
    markup = catalog()["markup_by_category"].get(record["category"])
    if markup is None:
        return None
    return Decimal(str(record["purchase_price_rub_per_m"])) * Decimal(str(markup))


def _aliases(record: dict[str, Any]) -> list[str]:
    found: list[str] = []
    for part in re.findall(r"[\"«](.+?)[\"»]", str(record["name"])):
        token = normalize(part)
        if len(token) >= 3:
            found.append(token)
    full = normalize(str(record["name"]))
    if len(full) >= 3:
        found.append(full)
    unique: list[str] = []
    for token in found:
        if token not in unique:
            unique.append(token)
    return unique


def _contains_term(text: str, term: str) -> bool:
    return re.search(rf"(?<!\w){re.escape(term)}(?!\w)", text) is not None


def _stem(token: str) -> str:
    for ending in (
        "ами",
        "ями",
        "ого",
        "ему",
        "ыми",
        "ими",
        "ой",
        "ый",
        "ий",
        "ая",
        "яя",
        "ую",
        "юю",
        "ом",
        "ем",
        "ах",
        "ях",
        "ам",
        "ям",
        "ов",
        "ев",
        "а",
        "я",
        "у",
        "ю",
        "е",
        "и",
        "ы",
    ):
        if token.endswith(ending) and len(token) - len(ending) >= 4:
            return token[: -len(ending)]
    return token


_GENERIC_STEMS = {"однотонн", "декоративн"}
_MOUNTING_HINTS = (
    (re.compile(r"люверс"), "Люверсы"),
    (re.compile(r"шторн\w*\s+лент"), "шторная лента"),
)


def _alias_in_text(text: str, alias: str) -> bool:
    if _contains_term(text, alias):
        return True
    alias_stems = [_stem(part) for part in alias.split() if len(_stem(part)) >= 5]
    if not alias_stems:
        return False
    text_stems = {_stem(part) for part in text.split()}
    if all(stem in text_stems for stem in alias_stems):
        return True
    distinctive = [stem for stem in alias_stems if stem not in _GENERIC_STEMS]
    return bool(distinctive) and all(stem in text_stems for stem in distinctive)


def release_trim_heading(
    request: dict[str, Any],
    raw_request: Any,
) -> dict[str, Any]:
    """Drop decorative trim that a parser stored as a curtain heading.

    An explicit mounting word in the same value is kept. A heading that only
    names trim returns to the model's standard fastening.
    """
    configuration = request.get("configuration")
    if not isinstance(configuration, dict):
        return request
    heading = configuration.get("heading")
    if not isinstance(heading, str) or not heading.strip():
        return request
    text = normalize(heading)
    if not is_trim_text(text):
        return request
    mounting = next(
        (label for pattern, label in _MOUNTING_HINTS if pattern.search(text)),
        None,
    )
    updated = dict(configuration)
    updated["heading"] = mounting
    request = {**request, "configuration": updated}
    raw = raw_request if isinstance(raw_request, str) else ""
    if not is_trim_text(raw) and not request.get("_trim_text"):
        request["_trim_text"] = heading.strip()
    return request


def is_trim_text(value: str) -> bool:
    text = normalize(value)
    if any(pattern.search(text) for _, pattern in _CATEGORY_PATTERNS):
        return True
    return any(
        _alias_in_text(text, alias)
        for record in records()
        for alias in _aliases(record)
    )


def _categories(text: str) -> list[str]:
    return [name for name, pattern in _CATEGORY_PATTERNS if pattern.search(text)]


def _placements(text: str) -> list[str]:
    for names, pattern in _PLACEMENT_PATTERNS:
        if pattern.search(text):
            return list(names)
    return []


def _articles(text: str) -> list[dict[str, Any]]:
    known = {str(record["article"]): record for record in records()}
    found: list[dict[str, Any]] = []
    for match in re.finditer(r"(?<!\d)(\d{3,5})(?!\d)", text):
        record = known.get(match.group(1))
        if record and record not in found:
            found.append(record)
    return found


def _color_matches(record: dict[str, Any], text: str) -> bool:
    color = normalize(str(record.get("color") or ""))
    if not color:
        return False
    if _alias_in_text(text, color):
        return True
    head = color.split()[0]
    if len(head) < 4:
        return False
    prefix = head[:3]
    return any(token.startswith(prefix) for token in text.split())


def _name_matches(text: str, categories: list[str]) -> list[dict[str, Any]]:
    matched = [
        record
        for record in records()
        if any(_alias_in_text(text, alias) for alias in _aliases(record))
    ]
    if categories:
        narrowed = [record for record in matched if record["category"] in categories]
        if narrowed:
            return narrowed
    return matched


def _unknown_trim_token(text: str) -> str | None:
    start = 0
    for _, pattern in _CATEGORY_PATTERNS:
        found = pattern.search(text)
        if found:
            start = found.end()
            break
    cleaned = text[start:]
    for _, pattern in _CATEGORY_PATTERNS:
        cleaned = pattern.sub(" ", cleaned)
    for _, pattern in _PLACEMENT_PATTERNS:
        cleaned = pattern.sub(" ", cleaned)
    cleaned = re.sub(
        r"\d+(?:[.,]\d+)?|см|шт|штук\w*|комплект\w*|римск\w*|штор\w*|портьер\w*|покрывал\w*|издели\w*",
        " ",
        cleaned,
    )
    tokens = [
        token
        for token in cleaned.split()
        if len(token) >= 4 and token not in {"новый", "полная", "полном"}
    ]
    return " ".join(tokens[:4]) or None


def _resolve_clause(text: str) -> dict[str, Any]:
    categories = _categories(text)
    placements = _placements(text)
    chosen = _articles(text) or _name_matches(text, categories)
    if len(chosen) > 1:
        colored = [record for record in chosen if _color_matches(record, text)]
        if len(colored) == 1:
            chosen = colored
    if not chosen:
        if categories or _articles(text):
            token = _unknown_trim_token(text)
            if token:
                return {"error": "not_found", "requested": token, "placements": placements}
            return {"error": "missing_model", "placements": placements}
        return {"error": "none"}
    if len(chosen) > 1:
        return {
            "error": "ambiguous",
            "options": chosen,
            "placements": placements,
        }
    return {"error": None, "record": chosen[0], "placements": placements}


def parse_text(text: str) -> list[dict[str, Any]]:
    normalized = normalize(text)
    if not is_trim_text(normalized):
        return []
    parts = [
        part.strip()
        for part in re.split(r"\s+и\s+", normalized)
        if part.strip()
    ]
    # «снизу и сбоку» is one placement. Split only when every part names a trim.
    clauses = parts if len(parts) > 1 and all(is_trim_text(part) for part in parts) else [normalized]
    parsed = [_resolve_clause(clause) for clause in clauses]
    return [item for item in parsed if item.get("error") != "none"]


def _structured_clause(item: dict[str, Any]) -> dict[str, Any]:
    article = str(item.get("article") or "").strip()
    name = normalize(str(item.get("name") or ""))
    color = normalize(str(item.get("color") or ""))
    category = normalize(str(item.get("category") or ""))
    placement = normalize(str(item.get("placement") or ""))
    text = " ".join(
        part
        for part in (category, name, color, article, placement)
        if part
    )
    resolved = _resolve_clause(text)
    if placement in PLACEMENT_LABELS:
        resolved["placements"] = [placement]
    elif placement:
        labels = _placements(placement)
        if labels:
            resolved["placements"] = labels
        elif resolved.get("error") is None:
            resolved["placements"] = []
            resolved["placement_invalid"] = placement
    return resolved


def _allowance_rate() -> Decimal:
    return Decimal(str(catalog()["allowance_rate"]))


def _meters(placement: str, width_cm: Decimal, height_cm: Decimal, quantity: int) -> Decimal:
    width_m = width_cm / Decimal("100")
    height_m = height_cm / Decimal("100")
    edge = {
        "bottom": width_m,
        "top": width_m,
        "left": height_m,
        "right": height_m,
        "both_sides": height_m * Decimal("2"),
        "perimeter": (width_m + height_m) * Decimal("2"),
    }[placement]
    return edge * Decimal(quantity)


def _labor_operation(category: str) -> dict[str, Any] | None:
    operation_id = catalog()["labor_by_category"].get(category)
    if not operation_id:
        return None
    return next(
        (record for record in _operations() if record.get("id") == operation_id),
        None,
    )


def _preview(
    record: dict[str, Any],
    placement: str,
    meters: Decimal,
    *,
    labor: dict[str, Any] | None,
) -> dict[str, Any]:
    price = client_price(record)
    material_meters = meters * _allowance_rate()
    material = price * material_meters if price is not None else None
    labor_cost = (
        Decimal(str(labor["tariff_rub"])) * meters if labor is not None else None
    )
    return {
        "article": record["article"],
        "name": record["name"],
        "color": record["color"],
        "category": record["category"],
        "placement": placement,
        "placement_label": PLACEMENT_LABELS[placement],
        "meters": float(meters),
        "material_meters": float(material_meters),
        "labor_meters": float(meters),
        "client_price_rub_per_m": float(price) if price is not None else None,
        "material_cost_rub": money(material) if material is not None else None,
        "labor_cost_rub": money(labor_cost) if labor_cost is not None else None,
    }


def _line(
    *,
    operation_id: str,
    group: str,
    variant: str,
    tariff: Decimal,
    basis: Decimal,
    calculation_basis: str,
    formula: str,
) -> dict[str, Any]:
    return {
        "operation_id": operation_id,
        "group": group,
        "variant": variant,
        "unit": "пог. м",
        "calculation_basis": calculation_basis,
        "tariff_rub": float(tariff),
        "formula": formula,
        "basis_value": float(basis),
        "cost_rub": money(tariff * basis),
    }


def _failure(reason_code: str, fields: list[str], details: dict[str, Any]) -> dict[str, Any]:
    labels = [FIELD_LABELS[field] for field in fields if field in FIELD_LABELS]
    if fields == ["labor_tariff"]:
        message = (
            "Модель фурнитуры найдена, но тариф пришивания для этой категории "
            "ещё не утверждён. Итоговую стоимость без работы не показываю. "
            f"Полный запрос выглядит так: {COMPLETE_REQUEST_EXAMPLE}"
        )
    elif reason_code == "TRIM_PLACEMENT_AMBIGUOUS":
        message = (
            "Неясно, с какой стороны пришить фурнитуру. Напишите «слева», "
            "«справа» или «по двум боковым краям». Фраза «снизу и по бокам» "
            "означает нижний край и оба боковых края. Отправьте новый полный "
            f"запрос, например: {COMPLETE_REQUEST_EXAMPLE}"
        )
    elif reason_code == "TRIM_PLACEMENT_UNSUPPORTED":
        message = (
            "Для римской шторы нельзя добавить декоративную фурнитуру по верху "
            "или по всему периметру: верх закреплён на механизме. Укажите низ, "
            "левую, правую или обе боковые стороны. "
            f"Например: {COMPLETE_REQUEST_EXAMPLE}"
        )
    elif reason_code == "TRIM_NOT_FOUND":
        message = (
            f"Фурнитура «{details.get('requested_value', '')}» не найдена в каталоге. "
            f"Укажите название как в прайсе и расположение. Например: {COMPLETE_REQUEST_EXAMPLE}"
        )
    else:
        message = (
            "В запросе не хватает данных: "
            + ", ".join(labels)
            + ". Отправьте новый полный запрос, например: "
            + COMPLETE_REQUEST_EXAMPLE
        )
    return {
        "status": "unavailable",
        "reason_code": reason_code,
        "message": message,
        "reason": message,
        "details": {
            "missing_fields": fields,
            "example": COMPLETE_REQUEST_EXAMPLE,
            **details,
        },
    }


def quote_accessories(
    clauses: list[dict[str, Any]],
    *,
    product_type: str,
    width_cm: Decimal,
    height_cm: Decimal,
    quantity: int,
) -> dict[str, Any]:
    """Return priced trim lines or one structured gap. No partial total."""
    if not clauses:
        return {"status": "empty"}
    missing: list[str] = []
    previews: list[dict[str, Any]] = []
    lines: list[dict[str, Any]] = []
    options: list[dict[str, str]] = []
    requested = None
    for clause in clauses:
        error = clause.get("error")
        placements = list(clause.get("placements") or [])
        if error == "none":
            continue
        if error == "not_found":
            requested = clause.get("requested")
            return _failure(
                "TRIM_NOT_FOUND",
                ["trim_model"],
                {"requested_value": requested, "accessories": []},
            )
        if error == "missing_model":
            if "trim_model" not in missing:
                missing.append("trim_model")
            if not placements and "placement" not in missing:
                missing.append("placement")
            continue
        if error == "ambiguous":
            if "trim_color" not in missing:
                missing.append("trim_color")
            for record in clause["options"]:
                option = {
                    "article": str(record["article"]),
                    "name": str(record["name"]),
                    "color": str(record["color"]),
                    "category": str(record["category"]),
                }
                if option not in options:
                    options.append(option)
            if not placements and "placement" not in missing:
                missing.append("placement")
            continue
        if clause.get("placement_invalid"):
            if "placement" not in missing:
                missing.append("placement")
            continue
        record = clause["record"]
        if "ambiguous_side" in placements:
            return _failure(
                "TRIM_PLACEMENT_AMBIGUOUS",
                ["placement"],
                {"accessories": [], "options": options},
            )
        if product_type == "roman" and any(
            placement in {"top", "perimeter"} for placement in placements
        ):
            return _failure(
                "TRIM_PLACEMENT_UNSUPPORTED",
                ["placement"],
                {"accessories": [], "options": options},
            )
        if not placements:
            if "placement" not in missing:
                missing.append("placement")
            continue
        price = client_price(record)
        labor = _labor_operation(str(record["category"]))
        if price is None and "markup" not in missing:
            missing.append("markup")
        if labor is None and "labor_tariff" not in missing:
            missing.append("labor_tariff")
        for placement in placements:
            meters = _meters(placement, width_cm, height_cm, quantity)
            previews.append(_preview(record, placement, meters, labor=labor))
            if price is None or labor is None:
                continue
            variant = (
                f"{record['name']}, арт. {record['article']}, "
                f"{record['color']}, {PLACEMENT_LABELS[placement]}"
            )
            lines.append(
                _line(
                    operation_id=f"TRIM-{record['article']}-{placement}",
                    group="Фурнитура",
                    variant=variant,
                    tariff=price,
                    basis=meters * _allowance_rate(),
                    calculation_basis="расход материала с запасом 10%",
                    formula="trim_length*1.10",
                )
            )
            lines.append(
                _line(
                    operation_id=str(labor["id"]),
                    group="Пришивание фурнитуры",
                    variant=variant,
                    tariff=Decimal(str(labor["tariff_rub"])),
                    basis=meters,
                    calculation_basis="длина пришивания без технологического запаса",
                    formula="trim_length",
                )
            )
    if missing:
        reason = {
            "trim_model": "TRIM_INCOMPLETE",
            "trim_color": "TRIM_AMBIGUOUS",
            "placement": "TRIM_INCOMPLETE",
            "markup": "TRIM_MARKUP_MISSING",
            "labor_tariff": "TRIM_LABOR_UNMAPPED",
        }[missing[0]]
        if "trim_color" in missing:
            reason = "TRIM_AMBIGUOUS"
        elif "markup" in missing:
            reason = "TRIM_MARKUP_MISSING"
        elif missing == ["labor_tariff"]:
            reason = "TRIM_LABOR_UNMAPPED"
        elif "trim_model" in missing or "placement" in missing:
            reason = "TRIM_INCOMPLETE"
        return _failure(
            reason,
            missing,
            {"accessories": previews, "options": options, "requested_value": requested},
        )
    return {"status": "priced", "lines": lines, "accessories": previews}


def _placement_from_request(raw_request: str) -> list[str]:
    """Placement named in the original text, when it is unambiguous."""
    found = [
        list(clause.get("placements") or [])
        for clause in parse_text(raw_request)
        if clause.get("error") is None and clause.get("placements")
    ]
    if len(found) != 1:
        return []
    return found[0]


def apply_trims(
    result: dict[str, Any],
    request: dict[str, Any],
    raw_request: Any,
) -> dict[str, Any] | None:
    structured = request.get("accessories")
    hint = str(request.get("_trim_text") or "")
    text = raw_request if isinstance(raw_request, str) else ""
    if structured is not None:
        if not isinstance(structured, list):
            return _failure(
                "TRIM_INCOMPLETE",
                ["trim_model"],
                {"accessories": [], "options": []},
            )
        clauses = [
            _structured_clause(item)
            for item in structured
            if isinstance(item, dict)
        ]
        # A parser can name the trim and drop the placement. The original
        # sentence still has it; an explicit placement on the item stays.
        recovered = _placement_from_request(text) if text else []
        open_clauses = [
            index
            for index, clause in enumerate(clauses)
            if not clause.get("placements")
            and not clause.get("placement_invalid")
            and not clause.get("error")
        ]
        if recovered and len(open_clauses) == 1:
            index = open_clauses[0]
            clauses[index] = {**clauses[index], "placements": list(recovered)}
    else:
        source = text if is_trim_text(text) else hint
        if not source or not is_trim_text(source):
            return None
        clauses = parse_text(source)
        if not clauses:
            return None
    payload = result["request"]
    quoted = quote_accessories(
        clauses,
        product_type=str(payload.get("product_type") or ""),
        width_cm=Decimal(str(payload["width_cm"])),
        height_cm=Decimal(str(payload["height_cm"])),
        quantity=int(payload["quantity"]),
    )
    if quoted["status"] == "empty":
        return None
    if quoted["status"] != "priced":
        return quoted
    additional = list(result["operations"]["additional"])
    additional.extend(quoted["lines"])
    result["operations"]["additional"] = additional
    extras = sum(
        (Decimal(str(line["cost_rub"])) for line in additional),
        Decimal("0"),
    )
    pricing = result["pricing"]
    result["pricing"] = build_pricing(
        fabric_cost=Decimal(str(pricing["fabric_cost"])),
        operation_cost=Decimal(str(pricing["operation_cost"])),
        extras_cost=extras,
    )
    result["accessories"] = quoted["accessories"]
    note = "; ".join(
        (
            f"{item['name']}, арт. {item['article']}, {item['placement_label']}, "
            f"отделка {item['meters']} пог. м, материал {item['material_meters']} пог. м"
        )
        for item in quoted["accessories"]
    )
    explanation = result["consumption"].get("explanation") or ""
    result["consumption"]["explanation"] = f"{explanation} Фурнитура: {note}."
    return result

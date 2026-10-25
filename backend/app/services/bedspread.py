"""Bedspread pricing from the draft catalogs and the live fabric catalog.

Decorative pillowcases, planks and hardware are omitted. A model is not
treated as ready only because its name matches a fabric or an embroidery.
"""

from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path
from typing import Any

from .fabric_calculator import calculate_bedspread_consumption
from .model_matching import normalize_model_name
from .pricing import build_pricing, money


DRAFT_DIR = (
    Path(__file__).resolve().parents[3] / "drafts" / "bedspreads"
)
DATA_DIR = Path(__file__).resolve().parents[1] / "data"
SEWING_TARIFF = Decimal("200")
PACKAGING_TARIFF = Decimal("200")
COMPLETE_REQUEST_EXAMPLE = "Покрывало Софт 230×250, ромб 10×10"
STITCH_REQUIRED_MESSAGE = (
    "Для расчёта покрывала укажите рисунок стёжки. "
    f"Например: {COMPLETE_REQUEST_EXAMPLE}"
)
UNSUPPORTED_CONSTRUCTION_TYPES = {
    "вязаное готовое изделие",
    "муслин с декоративными элементами",
    "покрывало-одеяло",
    "пледового типа",
    "жаккард",
}


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _normalize_token(value: str) -> str:
    text = normalize_model_name(value)
    text = (
        text.replace("×", "x")
        .replace("х", "x")
        .replace("*", "x")
        .replace("ё", "е")
    )
    for token in (" см", "см", "«", "»", '"'):
        text = text.replace(token, "")
    return " ".join(text.split())


def _new_request_message(requirement: str, example: str | None = None) -> str:
    """Ask for a complete bedspread request, without a session follow-up."""
    sample = example or COMPLETE_REQUEST_EXAMPLE
    return (
        f"Для расчёта покрывала укажите {requirement} в новом полном запросе. "
        f"Например: {sample}"
    )


def _unavailable(
    reason_code: str,
    message: str,
    *,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    result = {
        "status": "unavailable",
        "reason_code": reason_code,
        "message": message,
        "reason": message,
    }
    if details:
        result["details"] = details
    return result


def _line(
    *,
    operation_id: str,
    group: str,
    variant: str,
    unit: str,
    calculation_basis: str,
    tariff: Decimal,
    basis: Decimal,
    formula: str,
) -> dict[str, Any]:
    return {
        "operation_id": operation_id,
        "group": group,
        "variant": variant,
        "unit": unit,
        "calculation_basis": calculation_basis,
        "tariff_rub": float(tariff),
        "formula": formula,
        "basis_value": float(basis),
        "cost_rub": money(tariff * basis),
    }


def _fabrics() -> list[dict[str, Any]]:
    return _read_json(DATA_DIR / "fabrics.json")["records"]


def _operations() -> list[dict[str, Any]]:
    return _read_json(DATA_DIR / "operations.json")["records"]


def _models() -> list[dict[str, Any]]:
    return _read_json(DRAFT_DIR / "models.json")["records"]


def _draft_operations() -> list[dict[str, Any]]:
    return _read_json(DRAFT_DIR / "operations.json")["records"]


def _find_fabric(name: str) -> dict[str, Any] | None:
    expected = normalize_model_name(name)
    matches = [
        record
        for record in _fabrics()
        if normalize_model_name(str(record.get("name") or "")) == expected
    ]
    if len(matches) != 1:
        return None
    return matches[0]


def _stitch_options() -> list[dict[str, Any]]:
    return [
        record
        for record in _draft_operations()
        if record.get("group") == "Стежка покрывала"
        and record.get("tariff_rub") is not None
        and record.get("variant")
    ]


def _stitch_by_name(name: str) -> dict[str, Any] | None:
    expected = _normalize_token(name)
    matches = [
        record
        for record in _stitch_options()
        if _normalize_token(str(record["variant"])) == expected
    ]
    if len(matches) != 1:
        return None
    return matches[0]


def _filling_options() -> list[dict[str, Any]]:
    return [
        record
        for record in _draft_operations()
        if record.get("group") == "Толщина покрывала"
        and record.get("tariff_rub") is not None
    ]


def _filling_record(value: str | None) -> dict[str, Any] | None:
    options = _filling_options()
    if value is None:
        return next(
            record
            for record in options
            if "100" in str(record["variant"])
        )
    text = _normalize_token(value)
    if "200" in text or "средн" in text:
        return next(record for record in options if "200" in str(record["variant"]))
    if "100" in text or "легк" in text:
        return next(record for record in options if "100" in str(record["variant"]))
    return None


def _lining_record(value: str | None) -> dict[str, Any] | None:
    options = [
        record
        for record in _draft_operations()
        if record.get("group") == "Подкладка покрывала"
        and record.get("tariff_rub") is not None
        and (
            "анна" in _normalize_token(str(record["variant"]))
            or "сканди" in _normalize_token(str(record["variant"]))
        )
    ]
    if value is None:
        key = "анна"
    else:
        text = _normalize_token(value)
        if "анна" in text:
            key = "анна"
        elif "сканди" in text:
            key = "сканди"
        else:
            return None
    matches = [
        record
        for record in options
        if key in _normalize_token(str(record["variant"]))
    ]
    if len(matches) != 1:
        return None
    return matches[0]


def _operation_by_id(operation_id: str) -> dict[str, Any] | None:
    for record in _operations():
        if record.get("id") == operation_id:
            return record
    return None


def _confirmed_face_fabric(model: dict[str, Any]) -> dict[str, Any] | None:
    face = model.get("face_fabric") or {}
    if face.get("match") != "exact" or face.get("source") != "product_description":
        return None
    if not face.get("confirmed") or not face.get("catalog_name"):
        return None
    return _find_fabric(str(face["catalog_name"]))


def _embroidery_operation(model: dict[str, Any]) -> dict[str, Any] | None:
    embroidery = model.get("embroidery") or {}
    if not embroidery.get("on_bedspread"):
        return None
    if embroidery.get("described_as") != "с вышивкой":
        return None
    candidate = embroidery.get("candidate") or {}
    operation_id = candidate.get("operation_id")
    if not operation_id:
        return None
    operation = _operation_by_id(str(operation_id))
    if operation is None:
        return None
    if normalize_model_name(str(operation.get("variant") or "")) != normalize_model_name(
        str(candidate.get("variant") or "")
    ):
        return None
    if Decimal(str(operation.get("tariff_rub"))) != Decimal(str(candidate.get("tariff_rub"))):
        return None
    return operation


def _lining_conflict(model: dict[str, Any]) -> str | None:
    lining = (model.get("construction") or {}).get("lining")
    if lining in (None, "not_mentioned", "mentioned_fabric_not_named"):
        return None
    if isinstance(lining, str):
        return lining
    return None


def _unsupported_reason(model: dict[str, Any]) -> str | None:
    construction = model.get("construction") or {}
    kind = construction.get("construction_type")
    if kind in UNSUPPORTED_CONSTRUCTION_TYPES or not construction.get("quilted"):
        label = kind or "нестеганая конструкция"
        return (
            f"Покрывало «{model['model']}» имеет конструкцию «{label}». "
            "Стандартный пошив стеганого покрывала к нему не применяется."
        )
    return None


REQUEST_PARAMETERS = [
    "стежка из прайса",
    "лицевая ткань из каталога",
    "синтепон 100 или 200 г/м²",
    "подкладка «Анна» или «Сканди»",
]


def _suggested_fabric(model: dict[str, Any]) -> dict[str, Any] | None:
    """Name match is a hypothesis, not a price input."""
    face = model.get("face_fabric") or {}
    if face.get("source") != "model_name_equals_catalog_fabric":
        return None
    if face.get("match") != "exact" or not face.get("catalog_name"):
        return None
    fabric = _find_fabric(str(face["catalog_name"]))
    if fabric is None:
        return None
    if fabric.get("width_cm") in (None, "") or fabric.get("rrc_price_rub_per_m") in (
        None,
        "",
    ):
        return None
    return {
        "name": fabric["name"],
        "confirmation": "требует подтверждения",
        "used_in_price": False,
    }


def classify_model(model: dict[str, Any]) -> dict[str, Any]:
    """Describe whether a draft model can be priced without invented data."""
    missing: list[str] = []
    unsupported = _unsupported_reason(model)
    lining_conflict = _lining_conflict(model)
    embroidery = model.get("embroidery") or {}
    embroidery_missing = bool(
        embroidery.get("on_bedspread") and _embroidery_operation(model) is None
    )
    fabric_missing = _confirmed_face_fabric(model) is None
    if unsupported:
        missing.append("неподдерживаемая конструкция")
    if fabric_missing:
        missing.append("лицевая ткань не подтверждена описанием")
    if lining_conflict:
        missing.append("подкладка названа, но не равна Анне или Сканди")
    if embroidery_missing:
        missing.append("тариф или тип вышивки не подтверждён")

    if unsupported:
        status = "неподдерживаемая технология"
        block_reason = unsupported
        manager_can_specify: list[str] = []
    elif embroidery_missing:
        status = "требуется уточнение"
        block_reason = (
            "Обязательная вышивка указана в карточке, но её тариф не подтверждён. "
            "Другой тариф вместо неё не подставляется."
        )
        manager_can_specify = []
    elif lining_conflict:
        status = "требуется уточнение"
        block_reason = (
            f"Подкладка описана как «{lining_conflict}». "
            "Тарифы «Анна» и «Сканди» вместо неё не подставляются."
        )
        manager_can_specify = []
    elif fabric_missing:
        status = "требуется уточнение"
        block_reason = "Лицевая ткань описанием не подтверждена."
        manager_can_specify = list(REQUEST_PARAMETERS)
    else:
        status = "готова к расчёту"
        block_reason = None
        manager_can_specify = list(REQUEST_PARAMETERS)

    return {
        "model": model["model"],
        "article": model["article"],
        "aliases": [model["model"]],
        "default_fabric": (model.get("face_fabric") or {}).get("catalog_name")
        if not fabric_missing
        else None,
        "fabric_source": (model.get("face_fabric") or {}).get("source"),
        "suggested_fabric": _suggested_fabric(model),
        "default_stitch": None,
        "embroidery": embroidery.get("described_as"),
        "embroidery_operation_id": (
            _embroidery_operation(model) or {}
        ).get("id"),
        "construction": (model.get("construction") or {}).get("construction_type")
        or ("стеганое" if (model.get("construction") or {}).get("quilted") else None),
        "calculation_status": status,
        "block_reason": block_reason,
        "manager_can_specify": manager_can_specify,
        "missing": missing,
        "open_questions": model.get("open_questions") or [],
    }


def readiness_report() -> list[dict[str, Any]]:
    return [classify_model(model) for model in _models()]


def _classification_details(
    model: dict[str, Any],
    classification: dict[str, Any],
    **extra: Any,
) -> dict[str, Any]:
    details = {
        "model": model["model"],
        "calculation_status": classification["calculation_status"],
        "block_reason": classification["block_reason"],
        "manager_can_specify": classification["manager_can_specify"],
        "missing": classification["missing"],
    }
    suggested = classification.get("suggested_fabric")
    if suggested:
        details["suggested_fabric"] = suggested
    details.update(extra)
    return details


def _resolve_model(requested: str) -> dict[str, Any] | None:
    normalized = _normalize_token(requested)
    if normalized.startswith("покрывало "):
        normalized = normalized[len("покрывало "):].strip()
    for model in _models():
        if _normalize_token(model["model"]) == normalized:
            return model
    return None


def calculate_bedspread(
    request: dict[str, Any],
    audit: dict[str, Any],
    *,
    width_cm: Decimal,
    height_cm: Decimal,
    quantity: int,
    configuration: dict[str, str | None],
    extra_operations: list[str],
) -> dict[str, Any]:
    model = _resolve_model(str(request.get("model") or ""))
    if model is None:
        requested = str(request.get("model") or "").strip()
        message = (
            f"Покрывало «{requested}» нет в справочнике покрывал. "
            + _new_request_message("модель из справочника")
        )
        return _unavailable(
            "BEDSPREAD_MODEL_NOT_FOUND",
            message,
            details={"model": request.get("model"), "missing": ["модель"]},
        )

    classification = classify_model(model)
    audit["bedspread_model"] = model["model"]
    audit["bedspread_status"] = classification["calculation_status"]
    unsupported = _unsupported_reason(model)
    if unsupported:
        return _unavailable(
            "BEDSPREAD_CONSTRUCTION_UNSUPPORTED",
            unsupported,
            details=_classification_details(model, classification),
        )

    embroidery = model.get("embroidery") or {}
    embroidery_operation = _embroidery_operation(model)
    if embroidery.get("on_bedspread") and embroidery_operation is None:
        message = (
            f"У покрывала «{model['model']}» в карточке указана вышивка, "
            "но её тариф или расположение не подтверждены. "
            "Другой тариф вместо этой вышивки не подставляется."
        )
        return _unavailable(
            "BEDSPREAD_EMBROIDERY_UNCONFIRMED",
            message,
            details=_classification_details(
                model,
                classification,
                described_as=embroidery.get("described_as"),
            ),
        )

    lining_conflict = _lining_conflict(model)
    if lining_conflict:
        message = (
            f"У покрывала «{model['model']}» подкладка описана как "
            f"«{lining_conflict}». Это не «Анна» и не «Сканди», "
            "поэтому стандартный тариф подкладки не применён."
        )
        return _unavailable(
            "BEDSPREAD_LINING_UNCONFIRMED",
            message,
            details=_classification_details(
                model,
                classification,
                lining=lining_conflict,
            ),
        )

    requested_face = request.get("face_fabric")
    if requested_face is not None and not isinstance(requested_face, str):
        return _unavailable(
            "MISSING_RULE",
            "Поле face_fabric должно быть строкой или null.",
        )
    if isinstance(requested_face, str):
        requested_face = requested_face.strip() or None
    if requested_face:
        fabric = _find_fabric(requested_face)
        if fabric is None:
            return _unavailable(
                "FABRIC_NOT_FOUND",
                (
                    f"Ткань «{requested_face}» не найдена в каталоге. "
                    + _new_request_message(
                        "лицевую ткань из каталога",
                        f"Покрывало {model['model']} 230×250 из ткани Софт, ромб 10×10",
                    )
                ),
                details={"model": model["model"], "fabric": requested_face},
            )
    else:
        fabric = _confirmed_face_fabric(model)
        if fabric is None:
            suggested = classification.get("suggested_fabric") or {}
            example = (
                f"Покрывало {model['model']} 230×250 из ткани Софт, ромб 10×10"
            )
            confirmation = ""
            if suggested:
                confirmation = (
                    f" Предполагаемая ткань «{suggested['name']}» — "
                    "требует подтверждения и в цену молча не включается."
                )
            message = _new_request_message("лицевую ткань из каталога", example)
            if confirmation:
                message = f"{message}.{confirmation}"
            return _unavailable(
                "BEDSPREAD_FABRIC_UNCONFIRMED",
                message,
                details=_classification_details(model, classification),
            )

    if fabric.get("width_cm") in (None, "") or fabric.get("rrc_price_rub_per_m") in (
        None,
        "",
    ):
        message = (
            f"У ткани «{fabric['name']}» не заполнены ширина или розничная цена. "
            "Приблизительный расчёт не выполняется."
        )
        return _unavailable(
            "BEDSPREAD_FABRIC_DATA_MISSING",
            message,
            details={"model": model["model"], "fabric": fabric["name"]},
        )

    stitch_name = request.get("stitch")
    if stitch_name is not None and not isinstance(stitch_name, str):
        return _unavailable("MISSING_RULE", "Поле stitch должно быть строкой или null.")
    if isinstance(stitch_name, str):
        stitch_name = stitch_name.strip() or None
    if stitch_name is None:
        return _unavailable(
            "BEDSPREAD_STITCH_REQUIRED",
            STITCH_REQUIRED_MESSAGE,
            details={
                "model": model["model"],
                "field": "stitch",
                "available_options": [
                    str(record["variant"]) for record in _stitch_options()
                ],
            },
        )
    stitch = _stitch_by_name(stitch_name)
    if stitch is None:
        options = [str(record["variant"]) for record in _stitch_options()]
        return _unavailable(
            "BEDSPREAD_STITCH_NOT_FOUND",
            (
                f"Стёжка «{stitch_name}» не найдена в прайсе покрывал. "
                + _new_request_message("рисунок стёжки из прайса")
            ),
            details={
                "model": model["model"],
                "field": "stitch",
                "requested_value": stitch_name,
                "available_options": options,
            },
        )

    filling_name = request.get("filling")
    if filling_name is not None and not isinstance(filling_name, str):
        return _unavailable("MISSING_RULE", "Поле filling должно быть строкой или null.")
    filling = _filling_record(filling_name if isinstance(filling_name, str) else None)
    if filling is None:
        return _unavailable(
            "BEDSPREAD_FILLING_NOT_FOUND",
            _new_request_message(
                "плотность синтепона 100 или 200 г/м²",
                "Покрывало Софт 230×250, ромб 10×10, синтепон 200",
            ),
            details={
                "model": model["model"],
                "field": "filling",
                "requested_value": filling_name,
                "available_options": ["100 г/м²", "200 г/м²"],
            },
        )

    lining_name = configuration.get("lining")
    lining = _lining_record(lining_name)
    if lining is None:
        return _unavailable(
            "BEDSPREAD_LINING_NOT_FOUND",
            _new_request_message(
                "подкладку «Анна» или «Сканди»",
                "Покрывало Софт 230×250, ромб 10×10, подкладка Сканди",
            ),
            details={
                "model": model["model"],
                "field": "lining",
                "requested_value": lining_name,
                "available_options": ["Анна", "Сканди"],
            },
        )

    repeated_embroidery = False
    for extra in extra_operations:
        if (
            embroidery_operation is not None
            and normalize_model_name(extra)
            == normalize_model_name(str(embroidery_operation["variant"]))
        ):
            repeated_embroidery = True
            continue
        return _unavailable(
            "BEDSPREAD_EXTRA_NOT_SUPPORTED",
            (
                f"Операция «{extra}» не входит в расчёт покрывала. "
                "Наволочки, декоративные планки и фурнитура без отдельного правила не добавляются."
            ),
            details={
                "model": model["model"],
                "requested_value": extra,
            },
        )

    consumption = calculate_bedspread_consumption(
        width_cm=width_cm,
        height_cm=height_cm,
        quantity=quantity,
        fabric_width_cm=Decimal(str(fabric["width_cm"])),
    )
    if consumption.status != "success" or consumption.consumption_m is None:
        return _unavailable(
            consumption.reason_code or "BEDSPREAD_FABRIC_TOO_NARROW",
            consumption.reason or "Ткань не подходит по ширине.",
            details={
                "model": model["model"],
                "fabric": fabric["name"],
                "fabric_width_cm": fabric["width_cm"],
            },
        )

    width_m = width_cm / Decimal("100")
    height_m = height_cm / Decimal("100")
    area = width_m * height_m * Decimal(quantity)
    perimeter = Decimal("2") * (width_m + height_m) * Decimal(quantity)
    fabric_cost = consumption.consumption_m * Decimal(str(fabric["rrc_price_rub_per_m"]))
    lines = [
        _line(
            operation_id=str(filling["draft_id"]),
            group="Толщина покрывала",
            variant=str(filling["variant"]),
            unit="М2",
            calculation_basis="площадь готового покрывала",
            tariff=Decimal(str(filling["tariff_rub"])),
            basis=area,
            formula="area",
        ),
        _line(
            operation_id=str(lining["draft_id"]),
            group="Подкладка покрывала",
            variant=str(lining["variant"]),
            unit="М2",
            calculation_basis="площадь готового покрывала",
            tariff=Decimal(str(lining["tariff_rub"])),
            basis=area,
            formula="area",
        ),
        _line(
            operation_id=str(stitch["draft_id"]),
            group="Стежка покрывала",
            variant=str(stitch["variant"]),
            unit="М2",
            calculation_basis="площадь готового покрывала",
            tariff=Decimal(str(stitch["tariff_rub"])),
            basis=area,
            formula="area",
        ),
        _line(
            operation_id="BSD-SEW-BASE",
            group="Пошив покрывала с подкладкой",
            variant="Базовый периметр",
            unit="МП",
            calculation_basis="периметр готового покрывала",
            tariff=SEWING_TARIFF,
            basis=perimeter,
            formula="2*(width+height)",
        ),
    ]
    if embroidery_operation is not None:
        formula = str(embroidery_operation["formula"])
        if formula == "area":
            basis = area
            basis_name = "площадь готового покрывала"
        elif formula == "height":
            basis = height_m * Decimal(quantity)
            basis_name = "высота изделия"
        else:
            return _unavailable(
                "BEDSPREAD_EMBROIDERY_UNCONFIRMED",
                f"Формула вышивки «{embroidery_operation['variant']}» не подтверждена для покрывала.",
                details={"model": model["model"], "formula": formula},
            )
        lines.append(
            _line(
                operation_id=str(embroidery_operation["id"]),
                group=str(embroidery_operation["group"]),
                variant=str(embroidery_operation["variant"]),
                unit=str(embroidery_operation["unit"]),
                calculation_basis=basis_name,
                tariff=Decimal(str(embroidery_operation["tariff_rub"])),
                basis=basis,
                formula=formula,
            )
        )
    lines.append(
        _line(
            operation_id="BSD-PACK",
            group="Упаковка покрывала",
            variant="Чехол из ПВХ или спандбонда",
            unit="ШТ",
            calculation_basis="за изделие",
            tariff=PACKAGING_TARIFF,
            basis=Decimal(quantity),
            formula="quantity",
        )
    )
    operation_cost = sum(
        (Decimal(str(line["cost_rub"])) for line in lines),
        Decimal("0"),
    )
    explanation = (
        f"{consumption.explanation} "
        "Наволочки, декоративные планки и фурнитура в стоимость не входят."
    )
    if repeated_embroidery:
        explanation += " Повторно названная вышивка второй раз не начислена."
    request_payload = {
        "product_type": "bedspread",
        "model": model["model"],
        "width_cm": float(width_cm),
        "height_cm": float(height_cm),
        "quantity": quantity,
        "configuration": {
            "heading": configuration.get("heading"),
            "mechanism": configuration.get("mechanism"),
            "lining": str(lining["variant"]),
            "mounting": configuration.get("mounting"),
        },
        "face_fabric": fabric["name"],
        "stitch": stitch["variant"],
        "filling": filling["variant"],
        "extra_operations": extra_operations,
    }
    audit["explanation"] = explanation
    return {
        "status": "success",
        "request": request_payload,
        "model": {
            "name": model["model"],
            "status": classification["calculation_status"],
            "recipe_code": "BEDSPREAD_QUILTED",
        },
        "fabric": {
            "name": fabric["name"],
            "article": fabric.get("base_article"),
            "width_cm": fabric["width_cm"],
            "price_type": "RRC",
            "price_rub_per_m": fabric["rrc_price_rub_per_m"],
            "status": fabric.get("status"),
            "cost_rub": money(fabric_cost),
        },
        "day_fabric": None,
        "consumption": {
            **consumption.to_dict(),
            "explanation": explanation,
        },
        "operations": {
            "base": lines,
            "additional": [],
            "omitted": [
                "декоративные наволочки",
                "декоративные планки и вставки",
                "фурнитура без отдельного правила",
            ],
        },
        "pricing": build_pricing(
            fabric_cost=fabric_cost,
            operation_cost=operation_cost,
            extras_cost=Decimal("0"),
        ),
    }

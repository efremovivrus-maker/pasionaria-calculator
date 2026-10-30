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
    "пледового типа",
    "жаккард",
    "plaid_type",
}
PLAID_TYPE_MODELS = {"Кьюб", "Бруно", "Лео", "Нигма", "Шифу"}
EXCLUDED_FROM_INDIVIDUAL_CALCULATION = {"Зоуи", "Тина", "Перси"}
NOT_CALCULATED_BEDSPREADS = {
    "Бруно": (
        "Покрывало «Бруно» — готовое вязаное изделие с помпонами. "
        "Индивидуальный расчёт не выполняется."
    ),
    "Лео": (
        "Покрывало «Лео» — готовое вязаное изделие из пике. "
        "Индивидуальный расчёт не выполняется."
    ),
    "Шифу": (
        "Покрывало «Шифу» — муслин с декоративными элементами. "
        "Индивидуальный расчёт не выполняется: отделка не тарифицирована."
    ),
    "Данфорд": (
        "Плед «Данфорд» — готовое изделие. Индивидуальный расчёт не выполняется."
    ),
    "Ниэль": (
        "Плед «Ниэль» — ручная вязка. Индивидуальный расчёт не выполняется."
    ),
    "Хейли": (
        "Плед «Хейли» — готовое изделие. Индивидуальный расчёт не выполняется."
    ),
    "Паудер": (
        "Плед «Паудер» — готовое изделие. Индивидуальный расчёт не выполняется."
    ),
    "Сэмми": (
        "Плед «Сэмми» — готовое изделие. Индивидуальный расчёт не выполняется."
    ),
    "Китти": (
        "Плед «Китти» — готовое изделие. Индивидуальный расчёт не выполняется."
    ),
    "Ричи": (
        "Плед «Ричи» — готовое изделие. Индивидуальный расчёт не выполняется."
    ),
    "Тай": (
        "Плед «Тай» — муслин с декоративной бахромой. "
        "Индивидуальный расчёт не выполняется: бахрома не тарифицирована."
    ),
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


def _bare_five_by_five(name: str) -> bool:
    """«стёжка 5×5» names the size and not the geometry."""
    text = _normalize_token(name).replace("стежка", "")
    return text.replace(" ", "") == "5x5"


def _standard_square_stitch() -> dict[str, Any] | None:
    record = _stitch_by_name("Квадрат 5х5 см", allow_bare_square=False)
    if record is None or Decimal(str(record.get("tariff_rub"))) != Decimal("180"):
        return None
    return record


def _stitch_by_name(name: str, *, allow_bare_square: bool = True) -> dict[str, Any] | None:
    expected = _normalize_token(name)
    matches = [
        record
        for record in _stitch_options()
        if _normalize_token(str(record["variant"])) == expected
    ]
    if len(matches) == 1:
        return matches[0]
    if allow_bare_square and _bare_five_by_five(name):
        return _standard_square_stitch()
    return None


_ABSENT_STITCH_NAMES = {
    "нет",
    "без",
    "без стежки",
    "без рисунка",
    "отсутствует",
    "не нужна",
    "не требуется",
}


def _stitch_explicitly_absent(name: str) -> bool:
    text = _normalize_token(name)
    return text in _ABSENT_STITCH_NAMES or text.startswith("без стежк")


def _stitch_tariff_warning(requested_name: str) -> str:
    return (
        f"Тариф стёжки „{requested_name}“ отсутствует в справочнике. "
        "Стоимость рассчитана по базовому тарифу 180 ₽/м² и требует подтверждения"
    )


def _assumed_square_stitch(requested_name: str) -> dict[str, Any] | None:
    base = _standard_square_stitch()
    if base is None:
        return None
    return {
        **base,
        "variant": requested_name,
        "requested_variant": requested_name,
        "applied_variant": "Квадрат 5×5",
        "tariff_assumed": True,
    }


def _resolve_explicit_stitch(
    name: str,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Known stitch tariff, or the 180 ₽/m² square when the tariff is unknown."""
    if _stitch_explicitly_absent(name):
        message = (
            "Стёжка в запросе явно исключена. "
            "Базовый тариф 180 ₽/м² вместо неё не подставляется."
        )
        return None, _unavailable(
            "BEDSPREAD_STITCH_EXCLUDED",
            message,
            details={"field": "stitch", "requested_value": name},
        )
    found = _stitch_by_name(name)
    if found is not None and found.get("tariff_rub") not in (None, ""):
        return found, None
    assumed = _assumed_square_stitch(name)
    if assumed is None:
        message = (
            "Стандартная стёжка «Квадрат 5х5 см» с тарифом 180 ₽/м² "
            "не найдена в прайсе."
        )
        return None, _unavailable(
            "BEDSPREAD_STITCH_NOT_FOUND",
            message,
            details={"field": "stitch", "requested_value": name},
        )
    return assumed, None


def _filling_options() -> list[dict[str, Any]]:
    return [
        record
        for record in _draft_operations()
        if record.get("group") == "Толщина покрывала"
        and record.get("tariff_rub") is not None
    ]


def _doubled_filling(base: dict[str, Any]) -> dict[str, Any]:
    tariff = Decimal(str(base["tariff_rub"])) * 2
    return {
        **base,
        "variant": "300 г/м² (2 × тариф 200 г/м²)",
        "tariff_rub": tariff,
        "filling_multiplier": 2,
    }


def _filling_record(value: str | None) -> dict[str, Any] | None:
    options = _filling_options()
    if value is None:
        return next(
            record
            for record in options
            if "100" in str(record["variant"])
        )
    text = _normalize_token(value)
    if "300" in text:
        base = next(record for record in options if "200" in str(record["variant"]))
        return _doubled_filling(base)
    if "200" in text or "средн" in text:
        return next(record for record in options if "200" in str(record["variant"]))
    if "100" in text or "легк" in text:
        return next(record for record in options if "100" in str(record["variant"]))
    return None


_LINING_KEYS = ("анна", "сканди", "бойл")


def _lining_record(value: str | None) -> dict[str, Any] | None:
    options = [
        record
        for record in _draft_operations()
        if record.get("group") == "Подкладка покрывала"
        and record.get("tariff_rub") is not None
        and any(
            key in _normalize_token(str(record["variant"]))
            for key in _LINING_KEYS
        )
    ]
    if value is None:
        key = "анна"
    else:
        text = _normalize_token(value)
        key = next((item for item in _LINING_KEYS if item in text), None)
        if key is None:
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


CONFIRMED_FABRIC_SOURCES = {
    "product_description",
    "mapping_review",
    "production_review",
    "price_list_2026_10_30",
}


def _confirmed_face_fabric(model: dict[str, Any]) -> dict[str, Any] | None:
    face = model.get("face_fabric") or {}
    if not face.get("confirmed") or face.get("source") not in CONFIRMED_FABRIC_SOURCES:
        return None
    if face.get("match") == "exact" and face.get("catalog_name"):
        found = _find_fabric(str(face["catalog_name"]))
        if found is not None:
            return found
    width = face.get("catalog_width_cm")
    price = face.get("catalog_rrc_rub_per_m")
    name = face.get("catalog_name") or face.get("stated_name")
    if face.get("source") != "production_review" or name in (None, ""):
        return None
    if width in (None, "") or price in (None, ""):
        return None
    return {
        "name": str(name),
        "width_cm": width,
        "rrc_price_rub_per_m": price,
    }


def _default_stitch_record(model: dict[str, Any]) -> dict[str, Any] | None:
    stitch = model.get("default_stitch") or {}
    if stitch.get("binding") not in {"confirmed", "default_stitch_assumed"}:
        return None
    record = _stitch_by_name(str(stitch.get("variant") or ""))
    if record is None:
        return None
    if str(record.get("draft_id")) != str(stitch.get("operation_id")):
        return None
    if Decimal(str(record.get("tariff_rub"))) != Decimal(str(stitch.get("tariff_rub"))):
        return None
    return record


def _stitch_resolution(model: dict[str, Any]) -> dict[str, Any]:
    resolution = model.get("stitch_resolution") or {}
    return resolution if isinstance(resolution, dict) else {}


def _unresolved_stitch_message(model: dict[str, Any]) -> str | None:
    resolution = _stitch_resolution(model)
    pattern = resolution.get("stated_pattern")
    if resolution.get("status") == "ambiguous":
        return (
            f"У покрывала «{model['model']}» в описании указана стежка "
            f"«{pattern}». Точного тарифа для этого рисунка нет. "
            + _new_request_message("стёжку из прайса")
        )
    if resolution.get("status") == "not_in_catalog":
        return (
            f"Для покрывала «{model['model']}» в таблице указано «{pattern}». "
            "Этого значения нет в прайсе стёжки, тариф «Квадрат 5х5 см» "
            "вместо него не подставляется. "
            + _new_request_message("стёжку из прайса")
        )
    if resolution.get("status") == "customization_locked":
        return (
            f"Покрывало «{model['model']}» нельзя кастомизировать. "
            "Значение «нет возможности кастомизировать» ограничивает изменение модели "
            "и не является стёжкой из прайса. Тариф «Квадрат 5х5 см» вместо него "
            "не подставляется."
        )
    return None


def _is_customization_locked(model: dict[str, Any]) -> bool:
    return (model.get("customization") or {}).get("status") == "locked"


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


def _model_lining(model: dict[str, Any]) -> dict[str, Any] | None:
    rule = model.get("lining_rule") or {}
    if not rule.get("confirmed"):
        return None
    matches = [
        record
        for record in _draft_operations()
        if record.get("group") == "Подкладка покрывала"
        and record.get("draft_id") == rule.get("operation_id")
        and record.get("tariff_rub") is not None
    ]
    if len(matches) != 1:
        return None
    record = matches[0]
    if _normalize_token(str(record.get("variant"))) != _normalize_token(str(rule.get("variant"))):
        return None
    if Decimal(str(record.get("tariff_rub"))) != Decimal(str(rule.get("tariff_rub"))):
        return None
    return record


def _lining_conflict(model: dict[str, Any]) -> str | None:
    if _model_lining(model) is not None:
        return None
    lining = (model.get("construction") or {}).get("lining")
    if lining in (None, "not_mentioned", "mentioned_fabric_not_named"):
        return None
    if isinstance(lining, str):
        return lining
    return None


def _is_plaid(model: dict[str, Any]) -> bool:
    kind = (model.get("construction") or {}).get("construction_type")
    return model["model"] in PLAID_TYPE_MODELS or kind == "plaid_type"


def _unsupported_reason(model: dict[str, Any]) -> str | None:
    if _is_plaid(model):
        return None
    construction = model.get("construction") or {}
    kind = construction.get("construction_type")
    if kind in UNSUPPORTED_CONSTRUCTION_TYPES or not construction.get("quilted"):
        label = kind or "нестеганая конструкция"
        return (
            f"Покрывало «{model['model']}» имеет конструкцию «{label}». "
            "Стандартный пошив стеганого покрывала к нему не применяется."
        )
    return None


def _not_calculated_bedspread(name: str) -> str | None:
    key = name.strip().casefold().replace("ё", "е")
    for model_name, message in NOT_CALCULATED_BEDSPREADS.items():
        if model_name.casefold().replace("ё", "е") == key:
            return message
    return None


def _individual_exclusion_message(model: dict[str, Any]) -> str | None:
    if model["model"] not in EXCLUDED_FROM_INDIVIDUAL_CALCULATION:
        return None
    return (
        f"Покрывало «{model['model']}» исключено из индивидуального расчёта. "
        "Стандартная формула стеганого покрывала к нему не применяется."
    )


REQUEST_PARAMETERS = [
    "стежка из прайса",
    "лицевая ткань из каталога",
    "синтепон 100 или 200 г/м²",
    "подкладка «Анна», «Сканди» или «Бойл»",
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
    individual_exclusion = _individual_exclusion_message(model)
    lining_conflict = _lining_conflict(model)
    embroidery = model.get("embroidery") or {}
    embroidery_missing = bool(
        embroidery.get("on_bedspread") and _embroidery_operation(model) is None
    )
    fabric_missing = _confirmed_face_fabric(model) is None
    plaid = _is_plaid(model)
    stitch_message = None if plaid else _unresolved_stitch_message(model)
    stitch_pattern = _stitch_resolution(model).get("stated_pattern")
    if unsupported:
        missing.append("неподдерживаемая конструкция")
    if individual_exclusion:
        missing.append("исключено из индивидуального расчёта")
    if fabric_missing:
        missing.append("лицевая ткань не подтверждена описанием")
    if lining_conflict:
        missing.append("подкладка названа, но не равна Анне или Сканди")
    if embroidery_missing:
        missing.append("тариф или тип вышивки не подтверждён")
    if stitch_message:
        missing.append(f"рисунок стежки «{stitch_pattern}» не совпал с тарифом")

    notice = _not_calculated_bedspread(model["model"])
    if notice:
        status = "требуется уточнение"
        block_reason = notice
        manager_can_specify: list[str] = []
    elif unsupported:
        status = "неподдерживаемая технология"
        block_reason = unsupported
        manager_can_specify = []
    elif individual_exclusion:
        status = "требуется уточнение"
        block_reason = individual_exclusion
        manager_can_specify = []
    elif plaid and fabric_missing:
        stated = (model.get("face_fabric") or {}).get("stated_name")
        status = "требуется уточнение"
        block_reason = (
            f"Лицевая ткань «{stated}» не найдена в каталоге, цена для неё не задана."
            if stated
            else "Лицевая ткань не названа и в каталоге не найдена."
        )
        manager_can_specify = ["лицевая ткань из каталога"]
    elif plaid:
        status = "готова к расчёту"
        block_reason = None
        manager_can_specify = ["лицевая ткань из каталога"]
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
    elif stitch_message:
        status = "требуется уточнение"
        block_reason = stitch_message
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
        "default_stitch": (model.get("default_stitch") or {}).get("variant"),
        "stitch_binding": (model.get("default_stitch") or {}).get("binding"),
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


def _unpriced_trim_warnings(model: dict[str, Any]) -> list[str]:
    """Name trim the card requires when no tariff is confirmed for it."""
    construction = model.get("construction") or {}
    description = str(model.get("description") or "").lower()
    warnings: list[str] = []
    if construction.get("pom_poms") or "помпон" in description:
        warnings.append(
            "Цена не включает декоративные помпоны: отдельного тарифа нет."
        )
    if "бахром" in description:
        warnings.append("Цена не включает бахрому: отдельного тарифа нет.")
    if "кант" in description:
        warnings.append("Цена не включает кант: отдельного тарифа нет.")
    preserved = " ".join(model.get("preserved_when_fabric_changes") or []).lower()
    named_trim = any(word in description for word in ("помпон", "бахром", "кант"))
    if "декоративн" in preserved and not named_trim:
        warnings.append(
            "Цена не включает декоративные элементы: в карточке они не названы, тарифа нет."
        )
    return warnings


def _draft_by_id(draft_id: str) -> dict[str, Any] | None:
    matches = [
        record
        for record in _draft_operations()
        if record.get("draft_id") == draft_id and record.get("tariff_rub") is not None
    ]
    if len(matches) != 1:
        return None
    return matches[0]


def _price_plaid(
    request: dict[str, Any],
    audit: dict[str, Any],
    *,
    model: dict[str, Any],
    classification: dict[str, Any],
    width_cm: Decimal,
    height_cm: Decimal,
    quantity: int,
    configuration: dict[str, str | None],
    extra_operations: list[str],
) -> dict[str, Any]:
    """Fabric, unlined sewing and packaging. No sintepon, lining or stitch."""
    if extra_operations:
        return _unavailable(
            "BEDSPREAD_EXTRA_NOT_SUPPORTED",
            (
                f"Операция «{extra_operations[0]}» не входит в расчёт покрывала "
                "пледового типа."
            ),
            details={"model": model["model"], "requested_value": extra_operations[0]},
        )
    requested_face = request.get("face_fabric")
    if requested_face is not None and not isinstance(requested_face, str):
        return _unavailable("MISSING_RULE", "Поле face_fabric должно быть строкой или null.")
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
                        f"Покрывало {model['model']} 230×250 из ткани Софт",
                    )
                ),
                details={"model": model["model"], "fabric": requested_face},
            )
    else:
        fabric = _confirmed_face_fabric(model)
        if fabric is None:
            stated = (model.get("face_fabric") or {}).get("stated_name")
            message = _new_request_message(
                "лицевую ткань из каталога",
                f"Покрывало {model['model']} 230×250 из ткани Софт",
            )
            if stated:
                message = (
                    f"Лицевая ткань «{stated}» не найдена в каталоге, "
                    f"цена для неё не задана. {message}"
                )
            else:
                message = f"Лицевая ткань не названа и в каталоге не найдена. {message}"
            return _unavailable(
                "BEDSPREAD_FABRIC_UNCONFIRMED",
                message,
                details=_classification_details(model, classification),
            )
    if fabric.get("width_cm") in (None, "") or fabric.get("rrc_price_rub_per_m") in (None, ""):
        return _unavailable(
            "BEDSPREAD_FABRIC_DATA_MISSING",
            (
                f"У ткани «{fabric['name']}» не заполнены ширина или розничная цена. "
                "Приблизительный расчёт не выполняется."
            ),
            details={"model": model["model"], "fabric": fabric["name"]},
        )
    sewing = _draft_by_id("BSD-SEW-PLAIN")
    packaging = _draft_by_id("BSD-PACK")
    if sewing is None or packaging is None:
        return _unavailable(
            "MISSING_RULE",
            "Для покрывала пледового типа не найден тариф пошива без подкладки или упаковки.",
            details={"model": model["model"]},
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
    perimeter = Decimal("2") * (width_m + height_m) * Decimal(quantity)
    fabric_cost = consumption.consumption_m * Decimal(str(fabric["rrc_price_rub_per_m"]))
    lines = [
        _line(
            operation_id=str(sewing["draft_id"]),
            group=str(sewing["group"]),
            variant=str(sewing.get("variant") or "Пошив без подкладки"),
            unit=str(sewing["unit"]),
            calculation_basis="периметр готового изделия",
            tariff=Decimal(str(sewing["tariff_rub"])),
            basis=perimeter,
            formula="perimeter",
        ),
        _line(
            operation_id=str(packaging["draft_id"]),
            group=str(packaging["group"]),
            variant=str(packaging["variant"]),
            unit=str(packaging["unit"]),
            calculation_basis="за изделие",
            tariff=Decimal(str(packaging["tariff_rub"])),
            basis=Decimal(quantity),
            formula="quantity",
        ),
    ]
    operation_cost = sum((Decimal(str(line["cost_rub"])) for line in lines), Decimal("0"))
    trim_warnings = _unpriced_trim_warnings(model)
    explanation = (
        f"{consumption.explanation} Формула plaid_type: ткань, работа "
        f"«пошив без подкладки» {sewing['tariff_rub']} ₽/м.п. и упаковка "
        f"{packaging['tariff_rub']} ₽. Синтепон, подкладка и стёжка не начислены."
    )
    if trim_warnings:
        explanation += " " + " ".join(trim_warnings)
    audit["explanation"] = explanation
    return {
        "status": "success",
        "request": {
            "product_type": "bedspread",
            "model": model["model"],
            "width_cm": float(width_cm),
            "height_cm": float(height_cm),
            "quantity": quantity,
            "configuration": {
                "heading": configuration.get("heading"),
                "mechanism": configuration.get("mechanism"),
                "lining": None,
                "mounting": configuration.get("mounting"),
            },
            "face_fabric": fabric["name"],
            "stitch": None,
            "filling": None,
            "extra_operations": extra_operations,
        },
        "model": {
            "name": model["model"],
            "status": classification["calculation_status"],
            "recipe_code": "BEDSPREAD_PLAID",
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
                "синтепон",
                "подкладка",
                "стёжка",
                *trim_warnings,
                "декоративные наволочки",
            ],
        },
        "pricing": build_pricing(
            fabric_cost=fabric_cost,
            operation_cost=operation_cost,
            extras_cost=Decimal("0"),
        ),
    }


def _finish_quilted(
    *,
    audit: dict[str, Any],
    model_name: str | None,
    recipe_status: str | None,
    fabric: dict[str, Any],
    width_cm: Decimal,
    height_cm: Decimal,
    quantity: int,
    configuration: dict[str, str | None],
    extra_operations: list[str],
    filling: dict[str, Any],
    lining: dict[str, Any],
    stitch: dict[str, Any],
    stitch_binding: str,
    bare_square: bool,
    embroidery_operation: dict[str, Any] | None,
    repeated_embroidery: bool,
    applied_defaults: tuple[str, ...],
) -> dict[str, Any]:
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
                "model": model_name,
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
                details={"model": model_name, "formula": formula},
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
    if filling.get("filling_multiplier") == 2:
        explanation += (
            " Синтепон 300 г/м²: отдельного тарифа нет, начислен тариф "
            "200 г/м² дважды."
        )
    if stitch_binding == "default_stitch_assumed":
        explanation += (
            " Стёжка «Квадрат 5х5 см», 180 ₽/м², подставлена как "
            "default_stitch_assumed: рисунок в карточке не задан, "
            "использован тариф стандартной стёжки «Ибица»."
        )
    elif stitch_binding == "confirmed":
        explanation += (
            f" Использована подтверждённая стёжка модели «{stitch['variant']}», "
            f"{stitch['tariff_rub']} ₽/м². Вторая стёжка не начислена."
        )
    elif stitch_binding == "explicit" and not stitch.get("tariff_assumed"):
        explanation += " Использована стёжка, названная в запросе. Вторая стёжка не начислена."
    if stitch.get("tariff_assumed"):
        requested_stitch = str(stitch.get("requested_variant") or stitch["variant"])
        explanation += (
            f" Запрошенный рисунок стёжки: «{requested_stitch}». "
            "Применённый расчётный тариф: «Квадрат 5×5», 180 ₽/м². "
            + _stitch_tariff_warning(requested_stitch)
        )
    if bare_square:
        explanation += (
            " Стёжка «5×5» без геометрии принята как «Квадрат 5х5 см», 180 ₽/м²."
        )
    if applied_defaults:
        explanation += " По умолчанию: " + ", ".join(applied_defaults) + "."
    if repeated_embroidery:
        explanation += " Повторно названная вышивка второй раз не начислена."
    request_payload = {
        "product_type": "bedspread",
        "model": model_name,
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
    result = {
        "status": "success",
        "request": request_payload,
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
        "stitch_tariff_assumed": bool(stitch.get("tariff_assumed")),
    }
    if stitch.get("tariff_assumed"):
        requested_stitch = str(stitch.get("requested_variant") or stitch["variant"])
        result["stitch_warning"] = _stitch_tariff_warning(requested_stitch)
        result["stitch_calculation"] = {
            "requested": requested_stitch,
            "applied_operation_id": str(stitch["draft_id"]),
            "applied_variant": "Квадрат 5×5",
            "applied_tariff_rub": 180,
        }
    if model_name is not None:
        result["model"] = {
            "name": model_name,
            "status": recipe_status,
            "recipe_code": "BEDSPREAD_QUILTED",
        }
    return result


def _known_option_message(kind: str, value: str, options: str) -> str:
    return f"{kind} «{value}» не найдена. {options}"


def _price_modeless_bedspread(
    request: dict[str, Any],
    audit: dict[str, Any],
    *,
    width_cm: Decimal,
    height_cm: Decimal,
    quantity: int,
    configuration: dict[str, str | None],
    extra_operations: list[str],
) -> dict[str, Any]:
    """Standard quilt when the request has no bedspread model."""
    requested_face = request.get("face_fabric")
    if requested_face is not None and not isinstance(requested_face, str):
        return _unavailable("MISSING_RULE", "Поле face_fabric должно быть строкой или null.")
    if isinstance(requested_face, str):
        requested_face = requested_face.strip() or None
    if not requested_face:
        message = (
            "Лицевая ткань не указана. Другая ткань вместо неё не подставляется."
        )
        return _unavailable(
            "BEDSPREAD_FACE_FABRIC_REQUIRED",
            message,
            details={"missing": ["лицевая ткань"]},
        )
    fabric = _find_fabric(requested_face)
    if fabric is None:
        message = (
            f"Ткань «{requested_face}» не найдена в каталоге. "
            "Другая ткань вместо неё не подставляется."
        )
        return _unavailable(
            "FABRIC_NOT_FOUND",
            message,
            details={"fabric": requested_face},
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
            details={"fabric": fabric["name"]},
        )

    stitch_name = request.get("stitch")
    if stitch_name is not None and not isinstance(stitch_name, str):
        return _unavailable("MISSING_RULE", "Поле stitch должно быть строкой или null.")
    if isinstance(stitch_name, str):
        stitch_name = stitch_name.strip() or None
    bare_square = stitch_name is not None and _bare_five_by_five(stitch_name)
    applied_defaults: list[str] = []
    if stitch_name is None:
        stitch = _standard_square_stitch()
        stitch_binding = "modeless_default"
        applied_defaults.append("стёжка «Квадрат 5х5 см», 180 ₽/м²")
    else:
        stitch, stitch_error = _resolve_explicit_stitch(stitch_name)
        stitch_binding = "explicit"
        if stitch_error is not None:
            return stitch_error
    if stitch is None:
        message = (
            "Стандартная стёжка «Квадрат 5х5 см» с тарифом 180 ₽/м² "
            "не найдена в прайсе."
        )
        return _unavailable(
            "BEDSPREAD_STITCH_NOT_FOUND",
            message,
            details={"field": "stitch", "requested_value": stitch_name},
        )

    filling_name = request.get("filling")
    if filling_name is not None and not isinstance(filling_name, str):
        return _unavailable("MISSING_RULE", "Поле filling должно быть строкой или null.")
    if isinstance(filling_name, str):
        filling_name = filling_name.strip() or None
    if filling_name is None:
        applied_defaults.append("синтепон 100 г/м²")
    filling = _filling_record(filling_name)
    if filling is None:
        return _unavailable(
            "BEDSPREAD_FILLING_NOT_FOUND",
            _known_option_message(
                "Плотность синтепона",
                str(filling_name),
                "Доступны 100 и 200 г/м².",
            ),
            details={
                "field": "filling",
                "requested_value": filling_name,
                "available_options": ["100 г/м²", "200 г/м²"],
            },
        )

    lining_name = configuration.get("lining")
    if lining_name is not None and not isinstance(lining_name, str):
        return _unavailable(
            "MISSING_RULE",
            "Поле configuration.lining должно быть строкой или null.",
        )
    if isinstance(lining_name, str):
        lining_name = lining_name.strip() or None
    if lining_name is None:
        applied_defaults.append("подкладка «Анна»")
    lining = _lining_record(lining_name)
    if lining is None:
        return _unavailable(
            "BEDSPREAD_LINING_NOT_FOUND",
            _known_option_message(
                "Подкладка",
                str(lining_name),
                "Доступны «Анна», «Сканди» и «Бойл».",
            ),
            details={
                "field": "lining",
                "requested_value": lining_name,
                "available_options": ["Анна", "Сканди", "Бойл"],
            },
        )

    for extra in extra_operations:
        return _unavailable(
            "BEDSPREAD_EXTRA_NOT_SUPPORTED",
            (
                f"Операция «{extra}» не входит в расчёт покрывала. "
                "Наволочки, декоративные планки и фурнитура без отдельного правила не добавляются."
            ),
            details={"requested_value": extra},
        )

    audit["bedspread_model"] = None
    audit["bedspread_status"] = "стандартная формула"
    return _finish_quilted(
        audit=audit,
        model_name=None,
        recipe_status=None,
        fabric=fabric,
        width_cm=width_cm,
        height_cm=height_cm,
        quantity=quantity,
        configuration=configuration,
        extra_operations=extra_operations,
        filling=filling,
        lining=lining,
        stitch=stitch,
        stitch_binding=stitch_binding,
        bare_square=bare_square,
        embroidery_operation=None,
        repeated_embroidery=False,
        applied_defaults=tuple(applied_defaults),
    )


def _named_face_fabric(request: dict[str, Any]) -> str | None:
    value = request.get("face_fabric")
    if not isinstance(value, str):
        return None
    return value.strip() or None


def _price_unknown_name(
    request: dict[str, Any],
    audit: dict[str, Any],
    *,
    requested_name: str,
    width_cm: Decimal,
    height_cm: Decimal,
    quantity: int,
    configuration: dict[str, str | None],
    extra_operations: list[str],
) -> dict[str, Any]:
    """Use an exact catalog fabric when the bedspread model does not exist."""
    explicit_fabric = _named_face_fabric(request)
    if explicit_fabric:
        return _price_modeless_bedspread(
            request,
            audit,
            width_cm=width_cm,
            height_cm=height_cm,
            quantity=quantity,
            configuration=configuration,
            extra_operations=extra_operations,
        )
    fabric = _find_fabric(requested_name)
    if fabric is None:
        message = (
            f"«{requested_name}» не найдено ни среди моделей покрывал, "
            "ни среди тканей каталога."
        )
        return _unavailable(
            "BEDSPREAD_MODEL_NOT_FOUND",
            message,
            details={"model": requested_name},
        )
    priced_request = {**request, "model": None, "face_fabric": fabric["name"]}
    audit["bedspread_fabric_from_name"] = fabric["name"]
    return _price_modeless_bedspread(
        priced_request,
        audit,
        width_cm=width_cm,
        height_cm=height_cm,
        quantity=quantity,
        configuration=configuration,
        extra_operations=extra_operations,
    )


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
    requested_name = str(request.get("model") or "").strip()
    if not requested_name:
        return _price_modeless_bedspread(
            request,
            audit,
            width_cm=width_cm,
            height_cm=height_cm,
            quantity=quantity,
            configuration=configuration,
            extra_operations=extra_operations,
        )
    notice = _not_calculated_bedspread(requested_name)
    if notice:
        return _unavailable("BEDSPREAD_NOT_CALCULATED", notice)
    model = _resolve_model(requested_name)
    if model is None:
        return _price_unknown_name(
            request,
            audit,
            requested_name=requested_name,
            width_cm=width_cm,
            height_cm=height_cm,
            quantity=quantity,
            configuration=configuration,
            extra_operations=extra_operations,
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
    individual_exclusion = _individual_exclusion_message(model)
    if individual_exclusion:
        return _unavailable(
            "BEDSPREAD_INDIVIDUAL_CALCULATION_EXCLUDED",
            individual_exclusion,
            details=_classification_details(model, classification),
        )
    if _is_plaid(model):
        return _price_plaid(
            request,
            audit,
            model=model,
            classification=classification,
            width_cm=width_cm,
            height_cm=height_cm,
            quantity=quantity,
            configuration=configuration,
            extra_operations=extra_operations,
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
            f"«{lining_conflict}». Это не «Анна», не «Сканди» и не «Бойл», "
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
    if requested_face and _is_customization_locked(model):
        confirmed = _confirmed_face_fabric(model)
        confirmed_name = None if confirmed is None else str(confirmed["name"])
        if (
            confirmed_name is None
            or _normalize_token(requested_face) != _normalize_token(confirmed_name)
        ):
            return _unavailable(
                "BEDSPREAD_CUSTOMIZATION_LOCKED",
                _unresolved_stitch_message(model) or "",
                details=_classification_details(model, classification),
            )
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
            stated = (model.get("face_fabric") or {}).get("stated_name")
            message = _new_request_message("лицевую ткань из каталога", example)
            if stated:
                message = (
                    f"Лицевая ткань «{stated}» не найдена в каталоге, "
                    f"цена для неё не задана. {message}"
                )
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
    stitch_binding = "explicit"
    if stitch_name is not None and _is_customization_locked(model):
        return _unavailable(
            "BEDSPREAD_CUSTOMIZATION_LOCKED",
            _unresolved_stitch_message(model) or "",
            details=_classification_details(model, classification),
        )
    if stitch_name is None:
        stitch = _default_stitch_record(model)
        unresolved = _unresolved_stitch_message(model)
        if stitch is None and unresolved:
            return _unavailable(
                "BEDSPREAD_STITCH_UNMATCHED",
                unresolved,
                details=_classification_details(
                    model,
                    classification,
                    field="stitch",
                    stated_pattern=_stitch_resolution(model).get("stated_pattern"),
                ),
            )
        if stitch is None:
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
        stitch_binding = str((model.get("default_stitch") or {}).get("binding"))
    else:
        stitch, stitch_error = _resolve_explicit_stitch(stitch_name)
        if stitch_error is not None:
            return stitch_error
    if stitch is None:
        return _unavailable(
            "BEDSPREAD_STITCH_NOT_FOUND",
            (
                "Стандартная стёжка «Квадрат 5х5 см» с тарифом 180 ₽/м² "
                "не найдена в прайсе."
            ),
            details={
                "model": model["model"],
                "field": "stitch",
                "requested_value": stitch_name,
            },
        )

    filling_name = request.get("filling")
    if filling_name is not None and not isinstance(filling_name, str):
        return _unavailable("MISSING_RULE", "Поле filling должно быть строкой или null.")
    if filling_name is None and (model.get("filling_rule") or {}).get("confirmed"):
        filling_name = str((model.get("filling_rule") or {}).get("requested_value") or "")
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
    if lining_name is not None and not isinstance(lining_name, str):
        return _unavailable(
            "MISSING_RULE",
            "Поле configuration.lining должно быть строкой или null.",
        )
    if lining_name is None and (model.get("lining_rule") or {}).get("confirmed"):
        lining = _model_lining(model)
        if lining is None:
            return _unavailable(
                "BEDSPREAD_LINING_UNCONFIRMED",
                (
                    f"У покрывала «{model['model']}» подкладка задана отдельно, "
                    "но её тариф не совпал со справочником операций."
                ),
                details=_classification_details(model, classification),
            )
    else:
        lining = _lining_record(lining_name if isinstance(lining_name, str) else None)
    if lining is None:
        return _unavailable(
            "BEDSPREAD_LINING_NOT_FOUND",
            _new_request_message(
                "подкладку «Анна», «Сканди» или «Бойл»",
                "Покрывало Софт 230×250, ромб 10×10, подкладка Сканди",
            ),
            details={
                "model": model["model"],
                "field": "lining",
                "requested_value": lining_name,
                "available_options": ["Анна", "Сканди", "Бойл"],
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

    return _finish_quilted(
        audit=audit,
        model_name=model["model"],
        recipe_status=classification["calculation_status"],
        fabric=fabric,
        width_cm=width_cm,
        height_cm=height_cm,
        quantity=quantity,
        configuration=configuration,
        extra_operations=extra_operations,
        filling=filling,
        lining=lining,
        stitch=stitch,
        stitch_binding=stitch_binding,
        bare_square=_bare_five_by_five(stitch_name) if stitch_name else False,
        embroidery_operation=embroidery_operation,
        repeated_embroidery=repeated_embroidery,
        applied_defaults=(),
    )

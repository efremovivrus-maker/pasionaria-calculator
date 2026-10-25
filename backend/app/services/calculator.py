"""Catalog-backed PASIONARIA calculation engine."""

from __future__ import annotations

import json
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterable

from .audit_log import safe_record_calculation
from .configuration import (
    apply_configuration,
    find_exact_mechanism,
    resolve_extra_operation_ids,
)
from .fabric_calculator import calculate_fabric_consumption
from .model_matching import normalize_model_name, resolve_model
from .pricing import build_pricing, money


DATA_DIR = Path(__file__).resolve().parents[1] / "data"
PRODUCT_ALIASES = {
    "curtain": "curtain",
    "curtains": "curtain",
    "штора": "curtain",
    "шторы": "curtain",
    "roman": "roman",
    "roman_curtain": "roman",
    "roman_blind": "roman",
    "римская штора": "roman",
    "римские шторы": "roman",
    "bedspread": "bedspread",
    "покрывало": "bedspread",
    "покрывала": "bedspread",
}
REQUIRED_FIELDS = ("product_type", "model", "width_cm", "height_cm", "quantity")
BLACKOUT_FABRIC_DESCRIPTORS = {"блекаут"}
DAY_NIGHT_MECHANISM_IDS = {"OP_126", "OP_127"}
DEFAULT_DAY_FABRIC = "Вита"
PANEL_OPERATION_GROUPS = (
    "Пошив римской шторы",
    "Крепления к механизму",
)


def _read_catalog(filename: str, key: str) -> list[dict[str, Any]]:
    payload = json.loads((DATA_DIR / filename).read_text(encoding="utf-8"))
    return payload[key]


def _unavailable(
    reason_code: str,
    reason: str,
    *,
    message: str = "Не могу надёжно рассчитать этот вариант.",
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    result = {
        "status": "unavailable",
        "reason_code": reason_code,
        "message": message,
        "reason": reason,
    }
    if details:
        result["details"] = details
    return result


MAYA_MODEL_ALIASES = {"майа", "майя", "мая"}


def _requested_model_name(requested: str) -> str:
    """Apply confirmed model aliases without changing other catalog names."""
    normalized = normalize_model_name(requested)
    if normalized in MAYA_MODEL_ALIASES:
        return "Майа"
    if "мириам" in set(normalized.split()):
        return "Мириам"
    return requested.strip()


def _without_miriam_blackout_descriptor(
    model_name: str,
    extra_operations: list[str],
) -> list[str]:
    if model_name != "Мириам":
        return extra_operations
    return [
        value
        for value in extra_operations
        if normalize_model_name(value) not in BLACKOUT_FABRIC_DESCRIPTORS
    ]


def _catalog_fabric_by_name(name: str) -> dict[str, Any] | None:
    """Return a fabric only when its name matches without fuzzy substitution."""
    expected = normalize_model_name(name)
    if not expected:
        return None
    matches = [
        record
        for record in _read_catalog("fabrics.json", "records")
        if normalize_model_name(str(record.get("name") or "")) == expected
    ]
    if len(matches) != 1:
        return None
    return matches[0]


def _find_casefold(
    records: Iterable[dict[str, Any]],
    field: str,
    value: str,
) -> dict[str, Any] | None:
    expected = value.strip().casefold()
    return next(
        (
            record
            for record in records
            if str(record.get(field) or "").strip().casefold() == expected
        ),
        None,
    )


def _operation_basis(
    formula: str,
    *,
    width_m: Decimal,
    height_m: Decimal,
    quantity: int,
) -> Decimal | None:
    quantity_decimal = Decimal(quantity)
    area = width_m * height_m
    formulas = {
        "width": width_m * quantity_decimal,
        "height": height_m * quantity_decimal,
        "height*2": height_m * Decimal("2") * quantity_decimal,
        "area": area * quantity_decimal,
        "2*(width+height)": (
            Decimal("2") * (width_m + height_m) * quantity_decimal
        ),
        "quantity": quantity_decimal,
    }
    return formulas.get(formula)


def _price_operation(
    operation: dict[str, Any],
    *,
    width_m: Decimal,
    height_m: Decimal,
    quantity: int,
) -> dict[str, Any] | None:
    tariff = operation.get("tariff_rub")
    formula = operation.get("formula")
    if tariff is None or not formula:
        return None
    basis = _operation_basis(
        formula,
        width_m=width_m,
        height_m=height_m,
        quantity=quantity,
    )
    if basis is None:
        return None
    cost = Decimal(str(tariff)) * basis
    return {
        "operation_id": operation["id"],
        "group": operation["group"],
        "variant": operation["variant"],
        "unit": operation["unit"],
        "calculation_basis": operation["calculation_basis"],
        "tariff_rub": float(Decimal(str(tariff))),
        "formula": formula,
        "basis_value": float(basis),
        "cost_rub": money(cost),
    }


def _is_day_night(configuration: dict[str, str | None]) -> bool:
    mechanism = find_exact_mechanism(
        configuration.get("mechanism"),
        _read_catalog("operations.json", "records"),
    )
    return mechanism is not None and mechanism["id"] in DAY_NIGHT_MECHANISM_IDS


def _panel_height_reason(fabric_name: str, *, day: bool) -> str:
    role = "Дневная" if day else "Основная"
    return (
        f"{role} ткань «{fabric_name}» не подходит: высота римской шторы "
        "превышает ширину ткани; разворот и стачивание не разрешены."
    )


def _day_fabric_unavailable(
    reason_code: str,
    reason: str,
    *,
    requested_value: str,
) -> dict[str, Any]:
    return _unavailable(
        reason_code,
        reason,
        message=reason,
        details={
            "field": "day_fabric",
            "requested_value": requested_value,
        },
    )


def _resolve_day_fabric(
    requested_name: str | None,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    fabric_name = requested_name or DEFAULT_DAY_FABRIC
    fabric = _find_casefold(
        _read_catalog("fabrics.json", "records"),
        "name",
        fabric_name,
    )
    if fabric is None:
        return None, _day_fabric_unavailable(
            "FABRIC_NOT_FOUND",
            f"Дневная ткань «{fabric_name}» не найдена в справочнике.",
            requested_value=fabric_name,
        )
    if fabric.get("width_cm") is None:
        return None, _day_fabric_unavailable(
            "FABRIC_WIDTH_UNKNOWN",
            f"Для дневной ткани «{fabric['name']}» не указана ширина.",
            requested_value=fabric["name"],
        )
    if fabric.get("rrc_price_rub_per_m") is None:
        return None, _day_fabric_unavailable(
            "FABRIC_PRICE_UNKNOWN",
            f"Для дневной ткани «{fabric['name']}» не указана розничная цена.",
            requested_value=fabric["name"],
        )
    return fabric, None


def _expand_day_night_operations(
    operation_ids: list[str],
    operations_by_id: dict[str, dict[str, Any]],
    *,
    width_m: Decimal,
    height_m: Decimal,
    quantity: int,
) -> tuple[list[dict[str, Any]] | None, str | None]:
    """Price each panel operation twice and each shared operation once."""
    panel_lines: dict[str, list[dict[str, Any]]] = {
        group: [] for group in PANEL_OPERATION_GROUPS
    }
    shared_lines: list[dict[str, Any]] = []
    other_lines: list[dict[str, Any]] = []
    for operation_id in operation_ids:
        operation = operations_by_id.get(operation_id)
        if operation is None:
            return None, operation_id
        group = operation["group"]
        panels = ("main", "day") if group in panel_lines else (None,)
        for panel in panels:
            line = _price_operation(
                operation,
                width_m=width_m,
                height_m=height_m,
                quantity=quantity,
            )
            if line is None:
                return None, operation_id
            if panel is not None:
                line["panel"] = panel
                panel_lines[group].append(line)
            elif group in {"Механизм", "Монтаж римской шторы"}:
                shared_lines.append(line)
            else:
                if group == "Подкладка":
                    line = {**line, "variant": "Подкладка"}
                other_lines.append(line)
    return (
        [
            line
            for group in PANEL_OPERATION_GROUPS
            for line in panel_lines[group]
        ]
        + shared_lines
        + other_lines,
        None,
    )


def _calculate(
    request: dict[str, Any],
    audit: dict[str, Any],
) -> dict[str, Any]:
    audit.update(
        {
            "product_type": request.get("product_type"),
            "model": request.get("model"),
            "requested_model": request.get("model"),
            "normalized_model": None,
            "match_type": None,
            "match_distance": None,
            "width_cm": request.get("width_cm"),
            "height_cm": request.get("height_cm"),
            "quantity": request.get("quantity"),
        }
    )
    missing = [
        field
        for field in REQUIRED_FIELDS
        if field not in request or request[field] in (None, "")
    ]
    if missing:
        return _unavailable(
            "MISSING_RULE",
            f"Отсутствуют обязательные поля: {', '.join(missing)}.",
        )

    product_value = str(request["product_type"]).strip().casefold()
    product_type = PRODUCT_ALIASES.get(product_value)
    if product_type is None:
        return _unavailable(
            "UNSUPPORTED_PRODUCT",
            f"Тип изделия {request['product_type']!r} не поддерживается.",
        )
    audit["product_type"] = product_type

    try:
        width_cm = Decimal(str(request["width_cm"]))
        height_cm = Decimal(str(request["height_cm"]))
        quantity_decimal = Decimal(str(request["quantity"]))
        quantity = int(quantity_decimal)
    except (InvalidOperation, TypeError, ValueError):
        return _unavailable("MISSING_RULE", "Размеры и количество должны быть числами.")
    if (
        width_cm <= 0
        or height_cm <= 0
        or quantity <= 0
        or quantity_decimal != Decimal(quantity)
    ):
        return _unavailable(
            "MISSING_RULE",
            "Размеры должны быть положительными, количество — целым и положительным.",
        )

    configuration_value = request.get("configuration") or {}
    if not isinstance(configuration_value, dict):
        return _unavailable(
            "MISSING_RULE",
            "Поле configuration должно быть объектом.",
        )
    configuration: dict[str, str | None] = {}
    for field in ("heading", "mechanism", "lining", "mounting"):
        value = configuration_value.get(field)
        if value is not None and not isinstance(value, str):
            return _unavailable(
                "MISSING_RULE",
                f"Поле configuration.{field} должно быть строкой или null.",
            )
        configuration[field] = value.strip() if value else None

    extra_operations_value = request.get("extra_operations") or []
    if not isinstance(extra_operations_value, list) or any(
        not isinstance(value, str) or not value.strip()
        for value in extra_operations_value
    ):
        return _unavailable(
            "MISSING_RULE",
            "Поле extra_operations должно быть массивом непустых строк.",
        )
    requested_extra_operations = [
        value.strip() for value in extra_operations_value
    ]
    if "day_fabric" in request and request["day_fabric"] is not None:
        if not isinstance(request["day_fabric"], str):
            return _unavailable(
                "MISSING_RULE",
                "Поле day_fabric должно быть строкой или null.",
            )
        requested_day_fabric = request["day_fabric"].strip()
        if not requested_day_fabric:
            return _unavailable(
                "MISSING_RULE",
                "Поле day_fabric не может быть пустым.",
            )
    else:
        requested_day_fabric = None
    audit.update(
        {
            "model": str(request["model"]).strip(),
            "width_cm": float(width_cm),
            "height_cm": float(height_cm),
            "quantity": quantity,
        }
    )
    if product_type == "bedspread":
        from .bedspread import calculate_bedspread

        return calculate_bedspread(
            request,
            audit,
            width_cm=width_cm,
            height_cm=height_cm,
            quantity=quantity,
            configuration=configuration,
            extra_operations=requested_extra_operations,
        )

    master = _read_catalog("master.json", "records")
    requested_model = _requested_model_name(str(request["model"]))
    model_match = resolve_model(
        requested_model,
        (
            record
            for record in master
            if record["product_type"] == product_type
        ),
    )
    model = model_match.model
    audit.update(
        {
            "normalized_model": model["model"] if model else None,
            "match_type": model_match.match_type,
            "match_distance": model_match.distance,
        }
    )
    if model is None:
        fabric_match = _catalog_fabric_by_name(requested_model)
        if fabric_match is not None:
            message = (
                f"Ткань «{fabric_match['name']}» есть в справочнике, "
                "но модели шторы или римской шторы с таким названием нет."
            )
            return _unavailable(
                "MODEL_NOT_FOUND",
                message,
                message=message,
                details={
                    "model": requested_model,
                    "fabric_name": fabric_match["name"],
                    "fabric_without_model": True,
                },
            )
        return _unavailable(
            "MODEL_NOT_FOUND",
            f"Модель {requested_model!r} не найдена в master-каталоге.",
            message=(
                f"Не удалось найти модель «{requested_model}». "
                "Укажите название модели как на сайте pasionaria.ru."
            ),
        )
    audit.update(
        {
            "model": model["model"],
            "model_status": model["status"],
            "recipe_id": model["recipe_code"],
            "fabric": model.get("fabric_name"),
        }
    )
    if model["status"] == "problematic":
        return _unavailable(
            "PROBLEMATIC_MODEL",
            model["reason"] or "Модель помечена как проблемная.",
            message="Расчёт для этой модели пока недоступен.",
        )

    fabric_name = model.get("fabric_name")
    if not fabric_name:
        return _unavailable(
            "FABRIC_NOT_FOUND",
            "Для модели не указана используемая ткань.",
        )
    fabric = _find_casefold(
        _read_catalog("fabrics.json", "records"),
        "name",
        fabric_name,
    )
    if fabric is None:
        return _unavailable(
            "FABRIC_NOT_FOUND",
            f"Ткань {fabric_name!r} из master отсутствует в справочнике тканей.",
        )
    audit.update(
        {
            "fabric": fabric["name"],
            "fabric_width_cm": fabric.get("width_cm"),
            "fabric_price": fabric.get("rrc_price_rub_per_m"),
            "fabric_price_type": "RRC",
        }
    )
    if fabric.get("width_cm") is None:
        return _unavailable(
            "FABRIC_WIDTH_UNKNOWN",
            f"Для ткани {fabric_name!r} не указана ширина.",
        )
    if fabric.get("rrc_price_rub_per_m") is None:
        return _unavailable(
            "FABRIC_PRICE_UNKNOWN",
            f"Для ткани {fabric_name!r} не указана цена RRC.",
        )

    consumption = calculate_fabric_consumption(
        product_type=product_type,
        width_cm=width_cm,
        height_cm=height_cm,
        quantity=quantity,
        fabric_width_cm=Decimal(str(fabric["width_cm"])),
    )
    audit.update(
        {
            "fabric_layout": consumption.layout,
            "fabric_consumption_m": (
                float(consumption.consumption_m)
                if consumption.consumption_m is not None
                else None
            ),
            "explanation": consumption.explanation,
        }
    )
    if consumption.status != "success":
        if (
            product_type == "roman"
            and consumption.reason_code == "ROMAN_TOO_HIGH"
            and _is_day_night(configuration)
        ):
            reason = _panel_height_reason(fabric["name"], day=False)
            return _unavailable(
                "ROMAN_TOO_HIGH",
                reason,
                message=reason,
            )
        return _unavailable(
            consumption.reason_code or "MISSING_RULE",
            consumption.reason or "Не удалось определить расход ткани.",
        )

    recipes = _read_catalog("recipes.json", "recipes")
    recipe = next(
        (
            candidate
            for candidate in recipes
            if candidate["code"] == model["recipe_code"]
        ),
        None,
    )
    if recipe is None:
        return _unavailable(
            "MISSING_RULE",
            f"Шаблон {model['recipe_code']!r} отсутствует.",
        )
    audit["recipe_id"] = recipe["code"]

    operations = _read_catalog("operations.json", "records")
    operations_by_id = {operation["id"]: operation for operation in operations}
    width_m = width_cm / Decimal("100")
    height_m = height_cm / Decimal("100")

    configuration_resolution = apply_configuration(
        product_type=product_type,
        configuration=configuration,
        recipe_operation_ids=recipe["operation_ids"],
        operations=operations,
    )
    if configuration_resolution.error:
        error = configuration_resolution.error
        return _unavailable(
            error.reason_code,
            error.reason,
            message="Не могу надёжно рассчитать выбранный вариант комплектации.",
            details={
                "field": error.field,
                "requested_value": error.requested_value,
                "model": model["model"],
                "product_type": product_type,
                "available_options": error.available_options,
            },
        )

    resolved_operation_ids = configuration_resolution.operation_ids
    is_day_night = any(
        operation_id in DAY_NIGHT_MECHANISM_IDS
        for operation_id in resolved_operation_ids
    )
    if requested_day_fabric and not is_day_night:
        reason = (
            "Дневная ткань указана без механизма «день-ночь». "
            "Уточните механизм: «День-ночь Эконом» или «День-ночь Стандарт»."
        )
        return _unavailable(
            "CONFIGURATION_NOT_SUPPORTED",
            reason,
            message=reason,
            details={
                "field": "day_fabric",
                "requested_value": requested_day_fabric,
                "model": model["model"],
                "product_type": product_type,
                "available_options": [
                    "День-ночь Эконом",
                    "День-ночь Стандарт",
                ],
            },
        )

    day_fabric = None
    day_consumption = None
    if is_day_night:
        day_fabric, day_fabric_error = _resolve_day_fabric(requested_day_fabric)
        if day_fabric_error:
            return day_fabric_error
        day_consumption = calculate_fabric_consumption(
            product_type=product_type,
            width_cm=width_cm,
            height_cm=height_cm,
            quantity=quantity,
            fabric_width_cm=Decimal(str(day_fabric["width_cm"])),
        )
        if day_consumption.status != "success":
            if day_consumption.reason_code == "ROMAN_TOO_HIGH":
                reason = _panel_height_reason(day_fabric["name"], day=True)
                return _unavailable(
                    "ROMAN_TOO_HIGH",
                    reason,
                    message=reason,
                    details={
                        "field": "day_fabric",
                        "requested_value": day_fabric["name"],
                    },
                )
            return _unavailable(
                day_consumption.reason_code or "MISSING_RULE",
                day_consumption.reason
                or "Не удалось определить расход дневной ткани.",
                message=(
                    day_consumption.reason
                    or "Не удалось определить расход дневной ткани."
                ),
                details={
                    "field": "day_fabric",
                    "requested_value": day_fabric["name"],
                },
            )
        audit.update(
            {
                "day_fabric": day_fabric["name"],
                "day_fabric_width_cm": day_fabric["width_cm"],
                "day_fabric_price": day_fabric["rrc_price_rub_per_m"],
                "day_fabric_layout": day_consumption.layout,
                "day_fabric_consumption_m": float(
                    day_consumption.consumption_m
                ),
            }
        )

    base_lines: list[dict[str, Any]] = []
    if is_day_night:
        expanded_lines, failed_operation_id = _expand_day_night_operations(
            resolved_operation_ids,
            operations_by_id,
            width_m=width_m,
            height_m=height_m,
            quantity=quantity,
        )
        if expanded_lines is None:
            return _unavailable(
                "MISSING_RULE",
                f"Нельзя применить тариф операции {failed_operation_id!r}.",
            )
        base_lines.extend(expanded_lines)
        audit.setdefault("operations", []).extend(expanded_lines)
    for operation_id in (
        [] if is_day_night else resolved_operation_ids
    ):
        operation = operations_by_id.get(operation_id)
        if operation is None:
            return _unavailable(
                "MISSING_RULE",
                f"Операция {operation_id!r} отсутствует в справочнике.",
            )
        line = _price_operation(
            operation,
            width_m=width_m,
            height_m=height_m,
            quantity=quantity,
        )
        if line is None:
            return _unavailable(
                "MISSING_RULE",
                f"Нельзя применить тариф операции {operation_id!r}.",
            )
        if (
            operation_id == "OP_021"
            and (configuration.get("heading") or "").casefold() == "люверсы"
        ):
            line = {**line, "variant": "Люверсы"}
        if operation["group"] == "Подкладка":
            line = {**line, "variant": "Подкладка"}
        base_lines.append(line)
        audit.setdefault("operations", []).append(line)

    extra_operation_ids, extra_error = resolve_extra_operation_ids(
        requested_values=_without_miriam_blackout_descriptor(
            model["model"],
            requested_extra_operations,
        ),
        built_in_operation_id=model.get("additional_operation_id"),
        operations=operations,
    )
    if extra_error:
        return _unavailable(
            extra_error.reason_code,
            extra_error.reason,
            message=(
                "Не могу надёжно рассчитать выбранную "
                "дополнительную операцию."
            ),
            details={
                "field": extra_error.field,
                "requested_value": extra_error.requested_value,
                "model": model["model"],
                "product_type": product_type,
                "available_options": extra_error.available_options,
            },
        )

    extra_lines: list[dict[str, Any]] = []
    for extra_operation_id in extra_operation_ids:
        operation = operations_by_id.get(extra_operation_id)
        if operation is None:
            return _unavailable(
                "MISSING_RULE",
                f"Дополнительная операция {extra_operation_id!r} отсутствует.",
            )
        line = _price_operation(
            operation,
            width_m=width_m,
            height_m=height_m,
            quantity=quantity,
        )
        if line is None:
            return _unavailable(
                "MISSING_RULE",
                f"Нельзя применить тариф операции {extra_operation_id!r}.",
            )
        extra_lines.append(line)
        audit.setdefault("extras", []).append(line)

    main_fabric_cost = (
        consumption.consumption_m
        * Decimal(str(fabric["rrc_price_rub_per_m"]))
    )
    day_fabric_cost = (
        day_consumption.consumption_m
        * Decimal(str(day_fabric["rrc_price_rub_per_m"]))
        if day_fabric is not None and day_consumption is not None
        else Decimal("0")
    )
    fabric_cost = main_fabric_cost + day_fabric_cost
    operation_cost = sum(
        (Decimal(str(line["cost_rub"])) for line in base_lines),
        Decimal("0"),
    )
    extras_cost = sum(
        (Decimal(str(line["cost_rub"])) for line in extra_lines),
        Decimal("0"),
    )
    audit.update(
        {
            "fabric_cost": money(fabric_cost),
            "operation_cost": money(operation_cost),
        }
    )

    request_payload = {
        "product_type": product_type,
        "model": model["model"],
        "width_cm": float(width_cm),
        "height_cm": float(height_cm),
        "quantity": quantity,
        "configuration": configuration,
        "extra_operations": requested_extra_operations,
    }
    if day_fabric is not None:
        request_payload["day_fabric"] = day_fabric["name"]
    explanation = consumption.explanation
    if day_fabric is not None and day_consumption is not None:
        explanation = (
            f"Основное полотно: {consumption.explanation} "
            f"Дневное полотно «{day_fabric['name']}»: "
            f"{day_consumption.explanation}"
        )
        audit["day_fabric_cost"] = money(day_fabric_cost)
    audit["explanation"] = explanation
    return {
        "status": "success",
        "request": request_payload,
        "model": {
            "name": model["model"],
            "status": model["status"],
            "recipe_code": model["recipe_code"],
        },
        "fabric": {
            "name": fabric["name"],
            "article": fabric["base_article"],
            "width_cm": fabric["width_cm"],
            "price_type": "RRC",
            "price_rub_per_m": fabric["rrc_price_rub_per_m"],
            "status": fabric["status"],
            "cost_rub": money(main_fabric_cost),
        },
        "day_fabric": (
            {
                "name": day_fabric["name"],
                "article": day_fabric["base_article"],
                "width_cm": day_fabric["width_cm"],
                "price_type": "RRC",
                "price_rub_per_m": day_fabric["rrc_price_rub_per_m"],
                "status": day_fabric["status"],
                "cost_rub": money(day_fabric_cost),
                "consumption": day_consumption.to_dict(),
            }
            if day_fabric is not None and day_consumption is not None
            else None
        ),
        "consumption": {
            **consumption.to_dict(),
            "explanation": explanation,
        },
        "operations": {
            "base": base_lines,
            "additional": extra_lines,
            "omitted": recipe.get("omitted_operations", []),
        },
        "pricing": build_pricing(
            fabric_cost=fabric_cost,
            operation_cost=operation_cost,
            extras_cost=extras_cost,
        ),
    }


def calculate(
    request: dict[str, Any],
    *,
    raw_request: Any = None,
) -> dict[str, Any]:
    """Calculate and always attempt to append one independent audit record."""
    audit: dict[str, Any] = {}
    try:
        result = _calculate(request, audit)
    except Exception as error:
        error_result = {
            "status": "error",
            "reason_code": "CALCULATION_ERROR",
            "reason": str(error),
        }
        safe_record_calculation(
            request=request,
            raw_request=raw_request,
            context=audit,
            result=error_result,
        )
        raise

    safe_record_calculation(
        request=request,
        raw_request=raw_request,
        context=audit,
        result=result,
    )
    return result

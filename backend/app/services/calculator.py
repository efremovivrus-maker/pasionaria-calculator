"""Catalog-backed PASIONARIA calculation engine."""

from __future__ import annotations

import json
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterable

from .audit_log import safe_record_calculation
from .configuration import (
    apply_configuration,
    resolve_extra_operation_ids,
)
from .fabric_calculator import calculate_fabric_consumption
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
}
REQUIRED_FIELDS = ("product_type", "model", "width_cm", "height_cm", "quantity")


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


def _calculate(
    request: dict[str, Any],
    audit: dict[str, Any],
) -> dict[str, Any]:
    audit.update(
        {
            "product_type": request.get("product_type"),
            "model": request.get("model"),
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
    audit.update(
        {
            "model": str(request["model"]).strip(),
            "width_cm": float(width_cm),
            "height_cm": float(height_cm),
            "quantity": quantity,
        }
    )

    master = _read_catalog("master.json", "records")
    model = next(
        (
            record
            for record in master
            if record["product_type"] == product_type
            and record["model"].strip().casefold()
            == str(request["model"]).strip().casefold()
        ),
        None,
    )
    if model is None:
        return _unavailable(
            "MODEL_NOT_FOUND",
            (
                f"Модель {request['model']!r} не найдена для выбранного "
                "типа изделия."
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

    base_lines: list[dict[str, Any]] = []
    for operation_id in configuration_resolution.operation_ids:
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
        base_lines.append(line)
        audit.setdefault("operations", []).append(line)

    extra_operation_ids, extra_error = resolve_extra_operation_ids(
        requested_values=requested_extra_operations,
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

    fabric_cost = (
        consumption.consumption_m
        * Decimal(str(fabric["rrc_price_rub_per_m"]))
    )
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

    return {
        "status": "success",
        "request": {
            "product_type": product_type,
            "model": model["model"],
            "width_cm": float(width_cm),
            "height_cm": float(height_cm),
            "quantity": quantity,
            "configuration": configuration,
            "extra_operations": requested_extra_operations,
        },
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
        },
        "consumption": consumption.to_dict(),
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

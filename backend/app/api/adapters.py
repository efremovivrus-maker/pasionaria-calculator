"""Translate internal calculator results into stable HTTP responses."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from ..schemas.calculation import CalculationRequest


def _operation(line: dict[str, Any]) -> dict[str, Any]:
    return {
        "operation_id": line["operation_id"],
        "name": f"{line['group']}: {line['variant']}",
        "calculation_basis": line["calculation_basis"],
        "quantity": line["basis_value"],
        "tariff": line["tariff_rub"],
        "cost": line["cost_rub"],
    }


def _component_category(
    line: dict[str, Any],
    *,
    is_extra: bool,
) -> str:
    group = str(line["group"]).casefold()
    if "вышив" in group:
        return "embroidery"
    if is_extra:
        return "extra"
    if "упаков" in group:
        return "packaging"
    if "механизм" in group or "креплен" in group:
        return "hardware"
    return "production"


def _component_name(line: dict[str, Any]) -> str:
    group = str(line["group"])
    variant = str(line["variant"])
    if "вышив" in group.casefold():
        return f"{group} «{variant}»"
    return f"{group} — {variant}"


def _operation_component(
    line: dict[str, Any],
    *,
    is_extra: bool,
) -> dict[str, Any]:
    return {
        "category": _component_category(line, is_extra=is_extra),
        "name": _component_name(line),
        "cost": line["cost_rub"],
        "operation_id": line["operation_id"],
        "basis": line["calculation_basis"],
        "quantity": line["basis_value"],
        "tariff": line["tariff_rub"],
        "unit": line["unit"],
    }


def _components(result: dict[str, Any]) -> list[dict[str, Any]]:
    fabric = result["fabric"]
    pricing = result["pricing"]
    base_operations = result["operations"]["base"]
    extra_operations = result["operations"]["additional"]
    components = [
        {
            "category": "fabric",
            "name": f"Ткань «{fabric['name']}»",
            "cost": pricing["fabric_cost"],
        },
        *[
            _operation_component(line, is_extra=False)
            for line in base_operations
        ],
        *[
            _operation_component(line, is_extra=True)
            for line in extra_operations
        ],
    ]

    component_total = sum(
        (Decimal(str(component["cost"])) for component in components),
        Decimal("0"),
    )
    retail_price = Decimal(str(pricing["retail_price"]))
    if abs(component_total - retail_price) > Decimal("0.01"):
        raise ValueError(
            "Calculation components do not match retail_price: "
            f"{component_total} != {retail_price}"
        )
    return components


def adapt_calculation_result(
    *,
    calculation_id: str,
    request: CalculationRequest,
    result: dict[str, Any],
) -> dict[str, Any]:
    if result["status"] == "unavailable":
        details = {
            **(result.get("details") or {}),
            "reason": result.get("reason"),
            "normalized_request": request.calculator_payload(),
        }
        return {
            "status": "unavailable",
            "calculation_id": calculation_id,
            "reason_code": result["reason_code"],
            "message": result["message"],
            "details": details,
        }

    pricing = result["pricing"]
    consumption = result["consumption"]
    fabric = result["fabric"]
    components = _components(result)
    return {
        "status": "success",
        "calculation_id": calculation_id,
        "normalized_request": result["request"],
        "fabric": {
            "name": fabric["name"],
            "width_cm": fabric["width_cm"],
            "price_per_m": fabric["price_rub_per_m"],
            "layout": consumption["layout"],
            "consumption_m": consumption["consumption_m"],
            "cost": pricing["fabric_cost"],
        },
        "operations": [
            _operation(line) for line in result["operations"]["base"]
        ],
        "extras": [
            _operation(line) for line in result["operations"]["additional"]
        ],
        "components": components,
        "operation_cost": pricing["operation_cost"],
        "retail_price": pricing["retail_price"],
        "retail_price_status": pricing["retail_price_status"],
        "explanation": consumption["explanation"],
    }

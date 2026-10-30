"""Translate internal calculator results into stable HTTP responses."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from ..schemas.calculation import CalculationRequest


def _panel_suffix(line: dict[str, Any]) -> str:
    panel = line.get("panel")
    if panel == "main":
        return ", основное полотно"
    if panel == "day":
        return ", дневное полотно"
    return ""


def _operation(line: dict[str, Any]) -> dict[str, Any]:
    return {
        "operation_id": line["operation_id"],
        "name": f"{line['group']}: {line['variant']}{_panel_suffix(line)}",
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
    if group == "Крепление портьеры" and variant.casefold().startswith(
        "люверсы"
    ):
        return "Люверсы"
    if group == "Подкладка":
        return "Подкладка"
    if "вышив" in group.casefold():
        return f"{group} «{variant}»{_panel_suffix(line)}"
    return f"{group} — {variant}{_panel_suffix(line)}"


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


def _fabric_component(
    fabric: dict[str, Any],
    *,
    cost: float,
    panel: str | None = None,
) -> dict[str, Any]:
    name = f"Ткань «{fabric['name']}»"
    if panel == "main":
        name = f"{name} — основное полотно"
    elif panel == "day":
        name = f"{name} — дневное полотно"
    return {
        "category": "fabric",
        "name": name,
        "cost": cost,
    }


def _components(result: dict[str, Any]) -> list[dict[str, Any]]:
    fabric = result["fabric"]
    pricing = result["pricing"]
    day_fabric = result.get("day_fabric")
    base_operations = result["operations"]["base"]
    extra_operations = result["operations"]["additional"]
    if day_fabric:
        fabric_components = [
            _fabric_component(
                fabric,
                cost=fabric["cost_rub"],
                panel="main",
            ),
            _fabric_component(
                day_fabric,
                cost=day_fabric["cost_rub"],
                panel="day",
            ),
        ]
    else:
        fabric_components = [
            _fabric_component(fabric, cost=pricing["fabric_cost"]),
        ]
    components = [
        *fabric_components,
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
    day_fabric = result.get("day_fabric")
    components = _components(result)
    response = {
        "status": "success",
        "calculation_id": calculation_id,
        "normalized_request": result["request"],
        "fabric": {
            "name": fabric["name"],
            "width_cm": fabric["width_cm"],
            "price_per_m": fabric["price_rub_per_m"],
            "layout": consumption["layout"],
            "consumption_m": consumption["consumption_m"],
            "cost": (
                fabric["cost_rub"]
                if day_fabric
                else pricing["fabric_cost"]
            ),
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
    if "stitch_tariff_assumed" in result:
        response["stitch_tariff_assumed"] = bool(result["stitch_tariff_assumed"])
    if result.get("stitch_warning"):
        response["stitch_warning"] = result["stitch_warning"]
    if result.get("stitch_calculation"):
        response["stitch_calculation"] = result["stitch_calculation"]
    if day_fabric:
        day_consumption = day_fabric["consumption"]
        response["day_fabric"] = {
            "name": day_fabric["name"],
            "width_cm": day_fabric["width_cm"],
            "price_per_m": day_fabric["price_rub_per_m"],
            "layout": day_consumption["layout"],
            "consumption_m": day_consumption["consumption_m"],
            "cost": day_fabric["cost_rub"],
        }
    return response

"""Translate internal calculator results into stable HTTP responses."""

from __future__ import annotations

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


def adapt_calculation_result(
    *,
    calculation_id: str,
    request: CalculationRequest,
    result: dict[str, Any],
) -> dict[str, Any]:
    if result["status"] == "unavailable":
        return {
            "status": "unavailable",
            "calculation_id": calculation_id,
            "reason_code": result["reason_code"],
            "message": result["message"],
            "details": {
                "reason": result.get("reason"),
                "normalized_request": request.calculator_payload(),
            },
        }

    pricing = result["pricing"]
    consumption = result["consumption"]
    fabric = result["fabric"]
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
        "operation_cost": pricing["operation_cost"],
        "retail_price": pricing["retail_price"],
        "retail_price_status": pricing["retail_price_status"],
        "explanation": consumption["explanation"],
    }

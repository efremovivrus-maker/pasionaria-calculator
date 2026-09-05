"""Retail pricing aggregation for already-retail catalog tariffs."""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any


RETAIL_PRICING_RULE = "fabric_cost + operation_cost + extras_cost"
MONEY_QUANTUM = Decimal("0.01")


def money(value: Decimal) -> float:
    return float(value.quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP))


def build_pricing(
    *,
    fabric_cost: Decimal,
    operation_cost: Decimal,
    extras_cost: Decimal,
) -> dict[str, Any]:
    """Sum each retail component exactly once, without markup or coefficients."""
    retail_price = fabric_cost + operation_cost + extras_cost
    return {
        "fabric_cost": money(fabric_cost),
        "operation_cost": money(operation_cost),
        "labor_cost": None,
        "hardware_cost": None,
        "extras_cost": money(extras_cost),
        "known_components_total": money(retail_price),
        "retail_price": money(retail_price),
        "retail_price_status": "CALCULATED",
        "retail_pricing_rule": RETAIL_PRICING_RULE,
    }

"""Deterministic fabric-consumption rules from PROMPT.md."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from decimal import Decimal
from math import ceil, floor
from typing import Any, Optional


@dataclass(frozen=True)
class FabricConsumptionResult:
    status: str
    consumption_m: Optional[Decimal] = None
    layout: Optional[str] = None
    cuts: Optional[int] = None
    items_per_cut: Optional[int] = None
    reason_code: Optional[str] = None
    reason: Optional[str] = None
    explanation: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        result = asdict(self)
        if self.consumption_m is not None:
            result["consumption_m"] = float(self.consumption_m)
        return result


def calculate_curtain_consumption(
    *,
    width_cm: Decimal,
    height_cm: Decimal,
    quantity: int,
    fabric_width_cm: Decimal,
) -> FabricConsumptionResult:
    """Calculate curtain fabric usage, including shared rotated cutting."""
    if height_cm + Decimal("10") <= fabric_width_cm:
        consumption = (width_cm + Decimal("20")) * quantity / Decimal("100")
        return FabricConsumptionResult(
            status="success",
            consumption_m=consumption,
            layout="standard",
            cuts=quantity,
            items_per_cut=1,
            explanation=(
                "Высота изделия с технологическим запасом 10 см помещается "
                "в ширину ткани; расход равен ширине изделия + 20 см на каждую штору."
            ),
        )

    items_per_cut = floor(fabric_width_cm / width_cm)
    if items_per_cut < 1:
        return FabricConsumptionResult(
            status="unavailable",
            layout="unavailable",
            reason_code="MISSING_RULE",
            reason=(
                "Обычный раскрой невозможен, а ширина одной развёрнутой шторы "
                "не помещается в ширину ткани. Правило стачивания не задано."
            ),
        )

    cuts = ceil(quantity / items_per_cut)
    consumption = (height_cm + Decimal("20")) * cuts / Decimal("100")
    layout = "rotated_shared" if items_per_cut > 1 and quantity > 1 else "rotated"
    return FabricConsumptionResult(
        status="success",
        consumption_m=consumption,
        layout=layout,
        cuts=cuts,
        items_per_cut=items_per_cut,
        explanation=(
            "Высота с запасом не помещается в ширину ткани, поэтому шторы "
            f"развёрнуты. В одном отрезе помещается {items_per_cut} шт.; "
            f"требуется отрезов: {cuts}."
        ),
    )


def calculate_roman_consumption(
    *,
    width_cm: Decimal,
    height_cm: Decimal,
    quantity: int,
    fabric_width_cm: Decimal,
) -> FabricConsumptionResult:
    """Calculate Roman-blind usage without rotation or fabric joining."""
    if height_cm > fabric_width_cm:
        return FabricConsumptionResult(
            status="unavailable",
            layout="unavailable",
            reason_code="ROMAN_TOO_HIGH",
            reason=(
                "Высота римской шторы превышает ширину используемой ткани; "
                "разворот и стачивание не разрешены."
            ),
        )

    consumption = (width_cm + Decimal("10")) * quantity / Decimal("100")
    return FabricConsumptionResult(
        status="success",
        consumption_m=consumption,
        layout="standard",
        cuts=quantity,
        items_per_cut=1,
        explanation=(
            "Расход римской шторы равен её ширине + 10 см на каждое изделие."
        ),
    )


def calculate_fabric_consumption(
    *,
    product_type: str,
    width_cm: Decimal,
    height_cm: Decimal,
    quantity: int,
    fabric_width_cm: Decimal,
) -> FabricConsumptionResult:
    if product_type == "curtain":
        return calculate_curtain_consumption(
            width_cm=width_cm,
            height_cm=height_cm,
            quantity=quantity,
            fabric_width_cm=fabric_width_cm,
        )
    if product_type == "roman":
        return calculate_roman_consumption(
            width_cm=width_cm,
            height_cm=height_cm,
            quantity=quantity,
            fabric_width_cm=fabric_width_cm,
        )
    return FabricConsumptionResult(
        status="unavailable",
        reason_code="UNSUPPORTED_PRODUCT",
        reason=f"Тип изделия {product_type!r} не поддерживается.",
    )

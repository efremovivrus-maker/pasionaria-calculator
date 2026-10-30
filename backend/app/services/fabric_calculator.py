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
    fullness: Decimal = Decimal("1"),
) -> FabricConsumptionResult:
    """Calculate curtain fabric usage, including shared rotated cutting.

    Bow pleats use the finished width times the fullness coefficient.
    The published ratio 1:2.5 means the cloth is 2.5 times the finished width.
    """
    piece_width = width_cm * fullness
    pleat_note = ""
    if fullness != 1:
        pleat_note = (
            f"Бантовая складка: ширина умножена на {fullness} "
            "(соотношение 1:2,5, ткань в 2,5 раза шире готовой шторы). "
        )
    if height_cm + Decimal("10") <= fabric_width_cm:
        consumption = (piece_width + Decimal("20")) * quantity / Decimal("100")
        return FabricConsumptionResult(
            status="success",
            consumption_m=consumption,
            layout="standard",
            cuts=quantity,
            items_per_cut=1,
            explanation=(
                pleat_note
                + "Высота изделия с технологическим запасом 10 см помещается "
                "в ширину ткани; расход равен ширине изделия + 20 см на каждую штору."
            ),
        )

    items_per_cut = floor(fabric_width_cm / piece_width)
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
            pleat_note
            + "Высота с запасом не помещается в ширину ткани, поэтому шторы "
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


def calculate_bedspread_consumption(
    *,
    width_cm: Decimal,
    height_cm: Decimal,
    quantity: int,
    fabric_width_cm: Decimal,
) -> FabricConsumptionResult:
    """Cut one bedspread from a single width, with a mandatory 20 cm allowance.

    Both orientations are checked. The allowance is added to the side that
    runs along the roll. When the bedspread width fits into the fabric, that
    orientation is used and the allowance is added to the length. Rotation is
    used only when the width does not fit and the length does. Joining is
    not allowed.
    """
    allowance_cm = Decimal("20")
    standard_fits = width_cm <= fabric_width_cm
    rotated_fits = height_cm <= fabric_width_cm
    standard_consumption = (height_cm + allowance_cm) * quantity / Decimal("100")
    rotated_consumption = (width_cm + allowance_cm) * quantity / Decimal("100")
    if standard_fits:
        rotated_note = (
            f" Поворот тоже возможен и дал бы {rotated_consumption} м, "
            "но ширина уже помещается в ткань, поэтому он не выбран."
            if rotated_fits
            else " Поворот невозможен: длина не помещается в ширину ткани."
        )
        return FabricConsumptionResult(
            status="success",
            consumption_m=standard_consumption,
            layout="standard",
            cuts=quantity,
            items_per_cut=1,
            explanation=(
                "Проверены обе ориентации. Припуск 20 см добавлен к длине. "
                f"Раскрой по ширине: {standard_consumption} м."
                f"{rotated_note}"
            ),
        )
    if rotated_fits:
        return FabricConsumptionResult(
            status="success",
            consumption_m=rotated_consumption,
            layout="rotated",
            cuts=quantity,
            items_per_cut=1,
            explanation=(
                "Проверены обе ориентации. Ширина покрывала не помещается "
                f"в ткань {fabric_width_cm} см. Поворот помещает длину в ширину "
                f"ткани; припуск 20 см добавлен к стороне вдоль рулона: "
                f"{rotated_consumption} м."
            ),
        )
    return FabricConsumptionResult(
        status="unavailable",
        layout="unavailable",
        reason_code="BEDSPREAD_FABRIC_TOO_NARROW",
        reason=(
            "Покрывало не помещается в ширину ткани ни в одной ориентации. "
            f"Нужна цельная сторона {width_cm} или {height_cm} см, "
            f"ширина ткани {fabric_width_cm} см. Стачивание полотен не разрешено."
        ),
    )


def calculate_fabric_consumption(
    *,
    product_type: str,
    width_cm: Decimal,
    height_cm: Decimal,
    quantity: int,
    fabric_width_cm: Decimal,
    fullness: Decimal = Decimal("1"),
) -> FabricConsumptionResult:
    if product_type == "curtain":
        return calculate_curtain_consumption(
            width_cm=width_cm,
            height_cm=height_cm,
            quantity=quantity,
            fabric_width_cm=fabric_width_cm,
            fullness=fullness,
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

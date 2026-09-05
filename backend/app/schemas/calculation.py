"""HTTP schemas for the calculation endpoint."""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class CalculationRequest(BaseModel):
    product_type: Literal["curtain", "roman"]
    model: str = Field(min_length=1)
    width_cm: float = Field(gt=0)
    height_cm: float = Field(gt=0)
    quantity: int = Field(ge=1)
    raw_request: Optional[str] = None

    def calculator_payload(self) -> dict[str, Any]:
        return {
            "product_type": self.product_type,
            "model": self.model,
            "width_cm": self.width_cm,
            "height_cm": self.height_cm,
            "quantity": self.quantity,
        }


class NormalizedRequest(BaseModel):
    product_type: Literal["curtain", "roman"]
    model: str
    width_cm: float
    height_cm: float
    quantity: int


class FabricResponse(BaseModel):
    name: str
    width_cm: float
    price_per_m: float
    layout: str
    consumption_m: float
    cost: float


class OperationResponse(BaseModel):
    operation_id: str
    name: str
    calculation_basis: str
    quantity: float
    tariff: float
    cost: float


class SuccessResponse(BaseModel):
    status: Literal["success"]
    calculation_id: str
    normalized_request: NormalizedRequest
    fabric: FabricResponse
    operations: list[OperationResponse]
    extras: list[OperationResponse]
    operation_cost: float
    retail_price: float
    retail_price_status: Literal["CALCULATED"]
    explanation: str


class UnavailableResponse(BaseModel):
    status: Literal["unavailable"]
    calculation_id: str
    reason_code: str
    message: str
    details: dict[str, Any]


class ErrorResponse(BaseModel):
    status: Literal["error"]
    message: str

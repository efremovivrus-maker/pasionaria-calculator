"""HTTP schemas for the calculation endpoint."""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator


class CalculationConfiguration(BaseModel):
    heading: Optional[str] = None
    mechanism: Optional[str] = None
    lining: Optional[str] = None
    mounting: Optional[str] = None

    @field_validator("heading", "mechanism", "lining", "mounting")
    @classmethod
    def strip_option(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            raise ValueError("Configuration option cannot be empty")
        return stripped


class CalculationRequest(BaseModel):
    product_type: Literal["curtain", "roman"]
    model: str = Field(min_length=1)
    width_cm: float = Field(gt=0)
    height_cm: float = Field(gt=0)
    quantity: int = Field(ge=1)
    configuration: CalculationConfiguration = Field(
        default_factory=CalculationConfiguration
    )
    extra_operations: list[str] = Field(default_factory=list)
    raw_request: Optional[str] = None

    @field_validator("extra_operations")
    @classmethod
    def normalize_extra_operations(cls, values: list[str]) -> list[str]:
        normalized = [value.strip() for value in values]
        if any(not value for value in normalized):
            raise ValueError("Extra operation cannot be empty")
        return normalized

    def calculator_payload(self) -> dict[str, Any]:
        return {
            "product_type": self.product_type,
            "model": self.model,
            "width_cm": self.width_cm,
            "height_cm": self.height_cm,
            "quantity": self.quantity,
            "configuration": self.configuration.model_dump(),
            "extra_operations": self.extra_operations,
        }


class NormalizedRequest(BaseModel):
    product_type: Literal["curtain", "roman"]
    model: str
    width_cm: float
    height_cm: float
    quantity: int
    configuration: CalculationConfiguration
    extra_operations: list[str]


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


class CostComponentResponse(BaseModel):
    category: str
    name: str
    cost: float
    operation_id: Optional[str] = None
    basis: Optional[str] = None
    quantity: Optional[float] = None
    tariff: Optional[float] = None
    unit: Optional[str] = None


class SuccessResponse(BaseModel):
    status: Literal["success"]
    calculation_id: str
    normalized_request: NormalizedRequest
    fabric: FabricResponse
    operations: list[OperationResponse]
    extras: list[OperationResponse]
    components: list[CostComponentResponse]
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

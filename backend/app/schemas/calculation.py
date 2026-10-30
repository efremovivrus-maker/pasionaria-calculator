"""HTTP schemas for the calculation endpoint."""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


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
    product_type: Literal["curtain", "roman", "bedspread"]
    model: Optional[str] = None
    width_cm: Optional[float] = None
    height_cm: Optional[float] = None
    quantity: int = Field(ge=1)
    configuration: CalculationConfiguration = Field(
        default_factory=CalculationConfiguration
    )
    day_fabric: Optional[str] = None
    face_fabric: Optional[str] = None
    stitch: Optional[str] = None
    filling: Optional[str] = None
    extra_operations: list[str] = Field(default_factory=list)
    raw_request: Optional[str] = None

    @field_validator("model")
    @classmethod
    def strip_model(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @model_validator(mode="after")
    def require_named_product_fields(self) -> "CalculationRequest":
        if self.product_type != "bedspread":
            if not self.model:
                raise ValueError("Model is required")
            if self.width_cm is None or self.height_cm is None:
                raise ValueError("Dimensions are required")
        if self.width_cm is not None and self.width_cm <= 0:
            raise ValueError("Width must be positive")
        if self.height_cm is not None and self.height_cm <= 0:
            raise ValueError("Height must be positive")
        return self

    @field_validator("day_fabric", "face_fabric", "stitch", "filling")
    @classmethod
    def strip_optional_text(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            raise ValueError("Optional text field cannot be empty")
        return stripped

    @field_validator("extra_operations")
    @classmethod
    def normalize_extra_operations(cls, values: list[str]) -> list[str]:
        normalized = [value.strip() for value in values]
        if any(not value for value in normalized):
            raise ValueError("Extra operation cannot be empty")
        return normalized

    def calculator_payload(self) -> dict[str, Any]:
        payload = {
            "product_type": self.product_type,
            "model": self.model,
            "width_cm": self.width_cm,
            "height_cm": self.height_cm,
            "quantity": self.quantity,
            "configuration": self.configuration.model_dump(),
            "extra_operations": self.extra_operations,
        }
        if self.day_fabric is not None:
            payload["day_fabric"] = self.day_fabric
        if self.face_fabric is not None:
            payload["face_fabric"] = self.face_fabric
        if self.stitch is not None:
            payload["stitch"] = self.stitch
        if self.filling is not None:
            payload["filling"] = self.filling
        return payload


class NormalizedRequest(BaseModel):
    product_type: Literal["curtain", "roman", "bedspread"]
    model: Optional[str] = None
    width_cm: float
    height_cm: float
    quantity: int
    configuration: CalculationConfiguration
    day_fabric: Optional[str] = None
    face_fabric: Optional[str] = None
    stitch: Optional[str] = None
    filling: Optional[str] = None
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


class StitchCalculationResponse(BaseModel):
    requested: str
    applied_operation_id: str
    applied_variant: str
    applied_tariff_rub: float


class SuccessResponse(BaseModel):
    status: Literal["success"]
    calculation_id: str
    normalized_request: NormalizedRequest
    fabric: FabricResponse
    day_fabric: Optional[FabricResponse] = None
    operations: list[OperationResponse]
    extras: list[OperationResponse]
    components: list[CostComponentResponse]
    operation_cost: float
    retail_price: float
    retail_price_status: Literal["CALCULATED"]
    explanation: str
    stitch_tariff_assumed: Optional[bool] = None
    stitch_warning: Optional[str] = None
    stitch_calculation: Optional[StitchCalculationResponse] = None


class UnavailableResponse(BaseModel):
    status: Literal["unavailable"]
    calculation_id: str
    reason_code: str
    message: str
    details: dict[str, Any]


class ErrorResponse(BaseModel):
    status: Literal["error"]
    message: str

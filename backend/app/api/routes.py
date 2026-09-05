"""FastAPI transport routes for the existing calculation engine."""

from __future__ import annotations

from typing import Union
from uuid import uuid4

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from ..schemas.calculation import (
    CalculationRequest,
    ErrorResponse,
    SuccessResponse,
    UnavailableResponse,
)
from ..services.calculator import calculate
from .adapters import adapt_calculation_result


router = APIRouter(prefix="/api")


@router.post(
    "/calculate",
    response_model=Union[SuccessResponse, UnavailableResponse],
    responses={500: {"model": ErrorResponse}},
)
def calculate_endpoint(
    request: CalculationRequest,
) -> Union[dict, JSONResponse]:
    calculation_id = str(uuid4())
    try:
        result = calculate(
            request.calculator_payload(),
            raw_request=request.raw_request,
        )
        return adapt_calculation_result(
            calculation_id=calculation_id,
            request=request,
            result=result,
        )
    except Exception:
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": "Не удалось выполнить расчёт.",
            },
        )

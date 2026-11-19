"""FastAPI transport routes for the existing calculation engine."""

from __future__ import annotations

import os
import secrets
from typing import Union
from uuid import uuid4

from fastapi import APIRouter, Header
from fastapi.responses import JSONResponse, Response

from ..schemas.calculation import (
    CalculationRequest,
    ErrorResponse,
    SuccessResponse,
    UnavailableResponse,
)
from ..services.calculator import calculate
from ..services.price_lists import CATALOGS, price_list, workbook_bytes
from .adapters import adapt_calculation_result


router = APIRouter(prefix="/api")


@router.post(
    "/calculate",
    response_model=Union[SuccessResponse, UnavailableResponse],
    response_model_exclude_none=True,
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


def _price_list_authorized(provided: str | None) -> bool | None:
    expected = os.environ.get("PRICE_LIST_TOKEN", "").strip()
    if not expected:
        return None
    return bool(provided) and secrets.compare_digest(provided, expected)


@router.get("/price-lists/{catalog_name}")
def price_list_endpoint(
    catalog_name: str,
    audience: str = "manager",
    export: str = "json",
    x_price_list_token: Union[str, None] = Header(default=None),
) -> Response:
    authorized = _price_list_authorized(x_price_list_token)
    if authorized is None:
        return JSONResponse(
            status_code=503,
            content={"error": "price_lists_not_configured"},
        )
    if not authorized:
        return JSONResponse(status_code=401, content={"error": "unauthorized"})
    if catalog_name not in CATALOGS or audience not in {"admin", "manager"}:
        return JSONResponse(status_code=404, content={"error": "not_found"})
    payload = price_list(catalog_name, admin=audience == "admin")
    if export == "xlsx":
        return Response(
            content=workbook_bytes(payload),
            media_type=(
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            ),
            headers={
                "Content-Disposition": (
                    f'attachment; filename="pasionaria-{catalog_name}.xlsx"'
                ),
                "Cache-Control": "private, no-store",
            },
        )
    return JSONResponse(
        content=payload,
        headers={"Cache-Control": "private, no-store"},
    )

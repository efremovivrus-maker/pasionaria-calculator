"""Best-effort JSONL audit logging for calculator calls."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4


PROJECT_ROOT = Path(__file__).resolve().parents[3]
CALCULATION_LOG_PATH = PROJECT_ROOT / "logs" / "calculations.jsonl"


def _audit_operation(line: dict[str, Any]) -> dict[str, Any]:
    return {
        "operation_id": line.get("operation_id"),
        "name": ": ".join(
            value
            for value in (line.get("group"), line.get("variant"))
            if value
        ),
        "calculation_basis": line.get("calculation_basis"),
        "quantity": line.get("basis_value"),
        "tariff": line.get("tariff_rub"),
        "cost": line.get("cost_rub"),
    }


def build_calculation_audit(
    *,
    request: dict[str, Any],
    raw_request: Any,
    context: dict[str, Any],
    result: dict[str, Any],
) -> dict[str, Any]:
    pricing = result.get("pricing", {})
    record: dict[str, Any] = {
        "calculation_id": str(uuid4()),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "normalized_request": {
            "product_type": context.get("product_type"),
            "model": context.get("model"),
            "width_cm": context.get("width_cm"),
            "height_cm": context.get("height_cm"),
            "quantity": context.get("quantity"),
        },
        "requested_model": context.get("requested_model"),
        "normalized_model": context.get("normalized_model"),
        "match_type": context.get("match_type"),
        "match_distance": context.get("match_distance"),
        "model_status": context.get("model_status"),
        "fabric": context.get("fabric"),
        "fabric_width_cm": context.get("fabric_width_cm"),
        "fabric_price": context.get("fabric_price"),
        "fabric_price_type": context.get("fabric_price_type"),
        "fabric_layout": context.get("fabric_layout"),
        "fabric_consumption_m": context.get("fabric_consumption_m"),
        "fabric_cost": pricing.get("fabric_cost", context.get("fabric_cost")),
        "recipe_id": context.get("recipe_id"),
        "operations": [
            _audit_operation(line) for line in context.get("operations", [])
        ],
        "extras": [
            _audit_operation(line) for line in context.get("extras", [])
        ],
        "operation_cost": pricing.get(
            "operation_cost",
            context.get("operation_cost"),
        ),
        "known_components_total": pricing.get("known_components_total"),
        "retail_price": pricing.get("retail_price"),
        "retail_price_status": pricing.get("retail_price_status"),
        "status": result.get("status"),
        "reason_code": result.get("reason_code"),
        "reason": result.get("reason"),
        "explanation": context.get("explanation"),
    }
    if raw_request is not None:
        record["raw_request"] = raw_request
    return record


def write_calculation_audit(record: dict[str, Any]) -> None:
    CALCULATION_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(record, ensure_ascii=False, default=str) + "\n"
    with CALCULATION_LOG_PATH.open("a", encoding="utf-8") as log_file:
        log_file.write(serialized)


def safe_write_calculation_audit(record: dict[str, Any]) -> None:
    """Never let an audit storage failure affect calculator behavior."""
    try:
        write_calculation_audit(record)
    except Exception:
        pass


def safe_record_calculation(
    *,
    request: dict[str, Any],
    raw_request: Any,
    context: dict[str, Any],
    result: dict[str, Any],
) -> None:
    """Build and write a record without propagating any audit error."""
    try:
        record = build_calculation_audit(
            request=request,
            raw_request=raw_request,
            context=context,
            result=result,
        )
        write_calculation_audit(record)
    except Exception:
        pass

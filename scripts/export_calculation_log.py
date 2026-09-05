"""Export the calculator JSONL audit log to a technologist-friendly CSV."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = PROJECT_ROOT / "logs" / "calculations.jsonl"
DEFAULT_OUTPUT = PROJECT_ROOT / "logs" / "calculations_export.csv"

CSV_FIELDS = [
    "calculation_id",
    "created_at",
    "status",
    "reason_code",
    "reason",
    "raw_request",
    "product_type",
    "model",
    "width_cm",
    "height_cm",
    "quantity",
    "model_status",
    "fabric",
    "fabric_width_cm",
    "fabric_price",
    "fabric_price_type",
    "fabric_layout",
    "fabric_consumption_m",
    "fabric_cost",
    "recipe_id",
    "operations",
    "extras",
    "operation_cost",
    "known_components_total",
    "retail_price",
    "retail_price_status",
    "explanation",
]


def _display(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return value


def _operations_text(operations: list[dict[str, Any]]) -> str:
    parts = []
    for operation in operations:
        parts.append(
            "{name} [{operation_id}]: {quantity} × {tariff} = {cost} ₽".format(
                name=operation.get("name") or "",
                operation_id=operation.get("operation_id") or "",
                quantity=operation.get("quantity"),
                tariff=operation.get("tariff"),
                cost=operation.get("cost"),
            )
        )
    return "; ".join(parts)


def _csv_row(record: dict[str, Any]) -> dict[str, Any]:
    normalized = record.get("normalized_request") or {}
    return {
        "calculation_id": record.get("calculation_id"),
        "created_at": record.get("created_at"),
        "status": record.get("status"),
        "reason_code": record.get("reason_code"),
        "reason": record.get("reason"),
        "raw_request": _display(record.get("raw_request")),
        "product_type": normalized.get("product_type"),
        "model": normalized.get("model"),
        "width_cm": normalized.get("width_cm"),
        "height_cm": normalized.get("height_cm"),
        "quantity": normalized.get("quantity"),
        "model_status": record.get("model_status"),
        "fabric": record.get("fabric"),
        "fabric_width_cm": record.get("fabric_width_cm"),
        "fabric_price": record.get("fabric_price"),
        "fabric_price_type": record.get("fabric_price_type"),
        "fabric_layout": record.get("fabric_layout"),
        "fabric_consumption_m": record.get("fabric_consumption_m"),
        "fabric_cost": record.get("fabric_cost"),
        "recipe_id": record.get("recipe_id"),
        "operations": _operations_text(record.get("operations") or []),
        "extras": _operations_text(record.get("extras") or []),
        "operation_cost": record.get("operation_cost"),
        "known_components_total": record.get("known_components_total"),
        "retail_price": record.get("retail_price"),
        "retail_price_status": record.get("retail_price_status"),
        "explanation": record.get("explanation"),
    }


def export_calculation_log(input_path: Path, output_path: Path) -> int:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with input_path.open("r", encoding="utf-8") as source, output_path.open(
        "w",
        encoding="utf-8-sig",
        newline="",
    ) as destination:
        writer = csv.DictWriter(destination, fieldnames=CSV_FIELDS)
        writer.writeheader()
        for line_number, line in enumerate(source, start=1):
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(
                    f"Invalid JSON on line {line_number}: {error}"
                ) from error
            writer.writerow(_csv_row(record))
            count += 1
    return count


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    count = export_calculation_log(args.input, args.output)
    print(f"Exported {count} calculations to {args.output}")


if __name__ == "__main__":
    main()

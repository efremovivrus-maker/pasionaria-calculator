"""Run one real, valid-size calculator call for every master record."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from backend.app.services.calculator import calculate


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "backend" / "app" / "data"
DEFAULT_REPORT = PROJECT_ROOT / "logs" / "master_smoke_report.json"


def _read_records(filename: str) -> list[dict[str, Any]]:
    payload = json.loads((DATA_DIR / filename).read_text(encoding="utf-8"))
    return payload["records"]


def _request_for(
    model: dict[str, Any],
    fabrics_by_name: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    fabric = fabrics_by_name.get(model.get("fabric_name"))
    fabric_width = fabric.get("width_cm") if fabric else None
    if model["product_type"] == "roman":
        height_cm = min(180, fabric_width) if fabric_width else 180
    else:
        height_cm = min(270, fabric_width - 10) if fabric_width else 200
    return {
        "product_type": model["product_type"],
        "model": model["model"],
        "width_cm": 100,
        "height_cm": height_cm,
        "quantity": 1,
    }


def smoke_test_master() -> dict[str, Any]:
    master = _read_records("master.json")
    fabrics = _read_records("fabrics.json")
    fabrics_by_name = {fabric["name"]: fabric for fabric in fabrics}
    groups: dict[str, list[dict[str, Any]]] = {
        "SUCCESS": [],
        "INTENTIONAL_PROBLEMATIC": [],
        "UNEXPECTED_UNAVAILABLE": [],
        "ERROR": [],
    }

    for model in master:
        request = _request_for(model, fabrics_by_name)
        identity = {
            "product_type": model["product_type"],
            "model": model["model"],
            "request": request,
        }
        try:
            result = calculate(request, raw_request={"smoke_test": True})
        except Exception as error:
            groups["ERROR"].append({**identity, "error": repr(error)})
            continue

        if result["status"] == "success":
            groups["SUCCESS"].append({**identity, "result": result})
        elif (
            model["status"] == "problematic"
            and result.get("reason_code") == "PROBLEMATIC_MODEL"
        ):
            groups["INTENTIONAL_PROBLEMATIC"].append(
                {
                    **identity,
                    "reason_code": result.get("reason_code"),
                    "reason": result.get("reason"),
                }
            )
        else:
            groups["UNEXPECTED_UNAVAILABLE"].append(
                {
                    **identity,
                    "reason_code": result.get("reason_code"),
                    "reason": result.get("reason"),
                }
            )

    return {
        "total": len(master),
        "counts": {name: len(items) for name, items in groups.items()},
        "groups": groups,
    }


def main() -> None:
    report = smoke_test_master()
    DEFAULT_REPORT.parent.mkdir(parents=True, exist_ok=True)
    DEFAULT_REPORT.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"total": report["total"], **report["counts"]}, indent=2))
    print(f"Report: {DEFAULT_REPORT}")


if __name__ == "__main__":
    main()

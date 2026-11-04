"""Copy a PASIONARIA media catalog JSON into data/media without duplicating offer ids."""

from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: python scripts/import_media_catalog.py catalog.json", file=sys.stderr)
        raise SystemExit(2)
    source = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    offers = source.get("offers") if isinstance(source, dict) else None
    if not isinstance(offers, list):
        print("В файле нет списка offers.", file=sys.stderr)
        raise SystemExit(2)
    kept: dict[str, dict] = {}
    unrecognized = 0
    for offer in offers:
        if not isinstance(offer, dict):
            unrecognized += 1
            continue
        offer_id = str(offer.get("offer_id") or "").strip()
        model = str(offer.get("model") or "").strip()
        if not offer_id or not model:
            unrecognized += 1
            continue
        kept[offer_id] = offer
    destinations = [
        Path("data/media/pasionaria_media_catalog_2026-11-03.json"),
        Path("frontend/data/media/pasionaria_media_catalog_2026-11-03.json"),
    ]
    for destination in destinations:
        destination.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": source.get("schema_version", 1) if isinstance(source, dict) else 1,
        "source": source.get("source") if isinstance(source, dict) else None,
        "offers": list(kept.values()),
    }
    encoded = json.dumps(payload, ensure_ascii=False)
    for destination in destinations:
        destination.write_text(encoded, encoding="utf-8")
    print(f"Импортировано позиций: {len(kept)}")
    print(f"Неопознано: {unrecognized}")
    print("Дубликаты offer_id схлопнуты, выбранные фото в КП не изменяются.")


if __name__ == "__main__":
    main()

"""Role-filtered views of the catalogs the calculation engine reads."""

from __future__ import annotations

import json
from io import BytesIO
from pathlib import Path
from typing import Any

from openpyxl import Workbook

from .bedspread import (
    PACKAGING_TARIFF,
    SEWING_TARIFF,
    _draft_operations,
    _filling_options,
    _models,
    _stitch_options,
)
from .trims import catalog as trim_catalog
from .trims import client_price
from .trims import photo_file
from .pricing import money


DATA_DIR = Path(__file__).resolve().parents[1] / "data"
BEDSPREAD_DRAFT = (
    Path(__file__).resolve().parents[3] / "drafts" / "bedspreads" / "models.json"
)

CATALOGS = ("works", "fabrics", "curtains", "bedspreads", "trims")


def _read(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _table(
    *,
    table_id: str,
    title: str,
    columns: list[dict[str, str]],
    rows: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "id": table_id,
        "title": title,
        "columns": columns,
        "rows": rows,
    }


def _works() -> dict[str, Any]:
    payload = _read(DATA_DIR / "operations.json")
    columns = [
        {"key": "id", "label": "Код"},
        {"key": "category_source", "label": "Раздел"},
        {"key": "group", "label": "Группа"},
        {"key": "variant", "label": "Операция"},
        {"key": "unit", "label": "Единица"},
        {"key": "tariff_rub", "label": "Тариф, ₽"},
        {"key": "calculation_basis", "label": "База расчёта"},
        {"key": "formula", "label": "Формула"},
    ]
    return {
        "version": payload.get("source"),
        "version_date": None,
        "note": "Эти операции использует расчёт штор и римских штор.",
        "tables": [
            _table(
                table_id="operations",
                title="Работы",
                columns=columns,
                rows=[
                    {column["key"]: record.get(column["key"]) for column in columns}
                    for record in payload["records"]
                ],
            )
        ],
    }


def _fabrics(admin: bool) -> dict[str, Any]:
    payload = _read(DATA_DIR / "fabrics.json")
    columns = [
        {"key": "name", "label": "Название"},
        {"key": "base_article", "label": "Артикул"},
        {"key": "width_cm", "label": "Ширина, см"},
        {"key": "unit", "label": "Единица"},
        {"key": "rrc_price_rub_per_m", "label": "Цена, ₽/м"},
        {"key": "status", "label": "Статус"},
    ]
    if admin:
        columns.insert(4, {"key": "base_price_rub_per_m", "label": "Исходная цена, ₽/м"})
        columns.append({"key": "comment", "label": "Комментарий"})
    rows = []
    for record in payload["records"]:
        row = {
            "name": record.get("name"),
            "base_article": record.get("base_article"),
            "width_cm": record.get("width_cm"),
            "unit": "м",
            "rrc_price_rub_per_m": record.get("rrc_price_rub_per_m"),
            "status": record.get("status"),
        }
        if admin:
            row["base_price_rub_per_m"] = record.get("base_price_rub_per_m")
            row["comment"] = record.get("comment")
        rows.append(row)
    return {
        "version": payload.get("source"),
        "version_date": None,
        "note": "В расчёте используется розничная цена rrc_price_rub_per_m.",
        "tables": [_table(table_id="fabrics", title="Ткани", columns=columns, rows=rows)],
    }


def _curtains() -> dict[str, Any]:
    master = _read(DATA_DIR / "master.json")
    recipes = _read(DATA_DIR / "recipes.json")
    rules = {item["code"]: item.get("source_rule") for item in recipes["recipes"]}
    columns = [
        {"key": "model", "label": "Модель"},
        {"key": "product_type_source", "label": "Тип"},
        {"key": "fabric_name", "label": "Ткань"},
        {"key": "recipe_code", "label": "Рецепт"},
        {"key": "status", "label": "Статус"},
        {"key": "calculation_rule", "label": "Правило расчёта"},
    ]
    rows = [
        {
            "model": record.get("model"),
            "product_type_source": record.get("product_type_source"),
            "fabric_name": record.get("fabric_name"),
            "recipe_code": record.get("recipe_code"),
            "status": record.get("status"),
            "calculation_rule": rules.get(record.get("recipe_code")),
        }
        for record in master["records"]
    ]
    return {
        "version": master.get("source"),
        "version_date": None,
        "note": "У модели нет фиксированной цены готового изделия. Стоимость собирается из ткани и операций рецепта.",
        "tables": [_table(table_id="models", title="Модели штор", columns=columns, rows=rows)],
    }


def _bedspreads(admin: bool) -> dict[str, Any]:
    draft = json.loads(BEDSPREAD_DRAFT.read_text(encoding="utf-8"))
    columns = [
        {"key": "model", "label": "Модель"},
        {"key": "article", "label": "Артикул"},
        {"key": "construction", "label": "Конструкция"},
        {"key": "face_fabric", "label": "Лицевая ткань"},
        {"key": "default_stitch", "label": "Стёжка по умолчанию"},
        {"key": "calculation_status", "label": "Статус расчёта"},
    ]
    if admin:
        columns.append({"key": "open_questions", "label": "Открытые вопросы"})
    rows = []
    for record in _models():
        row = {column["key"]: record.get(column["key"]) for column in columns if column["key"] != "open_questions"}
        if admin:
            questions = record.get("open_questions") or []
            row["open_questions"] = "; ".join(str(item) for item in questions) if isinstance(questions, list) else questions
        rows.append(row)
    operation_columns = [
        {"key": "variant", "label": "Вариант"},
        {"key": "unit", "label": "Единица"},
        {"key": "tariff_rub", "label": "Тариф, ₽"},
        {"key": "calculation_basis", "label": "База расчёта"},
    ]
    stitches = [
        {
            "variant": record.get("variant"),
            "unit": record.get("unit"),
            "tariff_rub": record.get("tariff_rub"),
            "calculation_basis": record.get("calculation_basis"),
        }
        for record in _stitch_options()
    ]
    fillings = [
        {
            "variant": record.get("variant"),
            "unit": record.get("unit"),
            "tariff_rub": record.get("tariff_rub"),
            "calculation_basis": record.get("calculation_basis"),
        }
        for record in _filling_options()
    ]
    linings = [
        {
            "variant": record.get("variant"),
            "unit": record.get("unit"),
            "tariff_rub": record.get("tariff_rub"),
            "calculation_basis": record.get("calculation_basis"),
        }
        for record in _draft_operations()
        if record.get("group") == "Подкладка покрывала" and record.get("tariff_rub") is not None
    ]
    fixed = [
        {
            "variant": "Базовый периметр",
            "unit": "МП",
            "tariff_rub": money(SEWING_TARIFF),
            "calculation_basis": "периметр готового покрывала",
        },
        {
            "variant": "Чехол из ПВХ или спандбонда",
            "unit": "ШТ",
            "tariff_rub": money(PACKAGING_TARIFF),
            "calculation_basis": "за изделие",
        },
    ]
    return {
        "version": draft.get("source"),
        "version_date": draft.get("source_date"),
        "note": "Показаны параметры моделей и тарифы, которые выбирает расчёт покрывала. Фиксированной цены готового изделия нет.",
        "tables": [
            _table(table_id="models", title="Модели", columns=columns, rows=rows),
            _table(table_id="stitches", title="Стёжка", columns=operation_columns, rows=stitches),
            _table(table_id="fillings", title="Наполнение", columns=operation_columns, rows=fillings),
            _table(table_id="linings", title="Подкладка", columns=operation_columns, rows=linings),
            _table(table_id="sewing", title="Пошив и упаковка", columns=operation_columns, rows=fixed),
        ],
    }


def _trims(admin: bool) -> dict[str, Any]:
    payload = trim_catalog()
    columns = [
        {"key": "article", "label": "Артикул"},
        {"key": "name", "label": "Название"},
        {"key": "color", "label": "Цвет"},
        {"key": "category", "label": "Категория"},
        {"key": "unit", "label": "Единица"},
        {"key": "client_price_rub_per_m", "label": "Цена для клиента, ₽/м"},
    ]
    if admin:
        columns.extend(
            [
                {"key": "purchase_price_rub_per_m", "label": "Исходная цена, ₽/м"},
                {"key": "markup", "label": "Коэффициент"},
            ]
        )
    photos = False
    rows = []
    for record in payload["records"]:
        price = client_price(record)
        row = {
            "article": record["article"],
            "name": record["name"],
            "color": record["color"],
            "category": record["category"],
            "unit": record["unit"],
            "client_price_rub_per_m": money(price) if price is not None else None,
        }
        photo = photo_file(str(record["article"]))
        if photo:
            photos = True
            row["photo"] = photo
        if admin:
            markup = payload["markup_by_category"].get(record["category"])
            row["purchase_price_rub_per_m"] = record["purchase_price_rub_per_m"]
            row["markup"] = markup
        rows.append(row)
    if photos:
        columns.append({"key": "photo", "label": "Фото"})
    return {
        "version": payload.get("source"),
        "version_date": payload.get("source_date"),
        "note": "Отпускная цена материала — исходная цена ×3. Пришивание считается отдельно, 80 ₽ за погонный метр длины отделки.",
        "tables": [_table(table_id="trims", title="Фурнитура", columns=columns, rows=rows)],
    }


def price_list(catalog_name: str, *, admin: bool) -> dict[str, Any]:
    if catalog_name not in CATALOGS:
        raise KeyError(catalog_name)
    titles = {
        "works": "Работы",
        "fabrics": "Ткани",
        "curtains": "Шторы",
        "bedspreads": "Покрывала",
        "trims": "Фурнитура",
    }
    body = {
        "works": _works,
        "fabrics": lambda: _fabrics(admin),
        "curtains": _curtains,
        "bedspreads": lambda: _bedspreads(admin),
        "trims": lambda: _trims(admin),
    }[catalog_name]()
    return {
        "catalog": catalog_name,
        "title": titles[catalog_name],
        "audience": "admin" if admin else "manager",
        **body,
    }


def workbook_bytes(payload: dict[str, Any]) -> bytes:
    book = Workbook()
    first = True
    for table in payload["tables"]:
        sheet = book.active if first else book.create_sheet()
        first = False
        sheet.title = str(table["title"])[:31]
        sheet.append([column["label"] for column in table["columns"]])
        for row in table["rows"]:
            sheet.append([row.get(column["key"]) for column in table["columns"]])
    buffer = BytesIO()
    book.save(buffer)
    return buffer.getvalue()

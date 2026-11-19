"""Role-filtered views of the catalogs the calculation engine reads."""

from __future__ import annotations

import json
from io import BytesIO
from pathlib import Path
from typing import Any

from openpyxl import Workbook

from .bedspread import (
    EXCLUDED_FROM_INDIVIDUAL_CALCULATION,
    NOT_CALCULATED_BEDSPREADS,
    PACKAGING_TARIFF,
    SEWING_TARIFF,
    _draft_operations,
    _filling_options,
    _models,
    _stitch_options,
    classify_model,
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
    columns: list[dict[str, Any]],
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


_CARD_STATUS = {
    "not_ready": "Не завершена",
}
_INDIVIDUAL_UNAVAILABLE = "Индивидуальный расчёт недоступен"
_LINING = {
    "not_mentioned": "не упомянута",
    "mentioned_fabric_not_named": "упомянута, ткань не названа",
}
_STITCH_BINDING = {
    "confirmed": "подтверждена в карточке",
    "default_stitch_assumed": "рисунок в карточке не задан, взята стандартная стёжка",
}
_FABRIC_MATCH = {
    "exact": "точное совпадение с каталогом",
    "not_found": "в каталоге не найдена",
    "production_specification": "задана спецификацией производства",
}
_FABRIC_SOURCE = {
    "product_description": "описание изделия",
    "mapping_review": "сверка соответствия",
    "production_review": "производственная проверка",
    "price_list_2026_10_30": "прайс 30.10.2026",
    "model_name_equals_catalog_fabric": "имя модели совпало с тканью каталога",
}
_CONSTRUCTION_TYPE = {
    "plaid_type": "пледового типа",
    "стеганое": "стёганое",
}


def _known_label(labels: dict[str, str], value: Any) -> str | None:
    if value in (None, ""):
        return None
    return labels.get(str(value), str(value))


def _yes_no(value: Any) -> str:
    return "да" if value else "нет"


def _construction_summary(construction: dict[str, Any]) -> str:
    kind = construction.get("construction_type")
    if kind:
        label = _CONSTRUCTION_TYPE.get(str(kind), str(kind))
    elif construction.get("quilted"):
        label = "стёганое"
    else:
        label = "нестёганое"
    parts = [label[:1].upper() + label[1:]]
    if construction.get("planks"):
        parts.append("планки")
    ribbon = construction.get("decorative_ribbon")
    if ribbon:
        parts.append(str(ribbon))
    if construction.get("piping"):
        parts.append("кант")
    if construction.get("pom_poms"):
        parts.append("помпоны")
    lining = construction.get("lining")
    if isinstance(lining, str) and lining not in _LINING:
        parts.append(f"подкладка {lining}")
    return ", ".join(parts)


def _fabric_summary(face: dict[str, Any]) -> str:
    name = face.get("catalog_name") or face.get("stated_name") or "не указана"
    if face.get("confirmed") is False:
        return f"{name}, не подтверждена"
    return str(name)


def _stitch_summary(stitch: dict[str, Any] | None) -> str:
    if not stitch or not stitch.get("variant"):
        return "не задана"
    if stitch.get("binding") == "default_stitch_assumed":
        return f"{stitch['variant']}, стандартная"
    return str(stitch["variant"])


def _text_list(value: Any) -> str | None:
    if value in (None, "", []):
        return None
    if isinstance(value, list):
        return ", ".join(str(item) for item in value)
    return str(value)


def _detail(label: str, value: Any) -> dict[str, str] | None:
    if value in (None, ""):
        return None
    return {"label": label, "value": str(value)}


def _individual_calculation_forbidden(model_name: Any) -> bool:
    return (
        model_name in NOT_CALCULATED_BEDSPREADS
        or model_name in EXCLUDED_FROM_INDIVIDUAL_CALCULATION
    )


def _displayed_calculation_status(record: dict[str, Any], classification: dict[str, Any]) -> str:
    if _individual_calculation_forbidden(record.get("model")):
        return _INDIVIDUAL_UNAVAILABLE
    return str(classification["calculation_status"])


def _bedspread_details(
    record: dict[str, Any],
    classification: dict[str, Any],
    *,
    admin: bool,
    calculation_status: str,
) -> dict[str, Any]:
    construction = record.get("construction") or {}
    face = record.get("face_fabric") or {}
    stitch = record.get("default_stitch") or {}
    lining = construction.get("lining")
    construction_rows = [
        item
        for item in (
            _detail("Тип", _construction_summary(construction)),
            _detail("Полотно стеганое", _yes_no(construction.get("quilted"))),
            _detail("Подкладка", _known_label(_LINING, lining) or lining or "не указана"),
            _detail("Планки", _yes_no(construction.get("planks"))),
            _detail("Наполнитель", construction.get("filler") or "не указан"),
            _detail("Рисунок стежки в описании", construction.get("stitch_pattern") or "не указан"),
            _detail("Декоративная лента", construction.get("decorative_ribbon")),
            _detail("Кант", construction.get("piping")),
            _detail("Помпоны", "да" if construction.get("pom_poms") else None),
            _detail("Слова материала", _text_list(construction.get("material_words"))),
        )
        if item
    ]
    fabric_rows = [
        item
        for item in (
            _detail("В описании", face.get("stated_name") or "не названа"),
            _detail("В каталоге", face.get("catalog_name") or "нет соответствия"),
            _detail("Совпадение", _known_label(_FABRIC_MATCH, face.get("match"))),
            _detail("Подтверждена", "да" if face.get("confirmed") else "нет"),
            _detail("Ширина", f"{face['catalog_width_cm']} см" if face.get("catalog_width_cm") else None),
            _detail(
                "Розничная цена",
                f"{face['catalog_rrc_rub_per_m']} ₽/м" if face.get("catalog_rrc_rub_per_m") is not None else None,
            ),
            _detail(
                "Исходная цена",
                f"{face['catalog_base_rub_per_m']} ₽/м"
                if admin and face.get("catalog_base_rub_per_m") is not None
                else None,
            ),
            _detail("Откуда взята", _known_label(_FABRIC_SOURCE, face.get("source"))),
            _detail("Примечание", face.get("note")),
            _detail("Кандидат", face.get("candidate")),
        )
        if item
    ]
    stitch_rows = [
        item
        for item in (
            _detail("Вариант", stitch.get("variant") or "не задана"),
            _detail("Тариф", f"{stitch['tariff_rub']} ₽/м²" if stitch.get("tariff_rub") is not None else None),
            _detail("Как выбрана", _known_label(_STITCH_BINDING, stitch.get("binding"))),
            _detail("Операция", stitch.get("operation_id")),
            _detail("Основание", stitch.get("basis")),
        )
        if item
    ]
    calculation_rows = [
        item
        for item in (
            _detail("Возможность расчёта", calculation_status),
            _detail("Почему расчёт не выполняется", classification.get("block_reason")),
            _detail("Чего не хватает", "; ".join(classification.get("missing") or []) or None),
        )
        if item
    ]
    source_status = record.get("calculation_status")
    forbidden = calculation_status == _INDIVIDUAL_UNAVAILABLE
    card_meaning = (
        "В описании модели остались пробелы. "
        "Полнота карточки не меняет запрет: индивидуальный расчёт для этой модели недоступен."
        if forbidden
        else "В описании модели остались пробелы. "
        "Это не отказ калькулятора: возможность расчёта указана выше."
    )
    return {
        "groups": [
            {"title": "Конструкция", "rows": construction_rows},
            {"title": "Лицевая ткань", "rows": fabric_rows},
            {"title": "Стёжка", "rows": stitch_rows},
            {"title": "Расчёт", "rows": calculation_rows},
            {
                "title": "Карточка справочника",
                "rows": [
                    {
                        "label": "Полнота",
                        "value": _CARD_STATUS.get(str(source_status), str(source_status or "не указана")),
                    },
                    {
                        "label": "Что это значит",
                        "value": card_meaning,
                    },
                ],
            },
        ],
        "questions": [str(item) for item in record.get("open_questions") or []],
    }


def _bedspread_row(record: dict[str, Any], *, admin: bool) -> dict[str, Any]:
    classification = classify_model(record)
    questions = [str(item) for item in record.get("open_questions") or []]
    source_status = record.get("calculation_status")
    calculation_status = _displayed_calculation_status(record, classification)
    return {
        "model": record.get("model"),
        "article": record.get("article"),
        "construction": _construction_summary(record.get("construction") or {}),
        "face_fabric": _fabric_summary(record.get("face_fabric") or {}),
        "default_stitch": _stitch_summary(record.get("default_stitch")),
        "calculator_status": calculation_status,
        "card_status": _CARD_STATUS.get(str(source_status), str(source_status or "—")),
        "open_questions": "; ".join(questions),
        "details": _bedspread_details(
            record,
            classification,
            admin=admin,
            calculation_status=calculation_status,
        ),
    }


def _bedspreads(admin: bool) -> dict[str, Any]:
    draft = json.loads(BEDSPREAD_DRAFT.read_text(encoding="utf-8"))
    columns = [
        {"key": "model", "label": "Модель"},
        {"key": "article", "label": "Артикул"},
        {"key": "construction", "label": "Конструкция"},
        {"key": "face_fabric", "label": "Лицевая ткань"},
        {"key": "default_stitch", "label": "Стёжка по умолчанию"},
        {"key": "calculator_status", "label": "Расчёт"},
        {"key": "card_status", "label": "Карточка"},
        {"key": "open_questions", "label": "Открытые вопросы", "export_only": True},
    ]
    rows = [_bedspread_row(record, admin=admin) for record in _models()]
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
        "note": (
            "Показаны параметры моделей и тарифы, которые выбирает расчёт покрывала. "
            "Фиксированной цены готового изделия нет. Пометка «не завершена» относится "
            "к полноте карточки в справочнике, а не к отказу калькулятора. "
            "Файл справочника помечен как не подключённый, но калькулятор уже читает эти карточки."
        ),
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


def _excel_cell(value: Any) -> Any:
    if isinstance(value, dict):
        return "; ".join(
            f"{key}: {_excel_cell(item)}"
            for key, item in value.items()
            if item not in (None, "")
        )
    if isinstance(value, list):
        return "; ".join(str(_excel_cell(item)) for item in value)
    return value


def workbook_bytes(payload: dict[str, Any]) -> bytes:
    book = Workbook()
    first = True
    for table in payload["tables"]:
        sheet = book.active if first else book.create_sheet()
        first = False
        sheet.title = str(table["title"])[:31]
        sheet.append([column["label"] for column in table["columns"]])
        for row in table["rows"]:
            sheet.append([_excel_cell(row.get(column["key"])) for column in table["columns"]])
    buffer = BytesIO()
    book.save(buffer)
    return buffer.getvalue()

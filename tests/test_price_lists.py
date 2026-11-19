import json
import os
import unittest
from io import BytesIO
from unittest.mock import patch

from fastapi.testclient import TestClient
from openpyxl import load_workbook

from backend.app.main import app
from backend.app.services.bedspread import _models as bedspread_models
from backend.app.services.bedspread import classify_model
from backend.app.services.price_lists import BEDSPREAD_DRAFT, price_list, workbook_bytes


class PriceListProjectionTests(unittest.TestCase):
    def test_manager_projection_hides_purchase_fields(self):
        manager = price_list("trims", admin=False)
        admin = price_list("trims", admin=True)
        salsa = next(row for row in manager["tables"][0]["rows"] if row["article"] == "4629")
        admin_salsa = next(row for row in admin["tables"][0]["rows"] if row["article"] == "4629")
        self.assertEqual(salsa["client_price_rub_per_m"], 780.0)
        self.assertNotIn("purchase_price_rub_per_m", salsa)
        self.assertNotIn("markup_coefficient", salsa)
        self.assertEqual(admin_salsa["purchase_price_rub_per_m"], 260.0)
        self.assertEqual(admin_salsa["markup"], 3.0)
        fabrics = price_list("fabrics", admin=False)["tables"][0]["rows"]
        self.assertTrue(fabrics)
        self.assertNotIn("base_price_rub_per_m", fabrics[0])
        self.assertIn("base_price_rub_per_m", price_list("fabrics", admin=True)["tables"][0]["rows"][0])

    def test_catalogs_match_the_calculation_sources(self):
        works = price_list("works", admin=False)["tables"][0]["rows"]
        sewing = next(row for row in works if row["id"] == "OP_129")
        self.assertEqual(len(works), 129)
        self.assertEqual(sewing["tariff_rub"], 80)
        self.assertEqual(sewing["group"], "Пришивание фурнитуры")
        self.assertEqual(len(price_list("fabrics", admin=False)["tables"][0]["rows"]), 99)
        self.assertEqual(len(price_list("curtains", admin=False)["tables"][0]["rows"]), 129)
        self.assertEqual(len(price_list("trims", admin=False)["tables"][0]["rows"]), 30)
        curtain = price_list("curtains", admin=False)["tables"][0]["rows"][0]
        self.assertNotIn("finished_price", curtain)
        self.assertIn("calculation_rule", curtain)

    def test_endpoint_requires_the_server_token(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("PRICE_LIST_TOKEN", None)
            with TestClient(app) as client:
                missing = client.get("/api/price-lists/trims")
                self.assertEqual(missing.status_code, 503)
        with patch.dict(os.environ, {"PRICE_LIST_TOKEN": "server-secret"}):
            with TestClient(app) as client:
                denied = client.get("/api/price-lists/trims", headers={"X-Price-List-Token": "wrong"})
                allowed = client.get("/api/price-lists/trims?audience=manager", headers={"X-Price-List-Token": "server-secret"})
                exported = client.get("/api/price-lists/trims?audience=manager&export=xlsx", headers={"X-Price-List-Token": "server-secret"})
        self.assertEqual(denied.status_code, 401)
        self.assertEqual(allowed.status_code, 200)
        self.assertNotIn("purchase_price_rub_per_m", allowed.text)
        self.assertEqual(exported.status_code, 200)
        self.assertIn("spreadsheetml", exported.headers["content-type"])

    def test_bedspread_rows_show_values_instead_of_objects(self):
        source = json.loads(BEDSPREAD_DRAFT.read_text(encoding="utf-8"))
        self.assertFalse(source["connected_to_calculator"])
        payload = price_list("bedspreads", admin=False)
        admin = price_list("bedspreads", admin=True)
        models = payload["tables"][0]
        soft = next(row for row in models["rows"] if row["model"] == "Софт")
        bruno = next(row for row in models["rows"] if row["model"] == "Бруно")
        shown = [column["key"] for column in models["columns"] if not column.get("export_only")]
        for row in models["rows"]:
            for key in shown:
                self.assertNotIsInstance(row[key], (dict, list))
        self.assertEqual(soft["construction"], "Стёганое, планки")
        self.assertEqual(soft["face_fabric"], "Софт")
        self.assertEqual(soft["default_stitch"], "Квадрат 10х10 см")
        self.assertEqual(soft["calculator_status"], "готова к расчёту")
        self.assertEqual(soft["card_status"], "Не завершена")
        self.assertTrue(any("Подкладка не упомянута" in item for item in soft["details"]["questions"]))
        self.assertNotIn("Исходная цена", [item["label"] for group in soft["details"]["groups"] for item in group["rows"]])
        admin_soft = next(row for row in admin["tables"][0]["rows"] if row["model"] == "Софт")
        self.assertIn(
            "Исходная цена",
            [item["label"] for group in admin_soft["details"]["groups"] for item in group["rows"]],
        )
        self.assertEqual(bruno["calculator_status"], "Индивидуальный расчёт недоступен")
        self.assertEqual(bruno["card_status"], "Не завершена")
        forbidden = {
            row["model"]
            for row in models["rows"]
            if row["calculator_status"] == "Индивидуальный расчёт недоступен"
        }
        ready = [
            row["model"]
            for row in models["rows"]
            if row["calculator_status"] == "готова к расчёту"
        ]
        self.assertEqual(forbidden, {"Бруно", "Лео", "Шифу", "Зоуи", "Тина", "Перси"})
        self.assertEqual(len(ready), 39)
        self.assertEqual(len(models["rows"]), 45)
        self.assertTrue(all(row["card_status"] == "Не завершена" for row in models["rows"]))
        engine_bruno = next(model for model in bedspread_models() if model["model"] == "Бруно")
        self.assertEqual(classify_model(engine_bruno)["calculation_status"], "требуется уточнение")
        bruno_status = next(
            item["value"]
            for group in bruno["details"]["groups"]
            if group["title"] == "Расчёт"
            for item in group["rows"]
            if item["label"] == "Возможность расчёта"
        )
        self.assertEqual(bruno_status, "Индивидуальный расчёт недоступен")
        book = load_workbook(BytesIO(workbook_bytes(admin)))
        sheet = book["Модели"]
        headers = [cell.value for cell in next(sheet.iter_rows(max_row=1))]
        self.assertIn("Открытые вопросы", headers)
        self.assertNotIn("not_ready", [cell.value for row in sheet.iter_rows(min_row=2) for cell in row])
        exported = "\n".join(str(cell.value) for row in sheet.iter_rows() for cell in row)
        self.assertNotIn("[object Object]", exported)
        self.assertNotIn("{'quilted'", exported)
        self.assertIn("Стёганое, планки", exported)
        status_column = headers.index("Расчёт")
        statuses = [row[status_column].value for row in sheet.iter_rows(min_row=2)]
        self.assertEqual(statuses.count("готова к расчёту"), 39)
        self.assertEqual(statuses.count("Индивидуальный расчёт недоступен"), 6)
        self.assertFalse(any(isinstance(cell.value, dict) for row in sheet.iter_rows() for cell in row))

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.services import audit_log
from backend.app.services.calculator import calculate


SALSA = "Римская штора Вандер с бахромой Сальса по низу 150х170 см"
BASE = "Римская штора Вандер 150х170 см"


def _public(result):
    return str(result)


def _has_key(value, key: str) -> bool:
    if isinstance(value, dict):
        return key in value or any(_has_key(item, key) for item in value.values())
    if isinstance(value, list):
        return any(_has_key(item, key) for item in value)
    return False


def _line(result, group: str, placement: str):
    return next(
        line
        for line in result["operations"]["additional"]
        if line["group"] == group and placement in line["variant"]
    )


def _roman(text: str, **fields):
    payload = {
        "product_type": "римская штора",
        "model": "Вандер",
        "width_cm": 150,
        "height_cm": 170,
        "quantity": 1,
        **fields,
    }
    return calculate(payload, raw_request=text)


class TrimCalculationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.log_path_patcher = patch.object(
            audit_log,
            "CALCULATION_LOG_PATH",
            Path(self.temporary_directory.name) / "calculations.jsonl",
        )
        self.log_path_patcher.start()

    def tearDown(self) -> None:
        self.log_path_patcher.stop()
        self.temporary_directory.cleanup()

    def test_product_without_trim_keeps_the_existing_price(self):
        result = _roman(BASE)
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["pricing"]["retail_price"], 13403.0)

    def test_salsa_bottom_adds_material_allowance_and_labor_without_it(self):
        result = _roman(SALSA)
        self.assertEqual(result["status"], "success")
        preview = result["accessories"][0]
        self.assertEqual(preview["article"], "4629")
        self.assertEqual(preview["meters"], 1.5)
        self.assertEqual(preview["material_meters"], 1.65)
        self.assertEqual(preview["client_price_rub_per_m"], 780.0)
        self.assertEqual(preview["material_cost_rub"], 1287.0)
        self.assertEqual(preview["labor_cost_rub"], 120.0)
        self.assertEqual(result["pricing"]["retail_price"], 14810.0)
        self.assertEqual(_line(result, "Фурнитура", "по низу")["basis_value"], 1.65)
        labor = _line(result, "Пришивание фурнитуры", "по низу")
        self.assertEqual(labor["operation_id"], "OP_129")
        self.assertEqual(labor["tariff_rub"], 80.0)
        self.assertEqual(labor["basis_value"], 1.5)
        self.assertNotIn("purchase_price_rub_per_m", preview)

    def test_every_trim_category_uses_markup_three_and_labor_eighty(self):
        requests = {
            "4629": 260,
            "4511": 260,
            "3052": 60,
            "6112": 390,
            "6008": 195,
        }
        for article, purchase in requests.items():
            with self.subTest(article=article):
                result = _roman(
                    BASE,
                    accessories=[{"article": article, "placement": "по низу"}],
                )
                preview = result["accessories"][0]
                self.assertEqual(result["status"], "success")
                self.assertEqual(preview["client_price_rub_per_m"], purchase * 3)
                self.assertEqual(preview["material_meters"], 1.65)
                self.assertEqual(preview["labor_cost_rub"], 120.0)
                self.assertEqual(
                    _line(result, "Пришивание фурнитуры", "по низу")["operation_id"],
                    "OP_129",
                )

    def test_sides_quantity_and_clear_compound_placement(self):
        sides = _roman("Римская штора Вандер с бахромой Сальса по двум боковым краям 150х170")
        pair = _roman("2 римские шторы Вандер с бахромой Сальса снизу 150х170")
        compound = _roman("Римская штора Вандер с бахромой Сальса снизу и по бокам 150х170")
        curtain = calculate(
            {
                "product_type": "шторы",
                "model": "Вандер",
                "width_cm": 150,
                "height_cm": 170,
                "quantity": 1,
            },
            raw_request="Шторы Вандер с бахромой Сальса по периметру 150х170",
        )
        self.assertEqual(sides["accessories"][0]["meters"], 3.4)
        self.assertEqual(sides["accessories"][0]["material_meters"], 3.74)
        self.assertEqual(pair["accessories"][0]["meters"], 3.0)
        self.assertEqual(pair["accessories"][0]["material_meters"], 3.3)
        self.assertEqual(
            [item["placement"] for item in compound["accessories"]],
            ["bottom", "both_sides"],
        )
        self.assertEqual(curtain["status"], "success")
        self.assertEqual(curtain["accessories"][0]["placement"], "perimeter")
        self.assertEqual(curtain["accessories"][0]["meters"], 6.4)

    def test_roman_top_and_perimeter_are_refused(self):
        top = _roman("Римская штора Вандер с бахромой Сальса по верху 150х170")
        perimeter = _roman("Римская штора Вандер с бахромой Сальса по периметру 150х170")
        ambiguous = _roman("Римская штора Вандер с бахромой Сальса снизу и сбоку 150х170")
        self.assertEqual(top["reason_code"], "TRIM_PLACEMENT_UNSUPPORTED")
        self.assertEqual(perimeter["reason_code"], "TRIM_PLACEMENT_UNSUPPORTED")
        self.assertEqual(ambiguous["reason_code"], "TRIM_PLACEMENT_AMBIGUOUS")
        self.assertNotIn("retail_price", top)

    def test_incomplete_ambiguous_and_unknown_requests(self):
        missing = _roman("Римская штора Вандер с бахромой 150х170 см")
        placement = _roman("Римская штора Вандер с бахромой Сальса 150х170 см")
        unknown = _roman("Римская штора Вандер с бахромой Несуществующая по низу 150х170")
        ambiguous = _roman("Римская штора Вандер с однотонной репсовой лентой по низу 150х170")
        colored = _roman("Римская штора Вандер с однотонной репсовой лентой серого цвета по низу 150х170")
        self.assertEqual(missing["details"]["missing_fields"], ["trim_model", "placement"])
        self.assertEqual(placement["details"]["missing_fields"], ["placement"])
        self.assertEqual(unknown["reason_code"], "TRIM_NOT_FOUND")
        self.assertEqual(ambiguous["reason_code"], "TRIM_AMBIGUOUS")
        self.assertEqual(colored["status"], "success")
        self.assertEqual(colored["accessories"][0]["article"], "3052")
        self.assertEqual(colored["accessories"][0]["client_price_rub_per_m"], 180.0)
        self.assertEqual(colored["accessories"][0]["material_cost_rub"], 297.0)
        self.assertIn("Отправьте новый полный запрос", missing["message"])

    def test_same_name_requires_color(self):
        result = _roman("Римская штора Вандер с однотонной репсовой лентой по низу 150х170")
        articles = {option["article"] for option in result["details"]["options"]}
        self.assertEqual(result["reason_code"], "TRIM_AMBIGUOUS")
        self.assertEqual(articles, {"3052", "2978", "3262", "7438"})
        self.assertTrue(all("purchase_price_rub_per_m" not in option for option in result["details"]["options"]))

    def test_api_control_calculation_hides_purchase_fields(self):
        with TestClient(app) as client:
            response = client.post(
                "/api/calculate",
                json={
                    "product_type": "roman",
                    "model": "Вандер",
                    "width_cm": 150,
                    "height_cm": 170,
                    "quantity": 1,
                    "raw_request": SALSA,
                },
            )
        body = response.json()
        self.assertEqual(body["status"], "success")
        self.assertEqual(body["retail_price"], 14810.0)
        material = next(item for item in body["components"] if item["category"] == "trim")
        labor = next(item for item in body["components"] if item["category"] == "trim_labor")
        self.assertEqual(material["cost"], 1287.0)
        self.assertEqual(material["quantity"], 1.65)
        self.assertEqual(material["tariff"], 780.0)
        self.assertEqual(labor["cost"], 120.0)
        self.assertEqual(labor["quantity"], 1.5)
        self.assertEqual(labor["tariff"], 80.0)
        self.assertEqual(labor["operation_id"], "OP_129")
        self.assertFalse(_has_key(body, "purchase_price_rub_per_m"))
        self.assertFalse(_has_key(body, "markup"))
        self.assertNotIn("purchase_price", _public(body))

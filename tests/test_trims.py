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

    def _curtain(self, text, **fields):
        payload = {
            "product_type": "шторы",
            "model": "Софт",
            "width_cm": 140,
            "height_cm": 260,
            "quantity": 1,
            **fields,
        }
        return calculate(payload, raw_request=text)

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

    def test_decorative_ribbon_is_not_treated_as_a_heading(self):
        text = "Портьеры Софт 130×261 см, 2 штуки, с однотонной репсовой лентой серого цвета по двум бокам"
        plain = calculate(
            {
                "product_type": "шторы",
                "model": "Софт",
                "width_cm": 130,
                "height_cm": 261,
                "quantity": 2,
            },
            raw_request="Портьеры Софт 130×261 см, 2 штуки",
        )
        result = calculate(
            {
                "product_type": "шторы",
                "model": "Софт",
                "width_cm": 130,
                "height_cm": 261,
                "quantity": 2,
                "configuration": {"heading": "однотонная репсовая лента серого цвета по двум бокам"},
            },
            raw_request=text,
        )
        self.assertEqual(plain["status"], "success")
        self.assertEqual(result["status"], "success")
        preview = result["accessories"][0]
        self.assertEqual(preview["article"], "3052")
        self.assertEqual(preview["placement"], "both_sides")
        self.assertEqual(preview["meters"], 10.44)
        self.assertEqual(preview["material_meters"], 11.484)
        self.assertEqual(preview["labor_cost_rub"], 835.2)
        self.assertEqual(preview["client_price_rub_per_m"], 180.0)
        self.assertEqual(preview["material_cost_rub"], 2067.12)
        self.assertEqual(
            result["pricing"]["retail_price"],
            round(plain["pricing"]["retail_price"] + 2067.12 + 835.2, 2),
        )
        self.assertIn("OP_001", [line["operation_id"] for line in result["operations"]["base"]])
        self.assertIsNone(result["request"]["configuration"]["heading"])

    def test_explicit_heading_stays_when_trim_is_also_requested(self):
        result = self._curtain(
            "Портьера Софт 140×260 на люверсах с бахромой Сальса по низу",
            configuration={"heading": "Люверсы и бахрома Сальса по низу"},
        )
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["request"]["configuration"]["heading"], "Люверсы")
        self.assertEqual(result["accessories"][0]["article"], "4629")
        self.assertIn("OP_021", [line["operation_id"] for line in result["operations"]["base"]])

    def test_trim_phrases_ask_only_for_missing_details(self):
        gray = self._curtain("Портьеры Софт 130×261, 2 шт., с серой репсовой лентой по бокам", width_cm=130, height_cm=261, quantity=2)
        ribbon = self._curtain("Портьера Софт 140×260 с декоративной лентой по низу")
        braid = self._curtain("Портьера Софт 140×260 с тесьмой по двум бокам")
        salsa = self._curtain("Портьера Софт 140×260 с бахромой Сальса по низу")
        piping = self._curtain("Портьера Софт 140×260 с кантом по периметру")
        unnamed = _roman("Римская штора Вандер 150×170 с бахромой по низу")
        priced = _roman(SALSA)
        tape = self._curtain(
            "Портьера Софт 140×260 на шторной ленте",
            configuration={"heading": "шторная лента"},
        )
        self.assertEqual(gray["accessories"][0]["article"], "3052")
        self.assertEqual(gray["accessories"][0]["meters"], 10.44)
        self.assertEqual(ribbon["reason_code"], "TRIM_INCOMPLETE")
        self.assertIn("trim_model", ribbon["details"]["missing_fields"])
        self.assertEqual(braid["reason_code"], "TRIM_INCOMPLETE")
        self.assertIn("trim_model", braid["details"]["missing_fields"])
        self.assertEqual(salsa["accessories"][0]["article"], "4629")
        self.assertEqual(piping["reason_code"], "TRIM_INCOMPLETE")
        self.assertEqual(unnamed["details"]["missing_fields"], ["trim_model"])
        self.assertEqual(priced["pricing"]["retail_price"], 14810.0)
        self.assertEqual(tape["status"], "success")
        self.assertNotIn("accessories", tape)

    def test_both_side_phrases_have_the_same_length(self):
        phrases = (
            "по бокам",
            "по двум бокам",
            "с двух сторон",
            "по обоим боковым краям",
        )
        for phrase in phrases:
            result = self._curtain(
                f"Портьеры Софт 130×261 см, 2 штуки, с однотонной репсовой лентой серого цвета {phrase}",
                width_cm=130,
                height_cm=261,
                quantity=2,
            )
            preview = result["accessories"][0]
            self.assertEqual(result["status"], "success", phrase)
            self.assertEqual(preview["article"], "3052", phrase)
            self.assertEqual(preview["placement"], "both_sides", phrase)
            self.assertEqual(preview["meters"], 10.44, phrase)
            self.assertEqual(preview["material_meters"], 11.484, phrase)
            self.assertEqual(preview["material_cost_rub"], 2067.12, phrase)
            self.assertEqual(preview["labor_cost_rub"], 835.2, phrase)
            self.assertEqual(result["pricing"]["retail_price"], 7239.32, phrase)
        from_parser = self._curtain(
            "Портьеры Софт 130×261 см, 2 штуки, с однотонной репсовой лентой серого цвета по двум бокам",
            width_cm=130,
            height_cm=261,
            quantity=2,
            accessories=[{"name": "однотонная репсовая лента", "color": "серый"}],
        )
        self.assertEqual(from_parser["accessories"][0]["placement"], "both_sides")
        self.assertEqual(from_parser["pricing"]["retail_price"], 7239.32)
        explicit = self._curtain(
            "Портьеры Софт 130×261 см, 2 штуки, с однотонной репсовой лентой серого цвета по двум бокам",
            width_cm=130,
            height_cm=261,
            quantity=2,
            accessories=[{"article": "3052", "placement": "по низу"}],
        )
        self.assertEqual(explicit["accessories"][0]["placement"], "bottom")
        ambiguous = self._curtain("Портьера Софт 140×260 с бахромой Сальса снизу и сбоку")
        self.assertEqual(ambiguous["reason_code"], "TRIM_PLACEMENT_AMBIGUOUS")

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

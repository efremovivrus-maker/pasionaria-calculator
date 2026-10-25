"""Bedspread calculation and the boundary around unconfirmed models."""

from pathlib import Path
import tempfile
import unittest
from collections import Counter
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.services import audit_log
from backend.app.services.bedspread import readiness_report


class BedspreadCalculationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)
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

    def calculate(self, **payload: object) -> dict:
        response = self.client.post("/api/calculate", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def soft(self, **overrides: object) -> dict:
        payload = {
            "product_type": "bedspread",
            "model": "Софт",
            "width_cm": 230,
            "height_cm": 250,
            "quantity": 1,
            "stitch": "Ромб 10×10",
        }
        payload.update(overrides)
        return self.calculate(**payload)

    def component(self, payload: dict, operation_id: str) -> dict:
        matches = [
            component
            for component in payload["components"]
            if component.get("operation_id") == operation_id
        ]
        self.assertEqual(len(matches), 1)
        return matches[0]

    def test_catalog_covers_all_draft_models(self) -> None:
        report = readiness_report()
        statuses = Counter(item["calculation_status"] for item in report)

        self.assertEqual(len(report), 45)
        self.assertEqual(
            set(statuses),
            {
                "готова к расчёту",
                "требуется уточнение",
                "неподдерживаемая технология",
            },
        )
        self.assertEqual(statuses["готова к расчёту"], 14)
        self.assertEqual(statuses["неподдерживаемая технология"], 7)
        self.assertEqual(statuses["требуется уточнение"], 24)
        for item in report:
            self.assertIn("block_reason", item)
            self.assertIsInstance(item["manager_can_specify"], list)
            if item["calculation_status"] == "готова к расчёту":
                self.assertIsNone(item["block_reason"])
                self.assertIn("стежка из прайса", item["manager_can_specify"])
            else:
                self.assertTrue(item["block_reason"])
            suggestion = item.get("suggested_fabric")
            if suggestion:
                self.assertEqual(suggestion["confirmation"], "требует подтверждения")
                self.assertFalse(suggestion["used_in_price"])
        suggested_names = {
            item["model"]
            for item in report
            if item.get("suggested_fabric")
        }
        self.assertEqual(
            suggested_names,
            {
                "Ибица",
                "Джерри",
                "Конни",
                "Ким",
                "Лаура",
                "Нигма",
                "Голди",
                "Деко",
                "Астер",
                "Бохо",
            },
        )

    def test_default_options_for_a_confirmed_quilted_model(self) -> None:
        payload = self.soft()

        self.assertEqual(payload["status"], "success")
        self.assertEqual(payload["normalized_request"]["model"], "Софт")
        self.assertEqual(payload["fabric"]["name"], "Софт")
        self.assertEqual(payload["fabric"]["layout"], "standard")
        self.assertEqual(payload["fabric"]["consumption_m"], 2.7)
        self.assertEqual(payload["fabric"]["cost"], 2673)
        self.assertIn("2.7", payload["explanation"])
        self.assertIn("2.5", payload["explanation"])
        self.assertEqual(self.component(payload, "BSD-FILL-100 г/м2 (Легкое)")["tariff"], 80)
        self.assertEqual(self.component(payload, "BSD-FILL-100 г/м2 (Легкое)")["cost"], 460)
        lining = next(
            component
            for component in payload["components"]
            if component["name"].startswith("Подкладка покрывала")
        )
        self.assertEqual(lining["tariff"], 450)
        self.assertEqual(lining["cost"], 2587.5)
        stitch = self.component(payload, "BSD-STITCH-Ромб 10х10 см")
        self.assertEqual(stitch["tariff"], 150)
        self.assertEqual(stitch["cost"], 862.5)
        sewing = self.component(payload, "BSD-SEW-BASE")
        self.assertEqual(sewing["tariff"], 200)
        self.assertEqual(sewing["quantity"], 9.6)
        self.assertEqual(sewing["cost"], 1920)
        self.assertEqual(self.component(payload, "BSD-PACK")["cost"], 200)
        self.assertEqual(payload["extras"], [])
        self.assertEqual(payload["retail_price"], 8703)
        self.assertAlmostEqual(
            sum(component["cost"] for component in payload["components"]),
            payload["retail_price"],
            places=2,
        )

    def test_face_fabric_lining_filling_and_stitch_can_be_replaced(self) -> None:
        replaced = self.calculate(
            product_type="bedspread",
            model="Прайм",
            width_cm=230,
            height_cm=250,
            quantity=1,
            face_fabric="Софт",
            stitch="Квадрат 20х20",
            filling="200",
            configuration={"lining": "Сканди"},
        )
        plain = self.calculate(
            product_type="bedspread",
            model="Прайм",
            width_cm=230,
            height_cm=250,
            quantity=1,
            stitch="Квадрат 20х20",
        )

        self.assertEqual(replaced["status"], "success")
        self.assertEqual(replaced["fabric"]["name"], "Софт")
        self.assertEqual(replaced["fabric"]["cost"], 2673)
        self.assertNotEqual(plain["fabric"]["name"], "Софт")
        self.assertEqual(plain["fabric"]["name"], "Ибица")
        self.assertEqual(
            self.component(replaced, "BSD-FILL-200 г/м2 (Среднее)")["tariff"],
            150,
        )
        self.assertIn("Сканди", next(
            component["name"]
            for component in replaced["components"]
            if "Подкладка" in component["name"]
        ))
        self.assertEqual(
            self.component(replaced, "BSD-STITCH-Квадрат 20х20 см")["tariff"],
            80,
        )
        self.assertEqual(
            len([
                component
                for component in replaced["components"]
                if "Стежка" in component["name"]
            ]),
            1,
        )

    def test_model_embroidery_is_added_once(self) -> None:
        once = self.calculate(
            product_type="bedspread",
            model="Прайм",
            width_cm=230,
            height_cm=250,
            quantity=1,
            stitch="Ромб 10х10",
        )
        repeated = self.calculate(
            product_type="bedspread",
            model="Прайм",
            width_cm=230,
            height_cm=250,
            quantity=1,
            stitch="Ромб 10х10",
            extra_operations=["Прайм"],
        )
        embroidery = [
            component
            for component in once["components"]
            if component.get("operation_id") == "OP_067"
        ]

        self.assertEqual(once["status"], "success")
        self.assertEqual(len(embroidery), 1)
        self.assertEqual(embroidery[0]["tariff"], 370)
        self.assertEqual(embroidery[0]["quantity"], 5.75)
        self.assertEqual(embroidery[0]["cost"], 2127.5)
        self.assertEqual(repeated["retail_price"], once["retail_price"])
        self.assertEqual(
            len([
                component
                for component in repeated["components"]
                if component.get("operation_id") == "OP_067"
            ]),
            1,
        )

    def test_one_side_embroidery_uses_its_height_tariff(self) -> None:
        payload = self.calculate(
            product_type="bedspread",
            model="Бриджит",
            width_cm=230,
            height_cm=250,
            quantity=1,
            stitch="Ромб 20х20",
        )
        embroidery = self.component(payload, "OP_083")

        self.assertEqual(payload["status"], "success")
        self.assertEqual(embroidery["tariff"], 500)
        self.assertEqual(embroidery["unit"], "МП")
        self.assertEqual(embroidery["quantity"], 2.5)
        self.assertEqual(embroidery["cost"], 1250)

    def test_rotation_is_used_only_when_the_width_does_not_fit(self) -> None:
        payload = self.soft(width_cm=300, height_cm=270)

        self.assertEqual(payload["status"], "success")
        self.assertEqual(payload["fabric"]["layout"], "rotated")
        self.assertEqual(payload["fabric"]["consumption_m"], 3.2)
        self.assertIn("Проверены обе ориентации", payload["explanation"])

    def test_width_limit_is_reported_without_a_price(self) -> None:
        payload = self.soft(width_cm=300, height_cm=290)

        self.assertEqual(payload["status"], "unavailable")
        self.assertEqual(payload["reason_code"], "BEDSPREAD_FABRIC_TOO_NARROW")
        self.assertNotIn("retail_price", payload)
        self.assertIn("Стачивание", payload["message"])

    def test_missing_stitch_asks_for_a_choice(self) -> None:
        payload = self.calculate(
            product_type="bedspread",
            model="Софт",
            width_cm=230,
            height_cm=250,
            quantity=1,
        )

        self.assertEqual(payload["status"], "unavailable")
        self.assertEqual(payload["reason_code"], "BEDSPREAD_STITCH_REQUIRED")
        self.assertEqual(
            payload["message"],
            "Для расчёта покрывала укажите рисунок стёжки. "
            "Например: Покрывало Софт 230×250, ромб 10×10",
        )
        self.assertNotIn("retail_price", payload)
        self.assertNotIn("components", payload)

    def test_each_bedspread_request_stands_alone(self) -> None:
        first = self.soft(
            face_fabric="Ибица",
            filling="200",
            configuration={"lining": "Сканди"},
        )
        second = self.calculate(
            product_type="bedspread",
            model="Прайм",
            width_cm=230,
            height_cm=250,
            quantity=1,
        )
        named_fabric = self.calculate(
            product_type="bedspread",
            model="Ибица",
            width_cm=230,
            height_cm=250,
            quantity=1,
            stitch="Ромб 10×10",
        )

        self.assertEqual(first["status"], "success")
        self.assertEqual(first["fabric"]["name"], "Ибица")
        self.assertEqual(second["reason_code"], "BEDSPREAD_STITCH_REQUIRED")
        self.assertNotIn("retail_price", second)
        self.assertNotIn("Ибица", second["message"])
        self.assertEqual(named_fabric["reason_code"], "BEDSPREAD_FABRIC_UNCONFIRMED")
        self.assertIn("новом полном запросе", named_fabric["message"])
        self.assertIn("требует подтверждения", named_fabric["message"])
        self.assertNotIn("retail_price", named_fabric)

    def test_missing_fabric_and_unknown_options_ask_for_a_full_request(self) -> None:
        fabric = self.calculate(
            product_type="bedspread",
            model="Каспиан",
            width_cm=230,
            height_cm=250,
            quantity=1,
            stitch="Ромб 10×10",
        )
        unknown_stitch = self.calculate(
            product_type="bedspread",
            model="Софт",
            width_cm=230,
            height_cm=250,
            quantity=1,
            stitch="узелок",
        )
        unknown_filling = self.soft(filling="300")
        unknown_lining = self.soft(configuration={"lining": "сатин"})

        self.assertIn("новом полном запросе", fabric["message"])
        self.assertIn("лицевую ткань", fabric["message"])
        self.assertIn("новом полном запросе", unknown_stitch["message"])
        self.assertIn("узелок", unknown_stitch["message"])
        self.assertEqual(unknown_filling["reason_code"], "BEDSPREAD_FILLING_NOT_FOUND")
        self.assertIn("синтепон 200", unknown_filling["message"])
        self.assertEqual(unknown_lining["reason_code"], "BEDSPREAD_LINING_NOT_FOUND")
        self.assertIn("подкладка Сканди", unknown_lining["message"])
        for payload in (fabric, unknown_stitch, unknown_filling, unknown_lining):
            self.assertNotIn("retail_price", payload)

    def test_name_match_alone_does_not_price_a_model(self) -> None:
        payload = self.calculate(
            product_type="bedspread",
            model="Ибица",
            width_cm=200,
            height_cm=220,
            quantity=1,
            stitch="Ромб 10х10",
        )

        self.assertEqual(payload["status"], "unavailable")
        self.assertEqual(payload["reason_code"], "BEDSPREAD_FABRIC_UNCONFIRMED")
        self.assertNotIn("retail_price", payload)
        self.assertIn("новом полном запросе", payload["message"])
        self.assertIn("требует подтверждения", payload["message"])
        self.assertEqual(
            payload["details"]["suggested_fabric"]["name"],
            "Ибица",
        )
        self.assertFalse(payload["details"]["suggested_fabric"]["used_in_price"])

    def test_unconfirmed_embroidery_is_not_replaced(self) -> None:
        payload = self.calculate(
            product_type="bedspread",
            model="Мэри",
            width_cm=230,
            height_cm=250,
            quantity=1,
            stitch="Ромб 10х10",
        )

        self.assertEqual(payload["reason_code"], "BEDSPREAD_EMBROIDERY_UNCONFIRMED")
        self.assertNotIn("retail_price", payload)
        self.assertNotIn("components", payload)
        self.assertEqual(payload["details"]["manager_can_specify"], [])

        substituted = self.calculate(
            product_type="bedspread",
            model="Мэри",
            width_cm=230,
            height_cm=250,
            quantity=1,
            stitch="Ромб 10х10",
            extra_operations=["Прайм"],
        )
        self.assertEqual(
            substituted["reason_code"],
            "BEDSPREAD_EMBROIDERY_UNCONFIRMED",
        )
        self.assertNotIn("retail_price", substituted)
        self.assertNotIn("OP_067", response_text := str(substituted))
        self.assertNotIn("OP_128", response_text)

    def test_explicit_catalog_fabric_unlocks_an_unconfirmed_model(self) -> None:
        payload = self.calculate(
            product_type="bedspread",
            model="Ибица",
            width_cm=230,
            height_cm=250,
            quantity=1,
            face_fabric="Софт",
            stitch="Ромб 10х10",
        )

        self.assertEqual(payload["status"], "success")
        self.assertEqual(payload["fabric"]["name"], "Софт")
        self.assertEqual(payload["fabric"]["consumption_m"], 2.7)
        self.assertNotIn("suggested_fabric", payload)

    def test_knitted_model_is_not_sewn_as_a_quilt(self) -> None:
        payload = self.calculate(
            product_type="bedspread",
            model="Бруно",
            width_cm=200,
            height_cm=220,
            quantity=1,
            stitch="Ромб 10х10",
        )

        self.assertEqual(
            payload["reason_code"],
            "BEDSPREAD_CONSTRUCTION_UNSUPPORTED",
        )
        self.assertNotIn("retail_price", payload)

    def test_curtain_request_is_unchanged(self) -> None:
        payload = self.calculate(
            product_type="curtain",
            model="Софт",
            width_cm=140,
            height_cm=270,
            quantity=1,
        )

        self.assertEqual(payload["status"], "success")
        self.assertEqual(payload["normalized_request"]["product_type"], "curtain")
        self.assertEqual(payload["fabric"]["name"], "Софт")
        self.assertNotIn("face_fabric", payload["normalized_request"])
        self.assertNotIn("stitch", payload["normalized_request"])


if __name__ == "__main__":
    unittest.main()

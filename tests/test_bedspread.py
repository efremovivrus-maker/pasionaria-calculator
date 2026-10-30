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
            },
        )
        self.assertEqual(statuses["готова к расчёту"], 39)
        self.assertEqual(statuses["требуется уточнение"], 6)
        for item in report:
            self.assertIn("block_reason", item)
            self.assertIsInstance(item["manager_can_specify"], list)
            if item["calculation_status"] == "готова к расчёту":
                self.assertIsNone(item["block_reason"])
                if item.get("construction") != "plaid_type":
                    self.assertIn("стежка из прайса", item["manager_can_specify"])
            else:
                self.assertTrue(item["block_reason"])
            suggestion = item.get("suggested_fabric")
            if suggestion:
                self.assertEqual(suggestion["confirmation"], "требует подтверждения")
                self.assertFalse(suggestion["used_in_price"])
        self.assertEqual(
            {item["model"] for item in report if item.get("suggested_fabric")},
            set(),
        )
        assumed = {
            item["model"]
            for item in report
            if item.get("stitch_binding") == "default_stitch_assumed"
        }
        confirmed = {
            item["model"]
            for item in report
            if item.get("stitch_binding") == "confirmed"
        }
        self.assertEqual(
            confirmed,
            {
                "Инициалы",
                "Софт",
                "Ибица",
                "Каспиан",
                "Прайм",
                "Флэш",
                "Либерти",
                "Лилас",
                "Джерри",
                "Конни",
                "Мика",
                "Джим",
                "Ким",
                "Лука",
                "Бэлли",
                "Аника",
                "Элис",
                "Вайн",
                "Мэри",
                "Хьюго",
                "Диана",
                "Даллас",
                "Тара",
                "Ронда",
                "Лао",
                "Киа",
                "Узорье",
                "Кьют",
                "Астер",
                "Бохо",
            },
        )
        self.assertEqual(
            assumed,
            {"Бриджит", "Лаура", "Голди", "Деко", "Довер", "Бойл", "Эмма"},
        )
        self.assertIn("Бриджит", assumed)
        self.assertIn("Голди", assumed)
        self.assertNotIn("Ибица", assumed)
        self.assertNotIn("Софт", assumed)
        self.assertNotIn("Ронда", assumed)
        self.assertNotIn("Кьюб", assumed)

    def test_quilted_models_substitute_fabric_stitch_and_lining(self) -> None:
        report = readiness_report()
        quilted = [
            item
            for item in report
            if item["calculation_status"] == "готова к расчёту"
            and item.get("construction") != "plaid_type"
        ]
        boyle_lining = {"Бойл", "Эмма", "Астер"}

        self.assertEqual(len(quilted), 37)
        for item in quilted:
            payload = self.calculate(
                product_type="bedspread",
                model=item["model"],
                width_cm=230,
                height_cm=250,
                quantity=1,
            )
            lining_id = (
                "BSD-LIN-Подкладка «Бойл»"
                if item["model"] in boyle_lining
                else "BSD-LIN-Подкладка «Анна»"
            )
            stitches = [
                component
                for component in payload["components"]
                if str(component.get("operation_id") or "").startswith("BSD-STITCH")
            ]

            self.assertEqual(payload["status"], "success", item["model"])
            self.assertEqual(payload["fabric"]["name"], item["default_fabric"])
            self.assertEqual(stitches, [stitches[0]], item["model"])
            self.assertIn(item["default_stitch"], stitches[0]["name"])
            self.assertEqual(
                self.component(payload, lining_id)["tariff"],
                200 if item["model"] in boyle_lining else 450,
            )
            if item["model"] == "Эмма":
                self.assertEqual(
                    self.component(payload, "BSD-FILL-200 г/м2 (Среднее)")["tariff"],
                    300,
                )
            else:
                self.assertEqual(
                    self.component(payload, "BSD-FILL-100 г/м2 (Легкое)")["tariff"],
                    80,
                )
            if item["stitch_binding"] == "default_stitch_assumed":
                self.assertIn("default_stitch_assumed", payload["explanation"])
            else:
                self.assertNotIn("default_stitch_assumed", payload["explanation"])

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

    def test_missing_stitch_uses_the_ibiza_default_when_the_pattern_is_unnamed(self) -> None:
        payload = self.calculate(
            product_type="bedspread",
            model="Ибица",
            width_cm=230,
            height_cm=250,
            quantity=1,
        )
        stitches = [
            component
            for component in payload["components"]
            if "Стежка" in component["name"]
        ]

        self.assertEqual(payload["status"], "success")
        self.assertEqual(payload["fabric"]["name"], "Ибица")
        self.assertEqual(len(stitches), 1)
        self.assertEqual(stitches[0]["operation_id"], "BSD-STITCH-Квадрат 5х5 см")
        self.assertEqual(stitches[0]["tariff"], 180)
        self.assertIn("подтверждённая стёжка", payload["explanation"])
        self.assertNotIn("default_stitch_assumed", payload["explanation"])
        self.assertEqual(payload["retail_price"], 13857)

    def test_confirmed_nonstandard_stitches_are_not_replaced_by_ibiza(self) -> None:
        soft = self.calculate(
            product_type="bedspread",
            model="Софт",
            width_cm=230,
            height_cm=250,
            quantity=1,
        )
        kim = self.calculate(
            product_type="bedspread",
            model="Ким",
            width_cm=230,
            height_cm=250,
            quantity=1,
        )
        caspian = self.calculate(
            product_type="bedspread",
            model="Каспиан",
            width_cm=230,
            height_cm=250,
            quantity=1,
        )
        dover = self.calculate(
            product_type="bedspread",
            model="Довер",
            width_cm=230,
            height_cm=250,
            quantity=1,
        )
        assumed = self.calculate(
            product_type="bedspread",
            model="Бриджит",
            width_cm=230,
            height_cm=250,
            quantity=1,
        )

        self.assertEqual(
            self.component(soft, "BSD-STITCH-Квадрат 10х10 см")["tariff"],
            130,
        )
        self.assertEqual(soft["retail_price"], 8588)
        self.assertEqual(
            self.component(kim, "BSD-STITCH-Ромб 10х10 см")["tariff"],
            150,
        )
        self.assertEqual(kim["retail_price"], 12280.5)
        self.assertEqual(
            self.component(caspian, "BSD-STITCH-Ромб 5х5 см")["tariff"],
            220,
        )
        self.assertEqual(caspian["retail_price"], 10401.5)
        self.assertEqual(dover["status"], "success")
        self.assertEqual(
            self.component(dover, "BSD-STITCH-Квадрат 5х5 см")["tariff"],
            180,
        )
        self.assertIn("default_stitch_assumed", dover["explanation"])
        self.assertEqual(dover["retail_price"], 10171.5)
        self.assertEqual(
            self.component(assumed, "BSD-STITCH-Квадрат 5х5 см")["tariff"],
            180,
        )
        self.assertIn("default_stitch_assumed", assumed["explanation"])

    def test_explicit_stitch_replaces_the_default_and_is_charged_once(self) -> None:
        payload = self.soft()
        stitches = [
            component
            for component in payload["components"]
            if "Стежка" in component["name"]
        ]

        self.assertEqual(len(stitches), 1)
        self.assertEqual(stitches[0]["operation_id"], "BSD-STITCH-Ромб 10х10 см")
        self.assertNotIn("default_stitch_assumed", payload["explanation"])

    def test_production_review_stitch_replaces_an_unmatched_description(self) -> None:
        ronda = self.calculate(
            product_type="bedspread",
            model="Ронда",
            width_cm=230,
            height_cm=250,
            quantity=1,
        )
        boho = self.calculate(
            product_type="bedspread",
            model="Бохо",
            width_cm=230,
            height_cm=250,
            quantity=1,
        )
        pattern = self.calculate(
            product_type="bedspread",
            model="Узорье",
            width_cm=230,
            height_cm=250,
            quantity=1,
        )

        self.assertEqual(ronda["status"], "success")
        self.assertEqual(ronda["fabric"]["name"], "Софт")
        self.assertEqual(
            self.component(ronda, "BSD-STITCH-Квадрат 5х5 см")["tariff"],
            180,
        )
        self.assertEqual(ronda["retail_price"], 8875.5)
        self.assertEqual(
            self.component(boho, "BSD-STITCH-Квадрат 10х10 см")["tariff"],
            130,
        )
        self.assertEqual(boho["retail_price"], 8844.5)
        self.assertEqual(pattern["fabric"]["name"], "Репаблик")
        self.assertEqual(pattern["retail_price"], 9550.5)

    def test_customization_lock_is_not_a_stitch_operation(self) -> None:
        plain = self.calculate(
            product_type="bedspread",
            model="Тина",
            width_cm=230,
            height_cm=250,
            quantity=1,
        )
        changed = self.calculate(
            product_type="bedspread",
            model="Перси",
            width_cm=230,
            height_cm=250,
            quantity=1,
            stitch="Квадрат 5х5 см",
        )

        self.assertEqual(plain["reason_code"], "BEDSPREAD_INDIVIDUAL_CALCULATION_EXCLUDED")
        self.assertIn("исключено из индивидуального расчёта", plain["message"])
        self.assertNotIn("retail_price", plain)
        self.assertEqual(changed["reason_code"], "BEDSPREAD_INDIVIDUAL_CALCULATION_EXCLUDED")
        self.assertNotIn("retail_price", changed)

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
        self.assertEqual(second["status"], "success")
        self.assertEqual(second["fabric"]["name"], "Ибица")
        self.assertEqual(
            self.component(second, "BSD-STITCH-Закрепки")["tariff"],
            50,
        )
        self.assertEqual(
            self.component(second, "BSD-FILL-100 г/м2 (Легкое)")["tariff"],
            80,
        )
        self.assertNotEqual(first["retail_price"], second["retail_price"])
        self.assertEqual(named_fabric["status"], "success")
        self.assertEqual(named_fabric["fabric"]["name"], "Ибица")
        self.assertEqual(
            self.component(named_fabric, "BSD-STITCH-Ромб 10х10 см")["tariff"],
            150,
        )

    def test_missing_fabric_and_unknown_options_ask_for_a_full_request(self) -> None:
        fabric = self.calculate(
            product_type="bedspread",
            model="Киа",
            width_cm=230,
            height_cm=250,
            quantity=1,
        )
        unknown_stitch = self.calculate(
            product_type="bedspread",
            model="Софт",
            width_cm=230,
            height_cm=250,
            quantity=1,
            stitch="узелок",
        )
        unknown_filling = self.soft(filling="400")
        unknown_lining = self.soft(configuration={"lining": "сатин"})

        self.assertEqual(fabric["status"], "success")
        self.assertEqual(fabric["fabric"]["name"], "Киа")
        self.assertEqual(fabric["fabric"]["width_cm"], 250)
        self.assertEqual(fabric["fabric"]["price_per_m"], 1310)
        self.assertEqual(fabric["fabric"]["consumption_m"], 2.7)
        self.assertEqual(fabric["retail_price"], 9452)
        self.assertIn("новом полном запросе", unknown_stitch["message"])
        self.assertIn("узелок", unknown_stitch["message"])
        self.assertEqual(unknown_filling["reason_code"], "BEDSPREAD_FILLING_NOT_FOUND")
        self.assertIn("синтепон 200", unknown_filling["message"])
        self.assertEqual(unknown_lining["reason_code"], "BEDSPREAD_LINING_NOT_FOUND")
        self.assertIn("подкладка Сканди", unknown_lining["message"])
        for payload in (unknown_stitch, unknown_filling, unknown_lining):
            self.assertNotIn("retail_price", payload)

    def test_confirmed_mapping_fabric_is_used_without_a_named_override(self) -> None:
        payload = self.calculate(
            product_type="bedspread",
            model="Ибица",
            width_cm=200,
            height_cm=220,
            quantity=1,
        )
        replaced = self.calculate(
            product_type="bedspread",
            model="Ибица",
            width_cm=200,
            height_cm=220,
            quantity=1,
            face_fabric="Софт",
        )

        self.assertEqual(payload["status"], "success")
        self.assertEqual(payload["fabric"]["name"], "Ибица")
        self.assertEqual(replaced["fabric"]["name"], "Софт")
        self.assertNotEqual(payload["retail_price"], replaced["retail_price"])

    def test_pillow_embroidery_is_not_charged_and_lao_uses_prime(self) -> None:
        mary = self.calculate(
            product_type="bedspread",
            model="Мэри",
            width_cm=230,
            height_cm=250,
            quantity=1,
        )
        lao = self.calculate(
            product_type="bedspread",
            model="Лао",
            width_cm=230,
            height_cm=250,
            quantity=1,
        )
        aster = self.calculate(
            product_type="bedspread",
            model="Астер",
            width_cm=230,
            height_cm=250,
            quantity=1,
        )
        zoe = self.calculate(
            product_type="bedspread",
            model="Зоуи",
            width_cm=230,
            height_cm=250,
            quantity=1,
        )
        embroidery_ids = [
            component.get("operation_id")
            for component in mary["components"]
            if component.get("operation_id") in {"OP_067", "OP_080", "OP_128"}
        ]

        self.assertEqual(mary["status"], "success")
        self.assertEqual(embroidery_ids, [])
        self.assertEqual(mary["retail_price"], 13109.5)
        self.assertEqual(self.component(lao, "OP_067")["tariff"], 370)
        self.assertEqual(lao["retail_price"], 15890)
        self.assertEqual(
            self.component(aster, "BSD-LIN-Подкладка «Бойл»")["tariff"],
            200,
        )
        self.assertEqual(aster["retail_price"], 12865)
        self.assertEqual(zoe["status"], "unavailable")
        self.assertNotIn("retail_price", zoe)

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

    def test_plaid_models_use_fabric_work_and_packaging_only(self) -> None:
        nigma = self.calculate(
            product_type="bedspread",
            model="Нигма",
            width_cm=230,
            height_cm=250,
            quantity=1,
            stitch="Квадрат 5х5 см",
            filling="200",
            configuration={"lining": "Анна"},
        )
        bruno = self.calculate(
            product_type="bedspread",
            model="Бруно",
            width_cm=230,
            height_cm=250,
            quantity=1,
        )
        bruno_fabric = self.calculate(
            product_type="bedspread",
            model="Бруно",
            width_cm=230,
            height_cm=250,
            quantity=1,
            face_fabric="Софт",
            stitch="Ромб 10х10",
        )
        excluded = self.calculate(
            product_type="bedspread",
            model="Зоуи",
            width_cm=180,
            height_cm=200,
            quantity=2,
            face_fabric="Ибица",
            stitch="Аура",
        )
        operation_ids = {
            component.get("operation_id")
            for component in nigma["components"]
        }

        self.assertEqual(nigma["status"], "success")
        self.assertEqual(nigma["fabric"]["name"], "Нигма")
        self.assertEqual(self.component(nigma, "BSD-SEW-PLAIN")["tariff"], 70)
        self.assertEqual(self.component(nigma, "BSD-PACK")["tariff"], 200)
        self.assertEqual(nigma["retail_price"], 8958.5)
        self.assertNotIn("BSD-FILL-100 г/м2 (Легкое)", operation_ids)
        self.assertNotIn("BSD-FILL-200 г/м2 (Среднее)", operation_ids)
        self.assertNotIn("BSD-LIN-Подкладка «Анна»", operation_ids)
        self.assertNotIn("BSD-STITCH-Квадрат 5х5 см", operation_ids)
        self.assertIn("Синтепон, подкладка и стёжка не начислены", nigma["explanation"])
        self.assertNotIn("помпон", nigma["explanation"].lower())
        self.assertNotIn("бахром", nigma["explanation"].lower())
        self.assertNotIn("кант", nigma["explanation"].lower())
        self.assertEqual(bruno["reason_code"], "BEDSPREAD_NOT_CALCULATED")
        self.assertIn("Индивидуальный расчёт не выполняется", bruno["message"])
        self.assertNotIn("retail_price", bruno)
        self.assertEqual(bruno_fabric["reason_code"], "BEDSPREAD_NOT_CALCULATED")
        self.assertNotIn("retail_price", bruno_fabric)
        self.assertEqual(excluded["reason_code"], "BEDSPREAD_INDIVIDUAL_CALCULATION_EXCLUDED")
        self.assertNotIn("retail_price", excluded)

        cube = self.calculate(
            product_type="bedspread",
            model="Кьюб",
            width_cm=230,
            height_cm=250,
            quantity=1,
        )
        self.assertEqual(cube["status"], "success")
        self.assertEqual(cube["fabric"]["name"], "Кьюб")
        self.assertEqual(cube["fabric"]["width_cm"], 285)
        self.assertEqual(cube["fabric"]["price_per_m"], 2400)
        self.assertEqual(cube["retail_price"], 7352)
        self.assertNotIn("помпон", cube["explanation"].lower())

        for model_name in ("Лео", "Шифу", "Данфорд", "Тай"):
            plain = self.calculate(
                product_type="bedspread",
                model=model_name,
                width_cm=230,
                height_cm=250,
                quantity=1,
                face_fabric="Софт",
                stitch="Квадрат 5х5 см",
            )
            self.assertEqual(plain["reason_code"], "BEDSPREAD_NOT_CALCULATED")
            self.assertIn("Индивидуальный расчёт не выполняется", plain["message"])
            self.assertNotIn("retail_price", plain)

    def test_boyle_and_emma_use_confirmed_fabric_lining_and_filling(self) -> None:
        boyle = self.calculate(
            product_type="bedspread",
            model="Бойл",
            width_cm=230,
            height_cm=250,
            quantity=1,
        )
        emma = self.calculate(
            product_type="bedspread",
            model="Эмма",
            width_cm=230,
            height_cm=250,
            quantity=1,
        )
        fillings = [
            component
            for component in emma["components"]
            if component.get("operation_id") == "BSD-FILL-200 г/м2 (Среднее)"
        ]

        self.assertEqual(boyle["status"], "success")
        self.assertEqual(boyle["fabric"]["name"], "Бойл")
        self.assertEqual(boyle["fabric"]["width_cm"], 250)
        self.assertEqual(boyle["fabric"]["price_per_m"], 695)
        self.assertEqual(boyle["fabric"]["consumption_m"], 2.7)
        self.assertEqual(
            self.component(boyle, "BSD-LIN-Подкладка «Бойл»")["tariff"],
            200,
        )
        self.assertEqual(
            self.component(boyle, "BSD-STITCH-Квадрат 5х5 см")["tariff"],
            180,
        )
        self.assertEqual(boyle["retail_price"], 6641.5)
        self.assertEqual(emma["fabric"]["name"], "Ким")
        self.assertEqual(len(fillings), 1)
        self.assertEqual(fillings[0]["tariff"], 300)
        self.assertIn("200 г/м² дважды", emma["explanation"])
        self.assertEqual(
            self.component(emma, "BSD-LIN-Подкладка «Бойл»")["tariff"],
            200,
        )
        self.assertEqual(emma["retail_price"], 12280.5)

    def test_named_boyle_lining_is_priced_on_any_quilted_bedspread(self) -> None:
        payload = self.soft(configuration={"lining": "Бойл"})
        lining = self.component(payload, "BSD-LIN-Подкладка «Бойл»")

        self.assertEqual(payload["status"], "success")
        self.assertEqual(lining["tariff"], 200)
        self.assertEqual(lining["cost"], 1150)
        self.assertEqual(payload["retail_price"], 7265.5)

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

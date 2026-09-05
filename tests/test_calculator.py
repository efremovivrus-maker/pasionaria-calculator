from decimal import Decimal
import csv
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from backend.app.services import audit_log
from backend.app.services.calculator import calculate
from backend.app.services.fabric_calculator import (
    calculate_curtain_consumption,
    calculate_roman_consumption,
)
from scripts.export_calculation_log import export_calculation_log


class FabricConsumptionTests(unittest.TestCase):
    def test_a_standard_140_by_270(self) -> None:
        result = calculate_curtain_consumption(
            width_cm=Decimal("140"),
            height_cm=Decimal("270"),
            quantity=1,
            fabric_width_cm=Decimal("280"),
        )
        self.assertEqual(result.status, "success")
        self.assertEqual(result.layout, "standard")
        self.assertEqual(result.consumption_m, Decimal("1.6"))

    def test_b_standard_180_by_270(self) -> None:
        result = calculate_curtain_consumption(
            width_cm=Decimal("180"),
            height_cm=Decimal("270"),
            quantity=1,
            fabric_width_cm=Decimal("280"),
        )
        self.assertEqual(result.status, "success")
        self.assertEqual(result.layout, "standard")
        self.assertEqual(result.consumption_m, Decimal("2"))

    def test_c_two_rotated_curtains_share_cut(self) -> None:
        result = calculate_curtain_consumption(
            width_cm=Decimal("130"),
            height_cm=Decimal("280"),
            quantity=2,
            fabric_width_cm=Decimal("280"),
        )
        self.assertEqual(result.status, "success")
        self.assertEqual(result.layout, "rotated_shared")
        self.assertEqual(result.items_per_cut, 2)
        self.assertEqual(result.cuts, 1)
        self.assertEqual(result.consumption_m, Decimal("3"))

    def test_d_roman_165_by_180(self) -> None:
        result = calculate_roman_consumption(
            width_cm=Decimal("165"),
            height_cm=Decimal("180"),
            quantity=1,
            fabric_width_cm=Decimal("280"),
        )
        self.assertEqual(result.status, "success")
        self.assertEqual(result.consumption_m, Decimal("1.75"))

    def test_roman_too_high(self) -> None:
        result = calculate_roman_consumption(
            width_cm=Decimal("165"),
            height_cm=Decimal("281"),
            quantity=1,
            fabric_width_cm=Decimal("280"),
        )
        self.assertEqual(result.status, "unavailable")
        self.assertEqual(result.reason_code, "ROMAN_TOO_HIGH")


class CalculatorTests(unittest.TestCase):
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

    def test_complete_wander_calculation(self) -> None:
        result = calculate(
            {
                "product_type": "curtain",
                "model": "Вандер",
                "width_cm": 130,
                "height_cm": 280,
                "quantity": 2,
            }
        )
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["fabric"]["name"], "Вандер")
        self.assertEqual(result["fabric"]["price_type"], "RRC")
        self.assertEqual(result["consumption"]["consumption_m"], 3.0)
        self.assertEqual(result["pricing"]["fabric_cost"], 3150.0)
        self.assertEqual(result["pricing"]["operation_cost"], 1405.0)
        self.assertEqual(result["pricing"]["known_components_total"], 4555.0)
        self.assertEqual(result["pricing"]["retail_price"], 4555.0)
        self.assertEqual(
            result["pricing"]["retail_price_status"],
            "CALCULATED",
        )

    def test_confirmed_extra_is_added(self) -> None:
        result = calculate(
            {
                "product_type": "curtain",
                "model": "Аника",
                "width_cm": 100,
                "height_cm": 200,
                "quantity": 2,
            }
        )
        self.assertEqual(result["status"], "success")
        self.assertEqual(len(result["operations"]["additional"]), 1)
        self.assertEqual(
            result["operations"]["additional"][0]["variant"],
            "Аника",
        )
        self.assertEqual(result["pricing"]["extras_cost"], 3640.0)
        self.assertEqual(result["pricing"]["retail_price"], 11554.0)

    def test_problematic_model_is_unavailable(self) -> None:
        result = calculate(
            {
                "product_type": "curtain",
                "model": "Амми",
                "width_cm": 140,
                "height_cm": 270,
                "quantity": 1,
            }
        )
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["reason_code"], "PROBLEMATIC_MODEL")

    def test_unknown_model_is_unavailable(self) -> None:
        result = calculate(
            {
                "product_type": "curtain",
                "model": "Несуществующая модель",
                "width_cm": 140,
                "height_cm": 270,
                "quantity": 1,
            }
        )
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["reason_code"], "MODEL_NOT_FOUND")

    def test_roman_too_high_is_unavailable(self) -> None:
        result = calculate(
            {
                "product_type": "roman",
                "model": "Вандер",
                "width_cm": 165,
                "height_cm": 281,
                "quantity": 1,
            }
        )
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["reason_code"], "ROMAN_TOO_HIGH")

    def test_confirmed_fabric_data(self) -> None:
        cases = [
            ("Каспиан", "Каспиан/Довер", 280, 1470),
            ("Ноа", "Эйприл", 300, 390),
            ("Сайфер", "Сайфер", 300, 2680),
            ("Фито", "Луара", 300, 2800),
            ("Сири", "Сири", 180, 1510),
            ("Бархат", "Репаблик", 300, 1240),
        ]
        for model, fabric, width, price in cases:
            with self.subTest(model=model):
                height = 170 if fabric == "Сири" else 200
                result = calculate(
                    {
                        "product_type": "curtain",
                        "model": model,
                        "width_cm": 100,
                        "height_cm": height,
                        "quantity": 1,
                    }
                )
                self.assertEqual(result["status"], "success")
                self.assertEqual(result["fabric"]["name"], fabric)
                self.assertEqual(result["fabric"]["width_cm"], width)
                self.assertEqual(result["fabric"]["price_rub_per_m"], price)

    def test_check_fabric_status_does_not_block_calculation(self) -> None:
        result = calculate(
            {
                "product_type": "curtain",
                "model": "Бархат",
                "width_cm": 100,
                "height_cm": 200,
                "quantity": 1,
            }
        )
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["fabric"]["status"], "Проверить")
        self.assertEqual(result["fabric"]["width_cm"], 300)

    def test_fabric_type_coefficients_are_not_applied(self) -> None:
        request = {
            "product_type": "curtain",
            "width_cm": 100,
            "height_cm": 200,
            "quantity": 1,
        }
        blackout = calculate({**request, "model": "Блэкаут"})
        regular = calculate({**request, "model": "Вандер"})

        self.assertEqual(blackout["status"], "success")
        self.assertEqual(
            blackout["pricing"]["operation_cost"],
            regular["pricing"]["operation_cost"],
        )
        self.assertFalse(
            any(
                line["group"] == "Коэффициент типа ткани"
                for line in blackout["operations"]["base"]
            )
        )

    def test_villa_and_morris_are_intentionally_problematic(self) -> None:
        for model in ("Вилла", "Моррис"):
            with self.subTest(model=model):
                result = calculate(
                    {
                        "product_type": "curtain",
                        "model": model,
                        "width_cm": 100,
                        "height_cm": 200,
                        "quantity": 1,
                    }
                )
                self.assertEqual(result["status"], "unavailable")
                self.assertEqual(result["reason_code"], "PROBLEMATIC_MODEL")
                self.assertEqual(
                    result["message"],
                    "Расчёт для этой модели пока недоступен.",
                )

    def test_all_confirmed_extra_bindings_and_tariffs(self) -> None:
        expected = {
            "Амми": ("problematic", "area", 310),
            "Аника": ("active", "area", 910),
            "Бриджит": ("active", "height", 500),
            "Бэлли": ("active", "area", 510),
            "Вайн": ("active", "area", 1240),
            "Валери": ("active", "height", 815),
            "Джим": ("active", "area", 670),
            "Дюпон": ("active", "height", 560),
            "Лея": ("active", "height", 910),
            "Либерти": ("active", "area", 660),
            "Лилас": ("active", "area", 360),
            "Лука": ("active", "area", 470),
            "Мика": ("active", "area", 640),
            "Прайм": ("active", "area", 370),
            "Фито": ("active", "area", 300),
            "Флэш": ("active", "area", 305),
            "Шейн": ("active", "height", 440),
            "Элис": ("problematic", "area", 1080),
        }
        data_dir = (
            Path(__file__).resolve().parents[1] / "backend" / "app" / "data"
        )
        master = json.loads(
            (data_dir / "master.json").read_text(encoding="utf-8")
        )["records"]
        operations = {
            operation["id"]: operation
            for operation in json.loads(
                (data_dir / "operations.json").read_text(encoding="utf-8")
            )["records"]
        }
        nuances = json.loads(
            (data_dir / "recipes.json").read_text(encoding="utf-8")
        )["confirmed_nuances"]

        self.assertEqual({item["model"] for item in nuances}, set(expected))
        for model_name, (status, formula, tariff) in expected.items():
            with self.subTest(model=model_name):
                model = next(
                    item
                    for item in master
                    if item["product_type"] == "curtain"
                    and item["model"] == model_name
                )
                self.assertEqual(model["status"], status)
                if status == "problematic":
                    nuance = next(
                        item for item in nuances if item["model"] == model_name
                    )
                    self.assertIn(str(tariff), nuance["source_tariff"])
                    continue
                operation = operations[model["additional_operation_id"]]
                self.assertEqual(operation["formula"], formula)
                self.assertEqual(operation["tariff_rub"], tariff)


class AuditLogTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.log_path = Path(self.temporary_directory.name) / "calculations.jsonl"
        self.log_path_patcher = patch.object(
            audit_log,
            "CALCULATION_LOG_PATH",
            self.log_path,
        )
        self.log_path_patcher.start()

    def tearDown(self) -> None:
        self.log_path_patcher.stop()
        self.temporary_directory.cleanup()

    def read_records(self) -> list[dict]:
        return [
            json.loads(line)
            for line in self.log_path.read_text(encoding="utf-8").splitlines()
        ]

    def test_successful_calculation_is_logged(self) -> None:
        result = calculate(
            {
                "product_type": "curtain",
                "model": "Вандер",
                "width_cm": 130,
                "height_cm": 280,
                "quantity": 2,
            },
            raw_request="Две шторы Вандер 130×280",
        )

        records = self.read_records()
        self.assertEqual(result["status"], "success")
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["status"], "success")
        self.assertEqual(records[0]["raw_request"], "Две шторы Вандер 130×280")
        self.assertEqual(records[0]["fabric_consumption_m"], 3.0)
        self.assertEqual(records[0]["known_components_total"], 4555.0)
        self.assertEqual(records[0]["retail_price"], 4555.0)
        self.assertEqual(records[0]["retail_price_status"], "CALCULATED")
        self.assertEqual(len(records[0]["operations"]), 5)

    def test_unavailable_calculation_keeps_partial_data(self) -> None:
        result = calculate(
            {
                "product_type": "roman",
                "model": "Вандер",
                "width_cm": 165,
                "height_cm": 281,
                "quantity": 1,
            }
        )

        record = self.read_records()[0]
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(record["status"], "unavailable")
        self.assertEqual(record["reason_code"], "ROMAN_TOO_HIGH")
        self.assertEqual(record["model_status"], "active")
        self.assertEqual(record["fabric"], "Вандер")
        self.assertEqual(record["fabric_width_cm"], 280)
        self.assertEqual(record["fabric_layout"], "unavailable")

    def test_log_write_error_does_not_break_calculation(self) -> None:
        with patch.object(
            audit_log,
            "write_calculation_audit",
            side_effect=OSError("read-only filesystem"),
        ):
            result = calculate(
                {
                    "product_type": "curtain",
                    "model": "Вандер",
                    "width_cm": 140,
                    "height_cm": 270,
                    "quantity": 1,
                }
            )

        self.assertEqual(result["status"], "success")

    def test_jsonl_can_be_exported_to_csv(self) -> None:
        calculate(
            {
                "product_type": "curtain",
                "model": "Вандер",
                "width_cm": 140,
                "height_cm": 270,
                "quantity": 1,
            }
        )
        csv_path = Path(self.temporary_directory.name) / "export.csv"

        count = export_calculation_log(self.log_path, csv_path)

        with csv_path.open(encoding="utf-8-sig", newline="") as csv_file:
            rows = list(csv.DictReader(csv_file))
        self.assertEqual(count, 1)
        self.assertEqual(rows[0]["status"], "success")
        self.assertIn("Крепление портьеры", rows[0]["operations"])


if __name__ == "__main__":
    unittest.main()

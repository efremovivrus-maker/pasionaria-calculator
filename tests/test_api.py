from pathlib import Path
import json
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.services import audit_log


class CalculationApiTests(unittest.TestCase):
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

    def assert_components_match_retail(self, payload: dict) -> None:
        component_total = sum(
            component["cost"] for component in payload["components"]
        )
        self.assertAlmostEqual(
            component_total,
            payload["retail_price"],
            places=2,
        )

    def test_healthcheck(self) -> None:
        response = self.client.get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_successful_curtain_calculation(self) -> None:
        response = self.client.post(
            "/api/calculate",
            json={
                "product_type": "curtain",
                "model": "Вандер",
                "width_cm": 130,
                "height_cm": 280,
                "quantity": 2,
                "raw_request": "Посчитай две шторы Вандер 130 на 280",
            },
        )

        payload = response.json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["status"], "success")
        self.assertTrue(payload["calculation_id"])
        self.assertEqual(payload["fabric"]["layout"], "rotated_shared")
        self.assertEqual(payload["fabric"]["consumption_m"], 3.0)
        self.assertEqual(payload["fabric"]["cost"], 3150.0)
        self.assertEqual(payload["operation_cost"], 1405.0)
        self.assertEqual(payload["retail_price"], 4555.0)
        self.assertEqual(payload["retail_price_status"], "CALCULATED")
        self.assertEqual(
            payload["normalized_request"]["configuration"],
            {},
        )
        self.assertEqual(
            payload["normalized_request"]["extra_operations"],
            [],
        )
        self.assertFalse(
            any(
                component["category"] == "embroidery"
                for component in payload["components"]
            )
        )
        self.assert_components_match_retail(payload)

    def test_successful_roman_calculation(self) -> None:
        response = self.client.post(
            "/api/calculate",
            json={
                "product_type": "roman",
                "model": "Вандер",
                "width_cm": 165,
                "height_cm": 180,
                "quantity": 1,
            },
        )

        payload = response.json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["status"], "success")
        self.assertEqual(payload["fabric"]["consumption_m"], 1.75)
        self.assertEqual(payload["retail_price"], 8652.9)
        self.assertTrue(
            any(
                component["category"] == "fabric"
                for component in payload["components"]
            )
        )
        self.assertTrue(
            any(
                "Механизм" in component["name"]
                and component["cost"] == 4125.0
                for component in payload["components"]
            )
        )
        self.assert_components_match_retail(payload)

    def test_roman_default_and_economy_mechanism_override(self) -> None:
        base_request = {
            "product_type": "roman",
            "model": "Вандер",
            "width_cm": 120,
            "height_cm": 200,
            "quantity": 1,
        }
        default_payload = self.client.post(
            "/api/calculate",
            json=base_request,
        ).json()
        economy_payload = self.client.post(
            "/api/calculate",
            json={
                **base_request,
                "configuration": {"mechanism": "Эконом"},
                "extra_operations": [],
            },
        ).json()

        default_mechanisms = [
            component
            for component in default_payload["components"]
            if "Механизм" in component["name"]
        ]
        economy_mechanisms = [
            component
            for component in economy_payload["components"]
            if "Механизм" in component["name"]
        ]
        self.assertEqual(len(default_mechanisms), 1)
        self.assertIn("Стандарт", default_mechanisms[0]["name"])
        self.assertEqual(len(economy_mechanisms), 1)
        self.assertIn("Эконом", economy_mechanisms[0]["name"])
        self.assertEqual(economy_mechanisms[0]["tariff"], 1750.0)
        self.assertNotIn(
            "Стандарт",
            " ".join(component["name"] for component in economy_mechanisms),
        )
        self.assert_components_match_retail(economy_payload)

    def test_generic_eyelets_alias_matches_exact_no_layer_variant(self) -> None:
        request = {
            "product_type": "curtain",
            "model": "Вандер",
            "width_cm": 140,
            "height_cm": 270,
            "quantity": 2,
            "extra_operations": [],
        }
        alias_response = self.client.post(
            "/api/calculate",
            json={
                **request,
                "configuration": {"heading": "Люверсы"},
            },
        )
        exact_response = self.client.post(
            "/api/calculate",
            json={
                **request,
                "configuration": {
                    "heading": "Люверсы D35 матовое серебро, без слоя"
                },
            },
        )

        alias = alias_response.json()
        exact = exact_response.json()
        alias_eyelets = [
            component
            for component in alias["components"]
            if component["name"] == "Люверсы"
        ]
        alias_component_ids = {
            component.get("operation_id")
            for component in alias["components"]
        }
        self.assertEqual(alias_response.status_code, 200)
        self.assertEqual(exact_response.status_code, 200)
        self.assertEqual(alias["status"], "success")
        self.assertEqual(alias["retail_price"], exact["retail_price"])
        self.assertEqual(alias["operation_cost"], exact["operation_cost"])
        self.assertEqual(len(alias_eyelets), 1)
        self.assertEqual(alias_eyelets[0]["tariff"], 660.0)
        self.assertNotIn("OP_001", alias_component_ids)
        self.assertNotIn("OP_043", alias_component_ids)
        self.assert_components_match_retail(alias)
        self.assert_components_match_retail(exact)

    def test_all_exact_eyelet_variants_use_the_display_alias(self) -> None:
        data_dir = (
            Path(__file__).resolve().parents[1] / "backend" / "app" / "data"
        )
        eyelet_operations = [
            operation
            for operation in json.loads(
                (data_dir / "operations.json").read_text(encoding="utf-8")
            )["records"]
            if operation["group"] == "Крепление портьеры"
            and operation["variant"].startswith("Люверсы")
        ]

        self.assertEqual(len(eyelet_operations), 12)
        for operation in eyelet_operations:
            with self.subTest(variant=operation["variant"]):
                payload = self.client.post(
                    "/api/calculate",
                    json={
                        "product_type": "curtain",
                        "model": "Вандер",
                        "width_cm": 140,
                        "height_cm": 270,
                        "quantity": 2,
                        "configuration": {
                            "heading": operation["variant"]
                        },
                    },
                ).json()
                eyelets = [
                    component
                    for component in payload["components"]
                    if component["name"] == "Люверсы"
                ]
                self.assertEqual(payload["status"], "success")
                self.assertEqual(len(eyelets), 1)
                self.assertEqual(eyelets[0]["tariff"], operation["tariff_rub"])
                self.assert_components_match_retail(payload)

    def test_roman_ibiza_with_explicit_prime_embroidery(self) -> None:
        response = self.client.post(
            "/api/calculate",
            json={
                "product_type": "roman",
                "model": "Ибица",
                "width_cm": 120,
                "height_cm": 200,
                "quantity": 1,
                "extra_operations": ["Прайм"],
            },
        )

        payload = response.json()
        embroidery = [
            component
            for component in payload["components"]
            if component["category"] == "embroidery"
        ]
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(embroidery), 1)
        self.assertEqual(embroidery[0]["operation_id"], "OP_067")
        self.assertEqual(embroidery[0]["quantity"], 2.4)
        self.assertEqual(embroidery[0]["cost"], 888.0)
        self.assert_components_match_retail(payload)

    def test_exact_eyelets_and_leya_embroidery_can_be_combined(self) -> None:
        response = self.client.post(
            "/api/calculate",
            json={
                "product_type": "curtain",
                "model": "Ибица",
                "width_cm": 140,
                "height_cm": 270,
                "quantity": 2,
                "configuration": {
                    "heading": "Люверсы D35 матовое серебро, без слоя"
                },
                "extra_operations": ["Лея"],
            },
        )

        payload = response.json()
        component_ids = {
            component.get("operation_id")
            for component in payload["components"]
        }
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["status"], "success")
        self.assertIn("OP_021", component_ids)
        self.assertIn("OP_084", component_ids)
        self.assertNotIn("OP_001", component_ids)
        self.assertNotIn("OP_043", component_ids)
        self.assertEqual(
            sum(
                component["name"] == "Люверсы"
                for component in payload["components"]
            ),
            1,
        )
        self.assert_components_match_retail(payload)

    def test_exact_lining_and_explicit_default_mounting(self) -> None:
        curtain = self.client.post(
            "/api/calculate",
            json={
                "product_type": "curtain",
                "model": "Вандер",
                "width_cm": 120,
                "height_cm": 200,
                "quantity": 1,
                "configuration": {
                    "lining": "Отлетная по низу, заведена в боковые швы"
                },
            },
        ).json()
        roman = self.client.post(
            "/api/calculate",
            json={
                "product_type": "roman",
                "model": "Вандер",
                "width_cm": 120,
                "height_cm": 200,
                "quantity": 1,
                "configuration": {"mounting": "Стандарт"},
            },
        ).json()

        self.assertEqual(
            sum(
                component.get("operation_id") == "OP_062"
                for component in curtain["components"]
            ),
            1,
        )
        self.assertEqual(
            sum(
                component.get("operation_id") == "OP_117"
                for component in roman["components"]
            ),
            1,
        )
        self.assert_components_match_retail(curtain)
        self.assert_components_match_retail(roman)

    def test_explicit_built_in_extra_is_deduplicated(self) -> None:
        request = {
            "product_type": "curtain",
            "model": "Прайм",
            "width_cm": 120,
            "height_cm": 280,
            "quantity": 2,
        }
        implicit = self.client.post("/api/calculate", json=request).json()
        explicit = self.client.post(
            "/api/calculate",
            json={**request, "extra_operations": ["Прайм"]},
        ).json()

        explicit_embroidery = [
            component
            for component in explicit["components"]
            if component["category"] == "embroidery"
        ]
        self.assertEqual(implicit["retail_price"], 11784.4)
        self.assertEqual(explicit["retail_price"], implicit["retail_price"])
        self.assertEqual(len(explicit_embroidery), 1)

    def test_unknown_configuration_options_have_specific_codes(self) -> None:
        cases = [
            (
                "roman",
                {"mechanism": "СуперЭконом"},
                "CONFIGURATION_OPTION_NOT_FOUND",
            ),
            (
                "curtain",
                {"heading": "Магнитная лента"},
                "CONFIGURATION_OPTION_NOT_FOUND",
            ),
            (
                "roman",
                {"heading": "Люверсы"},
                "CONFIGURATION_NOT_SUPPORTED",
            ),
            (
                "curtain",
                {"mechanism": "Эконом"},
                "CONFIGURATION_NOT_SUPPORTED",
            ),
        ]
        for product_type, configuration, reason_code in cases:
            with self.subTest(configuration=configuration):
                response = self.client.post(
                    "/api/calculate",
                    json={
                        "product_type": product_type,
                        "model": "Вандер",
                        "width_cm": 120,
                        "height_cm": 200,
                        "quantity": 1,
                        "configuration": configuration,
                    },
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["reason_code"], reason_code)

    def test_unknown_extra_operation_has_specific_code(self) -> None:
        response = self.client.post(
            "/api/calculate",
            json={
                "product_type": "curtain",
                "model": "Вандер",
                "width_cm": 120,
                "height_cm": 200,
                "quantity": 1,
                "extra_operations": ["Несуществующий декор"],
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["reason_code"],
            "EXTRA_OPERATION_NOT_FOUND",
        )

    def test_unknown_mechanism_returns_catalog_options(self) -> None:
        response = self.client.post(
            "/api/calculate",
            json={
                "product_type": "roman",
                "model": "Вандер",
                "width_cm": 120,
                "height_cm": 200,
                "quantity": 1,
                "configuration": {"mechanism": "Премиум"},
            },
        )

        payload = response.json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            payload["reason_code"],
            "CONFIGURATION_OPTION_NOT_FOUND",
        )
        self.assertEqual(payload["details"]["field"], "mechanism")
        self.assertEqual(payload["details"]["requested_value"], "Премиум")
        self.assertEqual(
            payload["details"]["available_options"],
            ["Стандарт", "Эконом"],
        )

    def test_prime_embroidery_is_a_component(self) -> None:
        response = self.client.post(
            "/api/calculate",
            json={
                "product_type": "curtain",
                "model": "Прайм",
                "width_cm": 120,
                "height_cm": 280,
                "quantity": 2,
            },
        )

        payload = response.json()
        embroidery = [
            component
            for component in payload["components"]
            if component["category"] == "embroidery"
        ]
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(embroidery), 1)
        self.assertEqual(embroidery[0]["operation_id"], "OP_067")
        self.assertEqual(embroidery[0]["quantity"], 6.72)
        self.assertEqual(embroidery[0]["tariff"], 370.0)
        self.assertAlmostEqual(embroidery[0]["cost"], 2486.4, places=2)
        self.assert_components_match_retail(payload)

    def test_one_side_embroidery_uses_height_basis(self) -> None:
        response = self.client.post(
            "/api/calculate",
            json={
                "product_type": "curtain",
                "model": "Бриджит",
                "width_cm": 120,
                "height_cm": 280,
                "quantity": 1,
            },
        )

        payload = response.json()
        embroidery = next(
            component
            for component in payload["components"]
            if component["category"] == "embroidery"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(embroidery["basis"], "высота изделия")
        self.assertEqual(embroidery["quantity"], 2.8)
        self.assertEqual(embroidery["tariff"], 500.0)
        self.assertEqual(embroidery["cost"], 1400.0)
        self.assert_components_match_retail(payload)

    def test_problematic_model_is_business_unavailable(self) -> None:
        response = self.client.post(
            "/api/calculate",
            json={
                "product_type": "curtain",
                "model": "Вилла",
                "width_cm": 100,
                "height_cm": 200,
                "quantity": 1,
            },
        )

        payload = response.json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["status"], "unavailable")
        self.assertEqual(payload["reason_code"], "PROBLEMATIC_MODEL")

    def test_unknown_model_is_business_unavailable(self) -> None:
        response = self.client.post(
            "/api/calculate",
            json={
                "product_type": "curtain",
                "model": "Неизвестная",
                "width_cm": 100,
                "height_cm": 200,
                "quantity": 1,
            },
        )

        payload = response.json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["status"], "unavailable")
        self.assertEqual(payload["reason_code"], "MODEL_NOT_FOUND")

    def test_invalid_width_returns_422(self) -> None:
        response = self.client.post(
            "/api/calculate",
            json={
                "product_type": "curtain",
                "model": "Вандер",
                "width_cm": 0,
                "height_cm": 200,
                "quantity": 1,
            },
        )

        self.assertEqual(response.status_code, 422)

    def test_invalid_quantity_returns_422(self) -> None:
        response = self.client.post(
            "/api/calculate",
            json={
                "product_type": "curtain",
                "model": "Вандер",
                "width_cm": 100,
                "height_cm": 200,
                "quantity": 0,
            },
        )

        self.assertEqual(response.status_code, 422)

    def test_unexpected_exception_returns_500(self) -> None:
        with patch(
            "backend.app.api.routes.calculate",
            side_effect=RuntimeError("internal details"),
        ):
            response = self.client.post(
                "/api/calculate",
                json={
                    "product_type": "curtain",
                    "model": "Вандер",
                    "width_cm": 100,
                    "height_cm": 200,
                    "quantity": 1,
                },
            )

        self.assertEqual(response.status_code, 500)
        self.assertEqual(
            response.json(),
            {
                "status": "error",
                "message": "Не удалось выполнить расчёт.",
            },
        )
        self.assertNotIn("internal details", response.text)

    def test_all_master_success_components_match_retail(self) -> None:
        data_dir = (
            Path(__file__).resolve().parents[1] / "backend" / "app" / "data"
        )
        master = json.loads(
            (data_dir / "master.json").read_text(encoding="utf-8")
        )["records"]
        fabrics = {
            fabric["name"]: fabric
            for fabric in json.loads(
                (data_dir / "fabrics.json").read_text(encoding="utf-8")
            )["records"]
        }
        success_count = 0
        problematic_count = 0

        for model in master:
            fabric = fabrics.get(model["fabric_name"])
            fabric_width = fabric.get("width_cm") if fabric else None
            if model["product_type"] == "roman":
                height = min(180, fabric_width) if fabric_width else 180
            else:
                height = min(270, fabric_width - 10) if fabric_width else 200
            response = self.client.post(
                "/api/calculate",
                json={
                    "product_type": model["product_type"],
                    "model": model["model"],
                    "width_cm": 100,
                    "height_cm": height,
                    "quantity": 1,
                },
            )
            payload = response.json()
            self.assertEqual(response.status_code, 200)
            if model["status"] == "problematic":
                problematic_count += 1
                self.assertEqual(payload["reason_code"], "PROBLEMATIC_MODEL")
            else:
                success_count += 1
                self.assertEqual(payload["status"], "success")
                self.assert_components_match_retail(payload)

        self.assertEqual(success_count, 94)
        self.assertEqual(problematic_count, 7)


if __name__ == "__main__":
    unittest.main()

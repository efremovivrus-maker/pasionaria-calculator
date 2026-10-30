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
        self.assertEqual(payload["retail_price"], 14840.4)
        self.assertTrue(
            any(
                component["category"] == "fabric"
                for component in payload["components"]
            )
        )
        self.assertTrue(
            any(
                "Механизм" in component["name"]
                and component["cost"] == 10312.5
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
        self.assertEqual(economy_mechanisms[0]["tariff"], 4375.0)
        self.assertNotIn(
            "Стандарт",
            " ".join(component["name"] for component in economy_mechanisms),
        )
        self.assert_components_match_retail(economy_payload)

    def test_all_roman_mechanism_tariffs_and_normalized_names(self) -> None:
        cases = (
            ("Эконом", "OP_110", "Эконом", 4375.0),
            ("Стандарт", "OP_111", "Стандарт", 6250.0),
            (
                "день ночь эконом",
                "OP_126",
                "День-ночь Эконом",
                7656.25,
            ),
            (
                "ДЕНЬ НОЧЬ СТАНДАРТ",
                "OP_127",
                "День-ночь Стандарт",
                10937.5,
            ),
        )
        for requested, operation_id, display_name, tariff in cases:
            with self.subTest(requested=requested):
                response = self.client.post(
                    "/api/calculate",
                    json={
                        "product_type": "roman",
                        "model": "Вандер",
                        "width_cm": 120,
                        "height_cm": 200,
                        "quantity": 1,
                        "configuration": {"mechanism": requested},
                    },
                )
                payload = response.json()
                mechanisms = [
                    component
                    for component in payload["components"]
                    if component.get("operation_id") == operation_id
                ]
                self.assertEqual(response.status_code, 200)
                self.assertEqual(payload["status"], "success")
                self.assertEqual(len(mechanisms), 1)
                self.assertIn(display_name, mechanisms[0]["name"])
                self.assertEqual(mechanisms[0]["tariff"], tariff)
                self.assert_components_match_retail(payload)

    def test_bare_day_night_mechanism_is_ambiguous(self) -> None:
        response = self.client.post(
            "/api/calculate",
            json={
                "product_type": "roman",
                "model": "Вандер",
                "width_cm": 120,
                "height_cm": 200,
                "quantity": 1,
                "configuration": {"mechanism": "день ночь"},
            },
        )

        payload = response.json()
        self.assertEqual(payload["status"], "unavailable")
        self.assertEqual(
            payload["reason_code"],
            "CONFIGURATION_NOT_SUPPORTED",
        )
        self.assertEqual(
            payload["details"]["available_options"],
            ["День-ночь Эконом", "День-ночь Стандарт"],
        )

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

    def test_generic_lining_uses_product_defaults_once(self) -> None:
        cases = (
            ("curtain", "OP_062", 400.0),
            ("roman", "OP_065", 500.0),
        )
        for product_type, operation_id, tariff in cases:
            with self.subTest(product_type=product_type):
                payload = self.client.post(
                    "/api/calculate",
                    json={
                        "product_type": product_type,
                        "model": "Вандер",
                        "width_cm": 120,
                        "height_cm": 200,
                        "quantity": 1,
                        "configuration": {"lining": "Подкладка"},
                    },
                ).json()
                lining = [
                    component
                    for component in payload["components"]
                    if component["name"] == "Подкладка"
                ]
                self.assertEqual(payload["status"], "success")
                self.assertEqual(len(lining), 1)
                self.assertEqual(lining[0]["operation_id"], operation_id)
                self.assertEqual(lining[0]["tariff"], tariff)
                self.assert_components_match_retail(payload)

    def test_specific_and_equivalent_lining_variants(self) -> None:
        cases = (
            (
                "Отлетная по низу с перегибами по боковым швам",
                "OP_063",
                220.0,
            ),
            ("Притачная по боковым швам и низу", "OP_066", 260.0),
            ("Притачная", "OP_064", 260.0),
        )
        for requested, operation_id, tariff in cases:
            with self.subTest(requested=requested):
                payload = self.client.post(
                    "/api/calculate",
                    json={
                        "product_type": "curtain",
                        "model": "Вандер",
                        "width_cm": 120,
                        "height_cm": 200,
                        "quantity": 1,
                        "configuration": {"lining": requested},
                    },
                ).json()
                lining = [
                    component
                    for component in payload["components"]
                    if component["name"] == "Подкладка"
                ]
                self.assertEqual(payload["status"], "success")
                self.assertEqual(len(lining), 1)
                self.assertEqual(lining[0]["operation_id"], operation_id)
                self.assertEqual(lining[0]["tariff"], tariff)
                self.assert_components_match_retail(payload)

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
            [
                "Стандарт",
                "Эконом",
                "День-ночь Эконом",
                "День-ночь Стандарт",
            ],
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
        self.assertEqual(
            payload["message"],
            (
                "Не удалось найти модель «Неизвестная». "
                "Укажите название модели как на сайте pasionaria.ru."
            ),
        )

    def test_catalog_model_matching_normalizes_and_corrects_typos(self) -> None:
        cases = (
            ("вАнДер", "Вандер"),
            ("Мери", "Мэри"),
            ("Вандр", "Вандер"),
            ("Репаблк", "Репаблик"),
        )
        for requested, expected in cases:
            with self.subTest(requested=requested):
                payload = self.client.post(
                    "/api/calculate",
                    json={
                        "product_type": "curtain",
                        "model": requested,
                        "width_cm": 100,
                        "height_cm": 200,
                        "quantity": 1,
                    },
                ).json()
                self.assertEqual(payload["status"], "success")
                self.assertEqual(
                    payload["normalized_request"]["model"],
                    expected,
                )

    def test_catalog_model_matching_does_not_guess(self) -> None:
        for requested in ("Оска", "Нея", "абракадабра"):
            with self.subTest(requested=requested):
                payload = self.client.post(
                    "/api/calculate",
                    json={
                        "product_type": "curtain",
                        "model": requested,
                        "width_cm": 100,
                        "height_cm": 200,
                        "quantity": 1,
                    },
                ).json()
                self.assertEqual(payload["status"], "unavailable")
                self.assertEqual(
                    payload["reason_code"],
                    "MODEL_NOT_FOUND",
                )

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
        not_calculated_count = 0

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
            elif model["status"] == "not_calculated":
                not_calculated_count += 1
                self.assertEqual(payload["reason_code"], "MODEL_NOT_CALCULATED")
                self.assertIn("Индивидуальный расчёт не выполняется", payload["message"])
                self.assertNotIn("retail_price", payload)
            else:
                success_count += 1
                self.assertEqual(payload["status"], "success", model["model"])
                self.assert_components_match_retail(payload)

        self.assertEqual(success_count, 114)
        self.assertEqual(problematic_count, 7)
        self.assertEqual(not_calculated_count, 8)


class DayNightRomanTests(unittest.TestCase):
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

    def post_roman(self, **overrides: object) -> dict:
        payload = {
            "product_type": "roman",
            "model": "Вандер",
            "width_cm": 120,
            "height_cm": 200,
            "quantity": 1,
            "configuration": {"mechanism": "День-ночь Эконом"},
        }
        payload.update(overrides)
        response = self.client.post("/api/calculate", json=payload)
        self.assertEqual(response.status_code, 200)
        return response.json()

    def operation_ids(self, payload: dict, operation_id: str) -> list[dict]:
        return [
            component
            for component in payload["components"]
            if component.get("operation_id") == operation_id
        ]

    def test_vita_is_unique_and_usable(self) -> None:
        records = json.loads(
            (
                Path(__file__).resolve().parents[1]
                / "backend"
                / "app"
                / "data"
                / "fabrics.json"
            ).read_text(encoding="utf-8")
        )["records"]
        vita = [record for record in records if record["name"] == "Вита"]
        articles = [record["base_article"] for record in records]
        identifiers = [record["id"] for record in records if "id" in record]

        self.assertEqual(len(vita), 1)
        self.assertEqual(vita[0]["id"], "FABRIC_VITA")
        self.assertEqual(vita[0]["base_article"], "FABRIC_VITA")
        self.assertEqual(vita[0]["width_cm"], 280)
        self.assertEqual(vita[0]["rrc_price_rub_per_m"], 700)
        self.assertEqual(articles.count("FABRIC_VITA"), 1)
        self.assertEqual(len(identifiers), len(set(identifiers)))

    def test_day_night_uses_vita_by_default_for_both_levels(self) -> None:
        cases = (
            ("День-ночь Эконом", "OP_126", 7656.25, 9187.5, 15630.5),
            ("День-ночь Стандарт", "OP_127", 10937.5, 13125.0, 19568.0),
        )
        for mechanism, operation_id, tariff, mechanism_cost, retail in cases:
            with self.subTest(mechanism=mechanism):
                payload = self.post_roman(
                    configuration={"mechanism": mechanism},
                )
                mechanisms = self.operation_ids(payload, operation_id)
                sewing = self.operation_ids(payload, "OP_106")
                rings = self.operation_ids(payload, "OP_115")
                mounting = self.operation_ids(payload, "OP_117")

                self.assertEqual(payload["status"], "success")
                self.assertEqual(
                    payload["normalized_request"]["day_fabric"],
                    "Вита",
                )
                self.assertEqual(payload["fabric"]["consumption_m"], 1.3)
                self.assertEqual(payload["fabric"]["cost"], 1365.0)
                self.assertEqual(payload["day_fabric"]["name"], "Вита")
                self.assertEqual(payload["day_fabric"]["width_cm"], 280)
                self.assertEqual(payload["day_fabric"]["price_per_m"], 700)
                self.assertEqual(payload["day_fabric"]["consumption_m"], 1.3)
                self.assertEqual(payload["day_fabric"]["cost"], 910.0)
                self.assertEqual(len(sewing), 2)
                self.assertEqual(len(rings), 2)
                self.assertTrue(
                    all(component["cost"] == 512.0 for component in sewing)
                )
                self.assertTrue(
                    all(component["cost"] == 1416.0 for component in rings)
                )
                self.assertEqual(
                    [component["name"] for component in sewing],
                    [
                        "Пошив римской шторы — Стандартная сборка, основное полотно",
                        "Пошив римской шторы — Стандартная сборка, дневное полотно",
                    ],
                )
                self.assertEqual(len(mechanisms), 1)
                self.assertEqual(mechanisms[0]["tariff"], tariff)
                self.assertEqual(mechanisms[0]["cost"], mechanism_cost)
                self.assertNotAlmostEqual(
                    mechanisms[0]["cost"],
                    round(tariff * 1.75 * 1.2, 2),
                    places=2,
                )
                self.assertEqual(len(mounting), 1)
                self.assertEqual(mounting[0]["cost"], 312.0)
                self.assertEqual(payload["retail_price"], retail)
                self.assert_components_match_retail(payload)

    def test_explicit_day_fabric_replaces_vita(self) -> None:
        payload = self.post_roman(day_fabric="Вудсток")

        self.assertEqual(payload["status"], "success")
        self.assertEqual(payload["normalized_request"]["day_fabric"], "Вудсток")
        self.assertEqual(payload["day_fabric"]["name"], "Вудсток")
        self.assertEqual(payload["day_fabric"]["consumption_m"], 1.3)
        self.assertEqual(payload["day_fabric"]["cost"], 1001.0)
        self.assertEqual(payload["fabric"]["consumption_m"], 1.3)
        self.assertEqual(payload["retail_price"], 15721.5)
        self.assert_components_match_retail(payload)

    def test_two_finished_blinds_scale_shared_operations_once_per_item(self) -> None:
        payload = self.post_roman(quantity=2)
        sewing = self.operation_ids(payload, "OP_106")
        rings = self.operation_ids(payload, "OP_115")
        mechanisms = self.operation_ids(payload, "OP_126")
        mounting = self.operation_ids(payload, "OP_117")

        self.assertEqual(payload["fabric"]["consumption_m"], 2.6)
        self.assertEqual(payload["day_fabric"]["consumption_m"], 2.6)
        self.assertEqual(len(sewing), 2)
        self.assertEqual(len(rings), 2)
        self.assertTrue(all(component["cost"] == 1024.0 for component in sewing))
        self.assertTrue(all(component["cost"] == 2832.0 for component in rings))
        self.assertEqual(len(mechanisms), 1)
        self.assertEqual(mechanisms[0]["quantity"], 2.4)
        self.assertEqual(mechanisms[0]["cost"], 18375.0)
        self.assertEqual(len(mounting), 1)
        self.assertEqual(mounting[0]["cost"], 624.0)
        self.assertEqual(payload["retail_price"], 31261.0)
        self.assert_components_match_retail(payload)

    def test_unknown_day_fabric_has_no_invented_price(self) -> None:
        payload = self.post_roman(day_fabric="Нет такой ткани")

        self.assertEqual(payload["status"], "unavailable")
        self.assertEqual(payload["reason_code"], "FABRIC_NOT_FOUND")
        self.assertIn("Нет такой ткани", payload["message"])
        self.assertNotIn("retail_price", payload)

    def test_day_fabric_height_limit_names_the_fabric(self) -> None:
        payload = self.post_roman(day_fabric="Алан")

        self.assertEqual(payload["status"], "unavailable")
        self.assertEqual(payload["reason_code"], "ROMAN_TOO_HIGH")
        self.assertIn("Дневная ткань «Алан»", payload["message"])
        self.assertNotIn("retail_price", payload)

    def test_main_fabric_height_limit_names_the_main_fabric(self) -> None:
        payload = self.post_roman(height_cm=281)

        self.assertEqual(payload["status"], "unavailable")
        self.assertEqual(payload["reason_code"], "ROMAN_TOO_HIGH")
        self.assertIn("Основная ткань «Вандер»", payload["message"])

    def test_day_fabric_without_day_night_mechanism_asks_for_clarification(self) -> None:
        payload = self.post_roman(
            configuration={"mechanism": "Эконом"},
            day_fabric="Вита",
        )

        self.assertEqual(payload["status"], "unavailable")
        self.assertEqual(payload["reason_code"], "CONFIGURATION_NOT_SUPPORTED")
        self.assertIn("День-ночь Эконом", payload["message"])
        self.assertNotIn("retail_price", payload)

    def test_ordinary_roman_price_is_unchanged(self) -> None:
        economy = self.client.post(
            "/api/calculate",
            json={
                "product_type": "roman",
                "model": "Вандер",
                "width_cm": 120,
                "height_cm": 200,
                "quantity": 1,
                "configuration": {"mechanism": "Эконом"},
            },
        ).json()
        default = self.client.post(
            "/api/calculate",
            json={
                "product_type": "roman",
                "model": "Вандер",
                "width_cm": 120,
                "height_cm": 200,
                "quantity": 1,
            },
        ).json()

        self.assertEqual(economy["status"], "success")
        self.assertNotIn("day_fabric", economy)
        self.assertEqual(len(self.operation_ids(economy, "OP_106")), 1)
        self.assertEqual(len(self.operation_ids(economy, "OP_115")), 1)
        self.assertEqual(len(self.operation_ids(economy, "OP_110")), 1)
        self.assertEqual(self.operation_ids(economy, "OP_110")[0]["cost"], 5250.0)
        self.assertEqual(economy["retail_price"], 8855.0)
        self.assertEqual(default["retail_price"], 11105.0)
        self.assert_components_match_retail(economy)
        self.assert_components_match_retail(default)

    def test_lining_and_embroidery_are_not_duplicated(self) -> None:
        payload = self.post_roman(
            configuration={
                "mechanism": "День-ночь Эконом",
                "lining": "Подкладка",
            },
            extra_operations=["Прайм"],
        )
        lining = [
            component
            for component in payload["components"]
            if component["name"] == "Подкладка"
        ]
        embroidery = self.operation_ids(payload, "OP_067")

        self.assertEqual(payload["status"], "success")
        self.assertEqual(len(lining), 1)
        self.assertEqual(len(embroidery), 1)
        self.assertEqual(len(self.operation_ids(payload, "OP_126")), 1)
        self.assertEqual(len(self.operation_ids(payload, "OP_117")), 1)
        self.assert_components_match_retail(payload)


class ReportedModelAuditTests(unittest.TestCase):
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
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_mary_includes_anika_embroidery_once(self) -> None:
        single = self.calculate(
            product_type="curtain",
            model="Мэри",
            width_cm=140,
            height_cm=270,
            quantity=1,
        )
        repeated = self.calculate(
            product_type="curtain",
            model="Мэри",
            width_cm=140,
            height_cm=270,
            quantity=1,
            extra_operations=["Мэри"],
        )
        pair = self.calculate(
            product_type="curtain",
            model="Мэри",
            width_cm=140,
            height_cm=270,
            quantity=2,
        )
        resized = self.calculate(
            product_type="curtain",
            model="Мэри",
            width_cm=100,
            height_cm=200,
            quantity=2,
        )
        anika = self.calculate(
            product_type="curtain",
            model="Аника",
            width_cm=100,
            height_cm=200,
            quantity=2,
        )

        def embroidery(payload: dict) -> list[dict]:
            return [
                component
                for component in payload["components"]
                if component.get("operation_id") == "OP_128"
            ]

        single_embroidery = embroidery(single)
        self.assertEqual(single["status"], "success")
        self.assertEqual(single["fabric"]["name"], "Ибица")
        self.assertEqual(single["fabric"]["price_per_m"], 2835.0)
        self.assertEqual(single["fabric"]["consumption_m"], 1.6)
        self.assertEqual(len(single_embroidery), 1)
        self.assertEqual(single_embroidery[0]["tariff"], 910.0)
        self.assertEqual(single_embroidery[0]["quantity"], 3.78)
        self.assertEqual(single_embroidery[0]["cost"], 3439.8)
        self.assertEqual(len(embroidery(repeated)), 1)
        self.assertEqual(repeated["retail_price"], single["retail_price"])
        self.assertEqual(embroidery(pair)[0]["cost"], 6879.6)
        self.assertEqual(embroidery(resized)[0]["cost"], 3640.0)
        self.assertEqual(
            embroidery(resized)[0]["cost"],
            next(
                component["cost"]
                for component in anika["components"]
                if component.get("operation_id") == "OP_071"
            ),
        )
        for payload in (single, repeated, pair, resized, anika):
            component_total = sum(
                component["cost"] for component in payload["components"]
            )
            self.assertAlmostEqual(
                component_total,
                payload["retail_price"],
                places=2,
            )

    def test_soft_has_no_second_fabric(self) -> None:
        payload = self.calculate(
            product_type="curtain",
            model="Софт",
            width_cm=140,
            height_cm=270,
            quantity=2,
        )
        fabric_names = [
            component["name"]
            for component in payload["components"]
            if component["category"] == "fabric"
        ]

        self.assertEqual(payload["status"], "success")
        self.assertEqual(fabric_names, ["Ткань «Софт»"])

    def test_liberty_embroidery_remains_on_a_taller_curtain(self) -> None:
        payload = self.calculate(
            product_type="curtain",
            model="Либерти",
            width_cm=140,
            height_cm=320,
            quantity=2,
        )
        embroidery = [
            component
            for component in payload["components"]
            if component.get("operation_id") == "OP_069"
        ]

        self.assertEqual(payload["status"], "success")
        self.assertEqual(payload["fabric"]["layout"], "rotated_shared")
        self.assertEqual(len(embroidery), 1)
        self.assertEqual(embroidery[0]["tariff"], 660.0)

    def test_miriam_tiebacks_are_not_free(self) -> None:
        payload = self.calculate(
            product_type="curtain",
            model="Мириам",
            width_cm=140,
            height_cm=270,
            quantity=2,
            extra_operations=["подхваты"],
        )

        self.assertEqual(payload["status"], "unavailable")
        self.assertEqual(payload["reason_code"], "EXTRA_OPERATION_NOT_FOUND")
        self.assertNotIn("retail_price", payload)

    def test_blackout_word_keeps_explicit_miriam_model(self) -> None:
        dimensions = {
            "product_type": "curtain",
            "width_cm": 140,
            "height_cm": 270,
            "quantity": 1,
        }
        plain = self.calculate(model="Мириам", **dimensions)
        described = self.calculate(
            model="Блэкаут шторы Мириам",
            **dimensions,
        )
        described_extra = self.calculate(
            model="Мириам",
            extra_operations=["Блэкаут"],
            **dimensions,
        )
        blackout_model = self.calculate(model="Блэкаут", **dimensions)

        self.assertEqual(plain["status"], "success")
        self.assertEqual(plain["normalized_request"]["model"], "Мириам")
        self.assertEqual(plain["fabric"]["name"], "Мириам")
        self.assertEqual(described["normalized_request"]["model"], "Мириам")
        self.assertEqual(described["fabric"]["name"], "Мириам")
        self.assertEqual(described["retail_price"], plain["retail_price"])
        self.assertEqual(
            described_extra["retail_price"],
            plain["retail_price"],
        )
        self.assertEqual(described_extra["extras"], [])
        self.assertNotEqual(
            blackout_model["fabric"]["name"],
            plain["fabric"]["name"],
        )
        self.assertNotEqual(
            blackout_model["retail_price"],
            plain["retail_price"],
        )
        for payload in (plain, described, described_extra, blackout_model):
            self.assertEqual(payload["status"], "success")
            self.assertFalse(
                any(
                    component["name"] == "Подкладка"
                    or "блэкаут" in component["name"].casefold()
                    for component in payload["components"]
                    if payload is not blackout_model
                    or component["category"] != "fabric"
                )
            )
            self.assertAlmostEqual(
                sum(component["cost"] for component in payload["components"]),
                payload["retail_price"],
                places=2,
            )

    def test_miriam_phrase_uses_curtain_only_n8n_json(self) -> None:
        dimensions = {
            "width_cm": 140,
            "height_cm": 270,
            "quantity": 1,
        }
        plain = self.calculate(
            product_type="curtain",
            model="Мириам",
            **dimensions,
        )
        parsed = self.calculate(
            product_type="curtain",
            model="Мириам",
            configuration={
                "heading": None,
                "mechanism": None,
                "lining": None,
                "mounting": None,
            },
            day_fabric=None,
            extra_operations=[],
            raw_request="Блэкаут шторы с подхватами Мириам 140x270",
            **dimensions,
        )
        phrase_as_model = self.calculate(
            product_type="curtain",
            model="Блэкаут шторы с подхватами Мириам",
            configuration={
                "heading": None,
                "mechanism": None,
                "lining": None,
                "mounting": None,
            },
            extra_operations=[],
            **dimensions,
        )
        tiebacks_as_extra = self.calculate(
            product_type="curtain",
            model="Мириам",
            configuration={"lining": None},
            extra_operations=["подхваты"],
            raw_request="Блэкаут шторы с подхватами Мириам 140x270",
            **dimensions,
        )

        for payload in (parsed, phrase_as_model):
            self.assertEqual(payload["status"], "success")
            self.assertEqual(payload["normalized_request"]["model"], "Мириам")
            self.assertEqual(payload["fabric"]["name"], "Мириам")
            self.assertEqual(payload["extras"], [])
            self.assertEqual(payload["retail_price"], plain["retail_price"])
            self.assertIsNone(
                payload["normalized_request"]["configuration"].get("lining")
            )
            self.assertFalse(
                any(
                    "подхват" in component["name"].casefold()
                    or component["name"] == "Подкладка"
                    for component in payload["components"]
                )
            )
            self.assertAlmostEqual(
                sum(component["cost"] for component in payload["components"]),
                payload["retail_price"],
                places=2,
            )

        self.assertEqual(tiebacks_as_extra["status"], "unavailable")
        self.assertEqual(
            tiebacks_as_extra["reason_code"],
            "EXTRA_OPERATION_NOT_FOUND",
        )
        self.assertNotIn("retail_price", tiebacks_as_extra)

    def test_maya_spellings_use_standard_curtain_recipe(self) -> None:
        standard_prices = []
        for model in ("Майа", "Майя", "Мая"):
            with self.subTest(model=model):
                payload = self.calculate(
                    product_type="curtain",
                    model=model,
                    width_cm=140,
                    height_cm=270,
                    quantity=1,
                )
                self.assertEqual(payload["status"], "success")
                self.assertEqual(payload["normalized_request"]["model"], "Майа")
                self.assertEqual(payload["fabric"]["name"], "Майа")
                self.assertEqual(payload["fabric"]["width_cm"], 320)
                self.assertEqual(payload["fabric"]["price_per_m"], 1845)
                self.assertEqual(payload["fabric"]["layout"], "standard")
                self.assertEqual(payload["fabric"]["consumption_m"], 1.6)
                self.assertEqual(payload["fabric"]["cost"], 2952)
                self.assertEqual(payload["extras"], [])
                self.assertEqual(payload["retail_price"], 3667)
                self.assertAlmostEqual(
                    sum(component["cost"] for component in payload["components"]),
                    payload["retail_price"],
                    places=2,
                )
                standard_prices.append(payload["retail_price"])
        self.assertEqual(len(set(standard_prices)), 1)

        tall = self.calculate(
            product_type="curtain",
            model="Майя",
            width_cm=140,
            height_cm=320,
            quantity=1,
        )
        self.assertEqual(tall["status"], "success")
        self.assertEqual(tall["normalized_request"]["model"], "Майа")
        self.assertEqual(tall["fabric"]["layout"], "rotated")
        self.assertEqual(tall["fabric"]["consumption_m"], 3.4)
        self.assertEqual(tall["extras"], [])
        self.assertAlmostEqual(
            sum(component["cost"] for component in tall["components"]),
            tall["retail_price"],
            places=2,
        )


if __name__ == "__main__":
    unittest.main()

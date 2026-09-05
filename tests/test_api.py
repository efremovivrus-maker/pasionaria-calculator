from pathlib import Path
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


if __name__ == "__main__":
    unittest.main()

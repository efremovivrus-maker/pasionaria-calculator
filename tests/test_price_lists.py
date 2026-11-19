import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.services.price_lists import price_list


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

import json
from pathlib import Path
import unittest


CONTRACT_PATH = (
    Path(__file__).resolve().parents[1]
    / "docs"
    / "n8n-parser-examples.json"
)
GUIDE_PATH = (
    Path(__file__).resolve().parents[1]
    / "docs"
    / "n8n-configuration-contract.md"
)


class N8nParserContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
        cls.cases = {
            case["input"]: case["expected"]
            for case in cls.contract["quantity_cases"]
        }

    def test_singular_products_infer_one_item(self) -> None:
        for phrase in ("римская штора Вандер", "штора Вандер"):
            with self.subTest(phrase=phrase):
                expected = self.cases[phrase]
                self.assertEqual(expected["quantity"], 1)
                self.assertEqual(
                    expected["quantity_source"],
                    "inferred_singular",
                )
                self.assertFalse(expected["quantity_missing"])

    def test_plural_and_set_forms_keep_quantity_missing(self) -> None:
        for phrase in ("комплект штор Вандер", "шторы Вандер"):
            with self.subTest(phrase=phrase):
                expected = self.cases[phrase]
                self.assertIsNone(expected["quantity"])
                self.assertEqual(expected["quantity_source"], "missing")
                self.assertTrue(expected["quantity_missing"])

    def test_explicit_quantities_are_preserved(self) -> None:
        expected_values = {
            "2 римские шторы Вандер": 2,
            "3 комплекта штор Вандер": 3,
        }
        for phrase, quantity in expected_values.items():
            with self.subTest(phrase=phrase):
                expected = self.cases[phrase]
                self.assertEqual(expected["quantity"], quantity)
                self.assertEqual(expected["quantity_source"], "explicit")
                self.assertFalse(expected["quantity_missing"])


class BedspreadSessionContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.guide = GUIDE_PATH.read_text(encoding="utf-8")

    def test_bedspread_requests_are_not_merged_into_the_session(self) -> None:
        self.assertIn("A bedspread skips this merge.", self.guide)
        self.assertIn("from that message alone", self.guide)
        self.assertIn("session after the reply: still Вандер", self.guide)
        self.assertIn(
            "Do not add `face_fabric`, `stitch` or `filling` columns.",
            self.guide,
        )
        self.assertIn("Leave the curtain and Roman session", self.guide)
        self.assertIn("Do not ask a clarifying question for a bedspread.", self.guide)
        self.assertIn("`POST /api/calculate` with `model` omitted or null.", self.guide)
        self.assertNotIn("укажите модель в новом полном запросе", self.guide)

    def test_curtain_merge_rules_remain(self) -> None:
        self.assertIn(
            "applies only when the current message is a",
            self.guide,
        )
        self.assertIn("`day_fabric` is in `fields_present`", self.guide)
        self.assertIn("configuration_mechanism", self.guide)


if __name__ == "__main__":
    unittest.main()

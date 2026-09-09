import json
from pathlib import Path
import unittest


CONTRACT_PATH = (
    Path(__file__).resolve().parents[1]
    / "docs"
    / "n8n-parser-examples.json"
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


if __name__ == "__main__":
    unittest.main()

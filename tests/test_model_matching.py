import unittest

from backend.app.services.model_matching import resolve_model


def catalog(*names: str) -> list[dict[str, str]]:
    return [{"model": name} for name in names]


class ModelMatchingTests(unittest.TestCase):
    def test_exact_match_has_priority(self) -> None:
        result = resolve_model(
            "Вандер",
            catalog("Вандер", "Вандера"),
        )

        self.assertEqual(result.model["model"], "Вандер")
        self.assertEqual(result.match_type, "exact")
        self.assertEqual(result.distance, 0)

    def test_case_and_cyrillic_vowels_are_normalized(self) -> None:
        for requested, expected in (
            ("вАнДер", "Вандер"),
            ("Мери", "Мэри"),
            ("Берёза", "Береза"),
        ):
            with self.subTest(requested=requested):
                result = resolve_model(requested, catalog(expected))
                self.assertEqual(result.model["model"], expected)
                self.assertEqual(result.match_type, "normalized")
                self.assertEqual(result.distance, 0)

    def test_universal_fuzzy_matching_handles_synthetic_typos(self) -> None:
        cases = (
            ("Репаблк", "Репаблик", 1),
            ("Кембриджж", "Кембридж", 1),
            ("Алекзандрея", "Александрия", 2),
            ("Калифрна", "Калифорния", 3),
        )
        for requested, expected, distance in cases:
            with self.subTest(requested=requested):
                result = resolve_model(
                    requested,
                    catalog(expected, "Совершенно другая модель"),
                )
                self.assertEqual(result.model["model"], expected)
                self.assertEqual(result.match_type, "fuzzy")
                self.assertEqual(result.distance, distance)

    def test_short_names_use_a_stricter_threshold(self) -> None:
        result = resolve_model("Лк", catalog("Лука"))

        self.assertIsNone(result.model)
        self.assertEqual(result.distance, 2)

    def test_equal_best_candidates_are_ambiguous(self) -> None:
        result = resolve_model("Нея", catalog("Дея", "Лея"))

        self.assertIsNone(result.model)
        self.assertEqual(result.distance, 1)

    def test_close_runner_up_is_not_guessed(self) -> None:
        result = resolve_model(
            "abcdefghij",
            catalog("abcdefghik", "abcdefghxx"),
        )

        self.assertIsNone(result.model)
        self.assertEqual(result.distance, 1)

    def test_completely_unknown_name_is_rejected(self) -> None:
        result = resolve_model(
            "абракадабра",
            catalog("Вандер", "Мэри", "Репаблик"),
        )

        self.assertIsNone(result.model)

    def test_empty_catalog_is_rejected(self) -> None:
        result = resolve_model("Вандер", [])

        self.assertIsNone(result.model)
        self.assertIsNone(result.distance)


if __name__ == "__main__":
    unittest.main()

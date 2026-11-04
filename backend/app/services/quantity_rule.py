"""Quantity defaults that do not depend on how the parser phrased the request."""

from __future__ import annotations

import re


_NUMBER_WORDS = {
    "один": 1,
    "одна": 1,
    "одно": 1,
    "два": 2,
    "две": 2,
    "три": 3,
    "четыре": 4,
    "пять": 5,
    "шесть": 6,
    "семь": 7,
    "восемь": 8,
    "девять": 9,
    "десять": 10,
}
_AMBIGUOUS_COUNT = re.compile(
    r"(?:на\s+)?(?:\d+|один|одну|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять|несколько|пару)\s+окн"
    r"|\bнесколько\b",
    re.IGNORECASE,
)
_EXPLICIT_COUNT = re.compile(
    r"(\d+)\s*(?:шт\.?|штук[аи]?|комплект\w*)"
    r"|(\d+)\s+римск\w*(?:\s+штор\w*)?"
    r"|(один|одна|одно|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять)"
    r"\s+(?:шт\.?|штук[аи]?|комплект\w*|римск\w*(?:\s+штор\w*)?|штор\w*)",
    re.IGNORECASE,
)

AMBIGUOUS_QUANTITY_MESSAGE = (
    "Количество изделий не указано однозначно. Укажите, сколько изделий нужно."
)


def explicit_quantity(raw_request: str | None) -> int | None:
    """Read a product count written in the request, ignoring parser wording."""
    match = _EXPLICIT_COUNT.search(raw_request or "")
    if match is None:
        return None
    digits = match.group(1) or match.group(2)
    if digits:
        return int(digits)
    return _NUMBER_WORDS[match.group(3).casefold()]


def resolve_quantity(
    quantity: int | None,
    raw_request: str | None,
) -> tuple[int | None, str | None]:
    """Return one item when the count is absent.

    A count written in the request («2 шт», «две шторы», «3 комплекта») wins
    over a missing or different parser value. «на три окна» and «несколько»,
    without that product count, are not turned into a number. One curtain
    set stays one product: the word «шторы» alone is not two items.
    """
    text = raw_request or ""
    stated = explicit_quantity(text)
    if _AMBIGUOUS_COUNT.search(text) and stated is None:
        return None, AMBIGUOUS_QUANTITY_MESSAGE
    if stated is not None:
        return stated, None
    if quantity is None:
        return 1, None
    return quantity, None

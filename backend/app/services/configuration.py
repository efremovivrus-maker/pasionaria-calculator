"""Small, catalog-backed configuration overrides for supported products."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable


@dataclass(frozen=True)
class ConfigurationUnavailable:
    reason_code: str
    reason: str
    field: str
    requested_value: str


@dataclass(frozen=True)
class ConfigurationResolution:
    operation_ids: list[str]
    error: ConfigurationUnavailable | None = None


def _exact_variant(
    operations: Iterable[dict[str, Any]],
    *,
    group: str,
    value: str,
) -> dict[str, Any] | None:
    expected = value.strip().casefold()
    return next(
        (
            operation
            for operation in operations
            if operation["group"] == group
            and str(operation["variant"]).strip().casefold() == expected
        ),
        None,
    )


def _group_variants(
    operations: Iterable[dict[str, Any]],
    group: str,
) -> list[dict[str, Any]]:
    return [operation for operation in operations if operation["group"] == group]


def _not_found(field: str, value: str) -> ConfigurationUnavailable:
    return ConfigurationUnavailable(
        reason_code="CONFIGURATION_OPTION_NOT_FOUND",
        reason=f"В справочнике не найден вариант {field}={value!r}.",
        field=field,
        requested_value=value,
    )


def _not_supported(
    field: str,
    value: str,
    reason: str,
) -> ConfigurationUnavailable:
    return ConfigurationUnavailable(
        reason_code="CONFIGURATION_NOT_SUPPORTED",
        reason=reason,
        field=field,
        requested_value=value,
    )


def _replace_group(
    operation_ids: list[str],
    operations_by_id: dict[str, dict[str, Any]],
    group: str,
    replacement_id: str,
) -> list[str]:
    result: list[str] = []
    replaced = False
    for operation_id in operation_ids:
        if operations_by_id[operation_id]["group"] == group:
            if not replaced:
                result.append(replacement_id)
                replaced = True
        else:
            result.append(operation_id)
    if not replaced:
        result.append(replacement_id)
    return result


def apply_configuration(
    *,
    product_type: str,
    configuration: dict[str, str | None],
    recipe_operation_ids: list[str],
    operations: list[dict[str, Any]],
) -> ConfigurationResolution:
    operation_ids = list(recipe_operation_ids)
    operations_by_id = {
        operation["id"]: operation for operation in operations
    }

    mechanism = configuration.get("mechanism")
    if mechanism:
        if product_type != "roman":
            return ConfigurationResolution(
                operation_ids,
                _not_supported(
                    "mechanism",
                    mechanism,
                    "Механизмы римской шторы не применяются к шторам.",
                ),
            )
        selected = _exact_variant(
            operations,
            group="Механизм",
            value=mechanism,
        )
        if selected is None:
            return ConfigurationResolution(
                operation_ids,
                _not_found("mechanism", mechanism),
            )
        operation_ids = _replace_group(
            operation_ids,
            operations_by_id,
            "Механизм",
            selected["id"],
        )

    heading = configuration.get("heading")
    if heading:
        if product_type != "curtain":
            return ConfigurationResolution(
                operation_ids,
                _not_supported(
                    "heading",
                    heading,
                    "Верхняя обработка портьеры не применяется к римской шторе.",
                ),
            )
        default_heading = operations_by_id["OP_001"]["variant"]
        if heading.strip().casefold() not in {
            "шторная лента",
            default_heading.casefold(),
        }:
            selected = _exact_variant(
                operations,
                group="Крепление портьеры",
                value=heading,
            )
            if selected is None:
                matching_family = [
                    operation
                    for operation in _group_variants(
                        operations,
                        "Крепление портьеры",
                    )
                    if heading.strip().casefold()
                    in str(operation["variant"]).casefold()
                ]
                if matching_family:
                    return ConfigurationResolution(
                        operation_ids,
                        _not_supported(
                            "heading",
                            heading,
                            (
                                "Вариант верхней обработки неоднозначен: "
                                "нужно выбрать точный вариант из справочника."
                            ),
                        ),
                    )
                return ConfigurationResolution(
                    operation_ids,
                    _not_found("heading", heading),
                )
            operation_ids = _replace_group(
                operation_ids,
                operations_by_id,
                "Крепление портьеры",
                selected["id"],
            )
            if not str(selected["variant"]).casefold().startswith(
                "шторная лента"
            ):
                operation_ids = [
                    operation_id
                    for operation_id in operation_ids
                    if operations_by_id[operation_id]["group"]
                    != "Сборка шторной ленты"
                ]

    lining = configuration.get("lining")
    if lining:
        selected = _exact_variant(
            operations,
            group="Подкладка",
            value=lining,
        )
        if selected is None:
            matching_family = [
                operation
                for operation in _group_variants(operations, "Подкладка")
                if lining.strip().casefold()
                in str(operation["variant"]).casefold()
            ]
            error = (
                _not_supported(
                    "lining",
                    lining,
                    "Вариант подкладки неоднозначен; нужен точный вариант.",
                )
                if matching_family
                else _not_found("lining", lining)
            )
            return ConfigurationResolution(operation_ids, error)
        if (
            product_type == "curtain"
            and "для римских штор" in str(selected["variant"]).casefold()
        ):
            return ConfigurationResolution(
                operation_ids,
                _not_supported(
                    "lining",
                    lining,
                    "Этот вариант подкладки предназначен для римских штор.",
                ),
            )
        if selected["id"] not in operation_ids:
            operation_ids.append(selected["id"])

    mounting = configuration.get("mounting")
    if mounting:
        if product_type != "roman":
            return ConfigurationResolution(
                operation_ids,
                _not_supported(
                    "mounting",
                    mounting,
                    "Выбираемый монтаж в справочнике описан только для римских штор.",
                ),
            )
        selected = _exact_variant(
            operations,
            group="Монтаж римской шторы",
            value=mounting,
        )
        if selected is None:
            return ConfigurationResolution(
                operation_ids,
                _not_found("mounting", mounting),
            )
        operation_ids = _replace_group(
            operation_ids,
            operations_by_id,
            "Монтаж римской шторы",
            selected["id"],
        )

    return ConfigurationResolution(operation_ids)


def resolve_extra_operation_ids(
    *,
    requested_values: list[str],
    built_in_operation_id: str | None,
    operations: list[dict[str, Any]],
) -> tuple[list[str], ConfigurationUnavailable | None]:
    resolved = [built_in_operation_id] if built_in_operation_id else []
    seen = set(resolved)
    embroidery_operations = [
        operation
        for operation in operations
        if "вышив" in str(operation["group"]).casefold()
    ]

    for value in requested_values:
        selected = next(
            (
                operation
                for operation in embroidery_operations
                if str(operation["variant"]).strip().casefold()
                == value.strip().casefold()
            ),
            None,
        )
        if selected is None:
            return (
                resolved,
                ConfigurationUnavailable(
                    reason_code="EXTRA_OPERATION_NOT_FOUND",
                    reason=(
                        "Дополнительная операция "
                        f"{value!r} отсутствует в справочнике."
                    ),
                    field="extra_operations",
                    requested_value=value,
                ),
            )
        if selected["id"] not in seen:
            resolved.append(selected["id"])
            seen.add(selected["id"])

    return resolved, None

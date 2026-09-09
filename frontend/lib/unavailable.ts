type JsonObject = Record<string, unknown>;

const SAFE_FALLBACK = "Не могу надёжно рассчитать этот вариант.";

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];
}

function quotedList(values: string[]): string {
  const quoted = values.map((value) => `«${value}»`);
  if (quoted.length < 2) {
    return quoted[0] ?? "";
  }
  return `${quoted.slice(0, -1).join(", ")} и ${quoted.at(-1)}`;
}

function requestedModel(
  payload: JsonObject,
  details: JsonObject,
): string | undefined {
  const normalized = asObject(details.normalized_request);
  return (
    asString(details.model) ??
    asString(normalized?.model) ??
    asString(payload.model)
  );
}

const FIELD_LABELS: Record<string, string> = {
  mechanism: "механизм",
  heading: "вариант крепления",
  lining: "подкладку",
  mounting: "вариант монтажа",
};

export function formatUnavailableMessage(value: unknown): string {
  const payload = asObject(value);
  if (!payload) {
    return SAFE_FALLBACK;
  }
  const details = asObject(payload.details) ?? {};
  const reasonCode = asString(payload.reason_code);
  const reason =
    asString(details.reason) ??
    asString(payload.reason) ??
    asString(payload.explanation);

  if (reasonCode === "MODEL_NOT_FOUND") {
    const model = requestedModel(payload, details);
    return model
      ? `Не удалось найти модель «${model}». Укажите название модели как на сайте pasionaria.ru.`
      : SAFE_FALLBACK;
  }

  if (
    reasonCode === "ROMAN_TOO_HIGH" ||
    reasonCode === "FABRIC_WIDTH_UNKNOWN" ||
    reasonCode === "FABRIC_NOT_FOUND" ||
    reasonCode === "FABRIC_PRICE_UNKNOWN" ||
    reasonCode === "UNSUPPORTED_PRODUCT" ||
    reasonCode === "MISSING_RULE"
  ) {
    return (
      reason ??
      (reasonCode === "ROMAN_TOO_HIGH"
        ? "Не можем рассчитать римскую штору такого размера: высота изделия превышает допустимую ширину ткани."
        : SAFE_FALLBACK)
    );
  }

  if (reasonCode === "PROBLEMATIC_MODEL") {
    return asString(payload.message) ?? reason ?? SAFE_FALLBACK;
  }

  if (
    reasonCode === "CONFIGURATION_OPTION_NOT_FOUND" ||
    reasonCode === "CONFIGURATION_NOT_SUPPORTED"
  ) {
    const field = asString(details.field);
    const requestedValue = asString(details.requested_value);
    const fieldLabel = field ? FIELD_LABELS[field] : undefined;
    const availableOptions = stringList(
      details.available_options ?? details.candidates,
    );

    if (
      reasonCode === "CONFIGURATION_OPTION_NOT_FOUND" &&
      fieldLabel &&
      requestedValue
    ) {
      const optionsText =
        availableOptions.length > 0
          ? ` Доступные варианты: ${quotedList(availableOptions)}.`
          : "";
      return `Не нашёл ${fieldLabel} «${requestedValue}».${optionsText}`;
    }

    if (availableOptions.length > 0 && fieldLabel && requestedValue) {
      return `Не удалось однозначно выбрать ${fieldLabel} «${requestedValue}». Доступные варианты: ${quotedList(availableOptions)}.`;
    }
    return reason ?? SAFE_FALLBACK;
  }

  if (reasonCode === "EXTRA_OPERATION_NOT_FOUND") {
    const requestedValue = asString(details.requested_value);
    const availableOptions = stringList(details.available_options);
    if (!requestedValue) {
      return SAFE_FALLBACK;
    }
    const optionsText =
      availableOptions.length > 0
        ? ` Доступные варианты: ${quotedList(availableOptions)}.`
        : "";
    return `Не нашёл дополнительную операцию «${requestedValue}».${optionsText}`;
  }

  return SAFE_FALLBACK;
}

import type {
  CalculationResult,
  CostComponent,
  OperationLine,
  WebhookResponse,
} from "@/lib/types";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function firstObject(value: unknown): JsonObject {
  if (Array.isArray(value)) {
    return asObject(value[0]) ?? {};
  }
  return asObject(value) ?? {};
}

function parsePossibleJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function unwrapResponse(value: unknown): JsonObject {
  let payload = firstObject(value);
  const body = parsePossibleJson(payload.body);
  payload = asObject(body) ?? payload;
  payload = asObject(payload.data) ?? payload;
  payload = asObject(payload.result) ?? payload;
  return payload;
}

function operationLines(value: unknown): OperationLine[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item): OperationLine[] => {
    if (typeof item === "string") {
      return [{ name: item }];
    }
    const operation = asObject(item);
    if (!operation) {
      return [];
    }
    const group = asString(operation.group);
    const variant = asString(operation.variant);
    const name =
      asString(operation.name) ??
      asString([group, variant].filter(Boolean).join(": ")) ??
      "Операция";
    return [
      {
        id:
          asString(operation.operation_id) ??
          asString(operation.id),
        name,
        cost:
          asNumber(operation.cost) ??
          asNumber(operation.cost_rub),
      },
    ];
  });
}

function componentLines(value: unknown): CostComponent[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item): CostComponent[] => {
    const component = asObject(item);
    const name = asString(component?.name);
    const category = asString(component?.category);
    const cost = asNumber(component?.cost);
    if (!component || !name || !category || cost === undefined || cost === 0) {
      return [];
    }
    return [
      {
        category,
        name,
        cost,
        operationId:
          asString(component.operation_id) ??
          asString(component.operationId),
        basis: asString(component.basis),
        quantity: asNumber(component.quantity),
        tariff: asNumber(component.tariff),
        unit: asString(component.unit),
      },
    ];
  });
}

function fallbackComponents({
  retailPrice,
  fabricCost,
  operationCost,
  extrasCost,
}: {
  retailPrice: number;
  fabricCost?: number;
  operationCost?: number;
  extrasCost?: number;
}): CostComponent[] {
  const components: CostComponent[] = [];
  if (fabricCost !== undefined && fabricCost > 0) {
    components.push({
      category: "fabric",
      name: "Ткань",
      cost: fabricCost,
    });
  }
  if (operationCost !== undefined && operationCost > 0) {
    components.push({
      category: "production",
      name: "Пошив и комплектующие",
      cost: operationCost,
    });
  }
  if (extrasCost !== undefined && extrasCost > 0) {
    components.push({
      category: "extra",
      name: "Дополнительные операции",
      cost: extrasCost,
    });
  }

  const represented = components.reduce(
    (total, component) => total + component.cost,
    0,
  );
  const difference = Number((retailPrice - represented).toFixed(2));
  if (difference > 0.01) {
    components.push({
      category: "extra",
      name: "Прочие компоненты расчёта",
      cost: difference,
    });
  }
  return components;
}

function adaptResult(payload: JsonObject): CalculationResult | undefined {
  const pricing = asObject(payload.pricing) ?? {};
  const request =
    asObject(payload.normalized_request) ??
    asObject(payload.request) ??
    payload;
  const fabric = asObject(payload.fabric);
  const consumption = asObject(payload.consumption) ?? {};
  const modelObject = asObject(payload.model);
  const operationsObject = asObject(payload.operations);

  const retailPrice =
    asNumber(payload.retail_price) ??
    asNumber(pricing.retail_price);
  if (retailPrice === undefined) {
    return undefined;
  }

  const directExtras = operationLines(payload.extras);
  const extras =
    directExtras.length > 0
      ? directExtras
      : operationLines(operationsObject?.additional);
  const directOperations = operationLines(payload.operation_breakdown);
  const operations =
    directOperations.length > 0
      ? directOperations
      : operationLines(operationsObject?.base ?? payload.operations);
  const fabricCost =
    asNumber(payload.fabric_cost) ??
    asNumber(fabric?.cost) ??
    asNumber(pricing.fabric_cost);
  const operationCost =
    asNumber(payload.operation_cost) ??
    asNumber(pricing.operation_cost);
  const explicitExtrasCost =
    asNumber(payload.extras_cost) ??
    asNumber(pricing.extras_cost);
  const extrasCost =
    explicitExtrasCost ??
    (extras.length > 0
      ? extras.reduce((total, line) => total + (line.cost ?? 0), 0)
      : undefined);
  const providedComponents = componentLines(payload.components);
  const components =
    providedComponents.length > 0
      ? providedComponents
      : fallbackComponents({
          retailPrice,
          fabricCost,
          operationCost,
          extrasCost,
        });

  return {
    status: "success",
    retailPrice,
    model:
      asString(payload.model) ??
      asString(modelObject?.name) ??
      asString(request.model),
    productType:
      asString(payload.product_type) ??
      asString(request.product_type),
    widthCm:
      asNumber(payload.width_cm) ??
      asNumber(request.width_cm),
    heightCm:
      asNumber(payload.height_cm) ??
      asNumber(request.height_cm),
    quantity:
      asNumber(payload.quantity) ??
      asNumber(request.quantity),
    fabricName:
      asString(payload.fabric) ??
      asString(fabric?.name),
    fabricWidthCm:
      asNumber(payload.fabric_width_cm) ??
      asNumber(fabric?.width_cm),
    fabricPricePerM:
      asNumber(payload.fabric_price) ??
      asNumber(fabric?.price_per_m) ??
      asNumber(fabric?.price_rub_per_m),
    fabricLayout:
      asString(payload.fabric_layout) ??
      asString(fabric?.layout) ??
      asString(consumption.layout),
    fabricConsumptionM:
      asNumber(payload.fabric_consumption_m) ??
      asNumber(fabric?.consumption_m) ??
      asNumber(consumption.consumption_m),
    fabricCost,
    operationCost,
    extrasCost,
    explanation:
      asString(payload.explanation) ??
      asString(consumption.explanation),
    operations,
    extras,
    components,
  };
}

export function adaptWebhookResponse(value: unknown): WebhookResponse {
  const payload = unwrapResponse(value);
  const clarification = asString(payload.clarification_question);
  if (clarification) {
    return { type: "clarification", question: clarification };
  }

  if (payload.status === "unavailable") {
    const details = asObject(payload.details);
    return {
      type: "unavailable",
      message:
        asString(payload.message) ??
        asString(payload.reason) ??
        asString(details?.reason) ??
        asString(payload.explanation) ??
        "Расчёт для этого варианта пока недоступен.",
    };
  }

  const result = adaptResult(payload);
  if (result) {
    return { type: "result", result };
  }

  const message =
    asString(payload.message) ??
    asString(payload.answer);
  if (message) {
    return { type: "clarification", question: message };
  }

  throw new Error("Unsupported webhook response");
}

export async function sendChatMessage(
  sessionId: string,
  message: string,
): Promise<WebhookResponse> {
  const webhookUrl = process.env.NEXT_PUBLIC_N8N_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error("NEXT_PUBLIC_N8N_WEBHOOK_URL is not configured");
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      message,
    }),
  });

  if (!response.ok) {
    throw new Error(`Webhook returned HTTP ${response.status}`);
  }

  return adaptWebhookResponse(await response.json());
}

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  feedback?: FeedbackContext;
};

export type CalculationResponsePayload = Record<string, unknown>;

export type FeedbackContext = {
  calculationId: string | null;
  rawRequest: string;
  result: CalculationResponsePayload;
};

export type OperationLine = {
  id?: string;
  name: string;
  cost?: number;
};

export type CostComponent = {
  category: string;
  name: string;
  cost: number;
  operationId?: string;
  basis?: string;
  quantity?: number;
  tariff?: number;
  unit?: string;
};

export type CalculationResult = {
  status: "success";
  retailPrice: number;
  model?: string;
  productType?: string;
  widthCm?: number;
  heightCm?: number;
  quantity?: number;
  fabricName?: string;
  fabricWidthCm?: number;
  fabricPricePerM?: number;
  fabricLayout?: string;
  fabricConsumptionM?: number;
  fabricCost?: number;
  operationCost?: number;
  extrasCost?: number;
  explanation?: string;
  operations: OperationLine[];
  extras: OperationLine[];
  components: CostComponent[];
};

export type WebhookResponse =
  | {
      type: "clarification";
      question: string;
    }
  | {
      type: "result";
      result: CalculationResult;
      payload: CalculationResponsePayload;
    }
  | {
      type: "unavailable";
      message: string;
      payload: CalculationResponsePayload;
    };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
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
    }
  | {
      type: "unavailable";
      message: string;
    };

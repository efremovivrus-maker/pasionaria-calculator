import type {
  CalculationResponsePayload,
  FeedbackContext,
} from "@/lib/types";

export type FeedbackValue =
  | "positive"
  | "incorrect_price"
  | "incorrect_model"
  | "incorrect_configuration"
  | "calculation_failed"
  | "other";

export type FeedbackPayload = {
  calculation_id: string | null;
  raw_request: string;
  feedback: FeedbackValue;
  comment: string;
  result: CalculationResponsePayload;
};

export function createFeedbackContext(
  rawRequest: string,
  result: CalculationResponsePayload,
): FeedbackContext {
  const calculationId =
    typeof result.calculation_id === "string" &&
    result.calculation_id.trim()
      ? result.calculation_id
      : null;

  return {
    calculationId,
    rawRequest,
    result,
  };
}

export async function sendCalculationFeedback(
  context: FeedbackContext,
  feedback: FeedbackValue,
  comment: string,
): Promise<void> {
  const webhookUrl = process.env.NEXT_PUBLIC_FEEDBACK_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    throw new Error("NEXT_PUBLIC_FEEDBACK_WEBHOOK_URL is not configured");
  }

  const payload: FeedbackPayload = {
    calculation_id: context.calculationId,
    raw_request: context.rawRequest,
    feedback,
    comment: comment.trim(),
    result: context.result,
  };
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Feedback webhook returned HTTP ${response.status}`);
  }
}

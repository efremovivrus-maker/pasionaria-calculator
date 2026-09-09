import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { FeedbackPrompt } from "@/components/FeedbackPrompt";
import {
  createFeedbackContext,
  sendCalculationFeedback,
} from "@/lib/feedback";

const FEEDBACK_URL =
  "https://pasionaria.app.n8n.cloud/webhook/calculator-feedback";
const originalFeedbackUrl =
  process.env.NEXT_PUBLIC_FEEDBACK_WEBHOOK_URL;

function successfulResponse(): Response {
  return { ok: true, status: 200 } as Response;
}

function requestPayload(fetchMock: ReturnType<typeof vi.fn>, index = 0) {
  const init = fetchMock.mock.calls[index][1] as RequestInit;
  return JSON.parse(String(init.body));
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_FEEDBACK_WEBHOOK_URL = FEEDBACK_URL;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalFeedbackUrl === undefined) {
    delete process.env.NEXT_PUBLIC_FEEDBACK_WEBHOOK_URL;
  } else {
    process.env.NEXT_PUBLIC_FEEDBACK_WEBHOOK_URL = originalFeedbackUrl;
  }
});

describe("FeedbackPrompt", () => {
  it("sends the complete positive feedback payload", async () => {
    const result = {
      status: "success",
      calculation_id: "calc-123",
      requested_model: "Вандр",
      normalized_request: {
        model: "Вандер",
        product_type: "curtain",
        width_cm: 120,
        height_cm: 270,
        quantity: 2,
        configuration: { lining: "Подкладка" },
        extra_operations: [],
      },
      retail_price: 12500,
      components: [
        { category: "fabric", name: "Ткань", cost: 9000 },
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(successfulResponse());
    vi.stubGlobal("fetch", fetchMock);

    render(
      <FeedbackPrompt
        context={createFeedbackContext(
          "две шторы Вандр на подкладке",
          result,
        )}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "👍 Всё верно" }),
    );

    await screen.findByText("Спасибо за обратную связь");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(FEEDBACK_URL);
    expect(requestPayload(fetchMock)).toEqual({
      calculation_id: "calc-123",
      raw_request: "две шторы Вандр на подкладке",
      feedback: "positive",
      comment: "",
      result,
    });
  });

  it("sends selected negative feedback with a comment", async () => {
    const result = {
      status: "success",
      calculation_id: "calc-456",
      retail_price: 18000,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(successfulResponse());
    vi.stubGlobal("fetch", fetchMock);
    render(
      <FeedbackPrompt
        context={createFeedbackContext("шторы Вандер", result)}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "👎 Есть проблема" }),
    );
    expect(
      screen.getByRole("heading", { name: "Что пошло не так?" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Неверная стоимость"));
    fireEvent.change(screen.getByPlaceholderText("Комментарий"), {
      target: { value: "  Цена отличается от сайта  " },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Отправить" }),
    );

    await screen.findByText("Спасибо за обратную связь");
    expect(requestPayload(fetchMock)).toEqual({
      calculation_id: "calc-456",
      raw_request: "шторы Вандер",
      feedback: "incorrect_price",
      comment: "Цена отличается от сайта",
      result,
    });
  });

  it("preserves unavailable and error responses", async () => {
    const unavailable = {
      status: "unavailable",
      calculation_id: "calc-unavailable",
      reason_code: "MODEL_NOT_FOUND",
      message: "Не удалось найти модель.",
      details: { requested_model: "Неизвестная" },
    };
    const error = {
      status: "error",
      reason_code: "CALCULATION_ERROR",
      message: "Не удалось выполнить расчёт.",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(successfulResponse());
    vi.stubGlobal("fetch", fetchMock);

    await sendCalculationFeedback(
      createFeedbackContext("шторы Неизвестная", unavailable),
      "incorrect_model",
      "",
    );
    await sendCalculationFeedback(
      createFeedbackContext("шторы Вандер", error),
      "calculation_failed",
      "Ошибка при расчёте",
    );

    expect(requestPayload(fetchMock, 0).result).toEqual(unavailable);
    expect(requestPayload(fetchMock, 1)).toMatchObject({
      calculation_id: null,
      feedback: "calculation_failed",
      result: error,
    });
  });

  it("uses null when calculation_id is absent", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(successfulResponse());
    vi.stubGlobal("fetch", fetchMock);

    await sendCalculationFeedback(
      createFeedbackContext("шторы Вандер", {
        status: "error",
        message: "Ошибка",
      }),
      "other",
      "",
    );

    expect(requestPayload(fetchMock).calculation_id).toBeNull();
  });

  it("blocks repeated submission while a request is in flight", async () => {
    let resolveRequest: (response: Response) => void = () => {};
    const pendingRequest = new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(pendingRequest);
    vi.stubGlobal("fetch", fetchMock);
    render(
      <FeedbackPrompt
        context={createFeedbackContext("штора Вандер", {
          status: "success",
          calculation_id: "calc-once",
          retail_price: 5000,
        })}
      />,
    );
    const positiveButton = screen.getByRole("button", {
      name: "👍 Всё верно",
    });

    fireEvent.click(positiveButton);
    fireEvent.click(positiveButton);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveRequest(successfulResponse());
    await screen.findByText("Спасибо за обратную связь");
  });

  it("shows a retryable compact network error", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(successfulResponse());
    vi.stubGlobal("fetch", fetchMock);
    render(
      <FeedbackPrompt
        context={createFeedbackContext("штора Вандер", {
          status: "success",
          calculation_id: "calc-retry",
        })}
      />,
    );
    const positiveButton = screen.getByRole("button", {
      name: "👍 Всё верно",
    });

    fireEvent.click(positiveButton);
    await screen.findByText("Не удалось отправить. Попробуйте ещё раз.");
    fireEvent.click(positiveButton);

    await screen.findByText("Спасибо за обратную связь");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(
        screen.queryByText("Не удалось отправить. Попробуйте ещё раз."),
      ).toBeNull(),
    );
  });
});

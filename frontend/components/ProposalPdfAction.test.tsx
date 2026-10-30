import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/AppShell";
import {
  emptyConfiguration,
  PROPOSAL_STORAGE_KEY,
  type CommercialProposal,
} from "@/lib/proposal";

const downloadProposalPdf = vi.hoisted(() =>
  vi.fn<(proposal: CommercialProposal) => Promise<void>>(() => Promise.resolve()),
);

vi.mock("@/lib/api", () => ({
  sendChatMessage: vi.fn(),
  warmUpBackend: vi.fn(() => Promise.resolve()),
  CalculationResponseError: class CalculationResponseError extends Error {},
}));

vi.mock("@/lib/downloadProposalPdf", () => ({
  downloadProposalPdf,
}));

beforeEach(() => {
  sessionStorage.clear();
  downloadProposalPdf.mockReset();
  downloadProposalPdf.mockResolvedValue(undefined);
  Element.prototype.scrollIntoView = vi.fn();
  sessionStorage.setItem(
    PROPOSAL_STORAGE_KEY,
    JSON.stringify({
      items: [
        {
          id: "delivery",
          title: "Доставка",
          productType: null,
          quantity: 1,
          configuration: emptyConfiguration(),
          components: [],
          originalUnitPrice: 1500,
          unitPrice: 1500,
          room: null,
        },
      ],
      rooms: [],
      recipient: "Клиент",
      author: "Мария",
      objectName: null,
      issuedOn: "2026-10-30",
      roundingStep: 100,
      roundingMode: "nearest",
    }),
  );
});

afterEach(cleanup);

describe("proposal pdf action", () => {
  it("downloads the current proposal", async () => {
    render(<AppShell />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Коммерческое предложение, 1" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Сформировать PDF" }));

    await waitFor(() => {
      expect(downloadProposalPdf).toHaveBeenCalledTimes(1);
    });
    const [proposal] = downloadProposalPdf.mock.calls[0];
    expect(proposal).toMatchObject({
      recipient: "Клиент",
      author: "Мария",
      items: [expect.objectContaining({ title: "Доставка", unitPrice: 1500 })],
    });
  });

  it("reports a failed download", async () => {
    downloadProposalPdf.mockRejectedValue(new Error("pdf failed"));
    render(<AppShell />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Коммерческое предложение, 1" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Сформировать PDF" }));

    expect(
      await screen.findByRole("alert"),
    ).toHaveProperty(
      "textContent",
      "Не удалось сформировать PDF. Попробуйте ещё раз.",
    );
  });
});

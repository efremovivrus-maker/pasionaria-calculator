"use client";

import { Font, pdf } from "@react-pdf/renderer";

import { proposalPdfFilename } from "@/lib/proposalDocument";
import type { CommercialProposal } from "@/lib/proposal";
import { ProposalPdfDocument } from "@/lib/proposalPdf";

let fontsReady = false;

function ensureProposalFonts() {
  if (fontsReady) {
    return;
  }
  Font.register({
    family: "ProposalSans",
    fonts: [
      { src: "/fonts/SourceSans3-Regular.otf", fontWeight: 400 },
      { src: "/fonts/SourceSans3-Semibold.otf", fontWeight: 600 },
    ],
  });
  Font.register({
    family: "ProposalSerif",
    src: "/fonts/SourceSerif4-Regular.otf",
  });
  Font.registerHyphenationCallback((word) => [word]);
  fontsReady = true;
}

export async function downloadProposalPdf(
  proposal: CommercialProposal,
): Promise<void> {
  ensureProposalFonts();
  const blob = await pdf(<ProposalPdfDocument proposal={proposal} />).toBlob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = proposalPdfFilename(proposal);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

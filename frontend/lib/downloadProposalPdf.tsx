"use client";

import { Font, pdf } from "@react-pdf/renderer";

import { imageResponseToDataUrl } from "@/lib/inlineImage";
import { blobToDataUrl, readKpPhoto } from "@/lib/kpPhotoStore";
import { proposalImageSrc, proposalPdfFilename } from "@/lib/proposalDocument";
import type { CommercialProposal, ProposalItem } from "@/lib/proposal";
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

async function proposalWithoutMissingImages(
  proposal: CommercialProposal,
): Promise<CommercialProposal> {
  const items = await Promise.all(
    proposal.items.map(async (item) => stripMissingImage(item)),
  );
  return { ...proposal, items };
}

function withoutImage(item: ProposalItem): ProposalItem {
  return { ...item, sessionPhotoId: null, mediaImageUrl: null, mediaOfferId: null };
}

async function stripMissingImage(item: ProposalItem): Promise<ProposalItem> {
  if (item.sessionPhotoId) {
    try {
      const blob = await readKpPhoto(item.sessionPhotoId);
      if (!blob) {
        return withoutImage(item);
      }
      return {
        ...item,
        sessionPhotoId: null,
        mediaOfferId: null,
        mediaImageUrl: await blobToDataUrl(blob),
      };
    } catch {
      return withoutImage(item);
    }
  }
  const src = proposalImageSrc(item);
  if (!src || src.startsWith("data:")) {
    return item;
  }
  try {
    const dataUrl = await imageResponseToDataUrl(await fetch(src));
    if (!dataUrl) {
      return withoutImage(item);
    }
    return { ...item, mediaOfferId: null, mediaImageUrl: dataUrl };
  } catch {
    return withoutImage(item);
  }
}

export async function downloadProposalPdf(
  proposal: CommercialProposal,
): Promise<void> {
  ensureProposalFonts();
  const ready = await proposalWithoutMissingImages(proposal);
  const blob = await pdf(<ProposalPdfDocument proposal={ready} />).toBlob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = proposalPdfFilename(proposal);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

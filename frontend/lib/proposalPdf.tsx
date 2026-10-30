import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import {
  proposalPdfModel,
  type ProposalPdfLine,
  type ProposalPdfSection,
} from "@/lib/proposalDocument";
import type { CommercialProposal } from "@/lib/proposal";

const ink = "#1c1b18";
const muted = "#6f6a62";
const sage = "#6d7565";
const line = "#d9d3c7";
const paper = "#f4f1e9";
const band = "#e9e7df";

const qtyWidth = 58;
const priceWidth = 82;
const amountWidth = 88;
const roomGap = 14;
const continuedGap = 10;
const itemPad = 7;
const titleRowGap = 18;
const metaGap = 16;
const metaPaddingBottom = 14;
const objectGap = 12;
const totalGap = 12;
const totalPad = 14;
const pageHeight = 841.89;
const contentHeight = pageHeight - 46 - 64;
const layoutPage = contentHeight - 42;

const styles = StyleSheet.create({
  page: {
    backgroundColor: paper,
    color: ink,
    fontFamily: "ProposalSans",
    fontSize: 10,
    paddingTop: 46,
    paddingBottom: 64,
    paddingHorizontal: 50,
  },
  brand: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: 2.4,
  },
  brandRule: {
    width: 36,
    height: 1,
    marginTop: 8,
    backgroundColor: sage,
  },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginTop: titleRowGap,
  },
  title: {
    fontFamily: "ProposalSerif",
    fontSize: 24,
    lineHeight: 1.05,
  },
  date: {
    fontSize: 10,
    color: muted,
    marginBottom: 3,
  },
  metaBlock: {
    marginTop: metaGap,
    paddingBottom: metaPaddingBottom,
    borderBottomWidth: 0.6,
    borderBottomColor: line,
  },
  meta: {
    flexDirection: "row",
  },
  metaColumn: {
    flex: 1,
    paddingRight: 18,
  },
  object: {
    marginTop: objectGap,
  },
  label: {
    fontSize: 8,
    fontWeight: 600,
    letterSpacing: 1.1,
    color: muted,
    textTransform: "uppercase",
  },
  value: {
    marginTop: 4,
    fontSize: 11,
    lineHeight: 1.35,
  },
  room: {
    marginTop: roomGap,
  },
  roomContinued: {
    marginTop: continuedGap,
  },
  roomHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 8,
  },
  roomTitle: {
    fontFamily: "ProposalSerif",
    fontSize: 15,
    lineHeight: 1.15,
  },
  columns: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingBottom: 5,
    borderBottomWidth: 0.6,
    borderBottomColor: sage,
  },
  columnLabel: {
    fontSize: 7.5,
    fontWeight: 600,
    letterSpacing: 0.7,
    color: muted,
    textTransform: "uppercase",
  },
  nameColumn: {
    flex: 1,
    paddingRight: 12,
  },
  qtyColumn: {
    width: qtyWidth,
    textAlign: "right",
  },
  priceColumn: {
    width: priceWidth,
    textAlign: "right",
  },
  amountColumn: {
    width: amountWidth,
    textAlign: "right",
  },
  item: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingTop: itemPad,
    paddingBottom: itemPad,
    borderBottomWidth: 0.4,
    borderBottomColor: line,
  },
  itemTitle: {
    fontSize: 10.5,
    fontWeight: 600,
    lineHeight: 1.3,
  },
  dimensions: {
    marginTop: 4,
    fontSize: 9.5,
    lineHeight: 1.3,
    color: "#3f3c38",
  },
  serviceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingTop: 7,
    paddingBottom: 7,
    borderBottomWidth: 0.4,
    borderBottomColor: line,
  },
  serviceTitle: {
    flex: 1,
    paddingRight: 16,
    fontSize: 10.5,
    lineHeight: 1.3,
  },
  serviceNote: {
    marginTop: 2,
    fontSize: 8,
    color: muted,
  },
  confirmation: {
    marginTop: 4,
    fontSize: 8,
    lineHeight: 1.4,
    color: "#5c564c",
  },
  cell: {
    paddingTop: 1,
    fontSize: 10,
    lineHeight: 1.3,
  },
  amountCell: {
    fontWeight: 600,
  },
  subtotal: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "baseline",
    paddingTop: 8,
  },
  subtotalLabel: {
    fontSize: 8,
    letterSpacing: 0.6,
    color: muted,
    textTransform: "uppercase",
    marginRight: 12,
  },
  subtotalValue: {
    width: amountWidth,
    textAlign: "right",
    fontSize: 11,
    fontWeight: 600,
  },
  empty: {
    marginTop: 28,
    fontSize: 11,
    color: muted,
  },
  summaryBlock: {
    marginTop: totalGap,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    backgroundColor: band,
  },
  summaryLine: {
    fontSize: 11,
    lineHeight: 1.45,
    marginBottom: 6,
  },
  summaryUntil: {
    fontSize: 10,
    lineHeight: 1.4,
    color: muted,
    marginBottom: 4,
  },
  total: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingVertical: totalPad,
    paddingHorizontal: 16,
    backgroundColor: band,
  },
  totalLabel: {
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  totalValue: {
    fontFamily: "ProposalSerif",
    fontSize: 26,
    lineHeight: 1,
  },
  footer: {
    position: "absolute",
    left: 50,
    right: 50,
    bottom: 24,
    paddingTop: 8,
    borderTopWidth: 0.4,
    borderTopColor: line,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: {
    fontSize: 8,
    letterSpacing: 1.2,
    color: sage,
  },
});

export function ProposalPdfDocument({
  proposal,
}: {
  proposal: CommercialProposal;
}) {
  const model = proposalPdfModel(proposal);

  return (
    <Document
      title="Коммерческое предложение"
      author={model.author ?? "PASIONARIA"}
      creator="PASIONARIA"
      language="ru"
    >
      <Page size="A4" style={styles.page}>
        <Text style={styles.brand}>PASIONARIA</Text>
        <View style={styles.brandRule} />

        <View style={styles.titleRow}>
          <Text style={styles.title}>Коммерческое предложение</Text>
          <Text style={styles.date}>{model.issuedOnLabel}</Text>
        </View>

        <View style={styles.metaBlock}>
          <View style={styles.meta}>
            <View style={styles.metaColumn}>
              <Text style={styles.label}>Адресат</Text>
              <Text style={styles.value}>{model.recipient ?? "—"}</Text>
            </View>
            <View style={styles.metaColumn}>
              <Text style={styles.label}>Ваш менеджер</Text>
              <Text style={styles.value}>{model.author ?? "—"}</Text>
            </View>
          </View>
          {model.objectName ? (
            <View style={styles.object}>
              <Text style={styles.label}>Объект</Text>
              <Text style={styles.value}>{model.objectName}</Text>
            </View>
          ) : null}
        </View>

        {model.sections.length === 0 ? (
          <Text style={styles.empty}>
            В коммерческом предложении пока нет позиций.
          </Text>
        ) : (
          planBlocks(model.sections, Boolean(model.objectName)).map((block) => (
            <SectionBlock key={block.key} block={block} />
          ))
        )}

        <View wrap={false}>
          {model.subtotalLine ? (
            <View style={styles.summaryBlock}>
              <Text style={styles.summaryLine}>{model.subtotalLine}</Text>
              {model.discountLine ? (
                <Text style={styles.summaryLine}>{model.discountLine}</Text>
              ) : null}
              {model.discountUntilLine ? (
                <Text style={styles.summaryUntil}>{model.discountUntilLine}</Text>
              ) : null}
            </View>
          ) : null}
          <View style={styles.total}>
            <Text style={styles.totalLabel}>{model.totalCaption}</Text>
            <Text style={styles.totalValue}>{model.totalLabel}</Text>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>PASIONARIA</Text>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) =>
              `${pageNumber} / ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}

type PlannedBlock = {
  key: string;
  section: ProposalPdfSection;
  lines: ProposalPdfLine[];
  continued: boolean;
  showSubtotal: boolean;
  minPresenceAhead: number;
  breakBefore: boolean;
};

const totalPresence = 78;

function estimatePrologue(hasObject: boolean): number {
  const brand = 21;
  const title = titleRowGap + 26;
  const metaRow = 28;
  const object = hasObject ? objectGap + metaRow : 0;
  return brand + title + metaGap + metaRow + object + metaPaddingBottom + 28;
}

function lineHeight(section: ProposalPdfSection, line: ProposalPdfLine): number {
  if (section.kind === "services") {
    return 32 + (line.quantity > 1 ? 14 : 0);
  }
  const titleLines = Math.max(1, Math.ceil(line.title.length / 32));
  let height = itemPad * 2 + titleLines * 14;
  if (line.detailLines.length > 0) {
    height += line.detailLines.reduce(
      (sum, detailLine) => sum + 18 * Math.max(1, Math.ceil(detailLine.length / 48)),
      0,
    );
  }
  if (line.confirmation) {
    height += 8 + Math.max(1, Math.ceil(line.confirmation.length / 42)) * 12;
  }
  return Math.ceil(height * 1.45);
}

function blockHeight(
  section: ProposalPdfSection,
  lines: ProposalPdfLine[],
  continued: boolean,
  showSubtotal: boolean,
): number {
  const margin = continued ? continuedGap : roomGap;
  const title = section.title ? 28 : 0;
  const columns = section.kind === "products" ? 18 : 0;
  const rows = lines.reduce((sum, line) => sum + lineHeight(section, line), 0);
  const subtotal = showSubtotal ? 24 : 0;
  return margin + title + columns + rows + subtotal;
}

function pickLines(
  section: ProposalPdfSection,
  start: number,
  space: number,
  continued: boolean,
  reserveTotal: boolean,
): { count: number; showSubtotal: boolean; nextSpace: number } {
  const lines = section.lines;
  const showSubtotal = section.subtotalLabel !== null;
  const rest = blockHeight(section, lines.slice(start), continued, showSubtotal);
  const pageLimit = layoutPage - (reserveTotal ? totalPresence : 0);
  const opensNewPage = space < layoutPage - 1;

  if (rest <= pageLimit) {
    const fitsHere = rest <= space && (!reserveTotal || space - rest >= totalPresence);
    if (fitsHere || !opensNewPage) {
      const nextSpace = fitsHere ? space - rest : layoutPage - rest;
      return { count: lines.length - start, showSubtotal, nextSpace };
    }
    return { count: 0, showSubtotal: false, nextSpace: layoutPage };
  }

  const limit = Math.min(space, pageLimit);
  let count = 0;
  let used = (continued ? continuedGap : roomGap) + (section.title ? 28 : 0);
  used += section.kind === "products" ? 18 : 0;
  for (let index = start; index < lines.length; index += 1) {
    const isLastLine = index === lines.length - 1;
    const extra = lineHeight(section, lines[index]) + (isLastLine && showSubtotal ? 24 : 0);
    if (used + extra > limit) {
      break;
    }
    used += extra;
    count += 1;
  }
  if (count === 0) {
    return { count: 0, showSubtotal: false, nextSpace: layoutPage };
  }
  const endsSection = start + count === lines.length;
  const height = blockHeight(
    section,
    lines.slice(start, start + count),
    continued,
    endsSection && showSubtotal,
  );
  return {
    count,
    showSubtotal: endsSection && showSubtotal,
    nextSpace: endsSection ? space - height : layoutPage,
  };
}

function planBlocks(
  sections: ProposalPdfSection[],
  hasObject: boolean,
): PlannedBlock[] {
  let space = layoutPage - estimatePrologue(hasObject);
  const blocks: PlannedBlock[] = [];

  sections.forEach((section, sectionIndex) => {
    const reserveTotal = sectionIndex === sections.length - 1;
    let index = 0;
    let continued = false;
    while (index < section.lines.length) {
      const picked = pickLines(section, index, space, continued, reserveTotal);
      if (picked.count === 0) {
        if (space >= layoutPage - 1) {
          const endsSection = index === section.lines.length - 1;
          blocks.push({
            key: `${section.id}-${index}`,
            section,
            lines: [section.lines[index]],
            continued,
            showSubtotal: endsSection && section.subtotalLabel !== null,
            minPresenceAhead: 0,
            breakBefore: continued,
          });
          index += 1;
          space = layoutPage;
          continued = true;
          continue;
        }
        space = layoutPage;
        continue;
      }
      blocks.push({
        key: `${section.id}-${index}`,
        section,
        lines: section.lines.slice(index, index + picked.count),
        continued,
        showSubtotal: picked.showSubtotal,
        minPresenceAhead: 0,
        breakBefore: continued,
      });
      index += picked.count;
      space = picked.nextSpace;
      continued = true;
    }
  });

  const last = blocks.at(-1);
  if (last) {
    last.minPresenceAhead = totalPresence;
  }
  return applyPageBreaks(keepClosingWithProducts(blocks, hasObject), hasObject);
}

function applyPageBreaks(blocks: PlannedBlock[], hasObject: boolean): PlannedBlock[] {
  const starts = new Set(
    paginateBlocks(blocks, hasObject)
      .slice(1)
      .map((page) => page[0]?.key)
      .filter((key): key is string => Boolean(key)),
  );
  return blocks.map((block) =>
    starts.has(block.key) ? { ...block, breakBefore: true } : block,
  );
}

function measured(block: PlannedBlock): number {
  return blockHeight(block.section, block.lines, block.continued, block.showSubtotal);
}

function paginateBlocks(blocks: PlannedBlock[], hasObject: boolean): PlannedBlock[][] {
  const pages: PlannedBlock[][] = [];
  let space = 0;

  function openPage() {
    pages.push([]);
    space = pages.length === 1 ? layoutPage - estimatePrologue(hasObject) : layoutPage;
  }

  openPage();
  for (const block of blocks) {
    const height = measured(block);
    const needed = height + (block === blocks[blocks.length - 1] ? totalPresence : 0);
    const page = pages[pages.length - 1];
    if ((block.breakBefore && page.length > 0) || (page.length > 0 && needed > space)) {
      openPage();
    }
    pages[pages.length - 1].push(block);
    space -= height;
  }
  return pages;
}

function keepClosingWithProducts(
  blocks: PlannedBlock[],
  hasObject: boolean,
): PlannedBlock[] {
  const pages = paginateBlocks(blocks, hasObject);
  const lastPage = pages.at(-1);
  if (!lastPage || pages.length < 2 || lastPage.some((block) => block.section.kind === "products")) {
    return blocks;
  }

  const previous = pages[pages.length - 2];
  const product = [...previous].reverse().find((block) => block.section.kind === "products");
  if (!product || product.lines.length === 0) {
    return blocks;
  }

  const closingHeight =
    lastPage.reduce((sum, block) => sum + measured(block), 0) + totalPresence;
  if (measured(product) + closingHeight <= layoutPage) {
    return blocks.map((block) =>
      block.key === product.key ? { ...block, breakBefore: true } : block,
    );
  }

  const budget = Math.max(0, layoutPage - closingHeight);
  let tailCount = product.lines.length === 1 ? 1 : 0;
  for (let count = 1; count < product.lines.length; count += 1) {
    const height = blockHeight(
      product.section,
      product.lines.slice(product.lines.length - count),
      true,
      product.showSubtotal,
    );
    if (height > budget) {
      break;
    }
    tailCount = count;
  }
  if (tailCount === 0) {
    tailCount = 1;
  }
  if (tailCount >= product.lines.length) {
    return blocks.map((block) =>
      block.key === product.key ? { ...block, breakBefore: true } : block,
    );
  }

  const head: PlannedBlock = {
    ...product,
    lines: product.lines.slice(0, product.lines.length - tailCount),
    showSubtotal: false,
    minPresenceAhead: 0,
  };
  const tail: PlannedBlock = {
    ...product,
    key: `${product.key}-tail`,
    lines: product.lines.slice(product.lines.length - tailCount),
    continued: true,
    showSubtotal: product.showSubtotal,
    minPresenceAhead: 0,
    breakBefore: true,
  };
  return blocks.flatMap((block) => (block.key === product.key ? [head, tail] : [block]));
}

function SectionBlock({ block }: { block: PlannedBlock }) {
  const title = block.section.title
    ? block.continued
      ? `${block.section.title} · продолжение`
      : block.section.title
    : null;

  return (
    <View
      break={block.breakBefore}
      wrap={false}
      minPresenceAhead={block.minPresenceAhead}
      style={block.continued ? styles.roomContinued : styles.room}
    >
      {title ? <RoomHeading title={title} /> : null}
      {block.section.kind === "products" ? <ColumnHeader /> : null}
      {block.lines.map((line) =>
        block.section.kind === "services" ? (
          <ServiceRow key={line.id} line={line} />
        ) : (
          <ItemRow key={line.id} line={line} />
        ),
      )}
      {block.showSubtotal ? <Subtotal section={block.section} /> : null}
    </View>
  );
}

function RoomHeading({ title }: { title: string }) {
  return (
    <View style={styles.roomHeading}>
      <Text style={styles.roomTitle}>{title}</Text>
    </View>
  );
}

function ColumnHeader() {
  return (
    <View style={styles.columns}>
      <Text style={[styles.columnLabel, styles.nameColumn]}>Изделие</Text>
      <Text style={[styles.columnLabel, styles.qtyColumn]}>Кол-во</Text>
      <Text style={[styles.columnLabel, styles.priceColumn]}>Цена</Text>
      <Text style={[styles.columnLabel, styles.amountColumn]}>Сумма</Text>
    </View>
  );
}

function ItemRow({ line }: { line: ProposalPdfLine }) {
  return (
    <View style={styles.item}>
      <View style={styles.nameColumn}>
        <Text style={styles.itemTitle}>{line.title}</Text>
        {line.detailLines.map((detailLine, index) => (
          <Text key={`${line.id}-detail-${index}`} style={styles.dimensions}>
            {detailLine}
          </Text>
        ))}
        {line.confirmation ? (
          <Text style={styles.confirmation}>{line.confirmation}</Text>
        ) : null}
      </View>
      <Text style={[styles.cell, styles.qtyColumn]}>{line.quantityLabel}</Text>
      <Text style={[styles.cell, styles.priceColumn]}>{line.unitPriceLabel}</Text>
      <Text style={[styles.cell, styles.amountColumn, styles.amountCell]}>
        {line.amountLabel}
      </Text>
    </View>
  );
}

function ServiceRow({ line }: { line: ProposalPdfLine }) {
  return (
    <View style={styles.serviceRow}>
      <View style={styles.serviceTitle}>
        <Text>{line.title}</Text>
        {line.quantity > 1 ? (
          <Text style={styles.serviceNote}>
            {line.quantityLabel} × {line.unitPriceLabel}
          </Text>
        ) : null}
      </View>
      <Text style={styles.amountCell}>{line.amountLabel}</Text>
    </View>
  );
}

function Subtotal({ section }: { section: ProposalPdfSection }) {
  return (
    <View style={styles.subtotal}>
      <Text style={styles.subtotalLabel}>Подытог</Text>
      <Text style={styles.subtotalValue}>{section.subtotalLabel}</Text>
    </View>
  );
}

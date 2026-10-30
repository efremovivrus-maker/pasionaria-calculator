import {
  clientLineAmount,
  clientProposalTotal,
  clientUnitPrice,
  computeProposalTotals,
  formatDimensions,
  formatQuantity,
  proposalDiscountValue,
  type CommercialProposal,
  type ProposalItem,
  type RoundingMode,
  type RoundingStep,
} from "@/lib/proposal";

export const CLIENT_CONFIRMATION_NOTE =
  "Стоимость предварительная и подлежит подтверждению после согласования технологии изготовления.";

const proposalMoney = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatProposalMoney(value: number): string {
  return proposalMoney.format(value);
}

const MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

const UNCONFIRMED_PARAMETER =
  /default_stitch_assumed|stitch_tariff_assumed|требует подтверждения|отдельного тарифа нет|не включает (?:бахрому|кант|декоративн)|не подтвержд[её]н/i;

export type ProposalPdfCharacteristic = {
  label: string;
  value: string;
};

export type ProposalPdfLine = {
  id: string;
  title: string;
  dimensions: string | null;
  fabric: string | null;
  detailLines: string[];
  quantity: number;
  quantityLabel: string;
  unitPriceLabel: string;
  amountLabel: string;
  amount: number;
  confirmation: string | null;
};

export type ProposalPdfSection = {
  id: string;
  kind: "products" | "services";
  title: string | null;
  lines: ProposalPdfLine[];
  subtotalLabel: string | null;
  subtotal: number;
};

export type ProposalPdfModel = {
  recipient: string | null;
  author: string | null;
  objectName: string | null;
  issuedOnLabel: string;
  sections: ProposalPdfSection[];
  subtotalLine: string | null;
  discountLine: string | null;
  discountUntilLine: string | null;
  totalCaption: string;
  totalLabel: string;
  total: number;
};

export function formatProposalDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) {
    return isoDate;
  }
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) {
    return isoDate;
  }
  return `${Number(match[3])} ${month} ${match[1]}`;
}

export function proposalPdfFilename(proposal: CommercialProposal): string {
  return `PASIONARIA-КП-${proposal.issuedOn}.pdf`;
}

export function itemNeedsConfirmation(item: ProposalItem): boolean {
  if (item.configuration.stitchTariffAssumed) {
    return true;
  }
  const notes = [item.configuration.stitchWarning, item.configuration.explanation]
    .filter((value): value is string => Boolean(value))
    .join("\n");
  return UNCONFIRMED_PARAMETER.test(notes);
}

export function clientFabric(item: ProposalItem): string | null {
  return clientFaceFabric(item);
}

function clientFaceFabric(item: ProposalItem): string | null {
  const { faceFabric, fabricName } = item.configuration;
  return cleanClientValue(faceFabric) ?? cleanClientValue(fabricName);
}

function cleanClientValue(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sameClientValue(left: string | null, right: string | null): boolean {
  if (!left || !right) {
    return false;
  }
  return left.trim().toLocaleLowerCase("ru") === right.trim().toLocaleLowerCase("ru");
}

function embroideryFromCalculation(item: ProposalItem): string | null {
  for (const component of item.components) {
    if (!/вышив/i.test(component.name)) {
      continue;
    }
    const parsed = parseEmbroideryComponentName(component.name);
    if (parsed) {
      return parsed;
    }
  }
  for (const operation of item.configuration.extraOperations) {
    const trimmed = operation.trim();
    if (!trimmed) {
      continue;
    }
    const matched = item.components.some(
      (component) =>
        /вышив/i.test(component.name) &&
        component.name.toLocaleLowerCase("ru").includes(trimmed.toLocaleLowerCase("ru")),
    );
    if (matched) {
      return trimmed;
    }
  }
  return null;
}

function parseEmbroideryComponentName(name: string): string | null {
  const parts = name.split(/[—–-]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2 && /вышив/i.test(parts[0])) {
    return parts.slice(1).join(" — ");
  }
  const withoutPrefix = name.replace(/^.*?\bвышив\w*\b\s*[—–-]?\s*/iu, "").trim();
  return withoutPrefix.length > 0 ? withoutPrefix : null;
}

function bedspreadStitchLabel(item: ProposalItem): string | null {
  const stitch = cleanClientValue(item.configuration.stitch);
  if (!stitch) {
    return null;
  }
  return stitch;
}

function romanDayFabric(item: ProposalItem): string | null {
  const dayFabric = cleanClientValue(item.configuration.dayFabric);
  const face = clientFaceFabric(item);
  if (!dayFabric || sameClientValue(dayFabric, face)) {
    return null;
  }
  return dayFabric;
}

function productSpecCharacteristics(item: ProposalItem): ProposalPdfCharacteristic[] {
  const type = item.productType;
  const config = item.configuration;
  const specs: ProposalPdfCharacteristic[] = [];

  if (type === "curtain") {
    const lining = cleanClientValue(config.lining);
    if (lining) {
      specs.push({ label: "Подкладка", value: lining });
    }
    const heading = cleanClientValue(config.heading);
    if (heading) {
      specs.push({ label: "Крепление", value: heading });
    }
  } else if (type === "bedspread") {
    const stitch = bedspreadStitchLabel(item);
    if (stitch) {
      specs.push({ label: "Стёжка", value: stitch });
    }
    const lining = cleanClientValue(config.lining);
    if (lining) {
      specs.push({ label: "Подкладка", value: lining });
    }
  } else if (type === "roman") {
    const lining = cleanClientValue(config.lining);
    if (lining) {
      specs.push({ label: "Подкладка", value: lining });
    }
    const mechanism = cleanClientValue(config.mechanism);
    if (mechanism) {
      specs.push({ label: "Механизм", value: mechanism });
    }
    const dayFabric = romanDayFabric(item);
    if (dayFabric) {
      specs.push({ label: "Дневная ткань", value: dayFabric });
    }
  }

  const embroidery = embroideryFromCalculation(item);
  if (embroidery) {
    specs.push({ label: "Вышивка", value: embroidery });
  }

  const fabric = clientFaceFabric(item);
  return specs.filter((entry) => {
    if (entry.value.length === 0) {
      return false;
    }
    if (entry.label === "Вышивка") {
      return true;
    }
    return !sameClientValue(entry.value, fabric);
  });
}

export function clientCharacteristics(item: ProposalItem): ProposalPdfCharacteristic[] {
  const fabric = clientFaceFabric(item);
  const rows: ProposalPdfCharacteristic[] = fabric
    ? [{ label: "Ткань", value: fabric }]
    : [];
  return [...rows, ...productSpecCharacteristics(item)];
}

export function clientPdfDetailLines(item: ProposalItem): string[] {
  if (item.itemType === "service") {
    return [];
  }
  const primary: string[] = [];
  const dimensions = formatDimensions(item.widthCm, item.heightCm);
  if (dimensions) {
    primary.push(dimensions);
  }
  const fabric = clientFaceFabric(item);
  if (fabric) {
    primary.push(`Ткань: ${fabric}`);
  }
  const lines: string[] = [];
  if (primary.length > 0) {
    lines.push(primary.join(" · "));
  }
  const secondary = productSpecCharacteristics(item)
    .map((entry) => `${entry.label}: ${entry.value}`)
    .join(" · ");
  if (secondary) {
    lines.push(secondary);
  }
  return lines;
}

export function proposalPdfModel(proposal: CommercialProposal): ProposalPdfModel {
  const { roundingStep: step, roundingMode: mode } = proposal;
  const products = proposal.items.filter((item) => item.itemType !== "service");
  const services = proposal.items.filter((item) => item.itemType === "service");
  const sections: ProposalPdfSection[] = [];

  for (const room of proposal.rooms) {
    const section = productSection(
      room.id,
      room.name,
      products.filter((item) => item.room === room.id),
      step,
      mode,
    );
    if (section) {
      sections.push(section);
    }
  }

  const other = products.filter((item) => item.room === null);
  if (other.length > 0) {
    sections.push(
      proposal.rooms.length > 0
        ? productSection("other", "Другие изделия", other, step, mode)!
        : {
            id: "products",
            kind: "products",
            title: null,
            lines: other.map((item) => toLine(item, step, mode)),
            subtotalLabel: null,
            subtotal: clientProposalTotal(other, step, mode),
          },
    );
  }

  if (services.length > 0) {
    sections.push({
      id: "services",
      kind: "services",
      title: "Дополнительные услуги",
      lines: services.map((item) => toLine(item, step, mode)),
      subtotalLabel: null,
      subtotal: clientProposalTotal(services, step, mode),
    });
  }

  const totals = computeProposalTotals(proposal);
  const discountValue = proposalDiscountValue(proposal.discount);
  const showDiscount = totals.discountAmount > 0 && discountValue !== null;
  const discountLine = showDiscount
    ? proposal.discount.kind === "percent"
      ? `Скидка ${discountValue}%: −${formatProposalMoney(totals.discountAmount)}`
      : `Скидка: −${formatProposalMoney(totals.discountAmount)}`
    : null;
  const until = proposal.discount.until.trim();
  const discountUntilLine =
    showDiscount && /^\d{4}-\d{2}-\d{2}$/.test(until)
      ? `Скидка действует при оплате до ${formatProposalDate(until)}`
      : null;
  return {
    recipient: proposal.recipient,
    author: proposal.author,
    objectName: proposal.objectName,
    issuedOnLabel: formatProposalDate(proposal.issuedOn),
    sections,
    subtotalLine: showDiscount
      ? `Стоимость изделий и услуг: ${formatProposalMoney(totals.subtotal)}`
      : null,
    discountLine,
    discountUntilLine,
    totalCaption: showDiscount ? "Итого к оплате" : "Итого",
    totalLabel: formatProposalMoney(totals.finalTotal),
    total: totals.finalTotal,
  };
}

function productSection(
  id: string,
  title: string,
  items: ProposalItem[],
  step: RoundingStep,
  mode: RoundingMode,
): ProposalPdfSection | null {
  if (items.length === 0) {
    return null;
  }
  const subtotal = clientProposalTotal(items, step, mode);
  return {
    id,
    kind: "products",
    title,
    lines: items.map((item) => toLine(item, step, mode)),
    subtotalLabel: formatProposalMoney(subtotal),
    subtotal,
  };
}

function toLine(
  item: ProposalItem,
  step: RoundingStep,
  mode: RoundingMode,
): ProposalPdfLine {
  const unitPrice = clientUnitPrice(item, step, mode);
  const amount = clientLineAmount(item, step, mode);
  return {
    id: item.id,
    title: item.title,
    dimensions: formatDimensions(item.widthCm, item.heightCm),
    fabric: item.itemType === "service" ? null : clientFabric(item),
    detailLines: item.itemType === "service" ? [] : clientPdfDetailLines(item),
    quantity: item.quantity,
    quantityLabel: formatQuantity(item.quantity),
    unitPriceLabel: formatProposalMoney(unitPrice),
    amountLabel: formatProposalMoney(amount),
    amount,
    confirmation: itemNeedsConfirmation(item) ? CLIENT_CONFIRMATION_NOTE : null,
  };
}

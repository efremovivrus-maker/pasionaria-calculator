import {
  clientLineAmount,
  clientProposalTotal,
  clientUnitPrice,
  formatDimensions,
  formatQuantity,
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
  characteristics: ProposalPdfCharacteristic[];
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

export function clientCharacteristics(item: ProposalItem): ProposalPdfCharacteristic[] {
  const configuration = item.configuration;
  const characteristics: ProposalPdfCharacteristic[] = [];
  pushCharacteristic(characteristics, "Ткань", configuration.fabricName);
  if (configuration.faceFabric !== configuration.fabricName) {
    pushCharacteristic(characteristics, "Лицевая ткань", configuration.faceFabric);
  }
  pushCharacteristic(characteristics, "Дневная ткань", configuration.dayFabric);
  pushCharacteristic(characteristics, "Подкладка", configuration.lining);
  pushCharacteristic(characteristics, "Механизм", configuration.mechanism);
  pushCharacteristic(characteristics, "Обработка верха", configuration.heading);
  pushCharacteristic(characteristics, "Крепление", configuration.mounting);
  pushCharacteristic(characteristics, "Стёжка", configuration.stitch);
  pushCharacteristic(characteristics, "Наполнитель", configuration.filling);
  if (configuration.extraOperations.length > 0) {
    characteristics.push({
      label: "Дополнительно",
      value: configuration.extraOperations.join(", "),
    });
  }
  return characteristics;
}

function pushCharacteristic(
  characteristics: ProposalPdfCharacteristic[],
  label: string,
  value: string | null,
) {
  if (!value) {
    return;
  }
  const prefix = label.toLocaleLowerCase("ru");
  const raw = value.trim();
  if (!raw.toLocaleLowerCase("ru").startsWith(prefix)) {
    characteristics.push({ label, value: raw });
    return;
  }
  const rest = raw
    .slice(label.length)
    .replace(/^[\s:—–-]+/u, "")
    .replace(/^«/u, "")
    .replace(/»$/u, "")
    .trim();
  characteristics.push({ label, value: rest || raw });
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

  const total = clientProposalTotal(proposal.items, step, mode);
  return {
    recipient: proposal.recipient,
    author: proposal.author,
    objectName: proposal.objectName,
    issuedOnLabel: formatProposalDate(proposal.issuedOn),
    sections,
    totalLabel: formatProposalMoney(total),
    total,
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
    characteristics: clientCharacteristics(item),
    quantity: item.quantity,
    quantityLabel: formatQuantity(item.quantity),
    unitPriceLabel: formatProposalMoney(unitPrice),
    amountLabel: formatProposalMoney(amount),
    amount,
    confirmation: itemNeedsConfirmation(item) ? CLIENT_CONFIRMATION_NOTE : null,
  };
}

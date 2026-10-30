import { formatProposalDate, formatProposalMoney } from "@/lib/proposalDocument";
import type { CoverMessageInput, CoverOfferId } from "@/lib/coverMessageTypes";

export type ProductKind =
  | "curtain"
  | "roman"
  | "tulle"
  | "bedspread"
  | "bedding"
  | "kitchen"
  | "rail"
  | "mounting"
  | "pillow";

export type RoomFacts = {
  name: string;
  kinds: Set<ProductKind>;
};

const CATEGORY_LABELS: Record<ProductKind, string> = {
  curtain: "шторы",
  roman: "римские шторы",
  tulle: "тюль",
  bedspread: "покрывало",
  bedding: "постельное бельё",
  kitchen: "кухонный текстиль",
  rail: "карниз",
  mounting: "монтаж",
  pillow: "декоративные подушки",
};

export function productKind(item: {
  title: string;
  itemType: string;
  productType: string | null;
}): ProductKind | null {
  const title = item.title.toLocaleLowerCase("ru");
  if (/декоративн.*подуш|подушк/.test(title)) {
    return "pillow";
  }
  if (/тюл/.test(title)) {
    return "tulle";
  }
  if (/покрывал|плед/.test(title)) {
    return "bedspread";
  }
  if (/постельн|наволоч|пододеял|простын/.test(title)) {
    return "bedding";
  }
  if (/кухон|скатерт|прихват|фартук/.test(title)) {
    return "kitchen";
  }
  if (/карниз/.test(title)) {
    return "rail";
  }
  if (/монтаж|вывес/.test(title)) {
    return "mounting";
  }
  if (item.productType === "roman" || /римск/.test(title)) {
    return "roman";
  }
  if (item.productType === "bedspread") {
    return "bedspread";
  }
  if (item.productType === "curtain" || /штор/.test(title)) {
    return "curtain";
  }
  return null;
}

export function categoryLabel(kind: ProductKind): string {
  return CATEGORY_LABELS[kind];
}

export function roomFacts(input: CoverMessageInput): RoomFacts[] {
  return input.proposal.rooms.flatMap((room) => {
    const kinds = new Set<ProductKind>();
    for (const item of input.proposal.items) {
      if (item.room !== room.id || item.itemType === "service") {
        continue;
      }
      const kind = productKind(item);
      if (kind) {
        kinds.add(kind);
      }
    }
    return kinds.size > 0 ? [{ name: room.name, kinds }] : [];
  });
}

function looseKinds(input: CoverMessageInput): Set<ProductKind> {
  const kinds = new Set<ProductKind>();
  for (const item of input.proposal.items) {
    if (item.room !== null || item.itemType === "service") {
      continue;
    }
    const kind = productKind(item);
    if (kind) {
      kinds.add(kind);
    }
  }
  return kinds;
}

export function projectHasWindowTextile(input: CoverMessageInput): boolean {
  const rooms = roomFacts(input);
  const loose = looseKinds(input);
  return (
    rooms.some((room) => room.kinds.has("curtain") || room.kinds.has("roman")) ||
    loose.has("curtain") ||
    loose.has("roman")
  );
}

export function includedServiceTitles(input: CoverMessageInput): string[] {
  return input.proposal.items
    .filter((item) => item.itemType === "service")
    .map((item) => item.title.trim())
    .filter(Boolean);
}

export function selectedOfferInstructions(
  input: CoverMessageInput,
): Array<{ id: CoverOfferId; instruction: string }> {
  const selected = input.offers;
  if (selected.length === 0) {
    return [];
  }
  const rooms = roomFacts(input);
  const loose = looseKinds(input);
  const out: Array<{ id: CoverOfferId; instruction: string }> = [];
  for (const id of selected) {
    const instruction = instructionForOffer(id, input, rooms, loose);
    if (instruction) {
      out.push({ id, instruction });
    }
  }
  return out;
}

function instructionForOffer(
  id: CoverOfferId,
  input: CoverMessageInput,
  rooms: RoomFacts[],
  loose: Set<ProductKind>,
): string | null {
  switch (id) {
    case "mounting":
      return serviceInstruction(rooms, loose, "mounting", "монтаж и вывес штор");
    case "rails":
      return serviceInstruction(rooms, loose, "rail", "карнизы, включая обычные и электрические");
    case "bedspread":
      return textileInstruction(
        rooms,
        loose,
        ["curtain", "roman"],
        "bedspread",
        "покрывало",
        "к шторам",
      );
    case "tulle":
      return textileInstruction(rooms, loose, ["curtain"], "tulle", "тюль", "к портьерам");
    case "bedding":
      return namedRoomInstruction(rooms, /спальн/iu, "bedding", "постельное бельё", "спальн");
    case "kitchen":
      return namedRoomInstruction(rooms, /кухн/iu, "kitchen", "кухонный текстиль", "кухн");
    case "pillows":
      return pillowInstruction(rooms, loose);
    case "curtains":
      return curtainsInstruction(rooms, loose);
    case "premium":
      return "Предложи дополнительно пересчитать проект в более дорогом исполнении с премиальными тканями. Не называй новую цену и не изменяй текущую сумму.";
    case "discount":
      if (!input.discount) {
        return null;
      }
      return discountInstruction(input);
    default:
      return null;
  }
}

function discountInstruction(input: CoverMessageInput): string {
  const size =
    input.discount!.kind === "percent"
      ? `${input.discount!.value}%`
      : formatProposalMoney(input.discount!.value);
  return `Сообщи скидку ровно ${size} при оплате до ${formatProposalDate(input.discount!.until)}. Не пересчитывай сумму КП и не называй цену после скидки.`;
}

function serviceInstruction(
  rooms: RoomFacts[],
  loose: Set<ProductKind>,
  kind: ProductKind,
  label: string,
): string {
  const windows = rooms.filter((room) => room.kinds.has("curtain") || room.kinds.has("roman"));
  const looseWindows = loose.has("curtain") || loose.has("roman");
  if (windows.length === 0 && !looseWindows) {
    return `В проекте нет штор. Не предлагай ${label} и не придумывай помещение.`;
  }
  if (windows.length === 0) {
    if (loose.has(kind)) {
      return `${label} уже есть среди позиций без помещения. Не предлагай это повторно.`;
    }
    return `Предложи дополнительно рассчитать ${label} для штор в проекте. Это ещё не входит в КП, цены нет.`;
  }
  const open = windows.filter((room) => !room.kinds.has(kind)).map((room) => room.name);
  const closed = windows.filter((room) => room.kinds.has(kind)).map((room) => room.name);
  if (open.length === 0) {
    return `${label} уже включён в КП (${closed.join(", ")}). Не предлагай это повторно как дополнительный расчёт.`;
  }
  const skip = closed.length > 0 ? ` Не предлагай повторно для: ${closed.join(", ")}.` : "";
  return `Предложи дополнительно рассчитать ${label} для: ${open.join(", ")}. Это ещё не входит в КП, цены нет.${skip}`;
}

function textileInstruction(
  rooms: RoomFacts[],
  loose: Set<ProductKind>,
  triggers: ProductKind[],
  existing: ProductKind,
  label: string,
  relation: string,
): string {
  const looseOpen = triggers.some((kind) => loose.has(kind)) && !loose.has(existing);
  const relevant = rooms.filter((room) => triggers.some((kind) => room.kinds.has(kind)));
  const open = relevant.filter((room) => !room.kinds.has(existing)).map((room) => room.name);
  const closed = rooms.filter((room) => room.kinds.has(existing)).map((room) => room.name);
  if (relevant.length === 0) {
    if (!looseOpen) {
      return `Нет подходящих помещений для «${label}». Не придумывай помещение.`;
    }
    return `Предложи ${label} ${relation}, связав с уже выбранным текстилем в проекте. Не называй цену.`;
  }
  if (open.length === 0) {
    return `${label} уже есть в: ${closed.join(", ")}. Не предлагай повторно.`;
  }
  const skip = closed.length > 0 ? ` Не предлагай для: ${closed.join(", ")}.` : "";
  return `Предложи ${label} ${relation} для: ${open.join(", ")}.${skip} Свяжи предложение с уже выбранным текстилем. Не называй цену.`;
}

function namedRoomInstruction(
  rooms: RoomFacts[],
  pattern: RegExp,
  existing: ProductKind,
  label: string,
  roomWord: string,
): string {
  const matched = rooms.filter((room) => pattern.test(room.name));
  if (matched.length === 0) {
    return `В проекте нет помещения «${roomWord}». Не придумывай такое помещение.`;
  }
  const open = matched.filter((room) => !room.kinds.has(existing)).map((room) => room.name);
  const closed = matched.filter((room) => room.kinds.has(existing)).map((room) => room.name);
  if (open.length === 0) {
    return `${label} уже есть в: ${closed.join(", ")}. Не предлагай повторно.`;
  }
  const skip = closed.length > 0 ? ` Не предлагай для: ${closed.join(", ")}.` : "";
  return `Предложи ${label} для: ${open.join(", ")}.${skip} Не называй цену.`;
}

function pillowInstruction(rooms: RoomFacts[], loose: Set<ProductKind>): string {
  const triggers: ProductKind[] = ["bedspread", "bedding", "curtain", "roman"];
  const relevant = rooms.filter((room) => triggers.some((kind) => room.kinds.has(kind)));
  const open = relevant.filter((room) => !room.kinds.has("pillow")).map((room) => room.name);
  const closed = rooms.filter((room) => room.kinds.has("pillow")).map((room) => room.name);
  const looseOpen =
    triggers.some((kind) => loose.has(kind)) && !loose.has("pillow") && open.length === 0;
  if (relevant.length === 0 && !looseOpen) {
    return "Нет логичной связи для декоративных подушек. Сформулируй мягко как дополнение к текстилю проекта, без цены.";
  }
  if (open.length === 0 && !looseOpen) {
    return `Декоративные подушки уже есть в: ${closed.join(", ")}. Не предлагай повторно.`;
  }
  const target = open.length > 0 ? open.join(", ") : "помещений проекта";
  const skip = closed.length > 0 ? ` Не предлагай для: ${closed.join(", ")}.` : "";
  return `Предложи декоративные подушки для ${target}, в тон уже выбранному текстилю.${skip} Не называй цену.`;
}

function curtainsInstruction(rooms: RoomFacts[], loose: Set<ProductKind>): string {
  const open = rooms
    .filter((room) => !room.kinds.has("curtain") && !room.kinds.has("roman"))
    .filter(
      (room) =>
        room.kinds.has("bedspread") ||
        room.kinds.has("bedding") ||
        /гостин|спальн|детск|кабинет|столов/iu.test(room.name),
    )
    .map((room) => room.name);
  const hasWindows = projectHasWindowTextileFrom(rooms, loose);
  if (open.length === 0 && !hasWindows) {
    return "Шторы или римские шторы уже есть во всех релевантных помещениях. Не предлагай повторно.";
  }
  if (open.length === 0) {
    return "Предложи шторы или римские шторы для помещений, где их ещё нет, связав с общей концепцией проекта. Не называй цену.";
  }
  return `Предложи шторы или римские шторы для: ${open.join(", ")}. Не называй цену.`;
}

function projectHasWindowTextileFrom(rooms: RoomFacts[], loose: Set<ProductKind>): boolean {
  return (
    rooms.some((room) => room.kinds.has("curtain") || room.kinds.has("roman")) ||
    loose.has("curtain") ||
    loose.has("roman")
  );
}

type RelationshipHint = {
  relatedOfferIds: CoverOfferId[];
  text: string;
};

export function projectTextileGaps(input: CoverMessageInput): {
  presentCategories: string[];
  absentCategories: string[];
} {
  const rooms = roomFacts(input);
  const loose = looseKinds(input);
  const present = new Set<ProductKind>();
  for (const room of rooms) {
    for (const kind of room.kinds) {
      present.add(kind);
    }
  }
  for (const kind of loose) {
    present.add(kind);
  }
  const textileKinds: ProductKind[] = [
    "curtain",
    "roman",
    "tulle",
    "bedspread",
    "bedding",
    "pillow",
    "kitchen",
  ];
  return {
    presentCategories: [...present].map((kind) => categoryLabel(kind)),
    absentCategories: textileKinds
      .filter((kind) => !present.has(kind))
      .map((kind) => categoryLabel(kind)),
  };
}

function buildRelationshipHints(input: CoverMessageInput): RelationshipHint[] {
  const has = (kind: ProductKind) => projectHasKind(input, kind);
  const hints: RelationshipHint[] = [];

  if (has("bedspread")) {
    if (!has("bedding")) {
      hints.push({
        relatedOfferIds: ["bedding"],
        text: "В проекте уже есть покрывало — постельное бельё логично дополнит спальню в той же палитре.",
      });
    }
    if (!has("pillow")) {
      hints.push({
        relatedOfferIds: ["pillows"],
        text: "К покрывалу уместно предложить декоративные подушки, чтобы завершить композицию спальни.",
      });
    }
    if (!has("curtain") && !has("roman")) {
      hints.push({
        relatedOfferIds: ["curtains"],
        text: "При покрывале без штор можно предложить шторы или римские шторы для других зон квартиры.",
      });
    }
    if ((has("curtain") || has("roman")) && !has("tulle")) {
      hints.push({
        relatedOfferIds: ["tulle"],
        text: "Если появятся шторы, к ним можно подобрать лёгкий тюль — сейчас в проекте его нет.",
      });
    }
  }

  if ((has("curtain") || has("roman")) && !has("tulle")) {
    hints.push({
      relatedOfferIds: ["tulle"],
      text: "Шторы в проекте есть, тюля пока нет — предложение тюля будет уместно к портьерам.",
    });
  }
  if ((has("curtain") || has("roman")) && !has("bedspread")) {
    hints.push({
      relatedOfferIds: ["bedspread"],
      text: "Шторы задают палитру — покрывало в спальне может поддержать общий стиль.",
    });
  }
  if (has("bedding") && !has("bedspread")) {
    hints.push({
      relatedOfferIds: ["bedspread"],
      text: "Постельное бельё уже в проекте — покрывало завершит образ спальни.",
    });
  }
  if (has("kitchen")) {
    hints.push({
      relatedOfferIds: ["kitchen"],
      text: "Кухонный текстиль можно связать с отделкой других зон, если это уместно.",
    });
  }
  if ((has("curtain") || has("roman")) && !has("mounting") && !has("rail")) {
    hints.push({
      relatedOfferIds: ["mounting", "rails"],
      text: "Для штор в проекте логичны отдельные расчёты монтажа и карнизов, если их ещё нет в КП.",
    });
  }

  return dedupeHints(hints).slice(0, 6);
}

function projectHasKind(input: CoverMessageInput, kind: ProductKind): boolean {
  const rooms = roomFacts(input);
  const loose = looseKinds(input);
  return rooms.some((room) => room.kinds.has(kind)) || loose.has(kind);
}

function dedupeHints(hints: RelationshipHint[]): RelationshipHint[] {
  const seen = new Set<string>();
  return hints.filter((hint) => {
    const key = `${hint.relatedOfferIds.join(",")}:${hint.text}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/** Подсказки только для выбранных менеджером допродаж — не призыв добавлять новые. */
export function relationshipHints(input: CoverMessageInput): string[] {
  const selected = new Set(input.offers);
  return buildRelationshipHints(input)
    .filter((hint) => hint.relatedOfferIds.some((id) => selected.has(id)))
    .map((hint) => hint.text);
}

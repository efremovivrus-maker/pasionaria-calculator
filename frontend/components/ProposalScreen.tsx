"use client";

import { useEffect, useState, type ReactNode } from "react";

import { ProposalCoverMessage } from "@/components/ProposalCoverMessage";
import { useProposal } from "@/components/ProposalProvider";
import { formatProposalMoney } from "@/lib/proposalDocument";
import {
  clientLineAmount,
  clientProposalTotal,
  clientUnitPrice,
  createManualItem,
  formatDimensions,
  formatEditableNumber,
  formatRubles,
  itemsInRoom,
  parseEditableNumber,
  roundMoney,
  roundWholeRubles,
  ROUNDING_STEPS,
  UNASSIGNED_ROOM_LABEL,
  type ProposalItem,
  type ProposalRoom,
  type RoundingMode,
  type RoundingStep,
} from "@/lib/proposal";

const fieldClass =
  "mt-2 w-full border border-stone-300 bg-transparent px-3 py-2 text-sm font-normal normal-case tracking-normal text-stone-950 outline-none focus:border-stone-800";

export function ProposalScreen() {
  const {
    proposal,
    closeProposal,
    updateDocument,
    updateItem,
    moveItem,
    addRoom,
    renameRoom,
    removeRoom,
    applyRounding,
    addItem,
    removeItem,
    clearItems,
  } = useProposal();
  const [confirmClear, setConfirmClear] = useState(false);
  const [pdfState, setPdfState] = useState<"idle" | "working" | "failed">("idle");
  const [roomName, setRoomName] = useState("");
  const [manualTitle, setManualTitle] = useState("");
  const [manualQuantity, setManualQuantity] = useState("1");
  const [manualPrice, setManualPrice] = useState("");
  const [manualType, setManualType] = useState<"product" | "service">("product");
  const total = clientProposalTotal(
    proposal.items,
    proposal.roundingStep,
    proposal.roundingMode,
  );
  const unassigned = itemsInRoom(proposal.items, null);
  const manualQuantityValue = parseEditableNumber(manualQuantity);
  const manualPriceValue = parseEditableNumber(manualPrice);
  const canAddManual =
    manualTitle.trim().length > 0 &&
    manualQuantityValue !== null &&
    manualQuantityValue > 0 &&
    manualPriceValue !== null &&
    manualPriceValue >= 0;

  function commitClientPrice(item: ProposalItem, next: number) {
    const shown = clientUnitPrice(item, proposal.roundingStep, proposal.roundingMode);
    if (roundMoney(next) === roundMoney(shown)) {
      return;
    }
    updateItem(item.id, {
      unitPrice: roundWholeRubles(next, proposal.roundingMode),
    });
  }

  function saveRoom() {
    const name = roomName.trim();
    if (!name) {
      return;
    }
    addRoom(name);
    setRoomName("");
  }

  function saveManualItem() {
    if (
      manualQuantityValue === null ||
      manualPriceValue === null
    ) {
      return;
    }
    const manualItem = createManualItem({
      title: manualTitle,
      quantity: manualQuantityValue,
      unitPrice: manualPriceValue,
      itemType: manualType,
    });
    if (!manualItem) {
      return;
    }
    addItem(manualItem);
    setManualTitle("");
    setManualQuantity("1");
    setManualPrice("");
    setManualType("product");
  }

  function clearProposal() {
    clearItems();
    setConfirmClear(false);
  }

  async function createPdf() {
    setPdfState("working");
    try {
      const { downloadProposalPdf } = await import("@/lib/downloadProposalPdf");
      await downloadProposalPdf(proposal);
      setPdfState("idle");
    } catch {
      setPdfState("failed");
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-[1040px] flex-1 flex-col px-5 pb-10 pt-12 sm:px-8 sm:pt-16 lg:px-10">
      <button
        type="button"
        onClick={closeProposal}
        className="self-start text-sm text-stone-700 underline decoration-stone-300 underline-offset-4 transition-colors hover:text-stone-950"
      >
        Вернуться к расчётам
      </button>

      <h1 className="mt-6 font-editorial text-[2.6rem] leading-none text-stone-950 sm:text-[3.4rem]">
        Коммерческое предложение
      </h1>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <DocumentField
          label="Адресат КП"
          value={proposal.recipient ?? ""}
          onChange={(value) =>
            updateDocument({ recipient: value.trim() ? value : null })
          }
        />
        <DocumentField
          label="Автор КП"
          value={proposal.author ?? ""}
          onChange={(value) =>
            updateDocument({ author: value.trim() ? value : null })
          }
        />
        <div className="sm:col-span-2">
          <DocumentField
            label="Название объекта / адрес"
            value={proposal.objectName ?? ""}
            onChange={(value) =>
              updateDocument({ objectName: value.trim() ? value : null })
            }
          />
        </div>
        <DocumentField
          label="Дата КП"
          type="date"
          value={proposal.issuedOn}
          onChange={(value) => {
            if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
              updateDocument({ issuedOn: value });
            }
          }}
        />
      </div>

      <fieldset className="mt-8 border border-stone-300 px-4 py-4">
        <legend className="px-2 text-xs font-semibold uppercase tracking-[0.14em] text-stone-600">
          Округлять цены до
        </legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {ROUNDING_STEPS.map((step) => (
            <label key={step} className="inline-flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="rounding-step"
                value={step}
                checked={proposal.roundingStep === step}
                onChange={() => updateDocument({ roundingStep: step })}
              />
              {formatRubles(step)}
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="rounding-mode"
              value="nearest"
              checked={proposal.roundingMode === "nearest"}
              onChange={() => updateDocument({ roundingMode: "nearest" })}
            />
            До ближайшего значения
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="rounding-mode"
              value="up"
              checked={proposal.roundingMode === "up"}
              onChange={() => updateDocument({ roundingMode: "up" })}
            />
            Всегда вверх
          </label>
        </div>
        <button
          type="button"
          disabled={proposal.items.length === 0}
          onClick={() => applyRounding(proposal.roundingStep, proposal.roundingMode)}
          className="mt-4 min-h-10 border border-stone-800 px-4 text-sm font-medium text-stone-900 transition-colors hover:bg-stone-900 hover:text-stone-50 disabled:cursor-not-allowed disabled:border-stone-300 disabled:text-stone-400"
        >
          Округлить цены
        </button>
        <p className="mt-2 text-xs leading-5 text-stone-500">
          Округляется цена за единицу от исходной стоимости.
        </p>
      </fieldset>

      <form
        className="mt-8 flex flex-col gap-3 border border-stone-300 bg-[#f8f6f0] px-4 py-4 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          saveRoom();
        }}
      >
        <label className="block flex-1 text-xs font-semibold uppercase tracking-[0.14em] text-stone-600">
          Новое помещение
          <input
            value={roomName}
            onChange={(event) => setRoomName(event.target.value)}
            placeholder="Гостиная, спальня, детская"
            className={fieldClass}
          />
        </label>
        <button
          type="submit"
          disabled={!roomName.trim()}
          className="min-h-11 bg-stone-950 px-5 text-sm font-semibold text-[#f7f4ec] transition-colors hover:bg-[#6d7565] disabled:cursor-not-allowed disabled:bg-stone-300"
        >
          Добавить помещение
        </button>
      </form>

      {proposal.items.length === 0 && (
        <p className="mt-8 text-base text-stone-600">
          В коммерческом предложении пока нет позиций.
        </p>
      )}

      {(proposal.items.length > 0 || proposal.rooms.length > 0) && (
        <div className="mt-8 space-y-6">
          {unassigned.length > 0 && (
            <RoomGroup
              title={UNASSIGNED_ROOM_LABEL}
              items={unassigned}
              total={clientProposalTotal(
                unassigned,
                proposal.roundingStep,
                proposal.roundingMode,
              )}
            >
              {unassigned.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  position={proposal.items.findIndex((entry) => entry.id === item.id) + 1}
                  rooms={proposal.rooms}
                  canMoveUp={canMove(unassigned, item.id, "up")}
                  canMoveDown={canMove(unassigned, item.id, "down")}
                  onTitle={(title) => updateItem(item.id, { title })}
                  onQuantity={(quantity) => updateItem(item.id, { quantity })}
                  onPrice={(unitPrice) => commitClientPrice(item, unitPrice)}
                  roundingStep={proposal.roundingStep}
                  roundingMode={proposal.roundingMode}
                  onType={(itemType) => updateItem(item.id, { itemType })}
                  onRoom={(room) => updateItem(item.id, { room })}
                  onMove={(direction) => moveItem(item.id, direction)}
                  onRemove={() => removeItem(item.id)}
                />
              ))}
            </RoomGroup>
          )}

          {proposal.rooms.map((room) => {
            const roomItems = itemsInRoom(proposal.items, room.id);
            return (
              <RoomGroup
                key={room.id}
                title={room.name}
                items={roomItems}
                total={clientProposalTotal(
                  roomItems,
                  proposal.roundingStep,
                  proposal.roundingMode,
                )}
                heading={
                  <RoomName
                    room={room}
                    onRename={(name) => renameRoom(room.id, name)}
                    onRemove={() => removeRoom(room.id)}
                  />
                }
              >
                {roomItems.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    position={proposal.items.findIndex((entry) => entry.id === item.id) + 1}
                    rooms={proposal.rooms}
                    canMoveUp={canMove(roomItems, item.id, "up")}
                    canMoveDown={canMove(roomItems, item.id, "down")}
                    onTitle={(title) => updateItem(item.id, { title })}
                    onQuantity={(quantity) => updateItem(item.id, { quantity })}
                    onPrice={(unitPrice) => commitClientPrice(item, unitPrice)}
                    roundingStep={proposal.roundingStep}
                    roundingMode={proposal.roundingMode}
                    onType={(itemType) => updateItem(item.id, { itemType })}
                    onRoom={(roomId) => updateItem(item.id, { room: roomId })}
                    onMove={(direction) => moveItem(item.id, direction)}
                    onRemove={() => removeItem(item.id)}
                  />
                ))}
              </RoomGroup>
            );
          })}
        </div>
      )}

      <form
        className="mt-8 border border-stone-300 px-4 py-4"
        onSubmit={(event) => {
          event.preventDefault();
          saveManualItem();
        }}
      >
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-600">
          Произвольная позиция
        </p>
        <fieldset className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
          <legend className="sr-only">Тип произвольной позиции</legend>
          <label className="inline-flex items-center gap-2 text-sm text-stone-800">
            <input
              type="radio"
              name="manual-item-type"
              value="product"
              checked={manualType === "product"}
              onChange={() => setManualType("product")}
            />
            Изделие
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-stone-800">
            <input
              type="radio"
              name="manual-item-type"
              value="service"
              checked={manualType === "service"}
              onChange={() => setManualType("service")}
            />
            Услуга
          </label>
        </fieldset>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1.4fr_0.6fr_0.8fr_auto] sm:items-end">
          <label className="block text-xs text-stone-600">
            Название
            <input
              aria-label="Название произвольной позиции"
              value={manualTitle}
              onChange={(event) => setManualTitle(event.target.value)}
              placeholder="Монтаж карниза, доставка"
              className={fieldClass}
            />
          </label>
          <label className="block text-xs text-stone-600">
            Количество
            <input
              aria-label="Количество произвольной позиции"
              inputMode="decimal"
              value={manualQuantity}
              onChange={(event) => setManualQuantity(event.target.value)}
              className={fieldClass}
            />
          </label>
          <label className="block text-xs text-stone-600">
            Цена за единицу
            <input
              aria-label="Цена произвольной позиции"
              inputMode="decimal"
              value={manualPrice}
              onChange={(event) => setManualPrice(event.target.value)}
              className={fieldClass}
            />
          </label>
          <button
            type="submit"
            disabled={!canAddManual}
            className="min-h-11 bg-stone-950 px-5 text-sm font-semibold text-[#f7f4ec] transition-colors hover:bg-[#6d7565] disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            Добавить позицию
          </button>
        </div>
      </form>

      <div className="mt-8 flex items-baseline justify-between gap-6 border-t border-stone-800 pt-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-700">
          Итого
        </p>
        <p className="font-editorial text-[2.4rem] leading-none text-stone-950 sm:text-[3rem]">
          {formatProposalMoney(total)}
        </p>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void createPdf()}
          disabled={pdfState === "working"}
          className="min-h-11 bg-stone-950 px-5 text-sm font-semibold text-[#f7f4ec] transition-colors hover:bg-[#6d7565] disabled:cursor-wait disabled:bg-stone-400"
        >
          {pdfState === "working" ? "Формируется PDF…" : "Сформировать PDF"}
        </button>
        <ProposalCoverMessage />
        {pdfState === "failed" ? (
          <p role="alert" className="w-full text-sm text-stone-700">
            Не удалось сформировать PDF. Попробуйте ещё раз.
          </p>
        ) : null}
      </div>

      {proposal.items.length > 0 &&
        (confirmClear ? (
          <div className="mt-8 border border-stone-300 bg-[#f8f6f0] px-5 py-5">
            <p className="text-sm text-stone-800">
              Удалить все позиции из коммерческого предложения?
            </p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={clearProposal}
                className="min-h-11 bg-stone-950 px-5 text-sm font-semibold text-[#f7f4ec] transition-colors hover:bg-[#6d7565]"
              >
                Очистить
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="min-h-11 border border-stone-800 px-5 text-sm font-medium text-stone-900 transition-colors hover:bg-stone-900 hover:text-stone-50"
              >
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            className="mt-8 min-h-11 self-start border border-stone-800 px-5 text-sm font-medium text-stone-900 transition-colors hover:bg-stone-900 hover:text-stone-50"
          >
            Очистить КП
          </button>
        ))}
    </main>
  );
}

function DocumentField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "date";
}) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-stone-600">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={(event) => onChange(event.target.value.trim())}
        className={fieldClass}
      />
    </label>
  );
}

function RoomGroup({
  title,
  items,
  total,
  heading,
  children,
}: {
  title: string;
  items: ProposalItem[];
  total: number;
  heading?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="border border-stone-300">
      <div className="flex flex-col gap-3 border-b border-stone-300 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        {heading ?? (
          <h2 className="text-lg font-medium text-stone-950">{title}</h2>
        )}
        {items.length > 0 && (
          <p className="text-sm text-stone-600">
            Сумма помещения{" "}
            <span className="font-medium tabular-nums text-stone-950">
              {formatProposalMoney(total)}
            </span>
          </p>
        )}
      </div>
      {items.length > 0 ? (
        <ul>{children}</ul>
      ) : (
        <p className="px-4 py-4 text-sm text-stone-500">
          В помещении пока нет позиций.
        </p>
      )}
    </section>
  );
}

function RoomName({
  room,
  onRename,
  onRemove,
}: {
  room: ProposalRoom;
  onRename: (name: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
      <label className="block flex-1 text-xs font-semibold uppercase tracking-[0.14em] text-stone-600">
        Помещение
        <DraftInput
          value={room.name}
          ariaLabel={`Название помещения ${room.name}`}
          onCommit={onRename}
        />
      </label>
      <button
        type="button"
        onClick={onRemove}
        className="min-h-10 self-start border border-stone-300 px-3 text-sm text-stone-700 transition-colors hover:border-stone-800 hover:text-stone-950 sm:self-end"
      >
        Удалить помещение
      </button>
    </div>
  );
}

function ItemCard({
  item,
  position,
  rooms,
  canMoveUp,
  canMoveDown,
  onTitle,
  onQuantity,
  onPrice,
  roundingStep,
  roundingMode,
  onType,
  onRoom,
  onMove,
  onRemove,
}: {
  item: ProposalItem;
  position: number;
  rooms: ProposalRoom[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  onTitle: (title: string) => void;
  onQuantity: (quantity: number) => void;
  onPrice: (unitPrice: number) => void;
  roundingStep: RoundingStep;
  roundingMode: RoundingMode;
  onType: (itemType: "product" | "service") => void;
  onRoom: (room: string | null) => void;
  onMove: (direction: "up" | "down") => void;
  onRemove: () => void;
}) {
  const dimensions = formatDimensions(item.widthCm, item.heightCm);
  const siblings = rooms;
  const shownPrice = clientUnitPrice(item, roundingStep, roundingMode);
  const shownAmount = clientLineAmount(item, roundingStep, roundingMode);

  return (
    <li className="border-t border-stone-300 px-4 py-4 first:border-t-0">
      <DraftInput
        value={item.title}
        ariaLabel={`Название позиции ${position}`}
        onCommit={onTitle}
        className="text-base font-medium"
      />
      {dimensions && (
        <p className="mt-1 text-sm text-stone-600">{dimensions}</p>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <NumberField
          label={`Количество позиции ${position}`}
          visibleLabel="Количество"
          value={item.quantity}
          onCommit={onQuantity}
          allowZero={false}
        />
        <NumberField
          label={`Цена за единицу позиции ${position}`}
          visibleLabel="Цена за единицу"
          value={shownPrice}
          onCommit={onPrice}
          allowZero
        />
        <p className="self-end pb-2 text-sm text-stone-600">
          Сумма{" "}
          <span className="font-medium tabular-nums text-stone-950">
            {formatProposalMoney(shownAmount)}
          </span>
        </p>
      </div>
      {roundMoney(shownPrice) !== roundMoney(item.originalUnitPrice) && (
        <p className="mt-2 text-xs text-stone-500">
          Исходная цена {formatRubles(item.originalUnitPrice)}
        </p>
      )}
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row">
          {item.productType === null && (
            <label className="block text-xs text-stone-600 sm:min-w-40">
              Тип
              <select
                aria-label={`Тип позиции ${position}`}
                value={item.itemType}
                onChange={(event) =>
                  onType(event.target.value === "service" ? "service" : "product")
                }
                className={fieldClass}
              >
                <option value="product">Изделие</option>
                <option value="service">Услуга</option>
              </select>
            </label>
          )}
          <label className="block flex-1 text-xs text-stone-600 sm:min-w-56">
          Помещение
          <select
            aria-label={`Помещение позиции ${position}`}
            value={item.room ?? ""}
            onChange={(event) => onRoom(event.target.value || null)}
            className={fieldClass}
          >
            <option value="">{UNASSIGNED_ROOM_LABEL}</option>
            {siblings.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canMoveUp}
            onClick={() => onMove("up")}
            aria-label={`Выше позиции ${position}`}
            className="min-h-10 border border-stone-300 px-3 text-sm text-stone-700 transition-colors hover:border-stone-800 hover:text-stone-950 disabled:cursor-not-allowed disabled:text-stone-300"
          >
            Выше
          </button>
          <button
            type="button"
            disabled={!canMoveDown}
            onClick={() => onMove("down")}
            aria-label={`Ниже позиции ${position}`}
            className="min-h-10 border border-stone-300 px-3 text-sm text-stone-700 transition-colors hover:border-stone-800 hover:text-stone-950 disabled:cursor-not-allowed disabled:text-stone-300"
          >
            Ниже
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Удалить позицию ${position}`}
            className="min-h-10 border border-stone-300 px-3 text-sm text-stone-700 transition-colors hover:border-stone-800 hover:text-stone-950"
          >
            Удалить
          </button>
        </div>
      </div>
    </li>
  );
}

function DraftInput({
  value,
  ariaLabel,
  onCommit,
  className = "",
}: {
  value: string;
  ariaLabel: string;
  onCommit: (value: string) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <input
      aria-label={ariaLabel}
      value={draft}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        if (next.trim()) {
          onCommit(next);
        }
      }}
      onBlur={() => {
        const trimmed = draft.trim();
        if (!trimmed) {
          setDraft(value);
          return;
        }
        onCommit(trimmed);
        setDraft(trimmed);
      }}
      className={`${fieldClass} ${className}`}
    />
  );
}

function NumberField({
  label,
  visibleLabel,
  value,
  onCommit,
  allowZero,
}: {
  label: string;
  visibleLabel: string;
  value: number;
  onCommit: (value: number) => void;
  allowZero: boolean;
}) {
  const [draft, setDraft] = useState(formatEditableNumber(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setDraft(formatEditableNumber(value));
    }
  }, [focused, value]);

  function commit(next: string) {
    const parsed = parseEditableNumber(next);
    if (parsed === null || parsed < 0 || (!allowZero && parsed <= 0)) {
      setDraft(formatEditableNumber(value));
      return;
    }
    onCommit(parsed);
    setDraft(formatEditableNumber(parsed));
  }

  return (
    <label className="block text-xs text-stone-600">
      {visibleLabel}
      <input
        aria-label={label}
        inputMode="decimal"
        value={draft}
        onFocus={() => setFocused(true)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          setFocused(false);
          commit(event.target.value);
        }}
        className={fieldClass}
      />
    </label>
  );
}

function canMove(
  items: ProposalItem[],
  itemId: string,
  direction: "up" | "down",
): boolean {
  const index = items.findIndex((item) => item.id === itemId);
  if (index < 0) {
    return false;
  }
  return direction === "up" ? index > 0 : index < items.length - 1;
}

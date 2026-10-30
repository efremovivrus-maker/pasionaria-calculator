"use client";

import { useEffect, useState, type ReactNode } from "react";

import { ProposalCoverMessage } from "@/components/ProposalCoverMessage";
import { useProposal } from "@/components/ProposalProvider";
import { formatProposalMoney } from "@/lib/proposalDocument";
import {
  clientLineAmount,
  clientProposalTotal,
  clientUnitPrice,
  computeProposalTotals,
  proposalDiscountValid,
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
  "mt-1.5 w-full border border-stone-300 bg-transparent px-3 py-1.5 text-sm font-normal normal-case tracking-normal text-stone-950 outline-none focus:border-stone-800";

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
    updateDiscount,
  } = useProposal();
  const [confirmClear, setConfirmClear] = useState(false);
  const [pdfState, setPdfState] = useState<"idle" | "working" | "failed">("idle");
  const [coverOpen, setCoverOpen] = useState(false);
  const [addingRoom, setAddingRoom] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [addingManual, setAddingManual] = useState(false);
  const [manualTitle, setManualTitle] = useState("");
  const [manualQuantity, setManualQuantity] = useState("1");
  const [manualPrice, setManualPrice] = useState("");
  const [manualType, setManualType] = useState<"product" | "service">("product");
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const totals = computeProposalTotals(proposal);
  const discount = proposal.discount;
  const discountReady = proposalDiscountValid(discount, totals.subtotal);
  const unassigned = itemsInRoom(proposal.items, null);
  const manualQuantityValue = parseEditableNumber(manualQuantity);
  const manualPriceValue = parseEditableNumber(manualPrice);
  const canAddManual =
    manualTitle.trim().length > 0 &&
    manualQuantityValue !== null &&
    manualQuantityValue > 0 &&
    manualPriceValue !== null &&
    manualPriceValue >= 0;

  useEffect(() => {
    if (proposal.cover.text.trim()) {
      setCoverOpen(true);
    }
  }, [proposal.cover.text]);

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
    setAddingRoom(false);
  }

  function saveManualItem() {
    if (manualQuantityValue === null || manualPriceValue === null) {
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
    setAddingManual(false);
  }

  function clearProposal() {
    clearItems();
    setConfirmClear(false);
    setCoverOpen(false);
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

  const roundingModeLabel =
    proposal.roundingMode === "nearest" ? "ближайшее значение" : "вверх";
  const roundingSummary = `Округление: до ${formatRubles(proposal.roundingStep)} · ${roundingModeLabel}`;

  const discountSummary = !discount.enabled
    ? "Скидка: не применяется"
    : discountReady && totals.discountAmount > 0
      ? discount.kind === "percent"
        ? `Скидка ${parseEditableNumber(discount.value) ?? ""}% · −${formatProposalMoney(totals.discountAmount)}`
        : `Скидка · −${formatProposalMoney(totals.discountAmount)}`
      : "Скидка: укажите размер";

  const finalTotal =
    discount.enabled && discountReady ? totals.finalTotal : totals.subtotal;

  return (
    <main className="mx-auto flex w-full max-w-[1040px] flex-1 flex-col px-5 pb-10 pt-6 sm:px-8 sm:pt-8 lg:px-10">
      <button
        type="button"
        onClick={closeProposal}
        className="self-start text-xs text-stone-600 underline decoration-stone-300 underline-offset-2 transition-colors hover:text-stone-950"
      >
        ← Вернуться к расчётам
      </button>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <h1 className="font-editorial text-[1.65rem] leading-tight text-stone-950 sm:text-[2.15rem]">
          Коммерческое предложение
        </h1>
        {proposal.items.length > 0 ? (
          confirmClear ? (
            <div
              role="alertdialog"
              aria-labelledby="clear-kp-heading"
              className="max-w-md border border-stone-300 bg-[#f8f6f0] px-4 py-3 text-sm text-stone-800"
            >
              <p id="clear-kp-heading" className="leading-relaxed">
                Удалить всё содержимое КП? Будут удалены все позиции, помещения, скидка, данные
                клиента и сопроводительное сообщение. Это действие нельзя отменить.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={clearProposal}
                  className="min-h-9 bg-stone-950 px-3 text-xs font-semibold text-[#f7f4ec] hover:bg-[#6d7565]"
                >
                  Очистить
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="min-h-9 border border-stone-400 px-3 text-xs text-stone-800 hover:border-stone-800"
                >
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="inline-flex min-h-9 items-center gap-1.5 border border-stone-300 px-2.5 text-xs text-stone-700 transition-colors hover:border-stone-700 hover:text-stone-950"
            >
              <TrashIcon />
              Очистить КП
            </button>
          )
        ) : null}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <DocumentField
          label="Адресат КП"
          value={proposal.recipient ?? ""}
          onChange={(value) => updateDocument({ recipient: value.trim() ? value : null })}
        />
        <DocumentField
          label="Автор КП"
          value={proposal.author ?? ""}
          onChange={(value) => updateDocument({ author: value.trim() ? value : null })}
        />
        <DocumentField
          label="Объект / адрес"
          value={proposal.objectName ?? ""}
          onChange={(value) => updateDocument({ objectName: value.trim() ? value : null })}
        />
        <DocumentField
          label="Дата"
          type="date"
          value={proposal.issuedOn}
          onChange={(value) => {
            if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
              updateDocument({ issuedOn: value });
            }
          }}
        />
      </div>

      <CollapsibleSection
        className="mt-5"
        summary={`Настройки цен · ${roundingSummary}`}
        panelLabel="Настройки цен"
      >
        <p className="text-xs text-stone-600">{roundingSummary}</p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
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
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
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
          className="mt-3 min-h-9 border border-stone-800 px-3 text-sm font-medium text-stone-900 transition-colors hover:bg-stone-900 hover:text-stone-50 disabled:cursor-not-allowed disabled:border-stone-300 disabled:text-stone-400"
        >
          Округлить цены
        </button>
        <p className="mt-2 text-xs leading-5 text-stone-500">
          Округляется цена за единицу от исходной стоимости.
        </p>
      </CollapsibleSection>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-700">
          Состав КП
        </h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setAddingRoom(true);
              setAddingManual(false);
            }}
            className="min-h-9 border border-stone-300 px-2.5 text-xs font-medium text-stone-800 transition-colors hover:border-stone-800"
          >
            + Помещение
          </button>
          <button
            type="button"
            onClick={() => {
              setAddingManual(true);
              setAddingRoom(false);
            }}
            className="min-h-9 border border-stone-300 px-2.5 text-xs font-medium text-stone-800 transition-colors hover:border-stone-800"
          >
            + Добавить позицию
          </button>
        </div>
      </div>

      {addingRoom ? (
        <form
          className="mt-3 flex flex-col gap-2 border border-stone-300 bg-[#f8f6f0] px-3 py-3 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            saveRoom();
          }}
        >
          <label className="block flex-1 text-xs text-stone-600">
            Название помещения
            <input
              aria-label="Название нового помещения"
              value={roomName}
              onChange={(event) => setRoomName(event.target.value)}
              placeholder="Гостиная, спальня"
              className={fieldClass}
              autoFocus
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!roomName.trim()}
              className="min-h-9 bg-stone-950 px-3 text-xs font-semibold text-[#f7f4ec] disabled:bg-stone-300"
            >
              Сохранить
            </button>
            <button
              type="button"
              onClick={() => {
                setAddingRoom(false);
                setRoomName("");
              }}
              className="min-h-9 border border-stone-300 px-3 text-xs text-stone-700"
            >
              Отмена
            </button>
          </div>
        </form>
      ) : null}

      {addingManual ? (
        <form
          className="mt-3 border border-stone-300 px-3 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            saveManualItem();
          }}
        >
          <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
            <legend className="sr-only">Тип произвольной позиции</legend>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="manual-item-type"
                value="product"
                checked={manualType === "product"}
                onChange={() => setManualType("product")}
              />
              Изделие
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
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
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-xs text-stone-600 sm:col-span-2">
              Наименование
              <input
                aria-label="Название произвольной позиции"
                value={manualTitle}
                onChange={(event) => setManualTitle(event.target.value)}
                placeholder="Монтаж, доставка"
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
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="submit"
              disabled={!canAddManual}
              className="min-h-9 bg-stone-950 px-3 text-xs font-semibold text-[#f7f4ec] disabled:bg-stone-300"
            >
              Добавить
            </button>
            <button
              type="button"
              onClick={() => setAddingManual(false)}
              className="min-h-9 border border-stone-300 px-3 text-xs text-stone-700"
            >
              Отмена
            </button>
          </div>
        </form>
      ) : null}

      {proposal.items.length === 0 && proposal.rooms.length === 0 ? (
        <p className="mt-4 text-sm text-stone-600">
          В коммерческом предложении пока нет позиций.
        </p>
      ) : null}

      {(proposal.items.length > 0 || proposal.rooms.length > 0) && (
        <div className="mt-4 space-y-4">
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
                <ItemRow
                  key={item.id}
                  item={item}
                  position={proposal.items.findIndex((entry) => entry.id === item.id) + 1}
                  rooms={proposal.rooms}
                  canMoveUp={canMove(unassigned, item.id, "up")}
                  canMoveDown={canMove(unassigned, item.id, "down")}
                  expanded={expandedItemId === item.id}
                  onToggleExpand={() =>
                    setExpandedItemId((current) => (current === item.id ? null : item.id))
                  }
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
                  <ItemRow
                    key={item.id}
                    item={item}
                    position={proposal.items.findIndex((entry) => entry.id === item.id) + 1}
                    rooms={proposal.rooms}
                    canMoveUp={canMove(roomItems, item.id, "up")}
                    canMoveDown={canMove(roomItems, item.id, "down")}
                    expanded={expandedItemId === item.id}
                    onToggleExpand={() =>
                      setExpandedItemId((current) => (current === item.id ? null : item.id))
                    }
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

      <CollapsibleSection
        className="mt-6"
        summary={`${discountSummary} · Изменить`}
        panelLabel="Скидка на КП"
      >
        <label className="flex items-start gap-3 text-sm text-stone-800">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={discount.enabled}
            onChange={(event) => updateDiscount({ enabled: event.target.checked })}
          />
          <span>Применить скидку ко всей стоимости предложения</span>
        </label>
        {discount.enabled ? (
          <div className="mt-3 grid gap-3 border border-stone-200 px-3 py-3 sm:grid-cols-2">
            <fieldset>
              <legend className="text-xs text-stone-600">Тип скидки</legend>
              <div className="mt-1.5 flex flex-wrap gap-3">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="proposal-discount-kind"
                    checked={discount.kind === "percent"}
                    onChange={() => updateDiscount({ kind: "percent" })}
                  />
                  Процент
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="proposal-discount-kind"
                    checked={discount.kind === "fixed"}
                    onChange={() => updateDiscount({ kind: "fixed" })}
                  />
                  Фиксированная сумма
                </label>
              </div>
              <input
                aria-label="Значение скидки"
                inputMode="decimal"
                value={discount.value}
                placeholder={discount.kind === "percent" ? "10" : "5000"}
                onChange={(event) => updateDiscount({ value: event.target.value })}
                className={fieldClass}
              />
            </fieldset>
            <label className="block text-xs text-stone-600">
              Дата окончания (необязательно)
              <input
                aria-label="Дата окончания скидки"
                type="date"
                value={discount.until}
                onChange={(event) => updateDiscount({ until: event.target.value })}
                className={fieldClass}
              />
            </label>
            {!discountReady ? (
              <p className="text-sm text-stone-700 sm:col-span-2">
                Укажите корректный размер скидки: не больше 100% и не больше суммы КП.
              </p>
            ) : null}
          </div>
        ) : null}
      </CollapsibleSection>

      <section
        aria-label="Итог коммерческого предложения"
        className="mt-6 border border-stone-800 bg-[#f8f6f0] px-4 py-4 sm:px-5"
      >
        <div className="space-y-1.5 text-sm text-stone-800">
          <div className="flex justify-between gap-4">
            <span>Стоимость до скидки</span>
            <span className="tabular-nums">{formatProposalMoney(totals.subtotal)}</span>
          </div>
          {discount.enabled && totals.discountAmount > 0 && discountReady ? (
            <div className="flex justify-between gap-4">
              <span>
                {discount.kind === "percent"
                  ? `Скидка ${parseEditableNumber(discount.value) ?? ""}%`
                  : "Скидка"}
              </span>
              <span className="tabular-nums">−{formatProposalMoney(totals.discountAmount)}</span>
            </div>
          ) : null}
          <div className="flex items-baseline justify-between gap-4 border-t border-stone-400 pt-3">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-700">
              Итого к оплате
            </span>
            <span className="font-editorial text-2xl tabular-nums text-stone-950 sm:text-[2rem]">
              {formatProposalMoney(finalTotal)}
            </span>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            onClick={() => void createPdf()}
            disabled={pdfState === "working"}
            className="min-h-11 flex-1 bg-stone-950 px-5 text-sm font-semibold text-[#f7f4ec] transition-colors hover:bg-[#6d7565] disabled:cursor-wait disabled:bg-stone-400 sm:flex-none sm:min-w-[11rem]"
          >
            {pdfState === "working" ? "Формируется PDF…" : "Скачать PDF"}
          </button>
          <button
            type="button"
            onClick={() => setCoverOpen(true)}
            className="min-h-11 flex-1 border border-stone-800 px-5 text-sm font-medium text-stone-900 transition-colors hover:bg-stone-900 hover:text-stone-50 sm:flex-none sm:min-w-[11rem]"
          >
            Сопроводительное сообщение
          </button>
        </div>
        {pdfState === "failed" ? (
          <p role="alert" className="mt-3 text-sm text-stone-700">
            Не удалось сформировать PDF. Попробуйте ещё раз.
          </p>
        ) : null}
      </section>

      <ProposalCoverMessage open={coverOpen} />
    </main>
  );
}

function CollapsibleSection({
  summary,
  panelLabel,
  children,
  className = "",
}: {
  summary: string;
  panelLabel: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = `${panelLabel.replace(/\s+/g, "-")}-panel`;

  return (
    <div className={`border border-stone-300 ${className}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm text-stone-800 transition-colors hover:bg-[#f8f6f0]"
      >
        <span>{summary}</span>
        <ChevronIcon open={open} />
      </button>
      {open ? (
        <div id={panelId} className="disclosure-panel border-t border-stone-200 px-3 pb-3 pt-2">
          <span className="sr-only">{panelLabel}</span>
          {children}
        </div>
      ) : null}
    </div>
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
    <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-stone-600">
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
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-3 py-2">
        {heading ?? <h3 className="text-sm font-medium text-stone-950">{title}</h3>}
        {items.length > 0 ? (
          <p className="text-xs text-stone-600">
            <span className="tabular-nums font-medium text-stone-900">
              {formatProposalMoney(total)}
            </span>
          </p>
        ) : null}
      </div>
      {items.length > 0 ? (
        <ul className="divide-y divide-stone-200">{children}</ul>
      ) : (
        <p className="px-3 py-1.5 text-xs text-stone-500">Нет позиций</p>
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
    <div className="flex flex-1 flex-wrap items-center gap-2">
      <DraftInput
        value={room.name}
        ariaLabel={`Название помещения ${room.name}`}
        onCommit={onRename}
        className="max-w-[14rem] text-sm font-medium"
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Удалить помещение ${room.name}`}
        className="inline-flex min-h-8 min-w-8 items-center justify-center border border-stone-300 text-stone-600 transition-colors hover:border-stone-800 hover:text-stone-950"
      >
        <TrashIcon />
      </button>
    </div>
  );
}

function ItemRow({
  item,
  position,
  rooms,
  canMoveUp,
  canMoveDown,
  expanded,
  onToggleExpand,
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
  expanded: boolean;
  onToggleExpand: () => void;
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
  const shownPrice = clientUnitPrice(item, roundingStep, roundingMode);
  const shownAmount = clientLineAmount(item, roundingStep, roundingMode);
  const roomLabel =
    item.room === null
      ? null
      : (rooms.find((room) => room.id === item.room)?.name ?? null);

  return (
    <li className="px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 gap-y-1">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={
            expanded ? `Свернуть позицию ${position}` : `Развернуть позицию ${position}`
          }
          onClick={onToggleExpand}
          className="inline-flex min-h-8 min-w-8 shrink-0 items-center justify-center border border-stone-200 text-stone-600 hover:border-stone-500"
        >
          <ChevronIcon open={expanded} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-stone-950">{item.title}</p>
          <p className="text-xs text-stone-600">
            {[dimensions, `${item.quantity} шт.`, roomLabel].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="w-[5.5rem] shrink-0">
          <CompactNumberField
            label={`Цена за единицу позиции ${position}`}
            value={shownPrice}
            onCommit={onPrice}
            allowZero
          />
        </div>
        <p className="w-[5.5rem] shrink-0 text-right text-sm tabular-nums text-stone-950">
          {formatProposalMoney(shownAmount)}
        </p>
        <div className="flex shrink-0 gap-0.5">
          <IconButton
            label={`Выше позиции ${position}`}
            disabled={!canMoveUp}
            onClick={() => onMove("up")}
          >
            <ArrowUpIcon />
          </IconButton>
          <IconButton
            label={`Ниже позиции ${position}`}
            disabled={!canMoveDown}
            onClick={() => onMove("down")}
          >
            <ArrowDownIcon />
          </IconButton>
          <IconButton label={`Удалить позицию ${position}`} onClick={onRemove}>
            <TrashIcon />
          </IconButton>
        </div>
      </div>
      {expanded ? (
        <div className="mt-2 border-t border-stone-100 pt-2 pl-10">
          <DraftInput
            value={item.title}
            ariaLabel={`Название позиции ${position}`}
            onCommit={onTitle}
            className="text-sm font-medium"
          />
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <NumberField
              label={`Количество позиции ${position}`}
              visibleLabel="Количество"
              value={item.quantity}
              onCommit={onQuantity}
              allowZero={false}
            />
            {roundMoney(shownPrice) !== roundMoney(item.originalUnitPrice) && (
              <p className="self-end pb-1 text-xs text-stone-500 sm:col-span-2">
                Исходная цена {formatRubles(item.originalUnitPrice)}
              </p>
            )}
          </div>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            {item.productType === null && (
              <label className="block text-xs text-stone-600 sm:min-w-36">
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
            <label className="block flex-1 text-xs text-stone-600">
              Помещение
              <select
                aria-label={`Помещение позиции ${position}`}
                value={item.room ?? ""}
                onChange={(event) => onRoom(event.target.value || null)}
                className={fieldClass}
              >
                <option value="">{UNASSIGNED_ROOM_LABEL}</option>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex min-h-8 min-w-8 items-center justify-center border border-stone-200 text-stone-600 transition-colors hover:border-stone-700 hover:text-stone-950 disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
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

function CompactNumberField({
  label,
  value,
  onCommit,
  allowZero,
}: {
  label: string;
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
      className="w-full border border-stone-300 bg-transparent px-2 py-1 text-right text-sm tabular-nums text-stone-950 outline-none focus:border-stone-800"
    />
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

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 14 14"
      className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
    >
      <path
        d="M3 5l4 4 4-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M2.5 4h9M5.5 4V3a1 1 0 011-1h1a1 1 0 011 1v1M5 4v7.5a1 1 0 001 1h2a1 1 0 001-1V4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M7 10V4M4.5 6.5L7 4l2.5 2.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowDownIcon() {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M7 4v6M4.5 7.5L7 10l2.5-2.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

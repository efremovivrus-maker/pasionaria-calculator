"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { deleteKpPhoto, KP_PHOTO_MAX_BYTES, readKpPhoto, saveKpPhoto } from "@/lib/kpPhotoStore";
import { normalizeMediaName } from "@/lib/mediaMatch";
import { catalogPhotoMatchesColor } from "@/lib/proposalDocument";
import type { ProposalItem } from "@/lib/proposal";

const fieldClass =
  "mt-1.5 w-full border border-stone-300 bg-transparent px-3 py-1.5 text-sm text-stone-950 outline-none focus:border-stone-800";

type MediaOffer = {
  offerId: string;
  model: string;
  color: string | null;
  cover: string | null;
  images: string[];
};

type PendingPhoto = {
  offerId: string;
  image: string;
  color: string | null;
};

export function ProposalItemThumb({ item }: { item: ProposalItem }) {
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!item.sessionPhotoId) {
      setUploadPreview(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    void readKpPhoto(item.sessionPhotoId).then((blob) => {
      if (cancelled || !blob) {
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      setUploadPreview(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [item.sessionPhotoId]);

  const catalogBlocked =
    Boolean(item.mediaImageUrl) && !item.sessionPhotoId && !catalogPhotoMatchesColor(item);
  const src = uploadPreview
    ? uploadPreview
    : item.mediaImageUrl && !catalogBlocked
      ? `/api/media/image?url=${encodeURIComponent(item.mediaImageUrl)}`
      : null;
  if (!src) {
    return null;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className="h-10 w-10 shrink-0 border border-stone-200 object-contain" />
  );
}

export function ProposalItemDetails({
  item,
  position,
  onChange,
}: {
  item: ProposalItem;
  position: number;
  onChange: (patch: Partial<ProposalItem>) => void;
}) {
  const [colors, setColors] = useState<string[]>([]);
  const [offers, setOffers] = useState<MediaOffer[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState<PendingPhoto | null>(null);
  const [colorFilter, setColorFilter] = useState("");
  const [matchStatus, setMatchStatus] = useState<string | null>(null);
  const [mediaNote, setMediaNote] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const photosRequested = useRef(false);
  const [fabrics, setFabrics] = useState<string[]>([]);
  const [dayState, setDayState] = useState<string | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const dayNight =
    item.productType === "roman" &&
    /день[-\s]?ночь/i.test(item.configuration.mechanism ?? "");
  const colorValue = item.fabricColor ?? "";
  const knownColor = colors.some(
    (color) => color.toLocaleLowerCase("ru") === colorValue.trim().toLocaleLowerCase("ru"),
  );

  useEffect(() => {
    const fabric = item.configuration.faceFabric || item.configuration.fabricName;
    if (!fabric) {
      setColors([]);
      return;
    }
    const controller = new AbortController();
    void fetch(`/api/fabric-colors?fabric=${encodeURIComponent(fabric)}`, {
      signal: controller.signal,
    })
      .then((response) => response.json())
      .then((payload: { colors?: string[] }) => setColors(payload.colors ?? []))
      .catch(() => setColors([]));
    return () => controller.abort();
  }, [item.configuration.faceFabric, item.configuration.fabricName]);

  useEffect(() => {
    if (!dayNight) {
      return;
    }
    const controller = new AbortController();
    void fetch("/api/fabrics", { signal: controller.signal })
      .then((response) => response.json())
      .then((payload: { names?: string[] }) => setFabrics(payload.names ?? []))
      .catch(() => setFabrics([]));
    return () => controller.abort();
  }, [dayNight]);

  useEffect(() => {
    if (!item.sessionPhotoId) {
      setUploadPreview(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    void readKpPhoto(item.sessionPhotoId).then((blob) => {
      if (cancelled || !blob) {
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      setUploadPreview(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [item.sessionPhotoId]);

  const loadPhotos = useCallback(async () => {
    photosRequested.current = true;
    setMediaError(null);
    setMediaNote(null);
    if (!item.model) {
      setMatchStatus("none");
      setOffers([]);
      return;
    }
    const params = new URLSearchParams({ model: item.model });
    if (item.productType) {
      params.set("productType", item.productType);
    }
    if (item.fabricColor?.trim()) {
      params.set("color", item.fabricColor.trim());
    }
    const response = await fetch(`/api/media/offers?${params.toString()}`);
    const payload = (await response.json()) as {
      offers?: MediaOffer[];
      status?: string;
      error?: string;
    };
    if (!response.ok) {
      setMediaError("Каталог фотографий сейчас недоступен.");
      setMatchStatus("none");
      setOffers([]);
      return;
    }
    const status = payload.status ?? "none";
    setMatchStatus(status);
    if (status === "color-missing") {
      setMediaNote("Для выбранного цвета нет фотографии этого изделия. Другой цвет не подставлен.");
      setOffers([]);
      return;
    }
    if (status === "ambiguous") {
      setMediaNote("Несколько категорий изделия. Выберите фото вручную.");
    }
    setOffers(payload.offers ?? []);
  }, [item.fabricColor, item.model, item.productType]);

  useEffect(() => {
    if (!photosRequested.current) {
      return;
    }
    void loadPhotos();
  }, [loadPhotos]);

  async function uploadPhoto(file: File) {
    if (file.size > KP_PHOTO_MAX_BYTES) {
      setMediaError("Файл больше 2 МБ.");
      return;
    }
    const id = await saveKpPhoto(file);
    if (!id) {
      setMediaError("Нужен файл JPG, PNG или WebP.");
      return;
    }
    if (item.sessionPhotoId && item.sessionPhotoId !== id) {
      await deleteKpPhoto(item.sessionPhotoId);
    }
    onChange({ sessionPhotoId: id, mediaOfferId: null, mediaImageUrl: null, mediaColor: null });
    setMediaError(null);
  }

  async function changeDayFabric(name: string) {
    setDayState(null);
    const response = await fetch("/api/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product_type: "roman",
        model: item.model,
        width_cm: item.widthCm,
        height_cm: item.heightCm,
        quantity: item.quantity,
        configuration: {
          heading: item.configuration.heading,
          mechanism: item.configuration.mechanism,
          lining: item.configuration.lining,
          mounting: item.configuration.mounting,
        },
        day_fabric: name,
        face_fabric: item.configuration.faceFabric,
        extra_operations: item.configuration.extraOperations,
      }),
    });
    const payload = (await response.json()) as {
      status?: string;
      retail_price?: number;
      day_fabric?: { name?: string };
      error?: string;
    };
    if (!response.ok || payload.status !== "success" || typeof payload.retail_price !== "number") {
      setDayState("Не удалось пересчитать дневную ткань. Цена не изменена.");
      return;
    }
    const unit = Math.round((payload.retail_price / item.quantity) * 100) / 100;
    onChange({
      unitPrice: unit,
      originalUnitPrice: unit,
      configuration: {
        ...item.configuration,
        dayFabric: payload.day_fabric?.name ?? name,
      },
    });
  }

  const catalogColorMismatch = Boolean(item.mediaImageUrl) && !item.sessionPhotoId && !catalogPhotoMatchesColor(item);
  const preview = uploadPreview
    ? uploadPreview
    : item.mediaImageUrl && !catalogColorMismatch
      ? `/api/media/image?url=${encodeURIComponent(item.mediaImageUrl)}`
      : null;

  return (
    <div className="mt-3 space-y-3 border-t border-stone-100 pt-3">
      <label className="block text-xs text-stone-600">
        Цвет ткани
        <input
          aria-label={`Цвет ткани позиции ${position}`}
          list={`fabric-colors-${item.id}`}
          value={colorValue}
          onChange={(event) => {
            const next = event.target.value;
            const custom = !colors.some(
              (color) => color.toLocaleLowerCase("ru") === next.trim().toLocaleLowerCase("ru"),
            );
            onChange({
              fabricColor: next.trim() ? next : null,
              fabricColorCustom: Boolean(next.trim()) && custom,
            });
          }}
          className={fieldClass}
        />
        <datalist id={`fabric-colors-${item.id}`}>
          {colors.map((color) => (
            <option key={color} value={color} />
          ))}
        </datalist>
      </label>
      {colorValue.trim() && !knownColor ? (
        <p className="text-xs text-stone-500">Вне каталога</p>
      ) : null}

      {dayNight ? (
        <label className="block text-xs text-stone-600">
          Дневная ткань
          <select
            aria-label={`Дневная ткань позиции ${position}`}
            value={item.configuration.dayFabric ?? "Вита"}
            onChange={(event) => void changeDayFabric(event.target.value)}
            className={fieldClass}
          >
            {(fabrics.length > 0 ? fabrics : ["Вита"]).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {dayState ? <p className="text-xs text-stone-600">{dayState}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setPickerOpen(true);
            setPending(null);
            setColorFilter("");
            void loadPhotos();
          }}
          className="min-h-9 border border-stone-300 px-2.5 text-xs text-stone-800 hover:border-stone-800"
        >
          Выбрать фото
        </button>
        <label className="min-h-9 cursor-pointer border border-stone-300 px-2.5 text-xs leading-9 text-stone-800 hover:border-stone-800">
          Загрузить фото
          <input
            aria-label={`Загрузить фото позиции ${position}`}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) {
                void uploadPhoto(file);
              }
            }}
          />
        </label>
        {preview ? (
          <button
            type="button"
            onClick={() => {
              if (item.sessionPhotoId) {
                void deleteKpPhoto(item.sessionPhotoId);
              }
              onChange({ sessionPhotoId: null, mediaOfferId: null, mediaImageUrl: null, mediaColor: null });
            }}
            className="min-h-9 px-2 text-xs text-stone-600 underline"
          >
            Удалить фото
          </button>
        ) : null}
      </div>
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="" className="h-16 w-16 object-contain" />
      ) : null}
      {mediaError ? <p className="text-xs text-stone-600">{mediaError}</p> : null}
      {mediaNote ? <p className="text-xs text-stone-600">{mediaNote}</p> : null}
      {catalogColorMismatch ? (
        <p className="text-xs text-stone-600">
          Для выбранного цвета нет фотографии этого изделия. Другой цвет не подставлен.
        </p>
      ) : null}
      {pickerOpen ? (
        <PhotoPicker
          item={item}
          offers={offers}
          status={matchStatus}
          note={mediaNote}
          error={mediaError}
          colorFilter={colorFilter}
          pending={pending}
          onFilter={setColorFilter}
          onPending={setPending}
          onClose={() => setPickerOpen(false)}
          onConfirm={(photo) => {
            if (item.sessionPhotoId) {
              void deleteKpPhoto(item.sessionPhotoId);
            }
            onChange({
              mediaOfferId: photo.offerId,
              mediaImageUrl: photo.image,
              mediaColor: photo.color,
              sessionPhotoId: null,
            });
            setPickerOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function PhotoPicker({
  item,
  offers,
  status,
  note,
  error,
  colorFilter,
  pending,
  onFilter,
  onPending,
  onClose,
  onConfirm,
}: {
  item: ProposalItem;
  offers: MediaOffer[] | null;
  status: string | null;
  note: string | null;
  error: string | null;
  colorFilter: string;
  pending: PendingPhoto | null;
  onFilter: (color: string) => void;
  onPending: (photo: PendingPhoto) => void;
  onClose: () => void;
  onConfirm: (photo: PendingPhoto) => void;
}) {
  const lockedColor = item.fabricColor?.trim() ?? "";
  const colors = lockedColor
    ? []
    : [...new Set((offers ?? []).map((offer) => offer.color?.trim()).filter((color): color is string => Boolean(color)))];
  const visible = (offers ?? []).filter((offer) => {
    if (lockedColor || !colorFilter.trim()) {
      return true;
    }
    return offer.color !== null && normalizeMediaName(offer.color) === normalizeMediaName(colorFilter);
  });

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/40 p-3 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Фотографии ${item.model ?? item.title}`}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col border border-stone-300 bg-[#f8f6f0]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-stone-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-medium text-stone-950">Выбор фотографии</h2>
            <p className="mt-1 text-xs text-stone-600">{item.title}</p>
          </div>
          <button type="button" onClick={onClose} className="text-xs text-stone-600 underline">
            Закрыть
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {lockedColor ? <p className="text-xs text-stone-700">Цвет: {lockedColor}</p> : null}
          {!lockedColor && colors.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => onFilter("")}
                className={`min-h-8 border px-2 text-xs ${colorFilter ? "border-stone-300 text-stone-700" : "border-stone-900 text-stone-950"}`}
              >
                Все цвета
              </button>
              {colors.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => onFilter(color)}
                  className={`min-h-8 border px-2 text-xs ${normalizeMediaName(colorFilter) === normalizeMediaName(color) ? "border-stone-900 text-stone-950" : "border-stone-300 text-stone-700"}`}
                >
                  {color}
                </button>
              ))}
            </div>
          ) : null}
          {offers === null && !error ? (
            <p className="mt-3 text-xs text-stone-500">Загрузка фотографий…</p>
          ) : null}
          {error ? <p className="mt-3 text-xs text-stone-600">{error}</p> : null}
          {note ? <p className="mt-3 text-xs text-stone-600">{note}</p> : null}
          {offers && visible.length === 0 && status === "none" ? (
            <p className="mt-3 text-xs text-stone-500">Нет точного совпадения модели в медиакаталоге.</p>
          ) : null}
          {visible.length > 0 ? (
            <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {visible.flatMap((offer) => {
                const seen = new Set<string>();
                return (offer.images.length > 0 ? offer.images : offer.cover ? [offer.cover] : []).flatMap(
                  (image) => {
                    if (seen.has(image)) {
                      return [];
                    }
                    seen.add(image);
                    const selected = pending?.image === image && pending.offerId === offer.offerId;
                    return [
                      <li key={`${offer.offerId}:${image}`}>
                        <button
                          type="button"
                          aria-pressed={selected}
                          aria-label={`Фото ${offer.color ?? offer.model}`}
                          onClick={() => onPending({ offerId: offer.offerId, image, color: offer.color })}
                          className={`w-full border p-2 text-left ${selected ? "border-stone-950" : "border-stone-200"}`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/media/image?url=${encodeURIComponent(image)}`}
                            alt=""
                            className="h-36 w-full object-contain"
                          />
                          <p className="mt-1 text-xs text-stone-700">
                            {[offer.color, offer.model].filter(Boolean).join(" · ")}
                          </p>
                        </button>
                      </li>,
                    ];
                  },
                );
              })}
            </ul>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-stone-200 px-4 py-3">
          <button type="button" onClick={onClose} className="min-h-9 border border-stone-300 px-3 text-xs">
            Отмена
          </button>
          <button
            type="button"
            disabled={!pending}
            onClick={() => pending && onConfirm(pending)}
            className="min-h-9 border border-stone-900 px-3 text-xs text-stone-950 disabled:opacity-40"
          >
            Использовать фото
          </button>
        </div>
      </div>
    </div>
  );
}

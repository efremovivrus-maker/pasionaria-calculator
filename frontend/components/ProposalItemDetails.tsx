"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { deleteKpPhoto, KP_PHOTO_MAX_BYTES, readKpPhoto, saveKpPhoto } from "@/lib/kpPhotoStore";
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
          onClick={() => void loadPhotos()}
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
      {offers && offers.length === 0 && matchStatus === "none" ? (
        <p className="text-xs text-stone-500">
          Нет точного совпадения модели в медиакаталоге.
        </p>
      ) : null}
      {offers && offers.length > 0 ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {offers.map((offer) => (
            <li key={offer.offerId} className="border border-stone-200 p-2">
              <p className="text-xs text-stone-700">
                {[offer.color, offer.model].filter(Boolean).join(" · ")}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {(offer.images.length > 0 ? offer.images : offer.cover ? [offer.cover] : []).map(
                  (image, index) => (
                    <button
                      key={image}
                      type="button"
                      aria-label={
                        index === 0
                          ? `Заглавное фото ${offer.color ?? offer.model}`
                          : `Фото ${index + 1} ${offer.color ?? offer.model}`
                      }
                      onClick={() => {
                        if (item.sessionPhotoId) {
                          void deleteKpPhoto(item.sessionPhotoId);
                        }
                        onChange({
                          mediaOfferId: offer.offerId,
                          mediaImageUrl: image,
                          mediaColor: offer.color,
                          sessionPhotoId: null,
                        });
                      }}
                      className="h-12 w-12 border border-stone-200"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/media/image?url=${encodeURIComponent(image)}`}
                        alt=""
                        className="h-full w-full object-contain"
                      />
                    </button>
                  ),
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

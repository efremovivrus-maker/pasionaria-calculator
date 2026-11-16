"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useProposal } from "@/components/ProposalProvider";
import { ACCOUNT_LINK_KEY } from "@/lib/account/browser";
import { readKpPhoto } from "@/lib/kpPhotoStore";
import {
  AUTOSAVE_DELAY_MS,
  accountEnabledInBrowser,
  localDraftCanBeImported,
  savePhase,
  savePhaseLabel,
} from "@/lib/account/rules";

type LinkState = { id: string; version: number };

function readLink(): LinkState | null {
  try {
    const raw = sessionStorage.getItem(ACCOUNT_LINK_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<LinkState>;
    return typeof parsed.id === "string" && typeof parsed.version === "number"
      ? { id: parsed.id, version: parsed.version }
      : null;
  } catch {
    return null;
  }
}

export function ProposalSaveControl() {
  const { proposal, hydrated } = useProposal();
  const enabled = accountEnabledInBrowser();
  const [signedIn, setSignedIn] = useState(false);
  const [link, setLink] = useState<LinkState | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState(false);
  const [conflict, setConflict] = useState(false);
  const armed = useRef(false);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    setLink(readLink());
    void fetch("/api/account/session")
      .then((response) => setSignedIn(response.ok))
      .catch(() => setSignedIn(false));
  }, [enabled]);

  const persistRef = useRef(persist);
  persistRef.current = persist;

  useEffect(() => {
    if (!enabled || !hydrated || !link || conflict) {
      return;
    }
    if (!armed.current) {
      armed.current = true;
      return;
    }
    setDirty(true);
    const timer = window.setTimeout(() => {
      void persistRef.current(link);
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [proposal, hydrated, link, enabled, conflict]);

  if (!enabled) {
    return null;
  }

  async function persist(current = link) {
    setSaving(true);
    setError(false);
    const items = await Promise.all(
      proposal.items.map(async (item) => {
        if (!item.sessionPhotoId || item.storedPhotoId) {
          return item;
        }
        const blob = await readKpPhoto(item.sessionPhotoId);
        if (!blob) {
          return item;
        }
        const form = new FormData();
        form.set("file", new File([blob], "photo", { type: blob.type || "image/jpeg" }));
        const uploaded = await fetch("/api/account/photos", { method: "POST", body: form });
        if (!uploaded.ok) {
          return item;
        }
        const saved = (await uploaded.json()) as { id?: string };
        return saved.id ? { ...item, storedPhotoId: saved.id } : item;
      }),
    );
    const response = await fetch(current ? `/api/account/proposals/${current.id}` : "/api/account/proposals", {
      method: current ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposal: { ...proposal, items }, version: current?.version }),
    });
    setSaving(false);
    if (response.status === 409) {
      setConflict(true);
      setDirty(true);
      return;
    }
    if (!response.ok) {
      setError(true);
      return;
    }
    const body = (await response.json()) as { proposal?: { id?: string; version?: number } };
    const next = {
      id: body.proposal?.id ?? current?.id ?? "",
      version: body.proposal?.version ?? (current ? current.version + 1 : 1),
    };
    if (!next.id) {
      setError(true);
      return;
    }
    sessionStorage.setItem(ACCOUNT_LINK_KEY, JSON.stringify(next));
    setLink(next);
    setDirty(false);
    setConflict(false);
  }

  if (!signedIn) {
    return (
      <Link href="/account/login" className="inline-flex min-h-11 items-center border border-stone-800 px-5 text-sm">
        Войти, чтобы сохранить
      </Link>
    );
  }

  const phase = savePhase({ dirty, saving, error, conflict });
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <button
        type="button"
        onClick={() => void persist()}
        disabled={saving}
        className="min-h-11 border border-stone-800 px-5 text-sm font-medium text-stone-900 hover:bg-stone-900 hover:text-stone-50 disabled:cursor-wait"
      >
        Сохранить
      </button>
      <span className="text-xs text-stone-600">{link || dirty || error || conflict ? savePhaseLabel(phase) : "Черновик на этом устройстве"}</span>
      {!link && localDraftCanBeImported(proposal) ? (
        <button type="button" onClick={() => void persist(null)} className="text-xs text-stone-700 underline">
          Перенести в аккаунт
        </button>
      ) : null}
    </div>
  );
}

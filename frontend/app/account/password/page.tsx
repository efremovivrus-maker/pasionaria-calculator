"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export default function PasswordPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: currentPassword || undefined,
        nextPassword,
      }),
    });
    setCurrentPassword("");
    setNextPassword("");
    if (!response.ok) {
      setMessage("Не удалось сменить пароль. Проверьте текущий пароль.");
      return;
    }
    window.location.href = "/account/documents";
  }

  return (
    <main className="mx-auto min-h-screen max-w-md px-5 py-16 text-stone-900">
      <Link href="/" className="text-xs text-stone-600 underline">
        ← К калькулятору
      </Link>
      <h1 className="mt-6 text-3xl">Новый пароль</h1>
      <p className="mt-3 text-sm text-stone-600">
        Временный пароль нужно сменить до работы с документами. Если вы перешли по письму
        восстановления, текущий пароль можно не заполнять.
      </p>
      <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-3">
        <label className="block text-sm">
          Текущий пароль
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            className="mt-1 w-full border border-stone-300 bg-transparent px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          Новый пароль
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={nextPassword}
            onChange={(event) => setNextPassword(event.target.value)}
            className="mt-1 w-full border border-stone-300 bg-transparent px-3 py-2"
          />
        </label>
        <button type="submit" className="min-h-11 bg-stone-950 px-5 text-sm text-[#f7f4ec]">
          Сохранить пароль
        </button>
      </form>
      <p className="mt-3 text-sm text-stone-600">{message}</p>
    </main>
  );
}

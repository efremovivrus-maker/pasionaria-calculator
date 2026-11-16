"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

import { accountBrowser } from "@/lib/account/browser";
import { accountEnabledInBrowser } from "@/lib/account/rules";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const enabled = accountEnabledInBrowser();
  const client = accountBrowser();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!client) {
      setMessage("Вход ещё не настроен.");
      return;
    }
    const result = await client.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setPassword("");
    if (result.error) {
      setMessage("Неверный email или пароль.");
      return;
    }
    const session = await fetch("/api/account/session");
    if (session.status === 403) {
      await client.auth.signOut();
      setMessage("Учётная запись отключена.");
      return;
    }
    if (!session.ok) {
      await client.auth.signOut();
      setMessage("Не удалось открыть сессию.");
      return;
    }
    const body = (await session.json()) as { profile?: { must_change_password?: boolean } };
    window.location.href = body.profile?.must_change_password
      ? "/account/password"
      : "/account/documents";
  }

  async function recover(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/account/recovery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const body = (await response.json()) as { message?: string };
    setMessage(body.message ?? "Не удалось отправить письмо.");
  }

  return (
    <main className="mx-auto min-h-screen max-w-md px-5 py-16 text-stone-900">
      <Link href="/" className="text-xs text-stone-600 underline">
        ← К калькулятору
      </Link>
      <h1 className="mt-6 text-3xl text-stone-950">Вход</h1>
      {!enabled || !client ? (
        <p className="mt-4 text-sm leading-relaxed text-stone-700">
          Авторизация выключена или база ещё не подключена. Калькулятор по-прежнему доступен без входа.
        </p>
      ) : (
        <>
          <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-3">
            <label className="block text-sm">
              Email
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1 w-full border border-stone-300 bg-transparent px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              Пароль
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 w-full border border-stone-300 bg-transparent px-3 py-2"
              />
            </label>
            <button type="submit" className="min-h-11 bg-stone-950 px-5 text-sm text-[#f7f4ec]">
              Войти
            </button>
          </form>
          <form onSubmit={(event) => void recover(event)} className="mt-6">
            <button type="submit" className="text-sm text-stone-700 underline">
              Забыли пароль
            </button>
          </form>
          <p className="mt-3 text-sm text-stone-600">{message}</p>
        </>
      )}
    </main>
  );
}

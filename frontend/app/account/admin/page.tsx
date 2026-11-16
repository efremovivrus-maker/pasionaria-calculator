"use client";

import { FormEvent, useEffect, useState } from "react";

import { AccountFrame } from "@/components/AccountDocuments";

type Profile = { id: string; email: string; display_name: string; role: string; active: boolean };

function ResetPassword({ id }: { id: string }) {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  async function reset(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/account/admin/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, password }),
    });
    setPassword("");
    setMessage(response.ok ? "Временный пароль назначен." : "Не удалось сбросить пароль.");
  }

  return (
    <form onSubmit={(event) => void reset(event)} className="flex flex-wrap items-center gap-2">
      <input
        type="password"
        required
        minLength={8}
        autoComplete="new-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder="Временный пароль"
        className="border border-stone-300 px-2 py-1 text-sm"
      />
      <button type="submit" className="underline">
        Сбросить пароль
      </button>
      {message ? <span className="text-xs text-stone-500">{message}</span> : null}
    </form>
  );
}

export default function AdminPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  function load() {
    void fetch("/api/account/admin")
      .then(async (response) => (response.ok ? (response.json() as Promise<{ profiles: Profile[] }>) : null))
      .then((body) => setProfiles(body?.profiles ?? []))
      .catch(() => setMessage("Список пользователей недоступен."));
  }

  useEffect(() => {
    load();
  }, []);

  async function invite(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/account/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setPassword("");
    setMessage(response.ok ? "Пользователь создан. Передайте временный пароль лично." : "Не удалось создать пользователя.");
    if (response.ok) {
      setEmail("");
      load();
    }
  }

  return (
    <AccountFrame title="Пользователи">
      <form onSubmit={(event) => void invite(event)} className="mb-6 flex flex-wrap gap-2">
        <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="border border-stone-300 px-3 py-2 text-sm" placeholder="email менеджера" />
        <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="border border-stone-300 px-3 py-2 text-sm" placeholder="временный пароль" />
        <button type="submit" className="bg-stone-950 px-3 text-sm text-[#f7f4ec]">Создать</button>
      </form>
      {message ? <p className="mb-3 text-sm">{message}</p> : null}
      <ul className="divide-y divide-stone-300 border-y border-stone-300 text-sm">
        {profiles.map((profile) => (
          <li key={profile.id} className="flex items-center justify-between gap-3 py-3">
            <span>{profile.email} · {profile.role}</span>
            <ResetPassword id={profile.id} />
            <button
              type="button"
              className="underline"
              onClick={() =>
                void fetch("/api/account/admin", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ id: profile.id, active: !profile.active }),
                }).then(load)
              }
            >
              {profile.active ? "Отключить" : "Включить"}
            </button>
          </li>
        ))}
      </ul>
    </AccountFrame>
  );
}

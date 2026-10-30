import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "PASIONARIA — Калькулятор текстиля",
  description:
    "Предварительный расчёт стоимости штор, римских штор и текстиля по индивидуальным размерам.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "PASIONARIA — расчёт стоимости штор",
  description:
    "Предварительный расчёт стоимости штор и римских штор по индивидуальным размерам.",
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

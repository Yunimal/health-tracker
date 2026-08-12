import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Health Tracker",
  description: "음성 기반 개인 헬스 트래커 (Phase 0)",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body className="bg-white text-gray-900 antialiased">{children}</body>
    </html>
  );
}

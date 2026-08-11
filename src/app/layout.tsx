import type { ReactNode } from "react";

export const metadata = {
  title: "Health Tracker",
  description: "음성 기반 개인 헬스 트래커 (Phase 0)",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}

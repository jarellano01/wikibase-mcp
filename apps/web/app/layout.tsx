import type { Metadata } from "next";
import { Header } from "./components/Header";

export const metadata: Metadata = {
  title: "AI Wiki",
  description: "Personal AI knowledge base",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", maxWidth: 1200, margin: "0 auto", padding: "0 2rem" }}>
        <Header />
        {children}
      </body>
    </html>
  );
}

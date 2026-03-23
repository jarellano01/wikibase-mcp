"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function Header() {
  const pathname = usePathname();
  const isEntry = pathname.startsWith("/entries/");

  return (
    <header style={{ borderBottom: "1px solid #f3f4f6" }}>
      <div style={{
        maxWidth: 1080,
        margin: "0 auto",
        padding: "0 1.5rem",
        height: 56,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <Link
          href="/"
          style={{ fontWeight: 700, fontSize: "0.9375rem", letterSpacing: "-0.02em", color: "#111827" }}
        >
          AI Wiki
        </Link>
        {isEntry && (
          <Link href="/" style={{ fontSize: "0.8125rem", color: "#9ca3af" }}>
            ← All posts
          </Link>
        )}
      </div>
    </header>
  );
}

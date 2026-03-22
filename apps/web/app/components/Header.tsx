"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function Header() {
  const pathname = usePathname();
  const isEntry = pathname.startsWith("/entries/");

  return (
    <header style={{
      position: "sticky",
      top: 0,
      background: "#fff",
      borderBottom: "1px solid #eee",
      padding: "1rem 0",
      marginBottom: "2rem",
      zIndex: 10,
      display: "flex",
      alignItems: "center",
      gap: "1.5rem",
    }}>
      <h1 style={{ margin: 0 }}>AI Wiki</h1>
      {isEntry && (
        <Link href="/" style={{ color: "#888", fontSize: "0.9rem", textDecoration: "none" }}>
          ← Back
        </Link>
      )}
    </header>
  );
}

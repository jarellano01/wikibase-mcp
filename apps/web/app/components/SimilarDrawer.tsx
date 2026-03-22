"use client";
import Link from "next/link";
import { useState, useEffect } from "react";
import type { Entry } from "@ai-wiki/db";

export function SimilarDrawer({ similar }: { similar: Entry[] }) {
  const [isMobile, setIsMobile] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
      if (!e.matches) setOpen(false);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (similar.length === 0) return null;

  const list = (
    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {similar.map((e) => (
        <li key={e.id}>
          <Link
            href={`/entries/${e.id}`}
            style={{ fontWeight: 500, fontSize: "0.9rem", display: "block" }}
            onClick={() => setOpen(false)}
          >
            {e.title}
          </Link>
          <span style={{ color: "#aaa", fontSize: "0.75rem" }}>{e.type}</span>
          {e.summary && (
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.8rem", color: "#888", lineHeight: 1.5 }}>
              {e.summary}
            </p>
          )}
        </li>
      ))}
    </ul>
  );

  // Desktop: sticky sidebar
  if (!isMobile) {
    return (
      <aside style={{
        width: 280,
        flexShrink: 0,
        position: "sticky",
        top: 0,
        maxHeight: "calc(100vh - 5rem)",
        overflowY: "auto",
        borderLeft: "1px solid #eee",
        paddingLeft: "1.5rem",
      }}>
        <h3 style={{ fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "#aaa", margin: "0 0 1rem" }}>
          Similar entries
        </h3>
        {list}
      </aside>
    );
  }

  // Mobile: floating button + drawer
  return (
    <>
      {/* Floating trigger button */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Show similar entries"
        style={{
          position: "fixed",
          bottom: "1.5rem",
          right: "1.5rem",
          width: 48,
          height: 48,
          borderRadius: "50%",
          background: "#333",
          color: "#fff",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 2px 12px rgba(0,0,0,0.2)",
          zIndex: 40,
        }}
      >
        {/* Link/related icon */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
        </svg>
      </button>

      {/* Backdrop */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.3)",
            zIndex: 50,
          }}
        />
      )}

      {/* Drawer */}
      <div style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: "min(85vw, 360px)",
        background: "#fff",
        zIndex: 60,
        transform: open ? "translateX(0)" : "translateX(100%)",
        transition: "transform 0.25s ease",
        display: "flex",
        flexDirection: "column",
        boxShadow: "-4px 0 24px rgba(0,0,0,0.12)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1.25rem 1.25rem 1rem", borderBottom: "1px solid #eee" }}>
          <h3 style={{ margin: 0, fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "#aaa" }}>
            Similar entries
          </h3>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close"
            style={{ background: "none", border: "none", cursor: "pointer", color: "#888", padding: 4, lineHeight: 1 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "1.25rem" }}>
          {list}
        </div>
      </div>
    </>
  );
}

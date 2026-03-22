"use client";
import Link from "next/link";
import { useState, useMemo } from "react";
import type { Entry } from "@ai-wiki/db";

const ENTRY_TYPES = ["note", "idea", "article", "thought", "post"];

const pill = (label: string, onClick: () => void, active = false) => (
  <button
    key={label}
    onClick={onClick}
    style={{
      display: "inline-block",
      padding: "0.2rem 0.6rem",
      borderRadius: 999,
      fontSize: "0.8rem",
      border: "1px solid",
      borderColor: active ? "#333" : "#ddd",
      background: active ? "#333" : "transparent",
      color: active ? "#fff" : "#555",
      cursor: "pointer",
      whiteSpace: "nowrap",
    }}
  >
    {label}
  </button>
);

export function EntryList({ entries }: { entries: Entry[] }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (type && e.type !== type) return false;
      if (activeTags.length > 0 && !activeTags.every((t) => e.tags.includes(t))) return false;
      if (q) {
        const lower = q.toLowerCase();
        return (
          e.title.toLowerCase().includes(lower) ||
          e.content.toLowerCase().includes(lower) ||
          (e.summary ?? "").toLowerCase().includes(lower) ||
          e.tags.some((t) => t.toLowerCase().includes(lower))
        );
      }
      return true;
    });
  }, [entries, q, type, activeTags]);

  const toggleTag = (tag: string) =>
    setActiveTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );

  return (
    <>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search entries..."
        style={{ padding: "0.5rem", width: "100%", fontSize: "1rem", boxSizing: "border-box", marginBottom: "1rem" }}
      />

      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
        {pill("all types", () => setType(""), !type)}
        {ENTRY_TYPES.map((t) => pill(t, () => setType(type === t ? "" : t), type === t))}
      </div>

      {activeTags.length > 0 && (
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
          <span style={{ fontSize: "0.8rem", color: "#888", alignSelf: "center" }}>tags:</span>
          {activeTags.map((tag) => pill(`${tag} ×`, () => toggleTag(tag), true))}
        </div>
      )}

      {filtered.length === 0 ? (
        <p>No entries found.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {filtered.map((entry) => (
            <li key={entry.id} style={{ borderBottom: "1px solid #eee", padding: "1rem 0" }}>
              <Link href={`/entries/${entry.id}`} style={{ fontWeight: "bold", fontSize: "1.1rem" }}>
                {entry.title}
              </Link>
              <span style={{ marginLeft: "0.5rem", color: "#888", fontSize: "0.85rem" }}>{entry.type}</span>
              {entry.type === "post" && (() => {
                const status = (entry.metadata as { status?: string } | null)?.status;
                if (!status) return null;
                const published = status === "published";
                return (
                  <span style={{
                    marginLeft: "0.4rem",
                    fontSize: "0.75rem",
                    padding: "0.1rem 0.4rem",
                    borderRadius: 999,
                    background: published ? "#d1fae5" : "#fef9c3",
                    color: published ? "#065f46" : "#854d0e",
                  }}>
                    {status}
                  </span>
                );
              })()}
              {entry.summary && <p style={{ margin: "0.25rem 0 0", color: "#555" }}>{entry.summary}</p>}
              {entry.tags.length > 0 && (
                <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap", marginTop: "0.4rem" }}>
                  {entry.tags.map((tag) =>
                    pill(tag, () => toggleTag(tag), activeTags.includes(tag))
                  )}
                </div>
              )}
              <div style={{ fontSize: "0.8rem", color: "#aaa", marginTop: "0.25rem" }}>
                {new Date(entry.createdAt).toLocaleDateString()}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { getEntryById, getSimilarEntries, listEntries } from "@ai-wiki/db";
import { SimilarDrawer } from "../../components/SimilarDrawer";

export async function generateStaticParams() {
  const entries = await listEntries(1000);
  return entries.map((e) => ({ id: e.id }));
}


export default async function EntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [entry, similar] = await Promise.all([getEntryById(id), getSimilarEntries(id, 5)]);
  if (!entry) notFound();

  return (
    <div style={{ display: "flex", gap: "3rem", alignItems: "flex-start" }}>
      <main style={{ flex: "1 1 0", minWidth: 0 }}>
        <h2 style={{ marginTop: 0 }}>{entry.title}</h2>
        <div style={{ color: "#888", fontSize: "0.85rem", marginBottom: "1rem" }}>
          {entry.type} · {entry.tags.join(", ")} · {new Date(entry.createdAt).toLocaleDateString()}
        </div>
        {entry.summary && (
          <blockquote style={{ borderLeft: "3px solid #ddd", paddingLeft: "1rem", color: "#555", margin: "0 0 1.5rem" }}>
            {entry.summary}
          </blockquote>
        )}
        <div style={{ lineHeight: 1.7 }}>
          <ReactMarkdown components={{
            pre: ({ children }) => (
              <pre style={{
                overflowX: "auto",
                background: "#f6f8fa",
                borderRadius: 6,
                padding: "1rem",
                fontSize: "0.85em",
                lineHeight: 1.5,
              }}>
                {children}
              </pre>
            ),
            code: ({ children, className }) => (
              <code style={{
                fontFamily: "ui-monospace, monospace",
                fontSize: className ? "inherit" : "0.875em",
                background: className ? "transparent" : "#f6f8fa",
                borderRadius: 3,
                padding: className ? 0 : "0.2em 0.4em",
              }}>
                {children}
              </code>
            ),
          }}>
            {entry.content}
          </ReactMarkdown>
        </div>
      </main>

      <SimilarDrawer similar={similar} />
    </div>
  );
}

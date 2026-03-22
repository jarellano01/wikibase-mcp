import type { ComponentPropsWithoutRef } from "react";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getEntryById, getSimilarEntries, listEntries } from "@ai-wiki/db";
import type { Block } from "@ai-wiki/db";
import { getBlocksByEntry } from "@ai-wiki/db/blocks";
import { SimilarDrawer } from "../../components/SimilarDrawer";

// Shared ReactMarkdown component overrides for code and pre blocks
const markdownComponents = {
  pre: ({ children, ...rest }: ComponentPropsWithoutRef<"pre">) => (
    <pre
      {...rest}
      style={{
        overflowX: "auto",
        background: "#f6f8fa",
        borderRadius: 6,
        padding: "1rem",
        fontSize: "0.85em",
        lineHeight: 1.5,
      }}
    >
      {children}
    </pre>
  ),
  code: ({ children, className, ...rest }: ComponentPropsWithoutRef<"code">) => (
    <code
      {...rest}
      className={className}
      style={{
        fontFamily: "ui-monospace, monospace",
        fontSize: className ? "inherit" : "0.875em",
        background: className ? "transparent" : "#f6f8fa",
        borderRadius: 3,
        padding: className ? 0 : "0.2em 0.4em",
      }}
    >
      {children}
    </code>
  ),
};

// Metadata shape stored on image blocks
interface ImageBlockMetadata {
  src: string;
  alt: string;
  caption?: string;
}

// Renders a single block, with special handling for image type
function BlockRenderer({ block }: { block: Block }) {
  if (block.type === "html") {
    return <div dangerouslySetInnerHTML={{ __html: block.content }} />;
  }

  if (block.type === "image") {
    const meta = block.metadata as ImageBlockMetadata | null;
    if (!meta?.src) return null;
    return (
      <figure style={{ margin: "1.5rem 0", textAlign: "center" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={meta.src}
          alt={meta.alt ?? ""}
          style={{ maxWidth: "100%", borderRadius: 6 }}
        />
        {meta.caption && (
          <figcaption style={{ marginTop: "0.5rem", color: "#888", fontSize: "0.85rem" }}>
            {meta.caption}
          </figcaption>
        )}
      </figure>
    );
  }

  return (
    <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
      {block.content}
    </ReactMarkdown>
  );
}

export async function generateStaticParams() {
  const entries = await listEntries(1000);
  return entries.map((e) => ({ id: e.id }));
}


export default async function EntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [entry, similar, entryBlocks] = await Promise.all([
    getEntryById(id),
    getSimilarEntries(id, 5),
    getBlocksByEntry(id),
  ]);
  if (!entry) notFound();

  return (
    <div style={{ display: "flex", gap: "3rem", alignItems: "flex-start" }}>
      <main style={{ flex: "1 1 0", minWidth: 0 }}>
        <h2 style={{ marginTop: 0 }}>{entry.title}</h2>
        <div style={{ color: "#888", fontSize: "0.85rem", marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
          <span>{entry.type}</span>
          {entry.type === "post" && (() => {
            const status = (entry.metadata as { status?: string } | null)?.status;
            if (!status) return null;
            const published = status === "published";
            return (
              <span style={{
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
          <span>· {entry.tags.join(", ")} · {new Date(entry.createdAt).toLocaleDateString()}</span>
        </div>
        {entry.summary && (
          <blockquote style={{ borderLeft: "3px solid #ddd", paddingLeft: "1rem", color: "#555", margin: "0 0 1.5rem" }}>
            {entry.summary}
          </blockquote>
        )}
        <div style={{ lineHeight: 1.7 }}>
          {(() => {
            const hasTextBlocks = entryBlocks.some((b) => b.type !== "image");
            if (hasTextBlocks) {
              return entryBlocks.map((block) => (
                <BlockRenderer key={block.id} block={block} />
              ));
            }
            return (
              <>
                {entryBlocks
                  .filter((b) => b.type === "image")
                  .map((block) => (
                    <BlockRenderer key={block.id} block={block} />
                  ))}
                <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
                  {entry.content}
                </ReactMarkdown>
              </>
            );
          })()}
        </div>
      </main>

      <SimilarDrawer similar={similar} />
    </div>
  );
}

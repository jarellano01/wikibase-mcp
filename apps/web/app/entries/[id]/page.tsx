import type { ComponentPropsWithoutRef } from "react";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getEntryById, getSimilarEntries, listEntries } from "@ai-wiki/db";
import type { Block } from "@ai-wiki/db";
import { getBlocksByEntry } from "@ai-wiki/db/blocks";
import { SimilarDrawer } from "../../components/SimilarDrawer";

interface PostMeta {
  status?: "draft" | "review" | "published";
  publishedAt?: string;
  slug?: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

const markdownComponents = {
  pre: ({ children, ...rest }: ComponentPropsWithoutRef<"pre">) => (
    <pre {...rest}>{children}</pre>
  ),
  code: ({ children, className, ...rest }: ComponentPropsWithoutRef<"code">) => (
    <code {...rest} className={className}>{children}</code>
  ),
};

interface ImageBlockMetadata {
  src: string;
  alt: string;
  caption?: string;
}

function BlockRenderer({ block }: { block: Block }) {
  if (block.type === "html") {
    return <div dangerouslySetInnerHTML={{ __html: block.content }} />;
  }

  if (block.type === "image") {
    const meta = block.metadata as ImageBlockMetadata | null;
    if (!meta?.src) return null;
    return (
      <figure>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={meta.src} alt={meta.alt ?? ""} />
        {meta.caption && <figcaption>{meta.caption}</figcaption>}
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

  const entry = await getEntryById(id);
  if (!entry) notFound();

  const meta = entry.metadata as PostMeta | null;
  const isPublished = entry.status === "published";

  // Published posts have compiled markdown in entry.content — skip block fetch.
  const [similar, entryBlocks] = await Promise.all([
    getSimilarEntries(id, 5),
    isPublished ? Promise.resolve([]) : getBlocksByEntry(id),
  ]);

  const date = formatDate(
    (isPublished && meta?.publishedAt) ? meta.publishedAt : entry.createdAt.toISOString()
  );

  return (
    <div style={{ display: "flex", gap: "3.5rem", alignItems: "flex-start" }}>
      <article style={{ flex: "1 1 0", minWidth: 0, maxWidth: 680 }}>
        <header className="article-header">
          <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap" }}>
            <h1 className="article-title" style={{ flex: "1 1 0", minWidth: 0 }}>{entry.title}</h1>
            {entry.status !== "published" && (
              <span style={{
                flexShrink: 0,
                marginTop: "0.45rem",
                fontSize: "0.6875rem",
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                padding: "0.25em 0.6em",
                borderRadius: 4,
                background: entry.status === "review" ? "#eff6ff" : "#fefce8",
                color: entry.status === "review" ? "#1d4ed8" : "#a16207",
                border: `1px solid ${entry.status === "review" ? "#bfdbfe" : "#fde68a"}`,
              }}>
                {entry.status}
              </span>
            )}
          </div>
          <div className="article-meta">
            <time dateTime={entry.createdAt.toISOString()}>{date}</time>
            {entry.tags.length > 0 && (
              <>
                <span style={{ color: "#e5e7eb" }}>·</span>
                <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
                  {entry.tags.map((tag) => (
                    <span key={tag} className="tag">{tag}</span>
                  ))}
                </div>
              </>
            )}
          </div>
          {entry.summary && (
            <p className="article-summary">{entry.summary}</p>
          )}
        </header>

        <div className="prose">
          {isPublished ? (
            <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
              {entry.content}
            </ReactMarkdown>
          ) : (() => {
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
      </article>

      <SimilarDrawer similar={similar} />
    </div>
  );
}

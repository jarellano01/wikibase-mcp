import Link from "next/link";
import { listPublishedPosts } from "@ai-wiki/db";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function HomePage() {
  const posts = await listPublishedPosts(50);

  return (
    <div style={{ maxWidth: 680, margin: "0 auto" }}>
      {posts.length === 0 ? (
        <p style={{ color: "#9ca3af", marginTop: "2rem" }}>No posts yet.</p>
      ) : (
        <ul className="post-list">
          {posts.map((post) => {
            const meta = post.metadata as { publishedAt?: string } | null;
            const date = formatDate(meta?.publishedAt ?? post.createdAt.toISOString());

            return (
              <li key={post.id} className="post-item">
                <Link href={`/entries/${post.id}`} className="post-item-title">
                  {post.title}
                </Link>
                <div className="post-item-meta">
                  <span>{date}</span>
                  {post.tags.length > 0 && (
                    <> · {post.tags.join(", ")}</>
                  )}
                </div>
                {post.summary && (
                  <p className="post-item-summary">{post.summary}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

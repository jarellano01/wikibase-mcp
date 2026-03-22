import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { marked } from "marked";
import {
  listEntries,
  getEntryById,
  searchEntries,
} from "@ai-wiki/db";
import { generateEmbedding } from "@ai-wiki/db/embeddings";
import type { Block } from "@ai-wiki/db";
import {
  getBlocksByEntry,
  addBlockComment,
  getCommentsByBlock,
  resolveComment,
} from "@ai-wiki/db/blocks";

const PORT = parseInt(process.env.PORT ?? "3001", 10);

function renderMarkdown(content: string): string {
  const html = marked.parse(content) as string;
  return html.replace(
    /<img([^>]*?)src="([^"]*\.svg)"([^>]*?)>/gi,
    (_, before, src, after) => {
      const altMatch = (before + after).match(/alt="([^"]*)"/);
      const alt = altMatch ? altMatch[1] : "";
      return `<object data="${src}" type="image/svg+xml" style="max-width:100%">${alt}</object>`;
    }
  );
}

function renderBlock(block: Block): string {
  if (block.type === "html") return block.content;
  if (block.type === "image") {
    const meta = block.metadata as { src?: string; alt?: string; caption?: string } | null;
    if (!meta?.src) return "";
    const isSvg = meta.src.toLowerCase().endsWith(".svg");
    const mediaEl = isSvg
      ? `<object data="${h(meta.src)}" type="image/svg+xml" style="max-width:100%;border-radius:6px">${h(meta.alt ?? "")}</object>`
      : `<img src="${h(meta.src)}" alt="${h(meta.alt ?? "")}" style="max-width:100%;border-radius:6px" />`;
    return `
      <figure style="margin:1.5rem 0;text-align:center">
        ${mediaEl}
        ${meta.caption ? `<figcaption style="margin-top:.5rem;color:#888;font-size:.85rem">${h(meta.caption)}</figcaption>` : ""}
      </figure>`;
  }
  return renderMarkdown(block.content);
}

function h(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Strip markdown syntax for quote previews
function blockSnippet(block: Block): string {
  if (block.type === "image") {
    const meta = block.metadata as { caption?: string } | null;
    return meta?.caption ? `[Image: ${meta.caption}]` : "[Image]";
  }
  return block.content.replace(/[#*`_\[\]>]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
function layout(title: string, body: string, searchQuery = "", isDash = false): string {
  const homeHref = isDash ? "/dash" : "/";
  const searchAction = isDash ? "/dash/search" : "/search";
  const navLabel = isDash ? "⚙ Dashboard" : "ai-wiki";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${h(title)} — ai-wiki</title>
  <script src="https://unpkg.com/htmx.org@2.0.4/dist/htmx.min.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #fafafa; color: #1a1a1a; line-height: 1.7; }
    a { color: #0070f3; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem 1.5rem; }
    nav { background: #fff; border-bottom: 1px solid #eee; padding: .75rem 1.5rem; display: flex; align-items: center; gap: 1rem; }
    nav > a { font-weight: 600; font-size: .95rem; }
    nav form { margin-left: auto; display: flex; gap: .5rem; }
    nav input { border: 1px solid #ddd; border-radius: 6px; padding: .3rem .7rem; font-size: .9rem; width: 200px; }
    nav button { background: #0070f3; color: #fff; border: none; border-radius: 6px; padding: .3rem .75rem; cursor: pointer; font-size: .9rem; }
    a.tag { display: inline-block; background: #f0f0f0; color: #555; border-radius: 999px; padding: .1rem .5rem; font-size: .75rem; text-decoration: none; }
    a.tag:hover { background: #e0e0e0; }
    a.tag.active { background: #dbeafe; color: #1d4ed8; }
    .meta { color: #888; font-size: .85rem; margin-bottom: 1rem; display: flex; flex-wrap: wrap; gap: .4rem; align-items: center; }
    .badge { font-size: .75rem; padding: .1rem .4rem; border-radius: 999px; }
    .badge-published { background: #d1fae5; color: #065f46; }
    .badge-draft { background: #fef9c3; color: #854d0e; }
    .entry-summary { border-left: 3px solid #ddd; padding-left: 1rem; color: #555; margin: 0 0 1.5rem; }
    .entry-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: .5rem; }
    .entry-item { background: #fff; border: 1px solid #eee; border-radius: 8px; padding: 1rem 1.25rem; }
    .entry-item h3 { margin: 0 0 .4rem; font-size: 1rem; }
    .entry-item .tags { display: flex; flex-wrap: wrap; gap: .3rem; margin-bottom: .3rem; }
    .filters { display: flex; flex-wrap: wrap; gap: .4rem; margin-bottom: 1.25rem; align-items: center; }
    .filters span { font-size: .8rem; color: #888; }

    /* Entry detail layout */
    .entry-layout { display: flex; gap: 2rem; align-items: flex-start; }
    .article { flex: 1; min-width: 0; line-height: 1.7; }

    /* Blocks */
    .block-wrap { position: relative; padding-left: .75rem; border-left: 3px solid transparent; transition: border-color .2s; }
    .block-wrap.has-comments { border-left-color: #f59e0b; }
    .block-wrap.selected { border-left-color: #6366f1; background: #fafafa; border-radius: 0 4px 4px 0; }
    .block-wrap.flash { border-left-color: #6366f1 !important; background: #f5f3ff; border-radius: 4px; transition: none; }

    /* Comments sidebar */
    .comments-sidebar {
      width: 290px; flex-shrink: 0;
      position: sticky; top: 1.5rem;
      max-height: calc(100vh - 3rem); overflow-y: auto;
      background: #fff; border: 1px solid #e5e7eb;
      border-radius: 10px; display: flex; flex-direction: column;
    }
    .sidebar-header {
      padding: .75rem 1rem; border-bottom: 1px solid #f0f0f0;
      font-size: .9rem; font-weight: 600; color: #374151;
      display: flex; align-items: center; gap: .4rem; flex-shrink: 0;
    }
    .sidebar-header .count { color: #9ca3af; font-weight: 400; }
    #sidebar-threads { flex: 1; overflow-y: auto; padding: .5rem 0; }
    .no-comments { color: #9ca3af; font-size: .85rem; text-align: center; padding: 1.5rem 1rem; margin: 0; }

    /* Thread = one block's comments */
    .thread {
      padding: .6rem 1rem; cursor: pointer;
      border-left: 3px solid transparent; margin: 0 0 .1rem;
      transition: background .15s;
    }
    .thread:hover { background: #f9fafb; }
    .thread.active { border-left-color: #6366f1; background: #f5f3ff; }
    .thread-quote {
      font-size: .78rem; color: #9ca3af; margin-bottom: .4rem;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      border-left: 2px solid #f59e0b; padding-left: .4rem;
    }
    .thread-comment { margin-bottom: .5rem; }
    .thread-comment p { margin: 0 0 .25rem; font-size: .85rem; color: #374151; }
    .thread-comment-meta { display: flex; align-items: center; gap: .5rem; font-size: .75rem; color: #9ca3af; }
    .resolve-btn { background: none; border: 1px solid #e5e7eb; border-radius: 4px; padding: .1rem .4rem; cursor: pointer; font-size: .72rem; color: #6b7280; }
    .resolve-btn:hover { border-color: #86efac; color: #16a34a; background: #f0fdf4; }

    /* Add comment area at bottom of sidebar */
    .add-comment-area {
      flex-shrink: 0; border-top: 1px solid #f0f0f0; padding: .75rem 1rem;
    }
    .add-comment-target {
      font-size: .78rem; color: #9ca3af; margin-bottom: .4rem;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .add-comment-target.selected { color: #6366f1; border-left: 2px solid #f59e0b; padding-left: .4rem; }
    .add-comment-area textarea {
      width: 100%; border: 1px solid #ddd; border-radius: 6px;
      padding: .4rem .5rem; font-size: .82rem; resize: none;
      min-height: 52px; font-family: inherit; display: block;
    }
    .add-comment-area textarea:focus { outline: none; border-color: #6366f1; }
    .add-comment-area button {
      margin-top: .35rem; background: #6366f1; color: #fff; border: none;
      border-radius: 6px; padding: .28rem .65rem; font-size: .8rem;
      cursor: pointer; opacity: .5; pointer-events: none;
    }
    .add-comment-area button.ready { opacity: 1; pointer-events: auto; }
    .add-comment-area button:hover { background: #4f46e5; }

    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: .4rem .7rem; text-align: left; }
    th { background: #f5f5f5; }
    pre { overflow-x: auto; background: #f6f8fa; border-radius: 6px; padding: 1rem; font-size: .85em; }
    code { font-family: ui-monospace, monospace; }
    img { max-width: 100%; }
    blockquote { border-left: 3px solid #ddd; margin: 0; padding-left: 1rem; color: #555; }
  </style>
</head>
<body hx-boost="true">
  <nav>
    <a href="${homeHref}">${navLabel}</a>
    <form method="get" action="${searchAction}">
      <input name="q" placeholder="Search…" value="${h(searchQuery)}" />
      <button type="submit">Search</button>
    </form>
  </nav>
  <div class="container" id="main-content">${body}</div>
  <script>
    let activeBlockId = null;

    // Click anywhere on a block — activate for commenting
    // Guard: if the click ended a drag-select, preserve the selection and skip focus change
    function handleBlockClick(blockId, event) {
      if (event.target.closest('a, button, input, textarea, object')) return;
      if (window.getSelection()?.toString().length > 0) return;
      openComment(blockId);
    }

    function openComment(blockId) {
      activeBlockId = blockId;

      // Persistent selected state (no auto-clear)
      document.querySelectorAll('.block-wrap').forEach(b => b.classList.remove('selected', 'flash'));
      const block = document.getElementById('block-' + blockId);
      block?.classList.add('selected');

      // Highlight matching thread in sidebar if it exists
      document.querySelectorAll('.thread').forEach(t => t.classList.remove('active'));
      const thread = document.querySelector('.thread[data-block="' + blockId + '"]');
      if (thread) {
        thread.classList.add('active');
        thread.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

      // Update the add-comment target label
      const snippet = block?.querySelector('.block-content')?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 70);
      const label = document.getElementById('add-comment-target');
      if (label && snippet) {
        label.textContent = snippet + (snippet.length >= 70 ? '…' : '');
        label.className = 'add-comment-target selected';
      }

      // Set hidden blockId input and enable submit button
      const input = document.getElementById('comment-block-id');
      if (input) input.value = blockId;
      const btn = document.getElementById('comment-submit-btn');
      if (btn) btn.classList.add('ready');

      // Scroll sidebar to add form and focus textarea
      const addArea = document.querySelector('.add-comment-area');
      addArea?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      setTimeout(() => document.getElementById('comment-textarea')?.focus(), 100);
    }

    // Click a thread in sidebar — scroll main content to that block
    function scrollToBlock(blockId) {
      document.querySelectorAll('.thread').forEach(t => t.classList.remove('active'));
      document.querySelector('.thread[data-block="' + blockId + '"]')?.classList.add('active');

      document.querySelectorAll('.block-wrap').forEach(b => b.classList.remove('selected', 'flash'));
      const block = document.getElementById('block-' + blockId);
      if (!block) return;
      block.scrollIntoView({ behavior: 'smooth', block: 'center' });
      block.classList.add('selected');
    }

    function clearCommentTarget() {
      activeBlockId = null;
      document.querySelectorAll('.block-wrap').forEach(b => b.classList.remove('selected'));
      const label = document.getElementById('add-comment-target');
      if (label) { label.textContent = '← click a block to comment'; label.className = 'add-comment-target'; }
      const input = document.getElementById('comment-block-id');
      if (input) input.value = '';
      const btn = document.getElementById('comment-submit-btn');
      if (btn) btn.classList.remove('ready');
    }

    // After htmx swaps sidebar threads, update comment counts in block borders
    document.addEventListener('htmx:afterSettle', () => {
      document.querySelectorAll('.thread[data-block]').forEach(t => {
        const blockId = t.dataset.block;
        document.getElementById('block-' + blockId)?.classList.add('has-comments');
      });
    });
  </script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Sidebar threads HTML (inner content only, for htmx swaps)
// ---------------------------------------------------------------------------
async function sidebarThreadsHtml(entryBlocks: Block[], entryId: string): Promise<{ html: string; total: number }> {
  const withComments = await Promise.all(
    entryBlocks.map(async (b) => ({
      block: b,
      unresolved: (await getCommentsByBlock(b.id)).filter((c) => c.resolved === "false"),
    }))
  );

  const threads = withComments.filter(({ unresolved }) => unresolved.length > 0);
  const total = threads.reduce((n, { unresolved }) => n + unresolved.length, 0);

  if (threads.length === 0) {
    return { html: '<p class="no-comments">No comments yet</p>', total: 0 };
  }

  const html = threads.map(({ block, unresolved }) => {
    const snippet = h(blockSnippet(block));
    const commentItems = unresolved.map((c) => `
      <div class="thread-comment">
        <p>${h(c.body)}</p>
        <div class="thread-comment-meta">
          <span>${new Date(c.createdAt).toLocaleDateString()}</span>
          <form method="post" action="/comments/${c.id}/resolve" style="margin:0"
                hx-post="/comments/${c.id}/resolve"
                hx-target="#sidebar-threads"
                hx-swap="innerHTML">
            <input type="hidden" name="entryId" value="${entryId}" />
            <button class="resolve-btn" type="submit">✓ Resolve</button>
          </form>
        </div>
      </div>`).join("");

    return `
      <div class="thread" data-block="${block.id}" onclick="scrollToBlock('${block.id}')">
        <div class="thread-quote">${snippet}</div>
        ${commentItems}
      </div>`;
  }).join("");

  return { html, total };
}

// ---------------------------------------------------------------------------
// Entry list item
// ---------------------------------------------------------------------------
function entryItem(e: Awaited<ReturnType<typeof listEntries>>[number], activeTag?: string, basePath = "/"): string {
  const tagsHtml = [
    `<a class="tag${e.type === activeTag ? " active" : ""}" href="${basePath}?type=${h(e.type)}">${h(e.type)}</a>`,
    ...e.tags.map((t) => `<a class="tag${t === activeTag ? " active" : ""}" href="${basePath}?tag=${h(t)}">${h(t)}</a>`),
  ].join(" ");
  return `
    <li class="entry-item">
      <h3><a href="/entries/${e.id}">${h(e.title)}</a></h3>
      <div class="tags">${tagsHtml}
        <span style="color:#aaa;font-size:.75rem"> · ${new Date(e.createdAt).toLocaleDateString()}</span>
      </div>
      ${e.summary ? `<p style="margin:.2rem 0 0;color:#666;font-size:.875rem">${h(e.summary)}</p>` : ""}
    </li>`;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
const app = new Hono();

app.get("/", async (c) => {
  const all = await listEntries(500);
  const posts = all.filter((e) => e.type === "post");
  return c.html(layout("Blog", `
    <h2 style="margin-top:0">Posts</h2>
    <ul class="entry-list">${posts.map((e) => entryItem(e)).join("") || '<p style="color:#888">No posts yet.</p>'}</ul>
  `));
});

app.get("/dash", async (c) => {
  const filterTag = c.req.query("tag")?.trim();
  const filterType = c.req.query("type")?.trim();
  const all = await listEntries(500);
  const filtered = all.filter((e) => {
    if (filterTag && !e.tags.includes(filterTag)) return false;
    if (filterType && e.type !== filterType) return false;
    return true;
  });
  const activeFilter = filterTag ?? filterType;
  const filtersBar = activeFilter
    ? `<div class="filters"><span>Filtered by:</span> <a class="tag active" href="#">${h(activeFilter)}</a> <a href="/dash" style="font-size:.8rem;color:#888">✕ clear</a></div>`
    : "";
  return c.html(layout("Dashboard", `
    <h2 style="margin-top:0">All Entries</h2>
    ${filtersBar}
    <ul class="entry-list">${filtered.map((e) => entryItem(e, activeFilter, "/dash")).join("") || '<p style="color:#888">No entries match.</p>'}</ul>
  `, "", true));
});

app.get("/search", async (c) => {
  const q = c.req.query("q")?.trim() ?? "";
  if (!q) return c.redirect("/");
  const queryEmbedding = await generateEmbedding(q);
  const results = (await searchEntries(q, queryEmbedding)).filter((e) => e.type === "post");
  const items = results.length === 0
    ? `<p style="color:#888">No results for "${h(q)}"</p>`
    : results.map((e) => entryItem(e)).join("");
  return c.html(layout(`Search: ${q}`, `
    <h2 style="margin-top:0">Results for "<em>${h(q)}</em>"</h2>
    <ul class="entry-list">${items}</ul>
  `, q));
});

app.get("/dash/search", async (c) => {
  const q = c.req.query("q")?.trim() ?? "";
  if (!q) return c.redirect("/dash");
  const queryEmbedding = await generateEmbedding(q);
  const results = await searchEntries(q, queryEmbedding);
  const items = results.length === 0
    ? `<p style="color:#888">No results for "${h(q)}"</p>`
    : results.map((e) => entryItem(e)).join("");
  return c.html(layout(`Search: ${q}`, `
    <h2 style="margin-top:0">Results for "<em>${h(q)}</em>"</h2>
    <ul class="entry-list">${items}</ul>
  `, q, true));
});

app.get("/entries/:id", async (c) => {
  const { id } = c.req.param();
  const [entry, entryBlocks] = await Promise.all([getEntryById(id), getBlocksByEntry(id)]);
  if (!entry) return c.notFound();

  const status = (entry.metadata as { status?: string } | null)?.status;
  const badgeHtml = status
    ? `<span class="badge ${status === "published" ? "badge-published" : "badge-draft"}">${h(status)}</span>`
    : "";
  const tagsHtml = entry.tags.map((t) => `<a class="tag" href="/?tag=${h(t)}">${h(t)}</a>`).join(" ");

  const hasTextBlocks = entryBlocks.some((b) => b.type !== "image");
  const blocksToRender = hasTextBlocks ? entryBlocks : [];

  // Fetch comment counts to mark blocks that have comments
  const commentCounts = await Promise.all(
    blocksToRender.map(async (b) => ({
      id: b.id,
      count: (await getCommentsByBlock(b.id)).filter((c) => c.resolved === "false").length,
    }))
  );
  const hasCommentsSet = new Set(commentCounts.filter((x) => x.count > 0).map((x) => x.id));

  const blocksHtml = blocksToRender.map((b) => `
    <div class="block-wrap${hasCommentsSet.has(b.id) ? " has-comments" : ""}" id="block-${b.id}"
         onclick="handleBlockClick('${b.id}', event)">
      <div class="block-content">${renderBlock(b)}</div>
    </div>`).join("");

  const fallbackHtml = hasTextBlocks ? "" : `<div>${renderMarkdown(entry.content)}</div>`;

  const { html: threadsHtml, total } = await sidebarThreadsHtml(entryBlocks, id);

  const sidebar = `
    <aside class="comments-sidebar">
      <div class="sidebar-header">
        💬 Comments <span class="count">${total > 0 ? `(${total})` : ""}</span>
      </div>
      <div id="sidebar-threads">${threadsHtml}</div>
      <div class="add-comment-area">
        <div id="add-comment-target" class="add-comment-target">← click 💬 on a block to comment</div>
        <form method="post" action="/entries/${id}/comments"
              hx-post="/entries/${id}/comments"
              hx-target="#sidebar-threads"
              hx-swap="innerHTML"
              hx-on::after-request="this.reset(); clearCommentTarget()">
          <input type="hidden" id="comment-block-id" name="blockId" />
          <textarea id="comment-textarea" name="body" placeholder="Add a comment…" required></textarea>
          <button id="comment-submit-btn" type="submit">Comment</button>
        </form>
      </div>
    </aside>`;

  return c.html(layout(entry.title, `
    <p style="margin:0 0 1.5rem"><a href="javascript:history.back()">← Back</a></p>
    <h2 style="margin-top:0">${h(entry.title)}</h2>
    <div class="meta">
      <a class="tag" href="/?type=${h(entry.type)}">${h(entry.type)}</a>
      ${badgeHtml} ${tagsHtml}
      <span>· ${new Date(entry.createdAt).toLocaleDateString()}</span>
    </div>
    ${entry.summary ? `<blockquote class="entry-summary">${h(entry.summary)}</blockquote>` : ""}
    <div class="entry-layout">
      <div class="article">${blocksHtml}${fallbackHtml}</div>
      ${sidebar}
    </div>
  `));
});

// Add comment (blockId from form body)
app.post("/entries/:entryId/comments", async (c) => {
  const { entryId } = c.req.param();
  const body = await c.req.parseBody();
  const blockId = (body.blockId as string)?.trim();
  const text = (body.body as string)?.trim();
  if (blockId && text) await addBlockComment(blockId, text);

  if (c.req.header("hx-request")) {
    const entryBlocks = await getBlocksByEntry(entryId);
    const { html } = await sidebarThreadsHtml(entryBlocks, entryId);
    return c.html(html);
  }
  return c.redirect(`/entries/${entryId}`);
});

// Resolve comment
app.post("/comments/:id/resolve", async (c) => {
  const { id } = c.req.param();
  await resolveComment(id);

  if (c.req.header("hx-request")) {
    const body = await c.req.parseBody();
    const entryId = body.entryId as string;
    if (entryId) {
      const entryBlocks = await getBlocksByEntry(entryId);
      const { html } = await sidebarThreadsHtml(entryBlocks, entryId);
      return c.html(html);
    }
  }
  return c.redirect(c.req.header("referer") ?? "/");
});

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`ai-wiki server running at http://localhost:${PORT}`);
});

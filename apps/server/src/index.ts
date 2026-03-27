import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { marked } from "marked";
import {
  listEntries,
  getEntryById,
  searchEntries,
} from "@wikibase/db";
import { generateEmbedding } from "@wikibase/db/embeddings";
import type { Block } from "@wikibase/db";
import {
  getBlocksByEntry,
  addBlockComment,
  getCommentsByBlock,
  resolveComment,
} from "@wikibase/db/blocks";

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
      ? `<object data="${h(meta.src)}" type="image/svg+xml" style="max-width:100%;border-radius:4px">${h(meta.alt ?? "")}</object>`
      : `<img src="${h(meta.src)}" alt="${h(meta.alt ?? "")}" style="max-width:100%;border-radius:4px" />`;
    return `
      <figure style="margin:2rem 0;text-align:center">
        ${mediaEl}
        ${meta.caption ? `<figcaption style="margin-top:.6rem;color:var(--muted);font-size:.82rem">${h(meta.caption)}</figcaption>` : ""}
      </figure>`;
  }
  return renderMarkdown(block.content);
}

function h(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function blockSnippet(block: Block): string {
  if (block.type === "image") {
    const meta = block.metadata as { caption?: string } | null;
    return meta?.caption ? `[Image: ${meta.caption}]` : "[Image]";
  }
  return block.content.replace(/[#*`_\[\]>]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------
const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0d0d0f;
    --bg2: #141417;
    --bg3: #1c1c21;
    --border: #2a2a30;
    --text: #e8e8ec;
    --muted: #6b6b78;
    --accent: #00ff87;
    --accent-dim: rgba(0,255,135,0.12);
    --accent-glow: 0 0 20px rgba(0,255,135,0.25);
    --red: #ff4757;
    --yellow: #ffd43b;
    --mono: "JetBrains Mono", "Fira Code", ui-monospace, monospace;
    --sans: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --radius: 4px;
    --max-w: 720px;
  }

  [data-theme="light"] {
    --bg: #f8f8f5;
    --bg2: #ffffff;
    --bg3: #f0f0ed;
    --border: #e0e0da;
    --text: #1a1a1e;
    --muted: #888890;
    --accent: #007a42;
    --accent-dim: rgba(0,122,66,0.08);
    --accent-glow: 0 0 20px rgba(0,122,66,0.15);
  }

  html { font-size: 16px; }
  body {
    font-family: var(--sans);
    background: var(--bg);
    color: var(--text);
    line-height: 1.7;
    min-height: 100vh;
    transition: background .2s, color .2s;
  }

  /* Scan-line texture */
  body::before {
    content: "";
    position: fixed; inset: 0; pointer-events: none; z-index: 999;
    background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px);
  }

  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; text-decoration-color: var(--accent); }

  /* ---- Nav ---- */
  nav {
    position: sticky; top: 0; z-index: 50;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    padding: .75rem 1.5rem;
    display: flex; align-items: center; gap: 1rem;
  }
  .nav-brand {
    font-family: var(--mono);
    font-size: .85rem;
    font-weight: 700;
    color: var(--accent);
    letter-spacing: -.02em;
    display: flex; align-items: center; gap: .4rem;
  }
  .nav-brand::before { content: "> "; color: var(--muted); }
  nav form { margin-left: auto; display: flex; gap: .4rem; }
  nav input {
    background: var(--bg3); border: 1px solid var(--border);
    border-radius: var(--radius); padding: .3rem .65rem;
    font-size: .85rem; color: var(--text); width: 200px;
    font-family: var(--mono);
    transition: border-color .2s;
  }
  nav input::placeholder { color: var(--muted); }
  nav input:focus { outline: none; border-color: var(--accent); }
  nav button[type="submit"] {
    background: transparent; border: 1px solid var(--border);
    border-radius: var(--radius); padding: .3rem .65rem;
    color: var(--muted); cursor: pointer; font-size: .82rem;
    font-family: var(--mono);
    transition: color .2s, border-color .2s;
  }
  nav button[type="submit"]:hover { color: var(--accent); border-color: var(--accent); }

  .theme-toggle {
    background: none; border: 1px solid var(--border);
    border-radius: var(--radius); padding: .28rem .5rem;
    color: var(--muted); cursor: pointer; font-size: .82rem;
    transition: color .15s, border-color .15s;
    flex-shrink: 0;
  }
  .theme-toggle:hover { color: var(--accent); border-color: var(--accent); }

  /* ---- Container ---- */
  .container {
    max-width: var(--max-w);
    margin: 0 auto;
    padding: 3rem 1.5rem;
  }
  .container.wide { max-width: 960px; }

  /* ---- Tags / chips ---- */
  .tag {
    display: inline-block;
    font-family: var(--mono);
    font-size: .72rem;
    color: var(--muted);
    border: 1px solid var(--border);
    border-radius: 2px;
    padding: .05rem .4rem;
    text-decoration: none;
    transition: color .15s, border-color .15s;
  }
  .tag:hover { color: var(--accent); border-color: var(--accent); text-decoration: none; }
  .tag.active { color: var(--accent); border-color: var(--accent); background: var(--accent-dim); }

  /* ---- Status badges ---- */
  .badge {
    font-family: var(--mono);
    font-size: .68rem;
    padding: .1rem .4rem;
    border-radius: 2px;
    text-transform: uppercase;
    letter-spacing: .05em;
  }
  .badge-published { color: var(--accent); border: 1px solid var(--accent); background: var(--accent-dim); }
  .badge-draft { color: var(--yellow); border: 1px solid rgba(255,212,59,0.3); background: rgba(255,212,59,0.08); }
  .badge-review { color: #74c0fc; border: 1px solid rgba(116,192,252,0.3); background: rgba(116,192,252,0.08); }

  /* ---- Landing hero ---- */
  .hero {
    padding: 2.5rem 0 3rem;
    border-bottom: 1px solid var(--border);
    margin-bottom: 3rem;
  }
  .hero-title {
    font-family: var(--mono);
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text);
    margin-bottom: .5rem;
    display: flex; align-items: center; gap: .6rem;
  }
  .hero-title .cursor {
    display: inline-block;
    width: 2px; height: 1.3em;
    background: var(--accent);
    animation: blink 1s step-end infinite;
    vertical-align: text-bottom;
  }
  @keyframes blink { 50% { opacity: 0; } }
  .hero-sub {
    color: var(--muted);
    font-size: .95rem;
    max-width: 480px;
    line-height: 1.6;
  }
  .hero-links {
    margin-top: 1.25rem;
    display: flex; gap: .75rem; flex-wrap: wrap;
  }
  .hero-link {
    font-family: var(--mono);
    font-size: .8rem;
    color: var(--muted);
    border-bottom: 1px solid var(--border);
    padding-bottom: 1px;
    transition: color .15s, border-color .15s;
  }
  .hero-link:hover { color: var(--accent); border-color: var(--accent); text-decoration: none; }

  /* ---- Year groups ---- */
  .year-group { margin-bottom: 2.5rem; }
  .year-label {
    font-family: var(--mono);
    font-size: .78rem;
    color: var(--muted);
    letter-spacing: .08em;
    margin-bottom: .75rem;
    display: flex; align-items: center; gap: .75rem;
  }
  .year-label::after {
    content: "";
    flex: 1;
    height: 1px;
    background: var(--border);
  }

  /* ---- Post row ---- */
  .post-row {
    display: flex; align-items: baseline; gap: 1rem;
    padding: .55rem 0;
    border-bottom: 1px solid var(--border);
    transition: background .15s;
    text-decoration: none; color: inherit;
    position: relative;
  }
  .post-row:last-child { border-bottom: none; }
  .post-row:hover { background: var(--accent-dim); }
  .post-row:hover .post-title { color: var(--accent); }
  .post-title {
    font-size: .95rem;
    color: var(--text);
    flex: 1;
    transition: color .15s;
  }
  .post-date {
    font-family: var(--mono);
    font-size: .75rem;
    color: var(--muted);
    flex-shrink: 0;
    white-space: nowrap;
  }
  .post-tags { display: flex; gap: .3rem; flex-wrap: wrap; margin-top: .2rem; }

  /* ---- Entry list (dash) ---- */
  .entry-list { list-style: none; display: flex; flex-direction: column; gap: .4rem; }
  .entry-item {
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: .9rem 1.1rem;
    transition: border-color .15s;
  }
  .entry-item:hover { border-color: var(--accent); }
  .entry-item h3 { font-size: .95rem; font-weight: 500; margin-bottom: .3rem; }
  .entry-item h3 a { color: var(--text); }
  .entry-item h3 a:hover { color: var(--accent); text-decoration: none; }
  .entry-item .tags { display: flex; flex-wrap: wrap; gap: .3rem; margin-bottom: .25rem; }
  .entry-item .summary { color: var(--muted); font-size: .85rem; }
  .filters { display: flex; flex-wrap: wrap; gap: .4rem; margin-bottom: 1.25rem; align-items: center; }
  .filters span { font-size: .8rem; color: var(--muted); }

  /* ---- Article ---- */
  .article-header { margin-bottom: 2.5rem; padding-bottom: 1.5rem; border-bottom: 1px solid var(--border); }
  .article-title { font-size: 1.75rem; font-weight: 700; line-height: 1.3; margin-bottom: .75rem; }
  .meta { color: var(--muted); font-size: .82rem; display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; font-family: var(--mono); }
  .meta .sep { color: var(--border); }
  .entry-summary {
    border-left: 2px solid var(--accent);
    padding-left: 1rem;
    color: var(--muted);
    font-size: .95rem;
    margin: 1.25rem 0 0;
    font-style: italic;
  }

  /* ---- Prose ---- */
  .prose { max-width: var(--max-w); }
  .prose h1, .prose h2, .prose h3, .prose h4 {
    font-weight: 600; line-height: 1.3; margin: 2rem 0 .75rem; color: var(--text);
  }
  .prose h2 { font-size: 1.3rem; }
  .prose h3 { font-size: 1.1rem; }
  .prose p { margin: 0 0 1.2rem; }
  .prose ul, .prose ol { margin: 0 0 1.2rem; padding-left: 1.5rem; }
  .prose li { margin: .3rem 0; }
  .prose blockquote {
    border-left: 2px solid var(--accent);
    margin: 1.5rem 0;
    padding: .5rem 1rem;
    color: var(--muted);
    font-style: italic;
  }
  .prose code {
    font-family: var(--mono);
    font-size: .85em;
    background: var(--bg3);
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: .1em .35em;
  }
  .prose pre {
    background: var(--bg3);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.25rem;
    overflow-x: auto;
    margin: 1.5rem 0;
  }
  .prose pre code { background: none; border: none; padding: 0; font-size: .82rem; }
  .prose img { max-width: 100%; border-radius: var(--radius); }
  .prose table { border-collapse: collapse; width: 100%; margin: 1.5rem 0; }
  .prose th, .prose td { border: 1px solid var(--border); padding: .45rem .75rem; text-align: left; font-size: .88rem; }
  .prose th { background: var(--bg3); font-family: var(--mono); font-size: .8rem; color: var(--muted); }
  .prose a { color: var(--accent); }
  .prose hr { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }

  /* ---- Blocks ---- */
  .entry-layout { line-height: 1.8; }
  .block-wrap {
    position: relative;
    border-left: 2px solid transparent;
    padding-left: .75rem;
    margin-left: -.75rem;
    transition: border-color .2s, background .2s;
    cursor: text;
    border-radius: 0 var(--radius) var(--radius) 0;
  }
  .block-wrap.has-comments { border-left-color: var(--yellow); }
  .block-wrap.selected { border-left-color: var(--accent); background: var(--accent-dim); }
  .block-wrap.flash { border-left-color: var(--accent) !important; background: var(--accent-dim); transition: none; }

  /* ---- Progress bar ---- */
  #progress-bar {
    position: fixed; top: 0; left: 0; height: 2px; width: 0%;
    background: var(--accent);
    z-index: 200;
    transition: width .1s linear;
    box-shadow: var(--accent-glow);
  }

  /* ---- Comments drawer ---- */
  .drawer-backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.5);
    z-index: 99; opacity: 0; pointer-events: none;
    transition: opacity 0.25s ease;
  }
  .drawer-backdrop.open { opacity: 1; pointer-events: auto; }

  .comments-sidebar {
    position: fixed; top: 0; right: 0; bottom: 0;
    width: min(360px, 100vw);
    background: var(--bg2);
    border-left: 1px solid var(--border);
    z-index: 100;
    display: flex; flex-direction: column;
    transform: translateX(100%);
    transition: transform 0.25s ease;
  }
  .comments-sidebar.open { transform: translateX(0); }

  .comments-fab {
    position: fixed; bottom: 1.5rem; right: 1.5rem;
    width: 44px; height: 44px; border-radius: 50%;
    background: var(--bg3); color: var(--text);
    border: 1px solid var(--border); cursor: pointer;
    z-index: 98; font-size: 1rem;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 2px 12px rgba(0,0,0,0.4);
    transition: border-color .15s, color .15s;
  }
  .comments-fab:hover { border-color: var(--accent); color: var(--accent); }

  .sidebar-header {
    padding: .75rem 1rem; border-bottom: 1px solid var(--border);
    font-family: var(--mono); font-size: .82rem; font-weight: 600; color: var(--muted);
    display: flex; align-items: center; gap: .4rem; flex-shrink: 0;
    letter-spacing: .04em; text-transform: uppercase;
  }
  .sidebar-header .count { color: var(--accent); }
  .sidebar-header .close-btn {
    margin-left: auto; background: none; border: none; cursor: pointer;
    color: var(--muted); padding: 2px; line-height: 1; font-size: 1rem;
    transition: color .15s;
  }
  .sidebar-header .close-btn:hover { color: var(--text); }
  #sidebar-threads { flex: 1; overflow-y: auto; padding: .5rem 0; }
  .no-comments { color: var(--muted); font-size: .82rem; text-align: center; padding: 2rem 1rem; font-family: var(--mono); }

  .thread {
    padding: .6rem 1rem; cursor: pointer;
    border-left: 2px solid transparent; margin: 0 0 .1rem;
    transition: background .15s, border-color .15s;
  }
  .thread:hover { background: var(--bg3); }
  .thread.active { border-left-color: var(--accent); background: var(--accent-dim); }
  .thread-quote {
    font-size: .76rem; color: var(--muted); margin-bottom: .4rem;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    border-left: 2px solid var(--yellow); padding-left: .4rem;
    font-family: var(--mono);
  }
  .thread-comment { margin-bottom: .5rem; }
  .thread-comment p { margin: 0 0 .25rem; font-size: .85rem; color: var(--text); }
  .thread-comment-meta { display: flex; align-items: center; gap: .5rem; font-size: .73rem; color: var(--muted); font-family: var(--mono); }
  .resolve-btn {
    background: none; border: 1px solid var(--border);
    border-radius: var(--radius); padding: .1rem .4rem; cursor: pointer;
    font-size: .7rem; color: var(--muted); font-family: var(--mono);
    transition: color .15s, border-color .15s, background .15s;
  }
  .resolve-btn:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-dim); }

  .add-comment-area {
    flex-shrink: 0; border-top: 1px solid var(--border); padding: .75rem 1rem;
  }
  .add-comment-target {
    font-size: .76rem; color: var(--muted); margin-bottom: .4rem;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    font-family: var(--mono);
  }
  .add-comment-target.selected { color: var(--accent); border-left: 2px solid var(--yellow); padding-left: .4rem; }
  .add-comment-area textarea {
    width: 100%; background: var(--bg3); border: 1px solid var(--border);
    border-radius: var(--radius); padding: .4rem .5rem;
    font-size: .82rem; resize: none; min-height: 52px;
    font-family: var(--sans); color: var(--text); display: block;
    transition: border-color .2s;
  }
  .add-comment-area textarea::placeholder { color: var(--muted); }
  .add-comment-area textarea:focus { outline: none; border-color: var(--accent); }
  .add-comment-area button {
    margin-top: .35rem; background: transparent;
    border: 1px solid var(--border); color: var(--muted);
    border-radius: var(--radius); padding: .28rem .65rem;
    font-size: .78rem; cursor: pointer; font-family: var(--mono);
    opacity: .4; pointer-events: none;
    transition: color .15s, border-color .15s, background .15s, opacity .15s;
  }
  .add-comment-area button.ready { opacity: 1; pointer-events: auto; }
  .add-comment-area button.ready:hover { color: var(--accent); border-color: var(--accent); background: var(--accent-dim); }

  /* ---- Race mode easter egg ---- */
  @keyframes race-flash {
    0%   { background: #0d0d0f; }
    10%  { background: #1a0a00; }
    20%  { background: #001a0a; }
    30%  { background: #1a001a; }
    40%  { background: #0d0d0f; }
  }
  body.race-mode { animation: race-flash .5s ease forwards; }
  body.race-mode #progress-bar { background: #ff4757; box-shadow: 0 0 20px rgba(255,71,87,0.5); }
  body.race-mode .nav-brand { color: #ff4757; }
  body.race-mode a { color: #ff4757; }
  body.race-mode .tag:hover, body.race-mode .tag.active { color: #ff4757; border-color: #ff4757; }

  /* ---- Search results ---- */
  .search-header { margin-bottom: 2rem; }
  .search-header h2 { font-size: 1.1rem; font-weight: 500; color: var(--muted); }
  .search-header h2 em { color: var(--text); font-style: normal; }

  /* ---- Back link ---- */
  .back-link { font-family: var(--mono); font-size: .82rem; color: var(--muted); display: inline-block; margin-bottom: 2rem; }
  .back-link:hover { color: var(--accent); text-decoration: none; }

  /* ---- Section heading ---- */
  .section-heading {
    font-family: var(--mono);
    font-size: .78rem; font-weight: 600;
    color: var(--muted); letter-spacing: .1em;
    text-transform: uppercase; margin-bottom: 1.5rem;
    display: flex; align-items: center; gap: .75rem;
  }
  .section-heading::before { content: "//"; color: var(--border); }
`;

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
function layout(title: string, body: string, searchQuery = "", isDash = false, isArticle = false): string {
  const homeHref = isDash ? "/dash" : "/";
  const searchAction = isDash ? "/dash/search" : "/search";
  const navLabel = isDash ? "ai-wiki/dash" : "ja.codes";

  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${h(title)} — ja.codes</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <script src="https://unpkg.com/htmx.org@2.0.4/dist/htmx.min.js"></script>
  <style>${CSS}</style>
</head>
<body hx-boost="true">
  ${isArticle ? '<div id="progress-bar"></div>' : ""}
  <nav>
    <a href="${homeHref}" class="nav-brand">${h(navLabel)}</a>
    <button class="theme-toggle" onclick="toggleTheme()" title="Toggle theme">[light]</button>
    <form method="get" action="${searchAction}">
      <input name="q" placeholder="search_" value="${h(searchQuery)}" />
      <button type="submit">→</button>
    </form>
  </nav>
  <div class="container${isDash ? " wide" : ""}" id="main-content">${body}</div>
  <script>
    // --- Theme ---
    (function() {
      const saved = localStorage.getItem('theme') || 'light';
      document.documentElement.dataset.theme = saved;
      updateThemeBtn(saved);
    })();
    function updateThemeBtn(theme) {
      const btn = document.querySelector('.theme-toggle');
      if (btn) btn.textContent = theme === 'dark' ? '[light]' : '[dark]';
    }
    function toggleTheme() {
      const html = document.documentElement;
      const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
      html.dataset.theme = next;
      localStorage.setItem('theme', next);
      updateThemeBtn(next);
    }

    // --- Scroll progress ---
    ${isArticle ? `
    function updateProgress() {
      const el = document.getElementById('progress-bar');
      if (!el) return;
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      el.style.width = docHeight > 0 ? (scrollTop / docHeight * 100) + '%' : '0%';
    }
    window.addEventListener('scroll', updateProgress, { passive: true });
    ` : ""}

    // --- Comments drawer ---
    let activeBlockId = null;

    function openDrawer() {
      document.getElementById('comments-drawer')?.classList.add('open');
      document.getElementById('drawer-backdrop')?.classList.add('open');
    }

    function closeDrawer() {
      document.getElementById('comments-drawer')?.classList.remove('open');
      document.getElementById('drawer-backdrop')?.classList.remove('open');
    }

    function handleBlockClick(blockId, event) {
      if (event.target.closest('a, button, input, textarea, object')) return;
      if (window.getSelection()?.toString().length > 0) return;
      openComment(blockId);
    }

    function openComment(blockId) {
      activeBlockId = blockId;
      openDrawer();
      document.querySelectorAll('.block-wrap').forEach(b => b.classList.remove('selected', 'flash'));
      const block = document.getElementById('block-' + blockId);
      block?.classList.add('selected');
      document.querySelectorAll('.thread').forEach(t => t.classList.remove('active'));
      const thread = document.querySelector('.thread[data-block="' + blockId + '"]');
      if (thread) {
        thread.classList.add('active');
        thread.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      const snippet = block?.querySelector('.block-content')?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 70);
      const label = document.getElementById('add-comment-target');
      if (label && snippet) {
        label.textContent = snippet + (snippet.length >= 70 ? '…' : '');
        label.className = 'add-comment-target selected';
      }
      const input = document.getElementById('comment-block-id');
      if (input) input.value = blockId;
      const btn = document.getElementById('comment-submit-btn');
      if (btn) btn.classList.add('ready');
      const addArea = document.querySelector('.add-comment-area');
      addArea?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      setTimeout(() => document.getElementById('comment-textarea')?.focus(), 100);
    }

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

    document.addEventListener('htmx:afterSettle', () => {
      document.querySelectorAll('.thread[data-block]').forEach(t => {
        const blockId = t.dataset.block;
        document.getElementById('block-' + blockId)?.classList.add('has-comments');
      });
    });

    // --- Easter egg: console message ---
    console.log('%c ja.codes ', 'background:#00ff87;color:#0d0d0f;font-family:monospace;font-weight:bold;font-size:14px;padding:4px 8px;border-radius:2px');
    console.log('%c> built with obsession, coffee, and too many racing sims', 'color:#6b6b78;font-family:monospace;font-size:11px');
    console.log('%c> try the konami code for a surprise...', 'color:#6b6b78;font-family:monospace;font-size:11px');

    // --- Easter egg: Konami code → race mode ---
    (function() {
      const KONAMI = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
      let pos = 0;
      let raceActive = false;
      document.addEventListener('keydown', (e) => {
        if (e.key === KONAMI[pos]) {
          pos++;
          if (pos === KONAMI.length) {
            pos = 0;
            raceActive = !raceActive;
            document.body.classList.toggle('race-mode', raceActive);
            if (raceActive) {
              console.log('%c 🏁 RACE MODE ACTIVATED ', 'background:#ff4757;color:#fff;font-family:monospace;font-weight:bold;font-size:12px;padding:4px 8px');
              showToast('🏁 Race mode activated');
            } else {
              showToast('Race mode off');
            }
          }
        } else {
          pos = e.key === KONAMI[0] ? 1 : 0;
        }
      });
    })();

    function showToast(msg) {
      const t = document.createElement('div');
      t.textContent = msg;
      Object.assign(t.style, {
        position: 'fixed', bottom: '5rem', left: '50%', transform: 'translateX(-50%)',
        background: 'var(--bg3)', border: '1px solid var(--border)',
        color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: '.8rem',
        padding: '.4rem 1rem', borderRadius: 'var(--radius)', zIndex: '999',
        pointerEvents: 'none', opacity: '0', transition: 'opacity .2s',
      });
      document.body.appendChild(t);
      requestAnimationFrame(() => { t.style.opacity = '1'; });
      setTimeout(() => {
        t.style.opacity = '0';
        setTimeout(() => t.remove(), 200);
      }, 2500);
    }
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
    return { html: '<p class="no-comments">// no comments yet</p>', total: 0 };
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
            <button class="resolve-btn" type="submit">✓ resolve</button>
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
// Entry list item (dash only)
// ---------------------------------------------------------------------------
function entryItem(e: Awaited<ReturnType<typeof listEntries>>[number], activeTag?: string, basePath = "/"): string {
  const statusBadge = `<span class="badge badge-${e.status ?? "draft"}">${h(e.status ?? "draft")}</span>`;
  const tagsHtml = [
    `<a class="tag${e.type === activeTag ? " active" : ""}" href="${basePath}?type=${h(e.type)}">${h(e.type)}</a>`,
    ...e.tags.map((t) => `<a class="tag${t === activeTag ? " active" : ""}" href="${basePath}?tag=${h(t)}">${h(t)}</a>`),
  ].join(" ");
  return `
    <li class="entry-item">
      <h3><a href="/entries/${e.id}">${h(e.title)}</a></h3>
      <div class="tags">${statusBadge} ${tagsHtml}
        <span style="color:var(--muted);font-size:.72rem;font-family:var(--mono)"> · ${new Date(e.createdAt).toLocaleDateString()}</span>
      </div>
      ${e.summary ? `<p class="summary">${h(e.summary)}</p>` : ""}
    </li>`;
}

// ---------------------------------------------------------------------------
// Post row (landing page)
// ---------------------------------------------------------------------------
function postRow(e: Awaited<ReturnType<typeof listEntries>>[number]): string {
  const dateStr = new Date(e.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const tagsHtml = e.tags.map((t) => `<a class="tag" href="/search?q=${h(t)}">${h(t)}</a>`).join("");
  return `
    <a class="post-row" href="/entries/${e.id}">
      <span class="post-title">${h(e.title)}</span>
      ${tagsHtml ? `<span class="post-tags" style="flex-shrink:0">${tagsHtml}</span>` : ""}
      <span class="post-date">${dateStr}</span>
    </a>`;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
const app = new Hono();

app.get("/", async (c) => {
  const all = await listEntries(500);
  const posts = all.filter((e) => e.type === "post" && e.status === "published");

  // Group by year
  const byYear: Record<string, typeof posts> = {};
  for (const p of posts) {
    const year = new Date(p.createdAt).getFullYear().toString();
    (byYear[year] ??= []).push(p);
  }
  const years = Object.keys(byYear).sort((a, b) => Number(b) - Number(a));

  const postListHtml = years.length === 0
    ? `<p style="color:var(--muted);font-family:var(--mono);font-size:.85rem">// nothing published yet</p>`
    : years.map((year) => `
        <div class="year-group">
          <div class="year-label">${year}</div>
          ${byYear[year].map(postRow).join("")}
        </div>`).join("");

  const body = `
    <div class="hero">
      <h1 class="hero-title">Jonathan Arellano<span class="cursor"></span></h1>
      <p class="hero-sub">Engineer. Sim racer. Building things at the intersection of AI and developer tooling. Writing about what I learn.</p>
      <div class="hero-links">
        <a class="hero-link" href="https://github.com/jarellano01" target="_blank" rel="noopener">github</a>
      </div>
    </div>
    <div class="section-heading">writing</div>
    ${postListHtml}
  `;

  return c.html(layout("Home", body));
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
    ? `<div class="filters"><span>filtered by:</span> <a class="tag active" href="#">${h(activeFilter)}</a> <a href="/dash" style="font-size:.8rem;color:var(--muted)">✕ clear</a></div>`
    : "";
  return c.html(layout("Dashboard", `
    <div class="section-heading">all entries</div>
    ${filtersBar}
    <ul class="entry-list">${filtered.map((e) => entryItem(e, activeFilter, "/dash")).join("") || `<p style="color:var(--muted)">// no entries match</p>`}</ul>
  `, "", true));
});

app.get("/search", async (c) => {
  const q = c.req.query("q")?.trim() ?? "";
  if (!q) return c.redirect("/");
  const queryEmbedding = await generateEmbedding(q);
  const results = (await searchEntries(q, queryEmbedding)).filter((e) => e.type === "post");
  const items = results.length === 0
    ? `<p style="color:var(--muted);font-family:var(--mono);font-size:.85rem">// no results for "${h(q)}"</p>`
    : results.map(postRow).join("");
  return c.html(layout(`Search: ${q}`, `
    <div class="search-header"><h2>results for "<em>${h(q)}</em>"</h2></div>
    ${items}
  `, q));
});

app.get("/dash/search", async (c) => {
  const q = c.req.query("q")?.trim() ?? "";
  if (!q) return c.redirect("/dash");
  const queryEmbedding = await generateEmbedding(q);
  const results = await searchEntries(q, queryEmbedding);
  const items = results.length === 0
    ? `<p style="color:var(--muted)">// no results for "${h(q)}"</p>`
    : results.map((e) => entryItem(e)).join("");
  return c.html(layout(`Search: ${q}`, `
    <div class="section-heading">results for "<em>${h(q)}</em>"</div>
    <ul class="entry-list">${items}</ul>
  `, q, true));
});

app.get("/entries/:id", async (c) => {
  const { id } = c.req.param();
  const [entry, entryBlocks] = await Promise.all([getEntryById(id), getBlocksByEntry(id)]);
  if (!entry) return c.notFound();

  const status = entry.status ?? "draft";
  const badgeHtml = `<span class="badge badge-${status}">${h(status)}</span>`;
  const tagsHtml = entry.tags.map((t) => `<a class="tag" href="/search?q=${h(t)}">${h(t)}</a>`).join(" ");

  const hasTextBlocks = entryBlocks.some((b) => b.type !== "image");
  const blocksToRender = hasTextBlocks ? entryBlocks : [];

  const isPublished = status === "published";

  // Only load comment data for non-published entries
  const hasCommentsSet = new Set<string>();
  let sidebar = "";

  if (!isPublished) {
    const commentCounts = await Promise.all(
      blocksToRender.map(async (b) => ({
        id: b.id,
        count: (await getCommentsByBlock(b.id)).filter((c) => c.resolved === "false").length,
      }))
    );
    commentCounts.filter((x) => x.count > 0).forEach((x) => hasCommentsSet.add(x.id));

    const { html: threadsHtml, total } = await sidebarThreadsHtml(entryBlocks, id);
    sidebar = `
      <div class="drawer-backdrop" id="drawer-backdrop" onclick="closeDrawer()"></div>
      <button class="comments-fab" onclick="openDrawer()" aria-label="Open comments">💬</button>
      <aside class="comments-sidebar" id="comments-drawer">
        <div class="sidebar-header">
          comments <span class="count">${total > 0 ? `(${total})` : ""}</span>
          <button class="close-btn" onclick="closeDrawer()" aria-label="Close">✕</button>
        </div>
        <div id="sidebar-threads">${threadsHtml}</div>
        <div class="add-comment-area">
          <div id="add-comment-target" class="add-comment-target">← click a block to comment</div>
          <form method="post" action="/entries/${id}/comments"
                hx-post="/entries/${id}/comments"
                hx-target="#sidebar-threads"
                hx-swap="innerHTML"
                hx-on::after-request="this.reset(); clearCommentTarget()">
            <input type="hidden" id="comment-block-id" name="blockId" />
            <textarea id="comment-textarea" name="body" placeholder="add a comment…" required></textarea>
            <button id="comment-submit-btn" type="submit">comment</button>
          </form>
        </div>
      </aside>`;
  }

  const blocksHtml = blocksToRender.map((b) => `
    <div class="block-wrap${!isPublished && hasCommentsSet.has(b.id) ? " has-comments" : ""}" id="block-${b.id}"
         ${!isPublished ? `onclick="handleBlockClick('${b.id}', event)"` : ""}>
      <div class="block-content prose">${renderBlock(b)}</div>
    </div>`).join("");

  const fallbackHtml = hasTextBlocks ? "" : `<div class="prose">${renderMarkdown(entry.content)}</div>`;

  return c.html(layout(entry.title, `
    <a class="back-link" href="javascript:history.back()">← back</a>
    <div class="article-header">
      <h1 class="article-title">${h(entry.title)}</h1>
      <div class="meta">
        ${isPublished ? "" : `${badgeHtml}<span class="sep">·</span>`}
        <span>${new Date(entry.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</span>
        ${tagsHtml ? `<span class="sep">·</span> ${tagsHtml}` : ""}
      </div>
      ${entry.summary ? `<blockquote class="entry-summary">${h(entry.summary)}</blockquote>` : ""}
    </div>
    <div class="entry-layout">${blocksHtml}${fallbackHtml}</div>
    ${sidebar}
  `, "", false, true));
});

// Add comment
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
  console.log(`wikibase server running at http://localhost:${PORT}`);
});

"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import katex from "katex";

function MarkdownTable({ children }: { children?: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const dialogId = useId();
  const dialogScrollerRef = useRef<HTMLDivElement>(null);
  const table = <table className="cubad-md-table">{children}</table>;

  useEffect(() => {
    if (!expanded) return;
    dialogScrollerRef.current?.scrollTo({ left: 0, top: 0 });
  }, [expanded]);

  return (
    <figure className="cubad-md-table-shell">
      <div className="cubad-md-table-actions">
        <button
          type="button"
          className="cubad-md-table-expand"
          onClick={() => setExpanded(true)}
          aria-haspopup="dialog"
          aria-controls={expanded ? dialogId : undefined}
          title="Expand table"
        >
          <span aria-hidden>↗</span>
          <span>Expand</span>
        </button>
      </div>
      <div className="thin-scroll cubad-md-table-scroll" tabIndex={0}>
        {table}
      </div>
      {expanded && (
        <div
          id={dialogId}
          role="dialog"
          aria-modal="true"
          aria-label="Expanded table"
          className="no-print fixed inset-0 z-[80] flex items-center justify-center bg-ink/45 p-3 sm:p-6"
          onClick={() => setExpanded(false)}
        >
          <div
            className="flex max-h-[86vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line bg-card px-4 py-3">
              <p className="text-sm font-semibold text-deniz-deep">Table</p>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="rounded-full px-2.5 py-1 text-ink-soft hover:bg-wash"
                aria-label="Close table"
              >
                ×
              </button>
            </div>
            <div ref={dialogScrollerRef} className="thin-scroll overflow-auto p-3 sm:p-4">
              <table className="cubad-md-table cubad-md-table-expanded">{children}</table>
            </div>
          </div>
        </div>
      )}
    </figure>
  );
}

const tableDividerRe = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const pipeLineRe = /\|/;
const htmlBreakRe = /<br\s*\/?>/gi;

function isPipeTable(markdown: string) {
  return markdown
    .trim()
    .split(/\r?\n/)
    .some((line) => tableDividerRe.test(line));
}

function normalizeTableBreaks(markdown: string) {
  return markdown.replace(htmlBreakRe, " / ");
}

function normalizePipeTableBlocks(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  const tableLineIndexes = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    if (!tableDividerRe.test(lines[i])) continue;

    let start = i - 1;
    while (start >= 0 && lines[start].trim() && pipeLineRe.test(lines[start])) {
      start--;
    }
    start++;

    let end = i + 1;
    while (end < lines.length && lines[end].trim() && pipeLineRe.test(lines[end])) {
      end++;
    }

    if (start < i && end > i + 1) {
      for (let lineIndex = start; lineIndex < end; lineIndex++) {
        tableLineIndexes.add(lineIndex);
      }
    }
  }

  return lines
    .map((line, index) => (tableLineIndexes.has(index) ? normalizeTableBreaks(line) : line))
    .join("\n");
}

export function normalizeMarkdown(markdown: string) {
  // Gemini sometimes fences Markdown tables and uses <br> inside cells; keep cleanup table-scoped.
  const unfenced = markdown
    .replace(/```(?:markdown|md)?[ \t]*\r?\n([\s\S]*?)```/gi, (match, block: string) =>
      isPipeTable(block) ? normalizePipeTableBlocks(block.trim()) : match
    )
    .replace(/~~~(?:markdown|md)?[ \t]*\r?\n([\s\S]*?)~~~/gi, (match, block: string) =>
      isPipeTable(block) ? normalizePipeTableBlocks(block.trim()) : match
    );

  return normalizePipeTableBlocks(unfenced);
}

/** Markdown + LaTeX renderer for content fields. */
export function Md({ children, className = "" }: { children: string; className?: string }) {
  const markdown = normalizeMarkdown(children);
  return (
    <div className={`prose-cubad ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
        components={{
          table: ({ children }) => <MarkdownTable>{children}</MarkdownTable>,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

/** Renders a raw LaTeX string (no markdown) as display math. */
export function Tex({ tex, block = true }: { tex: string; block?: boolean }) {
  const html = katex.renderToString(tex, {
    displayMode: block,
    strict: false,
    throwOnError: false,
  });
  return (
    <span
      className={block ? "block overflow-x-auto" : ""}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

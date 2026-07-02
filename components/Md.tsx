"use client";

import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import katex from "katex";

/** Markdown + LaTeX renderer for content fields. */
export function Md({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div className={`prose-cubad ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
      >
        {children}
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

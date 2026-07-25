import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

import type { Components } from "react-markdown";

/**
 * Token-driven styles for rendered markdown.
 *
 * The repo ships no typography plugin, so `prose prose-invert` resolves to
 * nothing — every markdown surface has to style its own descendants, and doing
 * that per feature is how three call sites drifted apart. This is the one
 * definition: headings, lists, code, tables, links, quotes, all on the console's
 * type and colour tokens.
 *
 * It styles the block; it does not give it a measure. Prose gets
 * `max-w-[66ch]` from the caller, because a markdown block rendering a wide
 * table wants the full pane.
 */
export const markdownClass = cn(
  "space-y-2 break-words text-ui leading-relaxed text-body",
  "[&_h1]:text-head [&_h1]:font-semibold [&_h1]:text-primary",
  "[&_h2]:text-num [&_h2]:font-semibold [&_h2]:text-primary",
  "[&_h3]:text-ui [&_h3]:font-semibold [&_h3]:text-primary",
  "[&_strong]:font-semibold [&_strong]:text-primary",
  "[&_a]:text-accent-cyan [&_a]:underline [&_a]:decoration-dotted [&_a]:underline-offset-4",
  "[&_ul]:list-disc [&_ol]:list-decimal [&_li]:ml-4 [&_ul]:space-y-1 [&_ol]:space-y-1",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-accent-violet/60 [&_blockquote]:pl-3 [&_blockquote]:text-muted",
  "[&_code]:rounded-chip [&_code]:bg-surface-strong [&_code]:px-1 [&_code]:font-mono [&_code]:text-instrument [&_code]:text-accent-cyan",
  "[&_pre]:overflow-x-auto [&_pre]:rounded-control [&_pre]:border [&_pre]:border-hairline [&_pre]:bg-surface [&_pre]:p-2",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-body",
  "[&_table]:w-full [&_th]:py-1 [&_th]:text-left [&_th]:font-medium [&_th]:text-primary",
  "[&_td]:border-t [&_td]:border-hairline [&_td]:py-1",
  "[&_hr]:border-hairline",
);

const REMARK_PLUGINS = [remarkGfm];

// Links leave the app, so they open in a new tab; everything else is styled by
// `markdownClass` rather than by a component override, which keeps this map at
// exactly the one behaviour that isn't styling.
const COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
};

type MarkdownProps = {
  children: string;
  /** Extra classes for the wrapper — this is where a measure (`max-w-[66ch]`) goes. */
  className?: string;
};

/** Rendered markdown on the console's tokens. */
export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={cn(markdownClass, className)}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

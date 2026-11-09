import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/**
 * Renders model- or user-authored Markdown. Raw HTML is not rendered
 * (react-markdown default), links open in a new tab without referrer, and
 * images are not loaded, so content cannot inject markup or beacon out.
 */
export function Markdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn("min-w-0 space-y-3 text-sm leading-relaxed [overflow-wrap:anywhere] [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          h1: ({ children }) => <h2 className="text-lg font-semibold tracking-tight">{children}</h2>,
          h2: ({ children }) => <h3 className="pt-1 text-base font-semibold">{children}</h3>,
          h3: ({ children }) => <h4 className="pt-1 text-sm font-semibold">{children}</h4>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer noopener" className="text-primary underline underline-offset-2">{children}</a>,
          img: ({ alt }) => <span className="text-muted-foreground">[image: {alt ?? "not loaded"}]</span>,
          blockquote: ({ children }) => <blockquote className="border-l-2 pl-3 text-muted-foreground">{children}</blockquote>,
          table: ({ children }) => <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-sm">{children}</table></div>,
          th: ({ children }) => <th className="border-b px-2 py-1.5 font-medium">{children}</th>,
          td: ({ children }) => <td className="border-b px-2 py-1.5 align-top">{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export function JsonView({ value, className }: { value: unknown; className?: string }) {
  return (
    <pre className={cn("max-h-96 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed", className)}>
      {value === null || value === undefined ? "—" : JSON.stringify(value, null, 2)}
    </pre>
  );
}

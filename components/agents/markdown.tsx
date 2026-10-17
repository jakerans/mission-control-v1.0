import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

// Compact Markdown styling for agent replies and plans (no typography plugin in this project).
const components: Components = {
  p: (props) => <p className="leading-relaxed" {...props} />,
  h1: (props) => <h3 className="mt-1 text-base font-bold" {...props} />,
  h2: (props) => <h3 className="mt-1 text-[15px] font-bold" {...props} />,
  h3: (props) => <h4 className="mt-1 font-semibold" {...props} />,
  h4: (props) => <h4 className="mt-1 font-semibold" {...props} />,
  ul: (props) => <ul className="list-disc space-y-1 pl-5" {...props} />,
  ol: (props) => <ol className="list-decimal space-y-1 pl-5" {...props} />,
  li: (props) => <li className="leading-relaxed marker:text-muted-foreground" {...props} />,
  a: (props) => <a className="font-medium text-primary underline underline-offset-2" target="_blank" rel="noreferrer" {...props} />,
  blockquote: (props) => <blockquote className="border-l-2 pl-3 text-muted-foreground" {...props} />,
  hr: () => <hr className="border-border" />,
  pre: (props) => <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed [&_code]:bg-transparent [&_code]:p-0" {...props} />,
  code: (props) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...props} />,
  table: (props) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs" {...props} />
    </div>
  ),
  th: (props) => <th className="border-b px-2 py-1.5 text-left font-semibold" {...props} />,
  td: (props) => <td className="border-b border-border/60 px-2 py-1.5 align-top" {...props} />,
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2.5 text-sm wrap-break-word", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

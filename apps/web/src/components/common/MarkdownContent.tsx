import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import type { MarkdownBlock } from "../../types/app.js";

export const SakiPathOpenContext = createContext<((path: string, line?: number) => void) | undefined>(undefined);

const workspaceRefPattern =
  /^((?:[A-Za-z]:)?[\p{L}\p{N}_./\\ -]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|json|md|css|html|vue|svelte|toml|ya?ml))(?::(\d+))?$/iu;
function parseWorkspaceRef(raw: string): { path: string; line?: number } | null {
  const match = raw.trim().match(workspaceRefPattern);
  if (!match?.[1]) return null;
  const path = match[1].replace(/\\/g, "/");
  const line = match[2] ? Number(match[2]) : undefined;
  return {
    path,
    ...(Number.isInteger(line) && line && line > 0 ? { line } : {})
  };
}

function renderPathButton(
  label: string,
  ref: { path: string; line?: number },
  key: string,
  onOpenPath: ((path: string, line?: number) => void) | undefined
): React.ReactNode {
  if (!onOpenPath) return <code key={key}>{label}</code>;
  return (
    <button
      key={key}
      type="button"
      className="saki-md-path"
      title={`打开 ${ref.path}${ref.line ? `:${ref.line}` : ""}`}
      onClick={() => onOpenPath(ref.path, ref.line)}
    >
      <code>{label}</code>
    </button>
  );
}

function isMarkdownBoundary(line: string): boolean {
  const trimmed = line.trim();
  return (
    /^(?:`{3,}|~{3,})/.test(trimmed) ||
    /^#{1,4}\s+/.test(trimmed) ||
    /^>\s?/.test(trimmed) ||
    /^[-*+]\s+/.test(trimmed) ||
    /^\d+[.)]\s+/.test(trimmed)
  );
}

function splitTableRow(line: string): string[] {
  const cells: string[] = [];
  const text = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  let cell = "";
  let codeDelimiter = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === "\\" && text[index + 1] === "|") { cell += "|"; index += 1; continue; }
    if (char === "`") {
      const delimiter = text.slice(index).match(/^`+/)![0];
      codeDelimiter = codeDelimiter === delimiter ? "" : codeDelimiter || delimiter;
      cell += delimiter; index += delimiter.length - 1; continue;
    }
    if (char === "|" && !codeDelimiter) { cells.push(cell.trim()); cell = ""; }
    else cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function tableHeader(lines: string[], index: number): Extract<MarkdownBlock, { type: "table" }> | null {
  if (!lines[index]?.includes("|") || !lines[index + 1]?.includes("-")) return null;
  const headers = splitTableRow(lines[index]!);
  const delimiters = splitTableRow(lines[index + 1]!);
  if (headers.length !== delimiters.length || !delimiters.every((cell) => /^:?-{3,}:?$/.test(cell))) return null;
  return { type: "table", headers, rows: [], alignments: delimiters.map((cell) => cell.startsWith(":") ? cell.endsWith(":") ? "center" : "left" : cell.endsWith(":") ? "right" : undefined) };
}

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    const codeMatch = trimmed.match(/^(`{3,}|~{3,})([^\s]*)/);
    if (codeMatch) {
      const codeLines: string[] = [];
      index += 1;
      const closingFence = new RegExp(`^${codeMatch[1]![0]}{${codeMatch[1]!.length},}\\s*$`);
      while (index < lines.length && !closingFence.test((lines[index] ?? "").trim())) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", language: codeMatch[2] ?? "", code: codeLines.join("\n") });
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({ type: "heading", level: headingMatch[1]?.length ?? 1, text: headingMatch[2] ?? "" });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test((lines[index] ?? "").trim())) {
        quoteLines.push((lines[index] ?? "").trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "quote", text: quoteLines.join("\n") });
      continue;
    }

    const unorderedMatch = trimmed.match(/^[-*+]\s+(.+)$/);
    const orderedMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (unorderedMatch || orderedMatch) {
      const ordered = Boolean(orderedMatch);
      const items: string[] = [];
      while (index < lines.length) {
        const itemLine = (lines[index] ?? "").trim();
        const itemMatch = ordered ? itemLine.match(/^\d+[.)]\s+(.+)$/) : itemLine.match(/^[-*+]\s+(.+)$/);
        if (!itemMatch) break;
        items.push(itemMatch[1] ?? "");
        index += 1;
      }
      blocks.push({ type: "list", ordered, items, ...(ordered ? { start: Number(trimmed.match(/^\d+/)![0]) } : {}) });
      continue;
    }

    const table = tableHeader(lines, index);
    if (table) {
      index += 2;
      while (index < lines.length && lines[index]?.trim() && lines[index]!.includes("|") && !isMarkdownBoundary(lines[index]!)) {
        const cells = splitTableRow(lines[index++]!);
        table.rows.push(table.headers.map((_header, column) => cells[column] ?? ""));
      }
      blocks.push(table);
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const paragraphLine = lines[index] ?? "";
      if (!paragraphLine.trim() || (paragraphLines.length > 0 && (isMarkdownBoundary(paragraphLine) || tableHeader(lines, index)))) break;
      paragraphLines.push(paragraphLine);
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join("\n") });
  }

  return blocks.length ? blocks : [{ type: "paragraph", text: "" }];
}

function safeMarkdownHref(rawHref: string): string | null {
  const href = rawHref.trim();
  if (!href) return null;
  if (href.startsWith("#") || href.startsWith("/")) return href;
  if (/^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(href)) return href;
  try {
    const parsed = new URL(href);
    return parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:" ? href : null;
  } catch {
    return null;
  }
}

function safeMarkdownImageSrc(rawSrc: string): string | null {
  const src = rawSrc.trim();
  if (!src) return null;
  if (/^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(src)) return src;
  if (src.startsWith("/")) return src;
  try {
    const parsed = new URL(src);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? src : null;
  } catch {
    return null;
  }
}

function renderPlainWithPathRefs(
  text: string,
  keyPrefix: string,
  onOpenPath: ((path: string, line?: number) => void) | undefined
): React.ReactNode[] {
  if (!text) return [text];
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  const pattern = /https?:\/\/[^\s<>"`]+|(?<![A-Za-z0-9_./])([A-Za-z0-9_./\\-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|json|md|css|html|vue|svelte|toml|ya?ml):(\d+))/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    if (/^https?:\/\//i.test(match[0])) {
      let url = match[0].replace(/[.,;!?。，；！？、]+$/u, "");
      while (url.endsWith(")") && (url.match(/\)/g)?.length ?? 0) > (url.match(/\(/g)?.length ?? 0)) url = url.slice(0, -1);
      const href = safeMarkdownHref(url);
      nodes.push(href ? <a key={`${keyPrefix}-url-${match.index}`} href={href} target="_blank" rel="noopener noreferrer">{url}</a> : url);
      if (url.length < match[0].length) nodes.push(match[0].slice(url.length));
      cursor = match.index + match[0].length;
      continue;
    }
    const ref = parseWorkspaceRef(match[1] ?? "");
    if (onOpenPath && ref) {
      nodes.push(renderPathButton(match[0], ref, `${keyPrefix}-ref-${match.index}`, onOpenPath));
    } else {
      nodes.push(match[0]);
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes.length ? nodes : [text];
}

function renderInlineMarkdown(
  text: string,
  keyPrefix: string,
  onOpenPath?: ((path: string, line?: number) => void) | undefined
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(`([^`]+)`|\*\*([^*]+)\*\*|!\[([^\]]*)\]\((<[^>\n]+>|(?:[^\s()]|\([^\s()]*\))+)\)|\[([^\]]+)\]\((<[^>\n]+>|(?:[^\s()]|\([^\s()]*\))+)\)|<(https?:\/\/[^<>\s]+)>)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > cursor) {
      nodes.push(...renderPlainWithPathRefs(text.slice(cursor, match.index), `${keyPrefix}-${match.index}`, onOpenPath));
    }
    const token = match[0];
    if (token.startsWith("`")) {
      const code = match[2] ?? "";
      const ref = parseWorkspaceRef(code);
      nodes.push(ref ? renderPathButton(code, ref, `${keyPrefix}-code-${match.index}`, onOpenPath) : <code key={`${keyPrefix}-code-${match.index}`}>{code}</code>);
    } else if (token.startsWith("<")) {
      const href = safeMarkdownHref(match[8] ?? "");
      nodes.push(href ? <a href={href} key={`${keyPrefix}-autolink-${match.index}`} target="_blank" rel="noopener noreferrer">{href}</a> : token);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={`${keyPrefix}-strong-${match.index}`}>{match[3] ?? ""}</strong>);
    } else if (token.startsWith("![")) {
      const src = safeMarkdownImageSrc((match[5] ?? "").replace(/^<|>$/g, ""));
      const alt = match[4] ?? "";
      nodes.push(
        src ? (
          <img className="saki-md-image" src={src} alt={alt} key={`${keyPrefix}-img-${match.index}`} draggable={false} />
        ) : (
          alt || token
        )
      );
    } else {
      const destination = (match[7] ?? "").replace(/^<|>$/g, "");
      const ref = parseWorkspaceRef(destination);
      if (onOpenPath && ref) {
        nodes.push(renderPathButton(match[6] ?? destination, ref, `${keyPrefix}-link-${match.index}`, onOpenPath));
        cursor = match.index + token.length;
        continue;
      }
      const href = safeMarkdownHref(destination);
      nodes.push(
        href ? (
          <a href={href} key={`${keyPrefix}-link-${match.index}`} rel="noreferrer" target={href.startsWith("/") || href.startsWith("#") ? undefined : "_blank"}>
            {match[6] ?? href}
          </a>
        ) : (
          match[6] ?? token
        )
      );
    }
    cursor = match.index + token.length;
  }

  if (cursor < text.length) nodes.push(...renderPlainWithPathRefs(text.slice(cursor), `${keyPrefix}-tail`, onOpenPath));
  return nodes;
}

function renderInlineLines(text: string, keyPrefix: string, onOpenPath?: ((path: string, line?: number) => void) | undefined): React.ReactNode[] {
  return text.split("\n").flatMap((line, index) => {
    const nodes = renderInlineMarkdown(line, `${keyPrefix}-${index}`, onOpenPath);
    return index === 0 ? nodes : [<br key={`${keyPrefix}-br-${index}`} />, ...nodes];
  });
}

function SakiCodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    };
  }, []);

  async function copyCode(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = code;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setCopied(true);
    if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      copiedTimerRef.current = null;
    }, 1600);
  }

  return (
    <div className={`saki-code-block${copied ? " is-copied" : ""}`}>
      <div className="saki-code-toolbar">
        <span className="saki-code-lang">{language || "code"}</span>
        <button
          className="saki-code-copy"
          type="button"
          title={copied ? "已复制" : "复制代码"}
          aria-label={copied ? "已复制" : "复制代码"}
          onClick={(event) => void copyCode(event)}
        >
          {copied ? <Check size={15} strokeWidth={2.2} /> : <Copy size={15} strokeWidth={2.2} />}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function MarkdownContent({ content }: { content: string }) {
  const onOpenPath = useContext(SakiPathOpenContext);
  const blocks = parseMarkdownBlocks(content);
  return (
    <div className="saki-markdown">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const children = renderInlineMarkdown(block.text, `heading-${index}`, onOpenPath);
          if (block.level <= 1) return <h3 key={index}>{children}</h3>;
          if (block.level === 2) return <h4 key={index}>{children}</h4>;
          return <h5 key={index}>{children}</h5>;
        }
        if (block.type === "quote") {
          return <blockquote key={index}>{renderInlineLines(block.text, `quote-${index}`, onOpenPath)}</blockquote>;
        }
        if (block.type === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag key={index} {...(block.ordered ? { start: block.start } : {})}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInlineLines(item, `list-${index}-${itemIndex}`, onOpenPath)}</li>
              ))}
            </ListTag>
          );
        }
        if (block.type === "table") {
          return <div className="saki-md-table-scroll" key={index} tabIndex={0} role="region" aria-label="表格，可横向滚动">
            <table><thead><tr>{block.headers.map((header, column) => <th key={column} style={{ textAlign: block.alignments[column] }}>{renderInlineMarkdown(header, `table-${index}-head-${column}`, onOpenPath)}</th>)}</tr></thead>
              <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, column) => <td key={column} style={{ textAlign: block.alignments[column] }}>{renderInlineMarkdown(cell, `table-${index}-${rowIndex}-${column}`, onOpenPath)}</td>)}</tr>)}</tbody>
            </table>
          </div>;
        }
        if (block.type === "code") {
          return <SakiCodeBlock key={index} language={block.language} code={block.code} />;
        }
        return <p key={index}>{renderInlineLines(block.text, `paragraph-${index}`, onOpenPath)}</p>;
      })}
    </div>
  );
}

function FilePreview({ content, kind }: { content: string; kind: "html" | "markdown" | "image" }) {
  if (kind === "image") {
    return (
      <div className="image-file-preview">
        <img alt="" draggable={false} src={content} />
      </div>
    );
  }

  if (kind === "html") {
    return (
      <iframe
        className="html-file-preview"
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={content}
        title="HTML preview"
      />
    );
  }

  return (
    <div className="markdown-file-preview">
      <MarkdownContent content={content} />
    </div>
  );
}

export { MarkdownContent, FilePreview, parseMarkdownBlocks };

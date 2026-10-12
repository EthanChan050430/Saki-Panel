import React from "react";
import { ArrowUpRight } from "lucide-react";
import type { SakiAgentAction } from "@webops/shared";

export interface SakiWebSource { title: string; url: string; snippet: string }

// Understand persisted search/browse observations too, without requiring users
// to regenerate old conversations when the presentation changes.
export function sakiWebSources(observation: string): SakiWebSource[] {
  const sources: SakiWebSource[] = [];
  const seen = new Set<string>();
  const lines = observation.split(/\r?\n/);
  for (let index = 0; index < lines.length && sources.length < 12; index += 1) {
    const line = lines[index]!.trim();
    const urlText = line.replace(/^URL:\s*/i, "");
    if (!/^https?:\/\/\S+$/i.test(urlText)) continue;
    try {
      const url = new URL(urlText);
      if (url.username || url.password || seen.has(url.href)) continue;
      const preceding = lines[index - 1]?.match(/^\d+\.\s+(.+)/)?.[1];
      const followingTitle = lines[index + 1]?.match(/^Title:\s*(.+)/i)?.[1];
      sources.push({ title: preceding || followingTitle || url.hostname, url: url.href, snippet: preceding ? (lines[index + 1] ?? "").trim() : "" });
      seen.add(url.href);
    } catch { /* Malformed or unsafe links never become clickable. */ }
  }
  return sources;
}

export function isSakiWebTool(tool: string): boolean {
  return ["searchweb", "websearch", "researchweb", "webresearch", "browse", "browseurl", "readurl", "fetchpage", "crawl", "crawlweb", "crawlsite"].includes(tool.replace(/[_-]/g, "").toLowerCase());
}

export function SakiWebSources({ action, expanded }: { action: SakiAgentAction; expanded: boolean }) {
  const sources = action.ok ? sakiWebSources(action.observation) : [];
  if (!sources.length) return null;
  return <ul className="saki-web-sources" aria-label="网页来源">
    {sources.slice(0, expanded ? sources.length : 3).map((source) => <li key={source.url}>
      <a href={source.url} target="_blank" rel="noopener noreferrer" title={source.url}>
        <span className="saki-web-source-title">{source.title}</span><ArrowUpRight size={13} aria-hidden="true" />
        <span className="saki-web-source-host">{new URL(source.url).hostname.replace(/^www\./, "")}</span>
      </a>
      {expanded && source.snippet ? <p>{source.snippet}</p> : null}
    </li>)}
  </ul>;
}

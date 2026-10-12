import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  BrowseHttpError,
  currentAgentAbortSignal,
  linkAgentAbortSignal,
  RequestTimeoutError,
  htmlDecode,
  numericArg,
  RouteError,
  stripHtml,
  truncateText,
  trimString,
  userFacingError,
  webUserAgent,
  type WebPageSnapshot,
  type WebSearchResult
} from "./types.js";

export function normalizeHttpUrl(rawUrl: string): URL {
  const trimmed = trimString(rawUrl);
  if (!trimmed) throw new RouteError("URL is required.", 400);
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withProtocol);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new RouteError("Only http and https URLs can be browsed.", 400);
  }
  if (url.username || url.password) {
    throw new RouteError("Saki blocked URLs containing credentials.", 403);
  }
  url.hash = "";
  return url;
}

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    return (
      /^0\./.test(address) ||
      /^10\./.test(address) ||
      /^127\./.test(address) ||
      /^169\.254\./.test(address) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(address) ||
      /^192\.168\./.test(address) ||
      /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address) ||
      /^2(2[4-9]|3\d)\./.test(address) ||
      address === "255.255.255.255"
    );
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80") ||
      normalized.startsWith("::ffff:127.") ||
      normalized.startsWith("::ffff:10.") ||
      normalized.startsWith("::ffff:192.168.") ||
      /^::ffff:172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)
    );
  }
  return false;
}

export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  const url = normalizeHttpUrl(rawUrl);
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    isPrivateAddress(host)
  ) {
    throw new RouteError("Saki blocked browsing private network URLs.", 403);
  }
  try {
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: false });
    if (addresses.some((entry) => isPrivateAddress(entry.address))) {
      throw new RouteError("Saki blocked browsing private network URLs.", 403);
    }
  } catch (error) {
    if (error instanceof RouteError) throw error;
    throw new RouteError(`Could not resolve URL host '${host}'.`, 400);
  }
  return url;
}

function extractHtmlTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return stripHtml(match?.[1] ?? "").slice(0, 180);
}

function decodeDuckDuckGoHref(rawHref: string): string {
  const decoded = htmlDecode(rawHref);
  try {
    const parsed = new URL(decoded, "https://duckduckgo.com");
    return parsed.searchParams.get("uddg") ?? parsed.toString();
  } catch {
    return decoded;
  }
}

function extractPageLinks(html: string, baseUrl: URL, sameHostOnly: boolean): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  const regex = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) && links.length < 80) {
    const href = htmlDecode(match[1] ?? "").trim();
    if (!href || /^(?:javascript|mailto|tel|data):/i.test(href)) continue;
    try {
      const url = new URL(href, baseUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      if (sameHostOnly && url.hostname !== baseUrl.hostname) continue;
      url.hash = "";
      const key = url.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      links.push(key);
    } catch {
      // Ignore malformed page links.
    }
  }
  return links;
}

async function fetchPublicText(rawUrl: string, accept: string, timeoutMs = 15000): Promise<{ url: URL; response: Response; text: string }> {
  const controller = new AbortController();
  const unlink = linkAgentAbortSignal(controller);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    let nextUrl = rawUrl;
    for (let redirects = 0; redirects <= 4; redirects += 1) {
      const url = await assertPublicHttpUrl(nextUrl);
      const response = await fetch(url, { redirect: "manual", signal: controller.signal, headers: { accept, "user-agent": webUserAgent } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) throw new Error("Redirect response missing Location");
        nextUrl = new URL(location, url).toString();
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new BrowseHttpError(url.toString(), response.status, response.statusText); }
      const reader = response.body?.getReader();
      if (!reader) return { url, response, text: "" };
      const decoder = new TextDecoder();
      let text = "";
      let bytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 2 * 1024 * 1024) { await reader.cancel(); throw new Error("Web response exceeds 2 MiB; use a more specific page"); }
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } finally { reader.releaseLock(); }
      return { url, response, text };
    }
    throw new Error("Too many web redirects");
  } catch (error) {
    if (timedOut) throw new RequestTimeoutError(timeoutMs);
    throw error;
  } finally { clearTimeout(timer); unlink(); }
}

async function fetchPublicPage(rawUrl: string, maxChars = 9000): Promise<WebPageSnapshot> {
  const { url, response, text } = await fetchPublicText(rawUrl, "text/html, text/plain, application/xhtml+xml;q=0.9, */*;q=0.2");
  const contentType = response.headers.get("content-type") ?? "";
  const isHtml = /html|xml/i.test(contentType) || /<html|<body|<title/i.test(text.slice(0, 1200));
  const title = isHtml ? extractHtmlTitle(text) : "";
  const content = isHtml ? stripHtml(text) : text.replace(/\s+/g, " ").trim();
  const links = isHtml ? extractPageLinks(text, url, true) : [];
  return {
    url: url.toString(),
    title,
    content: truncateText(content, maxChars),
    links
  };
}

function formatWebPage(page: WebPageSnapshot): string {
  return [
    `URL: ${page.url}`,
    page.title ? `Title: ${page.title}` : null,
    `Same-site links found: ${page.links.length}`,
    "",
    page.content || "(no readable text extracted)"
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function decodedUrlText(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function relatedBrowseTerms(url: URL): string[] {
  const generic = new Set(["api", "class", "plugin", "plugins", "plugin-dev", "class-plugin", "pref-plugins", "dev", "docs", "index", "html"]);
  const decoded = decodedUrlText(url.pathname).toLowerCase();
  const terms: string[] = [];
  const add = (term: string) => {
    const cleaned = term.trim().replace(/^[._-]+|[._-]+$/g, "");
    if (cleaned.length < 2 || generic.has(cleaned) || terms.includes(cleaned)) return;
    terms.push(cleaned);
  };
  decoded.split(/[\s/._-]+/u).forEach(add);
  (decoded.match(/[a-z0-9][a-z0-9_.-]{1,}/g) ?? []).forEach(add);
  for (const phrase of decoded.match(/[\u3400-\u9fff]{2,}/g) ?? []) {
    add(phrase);
    for (let index = 0; index < phrase.length - 1 && terms.length < 20; index += 1) {
      add(phrase.slice(index, index + 2));
    }
  }
  return terms.slice(0, 20);
}

function browseFallbackCandidateUrls(url: URL): string[] {
  const candidates: string[] = [];
  const add = (candidate: URL | string) => {
    const value = typeof candidate === "string" ? candidate : candidate.toString();
    if (!candidates.includes(value)) candidates.push(value);
  };

  add(url);
  const host = url.hostname.toLowerCase();
  const pathSegments = url.pathname.split("/").filter(Boolean);
  if (host === "wiki.tooldelta.top") {
    const mapped = new URL(url.toString());
    mapped.hostname = "www.tooldelta.wiki";
    add(mapped);
  }

  const isToolDeltaWiki = host === "wiki.tooldelta.top" || host === "www.tooldelta.wiki";
  const toolDeltaBase = new URL(url.toString());
  if (isToolDeltaWiki) {
    toolDeltaBase.protocol = "https:";
    toolDeltaBase.hostname = "www.tooldelta.wiki";
    add(new URL("/plugin-dev", toolDeltaBase));
    add(new URL("/plugin-dev/api/pref-plugins", toolDeltaBase));
    const lastSegment = pathSegments.at(-1);
    if (lastSegment) {
      add(new URL(`/plugin-dev/api/pref-plugins/${lastSegment}`, toolDeltaBase));
      add(new URL(`/plugin-dev/class-plugin/${lastSegment}`, toolDeltaBase));
    }
  }

  for (let length = pathSegments.length - 1; length > 0 && candidates.length < 10; length -= 1) {
    const parent = new URL(url.toString());
    parent.pathname = `/${pathSegments.slice(0, length).join("/")}`;
    parent.search = "";
    add(parent);
    if (isToolDeltaWiki) {
      const mappedParent = new URL(parent.toString());
      mappedParent.protocol = "https:";
      mappedParent.hostname = "www.tooldelta.wiki";
      add(mappedParent);
    }
  }

  return candidates.slice(0, 10);
}

function linkLooksRelated(link: string, terms: string[]): boolean {
  if (terms.length === 0) return false;
  const decoded = decodedUrlText(link).toLowerCase();
  return terms.some((term) => decoded.includes(term));
}

async function browseMissingPageFallback(error: BrowseHttpError, rawUrl: string): Promise<string> {
  const original = await assertPublicHttpUrl(rawUrl);
  const terms = relatedBrowseTerms(original);
  const checked: string[] = [];
  const relatedLinks: string[] = [];
  const readablePages: string[] = [];

  for (const candidate of browseFallbackCandidateUrls(original)) {
    if (candidate === error.url) continue;
    if (checked.length >= 6) break;
    try {
      const page = await fetchPublicPage(candidate, 2400);
      checked.push(page.title ? `${page.url} (${page.title})` : page.url);
      const related = page.links.filter((link) => linkLooksRelated(link, terms));
      for (const link of related) {
        if (!relatedLinks.includes(link)) relatedLinks.push(link);
      }
      if (readablePages.length < 2) {
        readablePages.push(formatWebPage(page));
      }
    } catch {
      // Missing fallback pages are expected when a documentation route moved.
    }
  }

  return [
    `Requested URL: ${error.url}`,
    `HTTP status: ${error.httpStatus} ${error.statusText}`,
    "The exact page is missing, so no content was available at that URL.",
    "",
    checked.length ? `Fallback pages checked:\n${checked.map((item) => `- ${item}`).join("\n")}` : "Fallback pages checked: none could be read.",
    relatedLinks.length ? `\nRelated links found on fallback pages:\n${relatedLinks.slice(0, 12).map((link) => `- ${link}`).join("\n")}` : "\nRelated links found on fallback pages: none.",
    readablePages.length ? `\nReadable fallback page excerpts:\n\n${readablePages.join("\n\n---\n\n")}` : "",
    "\nContinue from the fallback pages or use searchWeb with the page title/path terms instead of stopping at this 404."
  ]
    .filter(Boolean)
    .join("\n");
}

export async function browsePublicUrl(rawUrl: string): Promise<string> {
  try {
    return formatWebPage(await fetchPublicPage(rawUrl, 9000));
  } catch (error) {
    if (error instanceof BrowseHttpError && (error.httpStatus === 404 || error.httpStatus === 410)) {
      return browseMissingPageFallback(error, rawUrl);
    }
    throw error;
  }
}

export function parseWebSearchResults(html: string, maxResults: number, rss = false): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const seen = new Set<string>();
  const add = (href: string, title: string, snippet: string) => {
    try {
      const url = normalizeHttpUrl(href);
      if (isPrivateAddress(url.hostname) || /(^|\.)localhost$/i.test(url.hostname)) return;
      const key = url.toString();
      if (seen.has(key)) return;
      seen.add(key);
      results.push({ title: stripHtml(title).slice(0, 200) || key, url: key, snippet: stripHtml(snippet).slice(0, 700) });
    } catch { /* Ignore malformed links; browse validates DNS before fetching. */ }
  };
  if (rss) {
    for (const match of html.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
      const item = match[1] ?? "";
      const field = (name: string) => htmlDecode((item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
      add(field("link"), field("title"), field("description"));
      if (results.length >= maxResults) break;
    }
    return results;
  }
  const regex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) && results.length < maxResults) {
    const attrs = match[1] ?? "";
    const className = attrs.match(/\bclass\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
    if (!/(?:^|\s)(?:result__a|result-link)(?:\s|$)/.test(className)) continue;
    const href = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const following = html.slice(regex.lastIndex, regex.lastIndex + 2500);
    const nextResult = following.search(/<a\b[^>]*\bclass\s*=\s*["'][^"']*\b(?:result__a|result-link)\b/i);
    const block = nextResult >= 0 ? following.slice(0, nextResult) : following;
    const snippetMatch = block.match(/class=["'][^"']*(?:result__snippet|result-snippet)[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div|span|td)>/i);
    add(decodeDuckDuckGoHref(href), match[2] ?? "", snippetMatch?.[1] ?? "");
  }
  return results;
}

const webSearchCache = new Map<string, { expiresAt: number; results: WebSearchResult[] }>();

async function webSearchResults(query: string, maxResultsInput?: string): Promise<WebSearchResult[]> {
  const q = trimString(query).slice(0, 300);
  if (!q) throw new RouteError("searchWeb requires a query.", 400);
  const maxResults = numericArg(maxResultsInput, 6, 1, 10);
  const key = `${q}:${maxResults}`;
  const cached = webSearchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.results;
  const encoded = encodeURIComponent(q);
  const sources = [
    { url: `https://html.duckduckgo.com/html/?q=${encoded}`, rss: false },
    { url: `https://lite.duckduckgo.com/lite/?q=${encoded}`, rss: false },
    { url: `https://www.bing.com/search?format=rss&q=${encoded}`, rss: true }
  ];
  const failures: string[] = [];
  for (const source of sources) {
    try {
      const { text } = await fetchPublicText(source.url, source.rss ? "application/rss+xml, application/xml" : "text/html", 12000);
      const results = parseWebSearchResults(text, maxResults, source.rss);
      if (!results.length) throw new Error("No readable results (empty response or search challenge)");
      webSearchCache.delete(key);
      webSearchCache.set(key, { expiresAt: Date.now() + 5 * 60 * 1000, results });
      if (webSearchCache.size > 100) webSearchCache.delete(webSearchCache.keys().next().value!);
      return results;
    } catch (error) {
      if (currentAgentAbortSignal()?.aborted) throw error;
      failures.push(`${new URL(source.url).hostname}: ${userFacingError(error)}`);
    }
  }
  throw new RouteError(`Web search unavailable. ${failures.join("; ")}. Try a direct official URL with browse or refine the query; do not infer facts from a failed search.`, 502);
}

function formatSearchResults(query: string, results: WebSearchResult[]): string {
  return [
    `Search query: ${query}`,
    `Results: ${results.length}`,
    "",
    results.map((result, index) => `${index + 1}. ${result.title}\n${result.url}${result.snippet ? `\n${result.snippet}` : ""}`).join("\n\n") ||
      "No search results found."
  ].join("\n");
}

export async function simpleWebSearch(query: string, maxResultsInput?: string): Promise<string> {
  return formatSearchResults(query, await webSearchResults(query, maxResultsInput));
}

export async function crawlPublicSite(rawUrl: string, maxPagesInput?: string, maxDepthInput?: string): Promise<string> {
  const startUrl = await assertPublicHttpUrl(rawUrl);
  const maxPages = numericArg(maxPagesInput, 4, 1, 8);
  const maxDepth = numericArg(maxDepthInput, 1, 0, 2);
  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: startUrl.toString(), depth: 0 }];
  const pages: WebPageSnapshot[] = [];

  while (queue.length > 0 && pages.length < maxPages) {
    const next = queue.shift();
    if (!next || visited.has(next.url)) continue;
    visited.add(next.url);
    let page: WebPageSnapshot;
    try {
      page = await fetchPublicPage(next.url, 4500);
    } catch (error) {
      pages.push({
        url: next.url,
        title: "",
        content: `Fetch failed: ${userFacingError(error)}`,
        links: []
      });
      continue;
    }
    pages.push(page);
    if (next.depth >= maxDepth) continue;
    for (const link of page.links) {
      if (pages.length + queue.length >= maxPages * 3) break;
      try {
        const parsed = normalizeHttpUrl(link);
        if (parsed.hostname !== startUrl.hostname || visited.has(parsed.toString())) continue;
        queue.push({ url: parsed.toString(), depth: next.depth + 1 });
      } catch {
        // Ignore bad discovered links.
      }
    }
  }

  return [
    `Crawl start: ${startUrl.toString()}`,
    `Pages fetched: ${pages.length}`,
    `Max depth: ${maxDepth}`,
    "",
    pages
      .map((page, index) =>
        [`## Page ${index + 1}`, `URL: ${page.url}`, page.title ? `Title: ${page.title}` : null, "", page.content].filter(Boolean).join("\n")
      )
      .join("\n\n---\n\n")
  ].join("\n");
}

export async function researchWeb(query: string, maxPagesInput?: string): Promise<string> {
  const maxPages = numericArg(maxPagesInput, 3, 1, 5);
  const results = await webSearchResults(query, String(maxPages));
  const pages = await Promise.all(results.slice(0, maxPages).map(async (result) => {
    try {
      return formatWebPage(await fetchPublicPage(result.url, 4200));
    } catch (error) {
      return `URL: ${result.url}\nFetch failed: ${userFacingError(error)}`;
    }
  }));
  return [formatSearchResults(query, results), "", "Fetched result pages:", "", pages.join("\n\n---\n\n") || "(none)"].join("\n");
}

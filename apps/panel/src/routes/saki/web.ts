import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  BrowseHttpError,
  fetchWithTimeout,
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

async function fetchPublicPage(rawUrl: string, maxChars = 9000): Promise<WebPageSnapshot> {
  const url = await assertPublicHttpUrl(rawUrl);
  const response = await fetchWithTimeout(
    url.toString(),
    {
      method: "GET",
      headers: {
        "accept": "text/html, text/plain, application/xhtml+xml;q=0.9, */*;q=0.2",
        "user-agent": webUserAgent
      }
    },
    15000
  );
  if (!response.ok) {
    throw new BrowseHttpError(url.toString(), response.status, response.statusText);
  }
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
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

async function webSearchResults(query: string, maxResultsInput?: string): Promise<WebSearchResult[]> {
  const q = trimString(query).slice(0, 180);
  if (!q) throw new RouteError("searchWeb requires a query.", 400);
  const maxResults = numericArg(maxResultsInput, 6, 1, 10);
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
  const response = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: {
        "accept": "text/html",
        "user-agent": webUserAgent
      }
    },
    15000
  );
  if (!response.ok) {
    throw new RouteError(`Search failed with ${response.status}: ${response.statusText}`, 502);
  }
  const html = await response.text();
  const results: WebSearchResult[] = [];
  const seen = new Set<string>();
  const regex = /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) && results.length < maxResults) {
    const href = decodeDuckDuckGoHref(match[1] ?? "");
    let parsed: URL;
    try {
      parsed = await assertPublicHttpUrl(href);
    } catch {
      continue;
    }
    const key = parsed.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    const blockEnd = html.indexOf("result__a", regex.lastIndex);
    const block = html.slice(regex.lastIndex, blockEnd === -1 ? regex.lastIndex + 2000 : blockEnd);
    const snippetMatch = block.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div|span)>/i);
    results.push({
      title: stripHtml(match[2] ?? "") || key,
      url: key,
      snippet: stripHtml(snippetMatch?.[1] ?? "")
    });
  }
  return results;
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
  const pages: string[] = [];
  for (const result of results.slice(0, maxPages)) {
    try {
      pages.push(formatWebPage(await fetchPublicPage(result.url, 4200)));
    } catch (error) {
      pages.push(`URL: ${result.url}\nFetch failed: ${userFacingError(error)}`);
    }
  }
  return [formatSearchResults(query, results), "", "Fetched result pages:", "", pages.join("\n\n---\n\n") || "(none)"].join("\n");
}

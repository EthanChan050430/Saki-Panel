import DOMPurify from "dompurify";
import { marked } from "marked";

marked.setOptions({ breaks: true, gfm: true });

function containsHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

export function sanitizeAnnouncementHtml(value: string): string {
  return DOMPurify.sanitize(value, {
    USE_PROFILES: { html: true },
    FORBID_ATTR: ["style", "class", "id"],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i
  });
}

export function renderAnnouncementContent(value: string): string {
  const source = value.trim();
  if (!source) return "";
  const html = containsHtml(source) ? source : String(marked.parse(source));
  return sanitizeAnnouncementHtml(html);
}

export function AnnouncementContent({ value }: { value: string }) {
  return <div className="announcement-rich-content" dangerouslySetInnerHTML={{ __html: renderAnnouncementContent(value) }} />;
}

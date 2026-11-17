import DOMPurify from "dompurify";
import { marked } from "marked";

export function markdown(text) {
  const fragment = DOMPurify.sanitize(marked.parse(text, { gfm: true, breaks: true }), {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: [
      "p", "b", "strong", "i", "em", "u", "s", "del", "strike", "mark", "sub", "sup",
      "hr", "blockquote", "a", "ul", "ol", "li", "code", "pre", "br",
      "h1", "h2", "h3", "h4", "h5", "h6", "table", "thead", "tbody", "tr", "th", "td",
      "details", "summary", "kbd",
    ],
    ALLOWED_ATTR: ["href", "title", "start", "open"],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
  for (const link of fragment.querySelectorAll("a")) {
    const href = link.getAttribute("href")?.trim();
    if (!href || !/^(https?:\/\/|mailto:)/i.test(href)) {
      link.removeAttribute("href");
      continue;
    }
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
  }
  return fragment;
}

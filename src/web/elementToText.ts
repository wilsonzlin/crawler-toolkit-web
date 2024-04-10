import { Element } from "cheerio";

// <br> is intentionally omitted since we want that to produce a newline.
const INLINE_ELEMS = new Set([
  "a",
  "abbr",
  "acronym",
  "audio",
  "b",
  "bdi",
  "bdo",
  "big",
  "button",
  "canvas",
  "cite",
  "code",
  "data",
  "datalist",
  "del",
  "dfn",
  "em",
  "embed",
  "i",
  "iframe",
  "img",
  "input",
  "ins",
  "kbd",
  "label",
  "map",
  "mark",
  "math",
  "meter",
  "noscript",
  "object",
  "output",
  "picture",
  "progress",
  "q",
  "ruby",
  "s",
  "samp",
  "script",
  "select",
  "slot",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "svg",
  "template",
  "textarea",
  "time",
  "tt",
  "u",
  "var",
  "video",
  "wbr",
]);

export const elementToText = (elem: Element) => {
  let out = "";
  const visit = (elem: Element) => {
    if (elem.tagName === "br") {
      out += "\n";
      return;
    }
    // For full accuracy, we need to insert newlines both before and after the block element, in case the element before/after isn't a block element.
    if (!INLINE_ELEMS.has(elem.tagName)) {
      out += "\n\n";
    }
    for (const c of elem.childNodes) {
      if (c.nodeType === 3) {
        out += c.nodeValue;
      } else if ("tagName" in c) {
        visit(c);
      }
    }
    if (!INLINE_ELEMS.has(elem.tagName)) {
      out += "\n\n";
    }
  };
  visit(elem);
  return out
    .replace(/^[ \t\v]+$/gm, "") // Remove non-empty blank lines.
    .replace(/[ \t\v]+/g, " ") // Collapse whitespace.
    .replace(/^[ \t\v]+/gm, "") // Trim lines.
    .replace(/[ \t\v]+$/gm, "") // Trim lines.
    .replace(/(\r|\n|\r\n){2,}/g, "\n\n") // Reduce multiple line breaks to two.
    .trim();
};

import { CheerioAPI, Element } from "cheerio";
import { elementToText } from "./elementToText";

// "Each group is known as an item. Each item can have item types, a global identifier (if the vocabulary specified by the item types support global identifiers for items), and a list of name-value pairs. Each name in the name-value pair is known as a property, and each property has one or more values. Each value is either a string or itself a group of name-value pairs (an item). The names are unordered relative to each other, but if a particular name has multiple values, they do have a relative order."
export const parseHtmlItemscope = ($: CheerioAPI, n: Element) => {
  // https://html.spec.whatwg.org/multipage/microdata.html#typed-items
  const types = n.attribs["itemtype"]?.split(/\s+/).filter((v) => v) ?? [];
  if (!types.length) {
    // If there's no type, we don't really know what to do with it.
    return undefined;
  }
  // We currently don't support multiple types as we need to return an object with one "@context" and "@type" property each, to keep schema aligned with JSON-LD for simplicity.
  if (types.length > 1) {
    return undefined;
  }
  // We currently only support well-known standards, so the type must definitely refer to a URL.
  let ctxtype;
  try {
    const u = new URL(types[0]);
    ctxtype = {
      "@context": u.origin,
      "@type": u.pathname.slice(1),
    };
  } catch {
    return undefined;
  }
  // "Sometimes, an item gives information about a topic that has a global identifier. For example, books can be identified by their ISBN number."
  const itemid = n.attribs["itemid"] || undefined;
  const d: Record<string, any> = Object.create(null);
  const visit = (n: Element) => {
    const isNewScope = n.attribs["itemscope"] != undefined;
    // "An element introducing a property can also introduce multiple properties at once, to avoid duplication when some of the properties have the same value."
    for (const name of n.attribs["itemprop"]?.split(/\s+/) ?? []) {
      if (!name) {
        continue;
      }
      let v: any;
      if (isNewScope) {
        v = parseHtmlItemscope($, n);
      } else {
        // TODO itemref
        // https://schema.org/docs/gs.html
        // https://html.spec.whatwg.org/multipage/microdata.html#values
        switch (n.tagName) {
          case "a":
          case "area":
          case "link":
            v = n.attribs["href"];
            break;
          case "audio":
          case "embed":
          case "iframe":
          case "img":
          case "source":
          case "track":
          case "video":
            v = n.attribs["src"];
            break;
          case "data":
            v = n.attribs["value"];
            break;
          case "meta":
            v = n.attribs["content"];
            break;
          case "meter":
            v = {
              min: n.attribs["min"],
              max: n.attribs["max"],
              value: n.attribs["value"],
            };
            break;
          case "object":
            v = n.attribs["data"];
            break;
          case "time":
            v = n.attribs["datetime"];
            break;
          default:
            if (n.attribs["aria-label"] != undefined) {
              v = n.attribs["aria-label"];
            } else {
              v = elementToText(n);
            }
            break;
        }
      }
      if (Object.hasOwn(d, name)) {
        if (!Array.isArray(d[name])) {
          d[name] = [d[name]];
        }
        d[name].push(v);
      } else {
        d[name] = v;
      }
    }
    if (!isNewScope) {
      for (const c of n.children) {
        if ("tagName" in c) {
          visit(c);
        }
      }
    }
  };
  // We can't pass in `n` directly as it will think it's a new itemscope.
  for (const c of n.children) {
    if ("tagName" in c) {
      visit(c);
    }
  }
  return {
    ...d,
    "@id": itemid,
    ...ctxtype,
  };
};

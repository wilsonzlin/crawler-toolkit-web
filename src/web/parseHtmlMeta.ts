import { CheerioAPI } from "cheerio";

export const parseHtmlMeta = ($: CheerioAPI) => {
  const metaTags: Record<string, string | string[]> = Object.create(null);
  for (const $m of $("meta")) {
    const k = $m.attribs["name"] ?? $m.attribs["property"];
    const v = $m.attribs["content"];
    if (k && v) {
      let e = metaTags[k];
      if (e == undefined) {
        metaTags[k] = v;
      } else {
        if (typeof e == "string") {
          e = metaTags[k] = [e];
        }
        e.push(v);
      }
    }
  }
  return metaTags;
};

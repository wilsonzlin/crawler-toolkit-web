import isPlainObject from "@xtjs/lib/js/isPlainObject";
import { CheerioAPI } from "cheerio";

export const collectRawLdjson = ($: CheerioAPI) => {
  const ldjson = Array<Record<string, any>>();
  for (const $s of $('script[type="application/ld+json"]')) {
    let o;
    try {
      o = JSON.parse($($s).text());
    } catch {
      // TODO Log and investigate.
      continue;
    }
    if (!isPlainObject(o)) {
      continue;
    }
    ldjson.push(o);
  }
  // Some websites place an array of objects in an LDJSON element.
  return ldjson.flat(Infinity);
};

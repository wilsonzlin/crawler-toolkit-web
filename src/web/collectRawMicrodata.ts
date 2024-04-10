import defined from "@xtjs/lib/js/defined";
import { CheerioAPI } from "cheerio";
import { parseHtmlItemscope } from "./parseHtmlItemscope";

export const collectRawMicrodata = ($: CheerioAPI) =>
  $("[itemscope]:not([itemprop])")
    .toArray()
    .map((e) => parseHtmlItemscope($, e))
    .filter(defined);

import assertExists from "@xtjs/lib/js/assertExists";
import { CheerioAPI, Element } from "cheerio";

const READERABLE_RE = {
  // Our addition:
  // - summary: often on home pages and aggregation pages (e.g. nytimes.com).
  // - hero: often on marketing/landing pages.
  unlikelyCandidates:
    /-ad-|ai2html|banner|breadcrumbs|combx|comment|community|cover-wrap|disqus|extra|footer|gdpr|header|legends|menu|related|remark|replies|rss|shoutbox|sidebar|skyscraper|social|sponsor|supplemental|ad-break|agegate|pagination|pager|popup|yom-remote|summary|hero/i,
  okMaybeItsACandidate: /and|article|body|column|content|main|shadow/i,
};

// Ported from mozilla/readability/Readability-readerable.js.
// The Reader Mode detection works reasonably well in Firefox, despite it's simplicity, which is why we're using it here. However, it does often trip up on landing pages, aggregations, and other non-primary but text-heavy pages.
// Some differences to note:
// - The original code runs in a live browser environment where JS and CSS have all been evaluated. This may make this algorithm less accurate.
// - Normally the algorithm takes in a function that determines whether an element is visible. In our case however, we already remove all [hidden], [aria-hidden], etc., and we don't have live CSS styles to check against.
// This should be called before any stripping, as those changes can make the page look more and more like an article.
export const isProbablyReaderable = ($: CheerioAPI) => {
  const minScore = 20;
  const minContentLength = 140;

  let nodes = $("p, pre, article").toArray();

  // Get <div> nodes which have <br> node(s) and append them into the `nodes` variable.
  // Some articles' DOM structures might look like
  // <div>
  //   Sentences<br>
  //   <br>
  //   Sentences<br>
  // </div>
  const brNodes = $("div > br").toArray();
  if (brNodes.length) {
    const set = new Set(nodes);
    for (const node of brNodes) {
      set.add(assertExists(node.parentNode) as Element);
    }
    nodes = [...set];
  }

  let score = 0;
  // This is a little cheeky, we use the accumulator 'score' to decide what to return from
  for (const node of nodes) {
    const matchString = [
      node.attribs["class"] || "",
      node.attribs["id"] || "",
    ].join(" ");
    if (
      READERABLE_RE.unlikelyCandidates.test(matchString) &&
      !READERABLE_RE.okMaybeItsACandidate.test(matchString)
    ) {
      continue;
    }

    if ($(node).is("li p")) {
      continue;
    }

    const textContentLength = $(node).text().trim().length;
    if (textContentLength < minContentLength) {
      continue;
    }

    score += Math.sqrt(textContentLength - minContentLength);

    if (score > minScore) {
      return true;
    }
  }
  return false;
};

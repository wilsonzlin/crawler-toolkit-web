import { VMember, Valid } from "@wzlin/valid";
import escapedRegex from "@xtjs/lib/js/escapedRegex";
import splitString from "@xtjs/lib/js/splitString";

export const vMetaCrawlErr = new VMember([
  "FailedToFetch",
  "InvalidRobotsTxtSection",
  "RobotsTxtRulesTooLong",
] as const);
export type MetaCrawlErr = Valid<typeof vMetaCrawlErr>;

export type ParsedRobotsTxt = {
  error?: MetaCrawlErr;
  errorDetails?: string;
  sitemaps?: string[];
  rules?: { allows: string; denys: string };
};

// https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt
export const parseRobotsTxt = (raw: string): ParsedRobotsTxt => {
  const sitemaps = [];
  const lines = raw
    .split("\n")
    .map((l) => l.trim().replace(/#.*$/, ""))
    .filter((l) => l)
    .map((l) => splitString(l, ":", 2).map((p) => p.trim()))
    .map(([k = "", v = ""]) => [k.toLowerCase(), v] as const)
    // We don't support these directives.
    .filter(([k]) => k !== "crawl-delay");
  let rules;
  while (lines.length) {
    const [k, v] = lines.shift()!;
    if (k === "sitemap") {
      sitemaps.push(v);
      continue;
    }
    if (k !== "user-agent") {
      // `k` may be huge so we don't store it in errorDetails. We can just do another fetch and manually debug anyway.
      return { error: "InvalidRobotsTxtSection" };
    }
    const userAgents = new Set([v.toLowerCase()]);
    const allows = Array<string>();
    const denys = Array<string>();
    const toRegex = (raw: string) => {
      const anchoredToStart = raw.startsWith("/");
      // Normally we won't remove the leading slash, but we don't store the leading slash in our DB.
      if (anchoredToStart) {
        raw = raw.slice(1);
      }
      const anchoredToEnd = raw.endsWith("$");
      if (anchoredToEnd) {
        raw = raw.slice(0, -1);
      }
      return [
        !anchoredToStart ? "" : "^",
        ...raw
          .split("*")
          .map((p) => escapedRegex(p))
          .join(".*"),
        !anchoredToEnd ? "" : "$",
      ].join("");
    };
    while (lines.at(0)?.[0] === "user-agent") {
      userAgents.add(lines.shift()![1].toLowerCase());
    }
    let m;
    while ((m = /^(dis)?allow$/.exec(lines.at(0)?.[0]!))) {
      (m[1] ? denys : allows).push(toRegex(lines.shift()![1]));
    }
    if (userAgents.has("googlebot") || userAgents.has("*")) {
      rules = { allows: allows.join("|"), denys: denys.join("|") };
    }
  }
  return {
    sitemaps,
    rules,
  };
};

export const fetchAndParseRobotsTxt = async ({
  site,
}: {
  site: string;
}): Promise<ParsedRobotsTxt> => {
  // No need for fetchMetaIfChanged as it's so tiny.
  let raw;
  const signal = new AbortController();
  const timeout = setTimeout(() => signal.abort(), 1000 * 10);
  try {
    raw = await fetch(`https://${site}/robots.txt`, {
      headers: {
        "user-agent": "curl/7.85.0",
      },
      signal: signal.signal,
    }).then((r) => r.text());
  } catch (err) {
    return {
      error: "FailedToFetch",
      errorDetails: err.cause?.code ?? err.code ?? err.message,
    };
  }
  clearTimeout(timeout);
  return parseRobotsTxt(raw);
};

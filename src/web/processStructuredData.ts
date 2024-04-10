export const SCHEMA_ORG_TYPE_PREFIX_RE =
  /^(https?:\/\/)?(www\.)?schema\.org\/*/i;

// We only accept schema.org data; we wouldn't know what to do with any other arbitrary schema anyway.
// Because we restrict to schema.org, we can canonicalise the type names, for easier downstream processing.
// We only return top-level data. While there are nested objects, they are often "noisy" and not primary to the content e.g. image objects.
export const processStructuredData = ({
  ldjson,
  microdata,
}: {
  ldjson: any[];
  microdata: {
    "@context": string;
    "@type": string;
    "@id"?: string;
    [p: string]: any;
  }[];
}) => {
  // It must either be a string like "https://schema.org" or an object like {"@vocab": "https://schema.org"}.
  const parseContextValue = (ctx: unknown): string | undefined => {
    if (typeof ctx == "object" && ctx && "@vocab" in ctx) {
      ctx = ctx["@vocab"];
    }
    if (typeof ctx == "string") {
      return ctx;
    }
    return undefined;
  };
  // Sometimes "@type" points to an array e.g. ["NewsArticle", "CreativeWork"].
  const parseTypeValue = (raw: unknown): string[] => {
    if (
      Array.isArray(raw) &&
      raw.every((t): t is string => typeof t == "string")
    ) {
      return raw;
    }
    if (typeof raw == "string") {
      return [raw];
    }
    return [];
  };
  const topLevelData: Record<string, any[]> = Object.create(null);
  for (const obj of [...ldjson, ...microdata]) {
    // Canonicalise the type so that we can refer to them downstream:
    // - Require schema.org @context value. Web authors may write this slightly differently (e.g. http/https, trailing slashes).
    // - We don't support any other schema, so omit the context. This also simplifies lookups.
    // - Make the type name lowercase, in case some web authors don't use the official casing.
    const ctx = parseContextValue(obj["@context"]);
    if (!ctx || !SCHEMA_ORG_TYPE_PREFIX_RE.test(ctx.trim())) {
      continue;
    }
    for (let t of parseTypeValue(obj["@type"])) {
      // Sometimes people use `/NewsArticle` i.e. strip leading slashes.
      t = t.trim().replace(/^\/+/, "").toLowerCase();
      if (!t) {
        continue;
      }
      (topLevelData[t] ??= []).push(obj);
    }
  }
  return topLevelData;
};

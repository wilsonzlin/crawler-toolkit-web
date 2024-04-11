import derivedComparator from "@xtjs/lib/js/derivedComparator";
import mapExists from "@xtjs/lib/js/mapExists";
import mapValue from "@xtjs/lib/js/mapValue";
import maybeParseDate from "@xtjs/lib/js/maybeParseDate";
import reversedComparator from "@xtjs/lib/js/reversedComparator";
import { CheerioAPI } from "cheerio";
import { normaliseUrl, resolveUrl } from "../url";
import { collectRawLdjson } from "./collectRawLdjson";
import { collectRawMicrodata } from "./collectRawMicrodata";
import { elementToText } from "./elementToText";
import { parseHtmlMeta } from "./parseHtmlMeta";
import { processStructuredData } from "./processStructuredData";

const orFirst = (v: undefined | null | string | string[]) =>
  v == null ? undefined : Array.isArray(v) ? v.at(0) : v;

const orLast = (v: undefined | null | string | string[]) =>
  v == null ? undefined : Array.isArray(v) ? v.at(-1) : v;

// Remove text that not even "full page text" (used for page noise ratio calculation) should consider.
// Semantically [hidden] means not part of the page (e.g. an HTML template, an error message, a dialog), but we should check if it's often used to visually hide semantic text and elements (incorrectly) for crawlers to understand that would normally be superceded by fancy JS and as such should be kept.
// No need to remove <iframe> or <object>; they're useful for detecting media and shouldn't contain any text content anyway.
export const SEL_STRIP_GENERAL = `
  [hidden],
  canvas,
  noscript,
  script,
  style,
  svg,
  template
`;

// Our rationale for removing <footer> elements:
// - They almost always contain ancillary content.
// Our rationale for removing [role=note] elements:
// - Literally defined as ancillary content by spec.
// WARNING: Do not remove based on "common" classes and IDs (e.g. `#menu`); even if they're somewhat accurate, they can often lead to removing entire sections from (or the entirety of) primary content on some edge case pages. Let the caller manually provide selectors to remove if they want to take the risk, but don't hard code here.
// This should be anchored to <body> e.g. `$("body").find(SEL_STRIP_NON_PRIMARY).remove()`.
// No need to remove <link> or <meta> as they cannot contain text, and may be useful to keep around for downstream users.
export const SEL_STRIP_NON_PRIMARY = `
  [aria-hidden],
  [role=alert],
  [role=alertdialog],
  [role=button],
  [role=checkbox],
  [role=combobox],
  [role=complementary],
  [role=feed],
  [role=menu],
  [role=menubar],
  [role=navigation],
  [role=none],
  [role=note],
  [role=presentation],
  [role=search],
  [role=searchbox],
  [role=tablist],
  [role=toolbar],
  [role=tooltip],
  [role=tree],
  [role=treegrid],
  aside,
  button,
  dialog,
  footer,
  form,
  hr,
  input,
  label,
  menu,
  nav,
  object,
  option,
  progress,
  select,
  title
`;

// Remove lists of links.
// A good heuristic: if all links are removed, does the list have any text left?
// - This handles complex nesting e.g. ul > li > div > div > h3 > a.
// - This handles not only simple bullet-point lists, but even more sophisticated ones like a set of tags, carousel of cards, etc.
// - This doesn't require NLP (e.g. does previous text or heading say "Related articles"), which is far more complex and difficult.
// - This doesn't require semantic labelling of the HTML, which pages almost never do (they often put these right in the `main article` and don't have any ARIA role or even a good class name or ID).
// - This works extremely well while remaining very simple and elegant. It can be expanded on by counting how many words/characters remain, etc.
export const stripListsOfLinks = ($: CheerioAPI) => {
  for (const $ul of $(`
    [class*=items i],
    [class*=links i],
    [class*=list i],
    [role=list],
    ol,
    ul
  `)) {
    const $ulCopy = $($ul).clone();
    // Surprisingly, `.remove("a")` doesn't work like this.
    $ulCopy.find("a").remove();
    // Remove any non-word-characters to discard if all that's left are separator/visual characters (e.g. slashes, bullet points, parentheses).
    // TODO The regex should be for all Unicode non-word-characters, but this works for now given we only support English.
    const finalText = $ulCopy.text().replace(/[^a-zA-Z0-9]/g, "");
    if (!finalText) {
      $($ul).remove();
    }
  }
};

// Unfortunately, too many great sites and content/pages on the web don't use `<article>`, and some use multiple (e.g. comments, related articles, ads); therefore, we just assume that if the content is readerable, and there is no <article>, we'll take the whole <body> as the article.
export const getMainArticle = ($: CheerioAPI) =>
  $(
    `
      main article,
      #article,
      [role=article],
      [itemtype=http://schema.org/Article],
      [itemtype=https://schema.org/Article]
    `,
  )
    .toArray()
    .sort(reversedComparator(derivedComparator(($e) => $($e).text().length)))
    .at(0) ?? $("body")[0];

// This should generally be called before normalising to hoover up all links, including outside of primary content and on bad status.
export const extractLinks = ($: CheerioAPI, url: string) => {
  const links = new Set<string>();
  for (const $a of $("a[href]")) {
    const normLink = resolveUrl(url, $a.attribs["href"]);
    if (normLink) {
      links.add(normLink);
    }
  }
  return links;
};

export const extractCanonicalUrl = ($: CheerioAPI, url: string) =>
  mapExists($("link[rel=canonical]").attr("href"), (c) => resolveUrl(url, c));

export const parseHtml = (
  $: CheerioAPI,
  {
    additionalElementSelectorsToRemove,
  }: {
    additionalElementSelectorsToRemove?: string[];
  } = {},
) => {
  const htmlLang = $("html").attr("lang")?.trim().toLowerCase();

  const metaTags = parseHtmlMeta($);
  const metaStr = (k: string) => mapValue(metaTags[k], orLast);

  const ldjson = collectRawLdjson($);
  const microdata = collectRawMicrodata($);

  $(SEL_STRIP_GENERAL).remove();

  // Do these AFTER removing <noscript> and <svg>. <title> is a valid element in <svg>.
  const titleElemValue = $("head title").first().text().trim();
  const titleCount = $("title").length;
  // Many top pages have multiple <h1> elements, so it can't be used as an indicator of quality.
  const h1 = $("body h1").first().text().trim();

  const pageText = elementToText($("body")[0]);
  const pageCharCount = pageText.replace(/\s/g, "").length;

  if (additionalElementSelectorsToRemove?.length) {
    $("body").find(additionalElementSelectorsToRemove.join(",")).remove();
  }
  $("body").find(SEL_STRIP_NON_PRIMARY).remove();

  stripListsOfLinks($);

  const mainArticle = getMainArticle($);

  const mainArticleAudioCount = $(mainArticle).find("audio").length;
  const mainArticleVideoCount = $(mainArticle).find(
    "video, iframe[src^=https://www.youtube.com/embed/], iframe[src^=https://www.youtube-nocookie.com/embed/]",
  ).length;

  // These should be removed after counting and extracting audios/videos/images/etc.
  // Our rationale for removing <figure>/<figcaption> elements:
  // - Usually these have some text that is associated with some content that cannot be represented in text (e.g. image, video, audio), so it won't make as much sense and may confuse the NLP model.
  // - Usually they are read like <aside> elements, and interrupt correct reading flow of text.
  // - We remove both becomes sometimes people put <p>/<span>/etc. inside <figure> and some use <figcaption> outside of a <figure> (both are wrong).
  $(`
    figcaption,
    figure
  `).remove();
  // We no longer try to format a more semantic structured text (e.g. Markdown), like indentation, hyphens for list entries, backticks for code spans and blocks, and repeating table headings for every cell. It's dubious that these have an effect on accuracy, and the table repetition uses a lot of tokens and doesn't really consider common non-ideal use cases (table containing largely sentences instead of numeric values, colspan and rowspan, extremely large tables, etc.).
  // Most NLP models do not tokenise whitespace and do not treat newlines specially, so there's no point in trying to preserve newlines in this text. (Even if we could tokenise space and CR/LF, the models weren't trained on them anyway.)
  const mainArticleText = elementToText(mainArticle);
  const mainArticleCharCount = mainArticleText.replace(/\s/g, "").length;

  const sd = processStructuredData({
    ldjson,
    microdata,
  });
  let ogLocale = metaStr("og:locale");
  let ogType = metaStr("og:type");
  const artSds = [
    ...(sd["article"] ?? []),
    ...(sd["blogposting"] ?? []),
    ...(sd["creativework"] ?? []),
    ...(sd["newsarticle"] ?? []),
  ];
  const articleStructuredDataCount = artSds.length;
  const artSd = artSds[0];

  // Yes we assume that the first <time> in the first <header> represents the "time" (and not modified time, release time, etc.).
  const timestamp =
    maybeParseDate(artSd?.["datePublished"]) ??
    maybeParseDate(metaStr("article:published_time")) ??
    maybeParseDate($(mainArticle).find("header time").attr("datetime"));
  const timestampModified =
    maybeParseDate(artSd?.["dateModified"]) ??
    maybeParseDate(metaStr("article:modified_time")) ??
    maybeParseDate(metaStr("og:updated_time"));
  // We prefer other sources instead of <title> as the <title> often contains other noise like the site name or some additional meta information. However, we prefer it over <h1> as the former is usually optimised for a concise page/tab title, whereas the latter could be contextual, stylistic, or contextual.
  const title = (
    artSd?.["headline"] ||
    metaStr("title") ||
    metaStr("og:title") ||
    metaStr("twitter:title") ||
    titleElemValue ||
    h1
  )
    .trim()
    .replace(/\s+/g, " ");
  const description = artSd?.["description"]?.trim();
  metaStr("description")?.trim() ||
    metaStr("og:description")?.trim() ||
    metaStr("twitter:description")?.trim() ||
    undefined;
  // The `image` property could be a URL string or an ImageObject object.
  // TODO We should really vStruct validate structured data, as we're just guessing and possibly coercing types into strings here.
  const imageUrl = mapExists(
    mapExists(
      orFirst(artSd?.["image"]),
      (v: any) => v["url"] ?? v["contentUrl"] ?? v,
    ) ??
      metaStr("og:image") ??
      metaStr("twitter:image:src"),
    (u) => normaliseUrl(u, true),
  );
  $(`
    blockquote,
    figure,
    h1,
    header,
    table
  `).remove();
  const snippet = $(mainArticle)
    .text()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 251);

  return {
    articleStructuredDataCount,
    description,
    htmlLang,
    imageUrl,
    mainArticleAudioCount,
    mainArticleCharCount,
    mainArticleText,
    mainArticleVideoCount,
    metaTags,
    ogLocale,
    ogType,
    pageCharCount,
    pageText,
    snippet,
    structuredData: sd,
    timestamp,
    timestampModified,
    title,
    titleCount,
  };
};

export type ParseHtmlResult = ReturnType<typeof parseHtml>;

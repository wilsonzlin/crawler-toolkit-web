import { maybeParseUrl } from "@wzlin/valid";
import PromiseQueue from "@xtjs/lib/js/PromiseQueue";
import defined from "@xtjs/lib/js/defined";
import distinctFilter from "@xtjs/lib/js/distinctFilter";
import map from "@xtjs/lib/js/map";
import { parseStringPromise } from "xml2js";
import { normaliseUrl } from "../url";

const maybeAsArray = (v: unknown) => (Array.isArray(v) ? v : []);

export const recursivelyCrawlSitemapXmlAndInsertUrls = async ({
  concurrency: q,
  fetcher,
  onUrls,
  site,
  url,
}: {
  // By requesting a PromiseQueue instead of simply a number, there can be shared (i.e. global) concurrency control amonst all tasks (including this recursively).
  concurrency: PromiseQueue;
  // This is abstracted to allow for custom implementations that do caching, store in a DB, etc.
  fetcher: (req: {
    accept: string;
    url: string;
    validContentType: RegExp;
  }) => Promise<string | undefined>;
  // e.g. `domain.com.au`.
  site: string;
  onUrls: (urls: Array<string>) => Promise<void>;
  // URL to the sitemap XML file.
  url: string;
}) => {
  const crawlXml = (url: string) =>
    q.add(async () => {
      const raw = await fetcher({
        accept: "text/xml",
        url,
        validContentType: /^(application|text)\/xml/,
      });
      if (!raw) {
        return;
      }
      // We use xml2js over cheerio because:
      // - It's faster
      // - It parses CDATA
      // - We don't need querying functionality (we just traverse children)
      // - We are CPU performance sensitive (because this is the primary CPU bottleneck)
      // We'd like to use libxmljs (because it's likely even faster) but it can't be used from threads (e.g. https://github.com/marudor/libxmljs2/issues/173), segfaults regularly, and its lack of proper code maintenance has security concerns.
      let doc;
      try {
        doc = await parseStringPromise(raw);
      } catch {
        return;
      }
      // Sometimes this is null.
      if (doc == null) {
        return;
      }

      // We don't collect all URLs from all sitemaps recursively into one list as some sites have gigantic deep sitemaps.
      // urlset > url > loc
      const urls = maybeAsArray(doc.urlset?.url)
        .map((u) => u.loc?.[0])
        .filter((v): v is string => typeof v == "string")
        .map((v) => normaliseUrl(v))
        .filter((c): c is string => !!c && c.startsWith(`${site}/`))
        .filter(distinctFilter());

      // sitemapindex > sitemap > loc
      // Sitemaps don't have to reside on the same server (e.g. CDN, ancillary site, subdomain).
      const otherSitemaps = maybeAsArray(doc.sitemapindex?.sitemap)
        .map((s) => s.loc?.[0])
        .filter((v): v is string => typeof v == "string")
        .filter((v) => maybeParseUrl(v))
        .filter(defined)
        .filter(distinctFilter());

      if (urls.length) {
        await onUrls(urls);
      }

      await Promise.all(map(otherSitemaps, (url) => crawlXml(url)));
    });
  await crawlXml(url);
};

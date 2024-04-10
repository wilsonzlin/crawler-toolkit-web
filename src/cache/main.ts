import withoutUndefined from "@xtjs/lib/js/withoutUndefined";

type CachedFetchMetdata = {
  sha512: Uint8Array;
  eTag?: string;
  lastModified?: string;
};

type Response = {
  status: number;
  headers: Record<string, string | string[] | null | undefined>;
  body: Uint8Array;
};

const orLast = (v: string | string[] | null | undefined) =>
  v == null ? undefined : Array.isArray(v) ? v.at(-1) : v;

/**
 * Returns undefined if:
 * - The fetcher returns undefined.
 * - The server returned with 304 (unchanged).
 * - The body content hasn't changed according to SHA-512.
 */
export const fetchIfChanged = async ({
  cache,
  fetcher,
  url,
}: {
  url: string;
  // This function should handle bad statuses, Accept, User-Agent, validating Content-Type, timeouts, etc. as they wish.
  fetcher: (
    url: string,
    headers: Record<string, string>,
  ) => Promise<Response | undefined>;
  cache: {
    getMeta: (url: string) => Promise<CachedFetchMetdata | undefined>;
    // The response is provided in case those values or derived values want to also be stored (e.g. status code, response size).
    setMeta: (
      url: string,
      meta: CachedFetchMetdata,
      res: Response,
    ) => Promise<any>;
  };
}) => {
  const ex = await cache.getMeta(url);
  const res = await fetcher(
    url,
    withoutUndefined({
      "if-modified-since": ex?.lastModified,
      "if-none-match": ex?.eTag,
    }),
  );
  if (!res) {
    return;
  }
  const { status, headers, body: dataRawBuf } = res;
  if (status === 304) {
    // Unchanged.
    return;
  }
  const sha512 = new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-512", dataRawBuf),
  );
  await cache.setMeta(
    url,
    {
      eTag: orLast(headers["etag"]),
      lastModified: orLast(headers["last-modified"]),
      sha512,
    },
    res,
  );
  if (ex && Buffer.compare(sha512, ex.sha512) === 0) {
    return;
  }
  return res;
};

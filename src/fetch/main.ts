import { VMember, Valid } from "@wzlin/valid";
import UnreachableError from "@xtjs/lib/js/UnreachableError";
import assertExists from "@xtjs/lib/js/assertExists";
import maybeParseDate from "@xtjs/lib/js/maybeParseDate";
import maybeParseInteger from "@xtjs/lib/js/maybeParseInteger";
import withoutUndefined from "@xtjs/lib/js/withoutUndefined";
import dns from "dns";
import http, { ClientRequest, IncomingMessage } from "http";
import https from "https";
import { BlockList } from "net";
import { promisify } from "util";
import zlib from "zlib";

const brotliDecompress = promisify(zlib.brotliDecompress);
const inflate = promisify(zlib.inflate);
const gunzip = promisify(zlib.gunzip);

export const vSafeFetchErrCode = new VMember([
  "BodyTooLarge",
  "ContentLengthTooLarge",
  "FetchErrorSysCode",
  "FetchErrorTrace",
  "InvalidUrl",
  "ReservedIpAddress",
  "UnknownContentEncoding",
  "UnknownContentType",
] as const);
export type SafeFetchErrCode = Valid<typeof vSafeFetchErrCode>;

// https://en.wikipedia.org/wiki/Reserved_IP_addresses.
const IP4_BLOCKLIST = new BlockList();
IP4_BLOCKLIST.addSubnet("0.0.0.0", 8);
IP4_BLOCKLIST.addSubnet("10.0.0.0", 8);
IP4_BLOCKLIST.addSubnet("100.64.0.0", 10);
IP4_BLOCKLIST.addSubnet("127.0.0.0", 8);
IP4_BLOCKLIST.addSubnet("169.254.0.0", 16);
IP4_BLOCKLIST.addSubnet("172.16.0.0", 12);
IP4_BLOCKLIST.addSubnet("192.0.0.0", 24);
IP4_BLOCKLIST.addSubnet("192.0.2.0", 24);
IP4_BLOCKLIST.addSubnet("192.88.99.0", 24);
IP4_BLOCKLIST.addSubnet("192.168.0.0", 16);
IP4_BLOCKLIST.addSubnet("198.18.0.0", 15);
IP4_BLOCKLIST.addSubnet("198.51.100.0", 24);
IP4_BLOCKLIST.addSubnet("203.0.113.0", 24);
IP4_BLOCKLIST.addSubnet("224.0.0.0", 4);
IP4_BLOCKLIST.addSubnet("233.252.0.0", 24);
IP4_BLOCKLIST.addSubnet("240.0.0.0", 4);
IP4_BLOCKLIST.addSubnet("255.255.255.255", 32);

export type SafeFetchResult = {
  cacheControl?: string;
  contentEncoding?: string;
  contentLanguage?: string[];
  contentLength?: number;
  contentSecurityPolicy?: string[];
  contentType?: string;
  date?: string;
  fetchMs?: number;
  fetchResponseMs?: number;
  error?: SafeFetchErrCode;
  errorDetails?: string;
  etag?: string;
  fetchTime: Date;
  frameOptions?: string;
  httpStatus?: number;
  lastModified?: Date;
  receivedBytes: number;
  redirectLocation?: string;
  resolvedIp?: string;
  source?: Buffer; // Original decompressed HTTP response payload.
};

export type SafeFetchState = {
  request?: ClientRequest;
  response?: IncomingMessage;
  result: SafeFetchResult;
  maxContentLength: number;
  maxContentLengthExceededStrategy: "error" | "truncate";
};

// From the Node.js docs: "... the data from the response object must be consumed, either by calling response.read() whenever there is a 'readable' event, or by adding a 'data' handler, or by calling the .resume() method. Until the data is consumed, the 'end' event will not fire. Also, until the data is read it will consume memory that can eventually lead to a 'process out of memory' error."
const cleanUpReq = (
  requestOrResponse: ClientRequest | IncomingMessage | undefined,
) => {
  requestOrResponse?.destroy(new Error("Dangling request"));
};

const fetchInner = async <R>(
  state: SafeFetchState,
  inner: () => Promise<R>,
) => {
  try {
    return await inner();
  } catch (err) {
    const { code } = err;
    if (typeof code == "string" || typeof code == "number") {
      state.result.error = "FetchErrorSysCode";
      state.result.errorDetails = String(code);
    } else {
      state.result.error = "FetchErrorTrace";
      state.result.errorDetails = err.stack;
    }
    cleanUpReq(state.request);
    return;
  }
};

export type SafeFetchOptions = {
  accept?: string;
  acceptLanguage?: string;
  timeoutMs: number;
  userAgent?: string;
  maxContentLength: number;
  maxContentLengthExceededStrategy?: "error" | "truncate"; // Defaults to "error".
  isValidContentType: (ct: string | undefined) => boolean;
};

export const beginSafeFetch = async (
  urlRaw: string | URL,
  {
    accept,
    acceptLanguage,
    userAgent,
    timeoutMs,
    maxContentLength,
    maxContentLengthExceededStrategy = "error",
    isValidContentType,
  }: SafeFetchOptions,
): Promise<SafeFetchState> => {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);
  const started = new Date();
  const result: SafeFetchResult = {
    fetchTime: started,
    receivedBytes: 0,
  };
  const state: SafeFetchState = {
    result,
    maxContentLength,
    maxContentLengthExceededStrategy,
  };
  // We use a nested function for easier control flow with `return`.
  await fetchInner(state, async () => {
    let urlObj: URL;
    try {
      urlObj = typeof urlRaw == "string" ? new URL(urlRaw) : urlRaw;
    } catch {
      result.error = "InvalidUrl";
      return;
    }
    // Use IPv4 only for now, as that's the only one I know the invalid CIDRs of.
    const resolvedIp = await new Promise<string>((resolve, reject) =>
      dns.lookup(urlObj.hostname, 4, (err, addr) =>
        err ? reject(err) : resolve(addr),
      ),
    );
    result.resolvedIp = resolvedIp;
    if (IP4_BLOCKLIST.check(resolvedIp)) {
      result.error = "ReservedIpAddress";
      return;
    }
    const getter = urlObj.protocol === "http:" ? http.get : https.get;
    state.request = getter(
      `${urlObj.protocol}//${resolvedIp}${urlObj.pathname}${urlObj.search}`,
      {
        headers: withoutUndefined({
          Accept: accept,
          "Accept-Encoding": "gzip, deflate, br",
          "Accept-Language": acceptLanguage,
          Host: urlObj.hostname,
          "User-Agent": userAgent,
        }),
        servername: urlObj.hostname, // Required for TLS SNI.
        setHost: false,
        signal: abortController.signal,
      },
    );
    const response = (state.response = await new Promise<IncomingMessage>(
      (resolve, reject) =>
        state.request!.on("error", reject).on("response", resolve),
    ));
    result.httpStatus = assertExists(response.statusCode);
    const headers = response.headers;
    const oneHdr = (h: string) => (Array.isArray(headers[h]) ? h.at(-1) : h);
    result.contentSecurityPolicy = oneHdr("content-security-policy")
      ?.split(";")
      .map((v) => v.trim())
      .filter((v) => v);
    result.frameOptions = oneHdr("x-frame-options")?.toLowerCase();
    result.cacheControl = headers["cache-control"]?.trim();
    const contentEncoding = (result.contentEncoding =
      headers["content-encoding"]);
    const isCompressed = !!contentEncoding && contentEncoding !== "identity";
    result.contentLanguage = headers["content-language"]
      ?.trim()
      .split(",")
      .map((l) => l.trim().toLowerCase())
      .filter((l) => l);
    const contentLength = (result.contentLength = maybeParseInteger(
      headers["content-length"] ?? "",
    ));
    const contentType = (result.contentType = headers["content-type"]?.trim());
    result.date = headers.date?.trim();
    result.etag = headers.etag?.trim();
    // TODO Stricter parsing.
    result.lastModified = maybeParseDate(headers["last-modified"]);
    result.redirectLocation = headers.location;
    // Too many pages are dynamic and don't have a Content-Length, so we cannot bail as an error if it doesn't exist.
    if (
      contentLength &&
      contentLength > maxContentLength &&
      maxContentLengthExceededStrategy === "error"
    ) {
      result.error = "ContentLengthTooLarge";
      result.errorDetails = `${contentLength}`;
      return;
    }
    if (!isValidContentType(contentType)) {
      result.error = "UnknownContentType";
      result.errorDetails = contentType;
      return;
    }
    if (isCompressed && !["br", "deflate", "gzip"].includes(contentEncoding)) {
      result.error = "UnknownContentEncoding";
      result.errorDetails = contentEncoding;
      return;
    }
  });
  clearTimeout(timeout);
  result.fetchResponseMs = Date.now() - started.getTime();
  return state;
};

export const readSafeFetchResponse = async (
  state: SafeFetchState,
): Promise<SafeFetchResult> => {
  const { result } = state;
  await fetchInner(state, async () => {
    const chunks = Array<Buffer>();
    // Do not use `for await` as that will add too many listeners and cause Node.js to endlessly whine about MaxListenersExceededWarning:.
    if (
      !(await new Promise<boolean>((resolve, reject) => {
        state
          .response!.on("data", (chunk) => {
            chunks.push(chunk);
            if (
              (result.receivedBytes += chunk.length) > state.maxContentLength
            ) {
              switch (state.maxContentLengthExceededStrategy) {
                case "error":
                  result.error = "BodyTooLarge";
                  result.errorDetails = `${result.receivedBytes}`;
                  resolve(false);
                  break;
                case "truncate":
                  resolve(true);
                  // Stop processing further "data" event chunks.
                  state.response?.destroy();
                  break;
                default:
                  throw new UnreachableError();
              }
            }
          })
          .on("end", () => resolve(true))
          .on("error", reject);
      }))
    ) {
      return;
    }
    const sourceRaw = Buffer.concat(
      chunks,
      Math.min(result.receivedBytes, state.maxContentLength),
    );
    let source: Buffer;
    switch (result.contentEncoding) {
      case "br":
        source = await brotliDecompress(sourceRaw);
        break;
      case "deflate":
        source = await inflate(sourceRaw);
        break;
      case "gzip":
        source = await gunzip(sourceRaw);
        break;
      case "":
      case undefined:
        source = sourceRaw;
        break;
      default:
        throw new UnreachableError();
    }
    result.source = source;
  });
  result.fetchMs = Date.now() - result.fetchTime.getTime();
  cleanUpReq(state.request);
  return result;
};

export const safeFetch = async (url: URL | string, opts: SafeFetchOptions) => {
  const state = await beginSafeFetch(url, opts);
  return await readSafeFetchResponse(state);
};

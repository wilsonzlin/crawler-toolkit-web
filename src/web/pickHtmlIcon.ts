import mapExists from "@xtjs/lib/js/mapExists";
import maxOr from "@xtjs/lib/js/maxOr";
import maybeParseInteger from "@xtjs/lib/js/maybeParseInteger";
import splitString from "@xtjs/lib/js/splitString";
import { CheerioAPI } from "cheerio";
import { resolveUrl } from "../url";

export const pickHtmlIcon = ($: CheerioAPI, url: string) => {
  let bestIcon:
    | undefined
    | {
        href: string;
        size: number;
      };
  for (const {
    attribs: { href, media, sizes = "", type },
  } of $("link[rel=icon]")) {
    if (!href) {
      continue;
    }
    // We don't support SVG images currently.
    const SUPPORTED_MIMES = [
      "image/avif",
      "image/ico",
      "image/jpeg",
      "image/png",
      "image/vnd.microsoft.icon",
      "image/webp",
      "image/x-icon",
    ];
    // Assume if `type` isn't set, it's supported.
    if (type && !SUPPORTED_MIMES.includes(type)) {
      continue;
    }
    // We don't support media queries for now, even if benign e.g. `screen`.
    if (media) {
      continue;
    }
    // Parse the `sizes` attribute.
    // We use `maxOr` because Math.max returns -Infinity on zero args, which we can't nicely use `||`.
    // Note that we want `maxOr` to output zero if there's none (and not the default 32 * 32), so that we can use `||` to handle both zero args and all args are invalid.
    const size =
      maxOr(
        sizes
          .trim()
          .split(/\s+/)
          .map((raw) =>
            // Many sites use "any" even when it's just a standard image and not a vector one like SVG, so even though we don't support SVG, we must still accept "any". If `type` was declared as a SVG, it'll be ignored that way; otherwise, our fetcher will handle it.
            raw == "any"
              ? // Since some sites use "any" for standard favicon.ico, interpret it as 32x32 to be safe (i.e. we'll still take a different one if it explicitly has a decent size).
                32 * 32
              : splitString(raw, "x", 2)
                  .map((x) => maybeParseInteger(x) ?? 0)
                  .reduce((s, v) => s * v, 1),
          ),
        0,
      ) ||
      // If there's no size value, assume it's 32x32 for comparison purposes.
      32 * 32;
    // Pick the icon with the largest size.
    if (!bestIcon || size > bestIcon.size) {
      bestIcon = {
        href,
        size,
      };
    }
  }
  return mapExists(bestIcon, (i) => resolveUrl(i.href, url, true));
};

import { load } from "cheerio";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { collectRawLdjson } from "../collectRawLdjson";
import { collectRawMicrodata } from "../collectRawMicrodata";
import { parseHtml } from "../parseHtml";
import { parseHtmlMeta } from "../parseHtmlMeta";
import { pickHtmlIcon } from "../pickHtmlIcon";
import { processStructuredData } from "../processStructuredData";

// JSON.stringify omits object properties with `undefined` values, and changes array element values from `undefined` to `null`.
// In order for our tests to correctly pass, we must normalise both the expected value read from disk and the actual value in memory.
// JSON.stringify also stringifies Date values.
const norm = (v: any): any => {
  if (Array.isArray(v)) {
    return v.map((v) => (v == null ? null : norm(v)));
  }
  if (v instanceof Date) {
    return v.toJSON();
  }
  if (typeof v == "object" && v) {
    return Object.fromEntries(
      Object.entries(v)
        .filter((e) => e[1] !== undefined)
        .map(([k, v]) => [k, norm(v)]),
    );
  }
  return v;
};

const readComputeCheckJson = async (file: string, want: any) => {
  // `undefined` cannot be serialised.
  if (process.env["REGENERATE"] === "1" && want !== undefined) {
    await writeFile(file, JSON.stringify(want, null, 2) + "\n");
  } else {
    let got;
    try {
      got = norm(JSON.parse(await readFile(file, "utf8")));
    } catch {}
    expect(got).toEqual(norm(want));
  }
};

const readComputeCheckText = async (file: string, want: string) => {
  if (process.env["REGENERATE"] === "1") {
    await writeFile(file, want);
  } else {
    let got;
    try {
      got = await readFile(file, "utf8");
    } catch {}
    expect(got).toEqual(want);
  }
};

for (const d of readdirSync(__dirname)) {
  const dir = `${__dirname}/${d}`;
  if (!statSync(dir).isDirectory()) {
    continue;
  }
  const url = decodeURIComponent(d);
  describe(url, () => {
    const src = readFileSync(`${dir}/src.html`, "utf8");
    const $ = load(src);
    // Split `mainArticleText` and `pageText` into separate output text files for easier diffing for both the texts and the other object entries.
    // `metaTags` is already tested directly.
    // We don't care about `links`.
    const { mainArticleText, pageText, metaTags, links, ...p } = parseHtml({
      sourceHtml: src,
      url,
    });
    const ldjson = collectRawLdjson($);
    const microdata = collectRawMicrodata($);
    test("collectRawLdjson", async () => {
      await readComputeCheckJson(`${dir}/collectRawLdjson.json`, ldjson);
    });
    test("collectRawMicrodata", async () => {
      await readComputeCheckJson(`${dir}/collectRawMicrodata.json`, microdata);
    });
    test("mainArticleText", async () => {
      await readComputeCheckText(`${dir}/mainArticleText.txt`, mainArticleText);
    });
    test("pageText", async () => {
      await readComputeCheckText(`${dir}/pageText.txt`, pageText);
    });
    test("parseHtml", async () => {
      await readComputeCheckJson(`${dir}/parseHtml.json`, p);
    });
    test("parseHtmlMeta", async () => {
      await readComputeCheckJson(`${dir}/parseHtmlMeta.json`, parseHtmlMeta($));
    });
    test("pickHtmlIcon", async () => {
      await readComputeCheckJson(
        `${dir}/pickHtmlIcon.json`,
        pickHtmlIcon(url, $),
      );
    });
    test("processStructuredData", async () => {
      await readComputeCheckJson(
        `${dir}/processStructuredData.json`,
        processStructuredData({
          ldjson,
          microdata,
        }),
      );
    });
  });
}

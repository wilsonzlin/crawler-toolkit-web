import { load } from "cheerio";
import { elementToText } from "./elementToText";

describe("elementToText", () => {
  it("should emit links", () => {
    const $ = load("Hello <a href='google.com'>wor<b>ld</b></a>!");
    expect(
      elementToText($("body")[0], {
        emitLinkHrefs: true,
      }),
    ).toEqual("Hello [world](google.com)!");
  });
});

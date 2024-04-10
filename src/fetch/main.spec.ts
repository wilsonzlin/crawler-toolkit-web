import { beginSafeFetch, readSafeFetchResponse } from "./main";

const OPTS = {
  isValidContentType: () => true,
  maxContentLength: Infinity,
  timeoutMs: 1000 * 30,
};

test("works correctly", async () => {
  const state = await beginSafeFetch("https://www.example.com", OPTS);
  await readSafeFetchResponse(state);
  const { result: res } = state;
  expect(res.contentType).toEqual("text/html; charset=UTF-8");
  expect(res.source?.toString("utf-8").replace(/ +$/gm, "")).toEqual(
    `
<!doctype html>
<html>
<head>
    <title>Example Domain</title>

    <meta charset="utf-8" />
    <meta http-equiv="Content-type" content="text/html; charset=utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style type="text/css">
    body {
        background-color: #f0f0f2;
        margin: 0;
        padding: 0;
        font-family: -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", "Open Sans", "Helvetica Neue", Helvetica, Arial, sans-serif;

    }
    div {
        width: 600px;
        margin: 5em auto;
        padding: 2em;
        background-color: #fdfdff;
        border-radius: 0.5em;
        box-shadow: 2px 3px 7px 2px rgba(0,0,0,0.02);
    }
    a:link, a:visited {
        color: #38488f;
        text-decoration: none;
    }
    @media (max-width: 700px) {
        div {
            margin: 0 auto;
            width: auto;
        }
    }
    </style>
</head>

<body>
<div>
    <h1>Example Domain</h1>
    <p>This domain is for use in illustrative examples in documents. You may use this
    domain in literature without prior coordination or asking for permission.</p>
    <p><a href="https://www.iana.org/domains/example">More information...</a></p>
</div>
</body>
</html>
  `.trim() + "\n",
  );
});

test("rejects hostnames that resolve to 127.0.0.0/8", async () => {
  const { result: res } = await beginSafeFetch("http://localhost/a/b/c", OPTS);
  expect(res.error).toEqual("ReservedIpAddress");
});

test("rejects hostnames that resolve to 192.168.0.0/16", async () => {
  const { result: res } = await beginSafeFetch(
    "http://192.168.1.1/a/b/c",
    OPTS,
  );
  expect(res.error).toEqual("ReservedIpAddress");
});

test("rejects non-HTML Content-Type responses", async () => {
  const { result: res } = await beginSafeFetch(
    "https://www.google.com/favicon.ico",
    {
      ...OPTS,
      isValidContentType: (ct) => !!ct?.startsWith("text/html"),
    },
  );
  expect(res.error).toEqual("UnknownContentType");
});

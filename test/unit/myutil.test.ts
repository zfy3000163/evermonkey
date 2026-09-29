import * as assert from "assert";
import {
  describeEvernoteError,
  guessMime,
  isAuthError,
  isRateLimitError
} from "../../src/myutil";

describe("isAuthError", () => {
  it("recognises the token codes", () => {
    assert.strictEqual(isAuthError({ errorCode: 8 }), true, "INVALID_AUTH");
    assert.strictEqual(isAuthError({ errorCode: 9 }), true, "AUTH_EXPIRED");
  });

  it("recognises HTTP rejections", () => {
    assert.strictEqual(isAuthError({ statusCode: 401 }), true);
    assert.strictEqual(isAuthError({ statusCode: 403 }), true);
  });

  it("leaves other failures alone", () => {
    assert.strictEqual(isAuthError({ errorCode: 11 }), false, "ENML_VALIDATION");
    assert.strictEqual(isAuthError({ errorCode: 19 }), false, "RATE_LIMIT_REACHED");
    assert.strictEqual(isAuthError({ identifier: "Note.guid", key: "x" }), false);
    assert.strictEqual(isAuthError({ statusCode: 500 }), false);
    assert.strictEqual(isAuthError(undefined), false);
    assert.strictEqual(isAuthError(null), false);
  });

  it("classifies errorCode 0 as not an auth error", () => {
    // Falsy-but-present codes must not be mistaken for a missing one.
    assert.strictEqual(isAuthError({ errorCode: 0 }), false);
  });
});

describe("isRateLimitError", () => {
  it("recognises the rate limit code", () => {
    assert.strictEqual(isRateLimitError({ errorCode: 19 }), true);
    assert.strictEqual(isRateLimitError({ errorCode: 9 }), false);
    assert.strictEqual(isRateLimitError(undefined), false);
  });
});

describe("describeEvernoteError", () => {
  it("names the codes a user can act on", () => {
    assert.strictEqual(describeEvernoteError({ errorCode: 9, parameter: "authenticationToken" }),
      "Evernote AUTH_EXPIRED (authenticationToken)");
    assert.strictEqual(describeEvernoteError({ errorCode: 11, parameter: "ENML_VALIDATION" }),
      "Evernote ENML_VALIDATION (ENML_VALIDATION)");
    assert.strictEqual(describeEvernoteError({ errorCode: 19 }), "Evernote RATE_LIMIT_REACHED");
  });

  it("falls back to the raw code for ones it does not know", () => {
    assert.strictEqual(describeEvernoteError({ errorCode: 999 }), "Evernote code 999");
  });

  it("describes a missing-entity exception, which has no numeric code", () => {
    // `name` is undefined on these, so nothing may depend on it.
    assert.strictEqual(describeEvernoteError({ identifier: "Note.guid", key: "abc" }),
      "Evernote: Note.guid (abc)");
  });

  it("describes transport failures", () => {
    assert.strictEqual(describeEvernoteError({ statusCode: 503, statusMessage: "unavailable" }),
      "HTTP 503: unavailable");
  });

  it("falls back to the message, then to JSON, then to nothing useful", () => {
    assert.strictEqual(describeEvernoteError({ message: "boom" }), "boom");
    assert.strictEqual(describeEvernoteError({ weird: true }), '{"weird":true}');
    assert.strictEqual(describeEvernoteError(undefined), "Unknown error");
  });

  it("does not confuse errorCode 0 with a missing code", () => {
    assert.strictEqual(describeEvernoteError({ errorCode: 0, parameter: "UNKNOWN" }),
      "Evernote code 0 (UNKNOWN)");
  });
});

describe("guessMime", () => {
  it("guesses from the extension", () => {
    assert.strictEqual(guessMime("a.png"), "image/png");
    assert.strictEqual(guessMime("a.md"), "text/markdown");
    assert.strictEqual(guessMime("a.pdf"), "application/pdf");
  });

  it("falls back to mime's own default for anything unknown", () => {
    // mime 1.x answers with `application/octet-stream` rather than null, so the
    // `|| "text/plain"` in guessMime is only a guard, never the live path.
    assert.strictEqual(guessMime("a.definitely-not-known"), "application/octet-stream");
    assert.strictEqual(guessMime("no-extension"), "application/octet-stream");
  });
});
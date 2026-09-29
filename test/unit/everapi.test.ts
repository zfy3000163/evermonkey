import * as assert from "assert";
import {
  EvernoteClient,
  shardFromNoteStoreUrl,
  shardFromToken
} from "../../src/everapi";

const TOKEN_S8 = "S=s8:U=12885b:E=1a110633f4c:C=1a0ec56bab0:P=1cd:A=en-devtoken:V=2:H=deadbeef";
const URL_S13 = "https://app.yinxiang.com/shard/s13/notestore";
const URL_S8 = "https://app.yinxiang.com/shard/s8/notestore";

describe("shardFromToken", () => {
  it("reads the shard out of a developer token", () => {
    assert.strictEqual(shardFromToken(TOKEN_S8), "s8");
    assert.strictEqual(shardFromToken("S=s13:U=32ad740:E=x"), "s13");
    assert.strictEqual(shardFromToken("S=s1:U=8f5f9"), "s1");
  });

  it("returns undefined when there is nothing to read", () => {
    assert.strictEqual(shardFromToken(""), undefined);
    assert.strictEqual(shardFromToken("garbage"), undefined);
    assert.strictEqual(shardFromToken("U=12885b:H=deadbeef"), undefined);
  });

  it("matches S only as a whole colon-delimited field", () => {
    // The real token puts S first; matching it anywhere keeps a reordered token
    // working, as long as it is a field of its own.
    assert.strictEqual(shardFromToken("U=123:S=s8"), "s8");
    assert.strictEqual(shardFromToken("H=S=s8"), undefined, "must not match inside a value");
    assert.strictEqual(shardFromToken("X=S=s8:U=1"), undefined, "nor when preceded by another key");
    assert.strictEqual(shardFromToken("S=s8:U=1:H=s99abc"), "s8", "does not drift to another field");
  });
});

describe("shardFromNoteStoreUrl", () => {
  it("reads the shard out of a NoteStore URL", () => {
    assert.strictEqual(shardFromNoteStoreUrl(URL_S13), "s13");
    assert.strictEqual(shardFromNoteStoreUrl(URL_S8), "s8");
    assert.strictEqual(shardFromNoteStoreUrl("https://www.evernote.com/shard/s1/notestore"), "s1");
  });

  it("returns undefined for URLs that carry no shard", () => {
    assert.strictEqual(shardFromNoteStoreUrl(""), undefined);
    assert.strictEqual(shardFromNoteStoreUrl("https://app.yinxiang.com/notestore"), undefined);
  });

  it("does not match a shard-like segment elsewhere in the URL", () => {
    assert.strictEqual(shardFromNoteStoreUrl("https://host/shard/s13/notestore/extra"), "s13");
  });
});

describe("EvernoteClient noteStoreUrl override", () => {
  it("ignores an override addressing a different shard than the token", () => {
    // This is the SHARD_UNAVAILABLE trap: a URL left over from a previous
    // account, used with a token for a different one.
    const client = new EvernoteClient({ token: TOKEN_S8, region: "china", noteStoreUrl: URL_S13 });
    assert.ok(client.ignoredNoteStoreUrl, "the stale override should have been discarded");
    assert.strictEqual(client.ignoredNoteStoreUrl.configuredShard, "s13");
    assert.strictEqual(client.ignoredNoteStoreUrl.tokenShard, "s8");
    assert.strictEqual(client.ignoredNoteStoreUrl.url, URL_S13);
  });

  it("keeps an override that agrees with the token", () => {
    const client = new EvernoteClient({ token: TOKEN_S8, region: "china", noteStoreUrl: URL_S8 });
    assert.strictEqual(client.ignoredNoteStoreUrl, undefined);
  });

  it("does not complain when there is no override", () => {
    const client = new EvernoteClient({ token: TOKEN_S8, region: "china" });
    assert.strictEqual(client.ignoredNoteStoreUrl, undefined);
  });

  it("does not guess when the token carries no shard", () => {
    // Without a shard in the token there is nothing to contradict, so the
    // override is left alone rather than silently dropped.
    const client = new EvernoteClient({ token: "not-a-real-token", region: "china", noteStoreUrl: URL_S13 });
    assert.strictEqual(client.ignoredNoteStoreUrl, undefined);
  });

  it("refuses to build without a token", () => {
    assert.throws(() => new EvernoteClient({ token: "", region: "china" }), /token is not configured/);
  });

  it("routes to the requested service", () => {
    assert.strictEqual(new EvernoteClient({ token: TOKEN_S8, region: "china" }).serviceHost, "app.yinxiang.com");
    assert.strictEqual(
      new EvernoteClient({ token: TOKEN_S8, region: "international" }).serviceHost,
      "www.evernote.com"
    );
  });
});
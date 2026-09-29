# Fork notes

What this tree changes relative to upstream
[`michalyao/evermonkey`](https://github.com/michalyao/evermonkey), and what each
change fixes.

Upstream baseline: **2.4.5** (2017 toolchain). This tree: **2.5.0**.

Operational docs live in [DEVELOPMENT.md](DEVELOPMENT.md); the terse
user-facing list is [CHANGELOG.md](CHANGELOG.md).

## At a glance

| | |
| --- | --- |
| New/rewritten source | 11 files, ~2250 lines (`src/`) |
| Deleted source | `src/file.ts`, `test/index.ts` |
| Tests | 7 files — 63 unit tests, 34 live API checks |
| Toolchain | TypeScript 2.0 → 5.9, dropped `vscode`/`bluebird`/`eslint` |
| Verified against | a live 印象笔记 account, end to end |

The work splits into five areas.

---

## 1. New capability: local Markdown → Evernote, one way

**Problem.** Upstream could only publish an *untitled editor buffer*. There was
no way to point it at a Markdown file on disk, and no durable link between a file
and its remote note: it decided create-vs-update by searching the whole account
for `intitle:"<title>"` and taking the **last** match. Re-publishing a file could
silently create a duplicate, and any note with a coincidentally equal title was a
target.

**What it does now.** `Alt+P` on a `.md` file pushes it and writes the note's
identity back into the file's front matter:

```
---
title: ...
tags: ...
notebook: ...
notebookGuid: 8f2c1d2e-...   ← renamed notebooks no longer get recreated
guid: 1a2b3c4d-...            ← the local file ↔ remote note mapping
updated: 1759123456789        ← the server's write time, for conflict detection
---
```

- Republishing **updates** the same note. The account-wide title search is gone,
  replaced by a direct `getNote(guid)` — one cheap call instead of a 500-result
  metadata scan.
- A file with **no** `guid` adopts an existing note only when the title matches
  exactly *and* there is exactly one candidate in the target notebook. That is
  the migration path for files published by the upstream version, which never
  wrote a `guid`.
- If the note was deleted server-side, the guid is cleared and a new one created.
- If the note changed remotely since the last push (`updated` is newer),
  publishing asks before overwriting. Upstream would clobber it silently.
- The write-back goes through a `WorkspaceEdit` + save, not `fs`, so it cannot
  race the editor buffer.

**Scope limits, deliberately.** One-way only (local is the source of truth); no
folder-wide batch; no sync-on-save; `Ever attach` still stages attachments but
publishing does not upload new local files on its own.

---

## 2. Data-correctness bugs

These are the ones that silently corrupt content. Everything here was reproduced
against the live service before being fixed.

| # | Symptom | Root cause | Upstream too? |
| --- | --- | --- | --- |
| 1 | `<en-media/>` / `<en-todo/>` written in Markdown swallowed the text after them; the note was rejected with `ENML_VALIDATION (11): must match "EMPTY"` | cheerio does not know these ENML empty elements, so a self-closing tag parses as an *opening* one. The paired form round-trips correctly. Fixed by normalising self-closing forms before rendering. | yes |
| 2 | Updating a note **destroyed its attachments** | `getNoteResources` used `getNoteWithResultSpec({ includeResourceData: true })`, which the service accepts but answers with `data.body === null`. Upstream fetched those and sent them back, uploading empty resources. | yes |
| 3 | Every update re-uploaded every attachment | Built on the assumption that omitting `resources` clears them. **Measured: omitting preserves them, `resources: []` wipes them, and passing a list replaces the whole set.** Now nothing is fetched unless a new local attachment actually needs merging. | new assumption, caught by testing |
| 4 | On Windows, **every** file pushed its entire front matter as note body | The header regex only matched `\n`. Upstream masked this by silently rewriting the user's global `files.eol` on activation. | yes |
| 5 | The remote note differed from the local file whenever the body began with an indented code block | Body extraction used `replace(/^\s+/, "")`, eating the indentation of the base64-embedded copy. | yes |
| 6 | A missing `title:` became the literal string `"undefined"` | `util.format("title: %s", undefined)`. | yes |
| 7 | `tags: ` (empty) produced the string `""` instead of `[]`, and was passed to the API as `tagNames` | Truthiness check on an empty string. | yes |

---

## 3. Connection and authentication

| Symptom | Root cause | Fix |
| --- | --- | --- |
| Every request went to `sandbox.evernote.com` | The SDK's `sandbox` option **defaults to true and outranks `china`** | Set `sandbox: false` explicitly |
| `SHARD_UNAVAILABLE (12)` after switching accounts | A `noteStoreUrl` left by a previous account took precedence over the token, so calls addressed the wrong shard | The token's shard wins; a mismatching override is ignored with a log line, and `Ever token` clears it |
| Validation passed but publishing failed | `Ever token` validated **without** the configured `noteStoreUrl`, i.e. a different path from real operations | Validation now builds the client from the same options |
| The user had to paste a NoteStore URL | Not actually necessary | `getNoteStore()` with no URL discovers it via the UserStore, so only the token is asked for |
| `Evernote error 9: authenticationToken` on every command, forever | No handling for a regenerated/revoked token | `INVALID_AUTH` / `AUTH_EXPIRED` / HTTP 401-403 explain the cause and offer **Re-enter token**; rate limiting is named separately; EDAM codes are reported by name |
| A full-account token sat in plaintext `settings.json`, replicated by Settings Sync | — | Stored in `SecretStorage` (OS keychain); an existing setting is migrated once and cleared |

---

## 4. Toolchain and dependencies

The 2017 build broke on a current Node: `npm install` ran a `postinstall` that
fetched VS Code 1.10, and `@types/node@7` plus `lib: ["es6"]` no longer compile
under TypeScript 5.

- `@types/vscode@1.90.0` + TypeScript 5.9 + `@vscode/test-electron` replace the
  deprecated `vscode` package. The engine floor is stated as `^1.90.0`.
- Removed: `vscode`, `eslint` (wired to no script), `crypto` (a stub for a Node
  builtin), `bluebird` (→ `fs.promises`), `opener` (→ `env.openExternal`).
- `compile` used to be `tsc -watch`, i.e. an endless task that `launch.json`
  chained into. Split into `compile` / `watch`.
- Manifest bugs: `activationEvents` was missing five of the contributed
  commands, so `Ever attach`, `Ever resources`, `Ever browse`, `Ever unattach`
  and `Ever everclient` could not activate the extension; and
  `evermonkey.noteReadonly` declared `"default": "true"` — a *string* for a
  boolean property.

**Not upgraded, on purpose:** `highlight.js@9` (v11 changes the `highlight()`
signature), `to-markdown` (see Known debt), `mime` (must stay 1.x — `lookup` was
removed in 3.x and 4.x is ESM-only), `cheerio` (1.x is ESM-first),
`markdown-it@8` and its plugins.

---

## 5. Structure, configuration and tests

**Module split.** `extension.ts` was 812 lines doing everything. It is now 571
lines of registration and wiring, with the rest extracted:

```
metadata.ts     front matter parse/serialise      no vscode import
converterplus   markdown <-> ENML                 no vscode import
myutil.ts       hashing, mime, error formatting   no vscode import
everapi.ts      the Evernote client               no vscode import
config.ts       lazy configuration + token
account.ts      client/converter/notebook/tag caches
attachments.ts  staged local attachments
auth.ts         the token flow
noteSync.ts     the push flow
report.ts       one place for surfacing failures
```

Keeping `vscode` out of the first four is what makes the ENML pipeline and the
front matter testable in plain node — impossible in the original, where
`require("vscode")` throws outside the host.

**Configuration staleness.** `everapi.ts` and `converterplus.ts` captured
`getConfiguration()` at module load, so a new token or theme needed a window
reload (there was even a `TODO` about it). Every accessor now reads on demand,
and an `onDidChangeConfiguration` listener drops the cached client, converter
and account state. This also exposed a latent crash: the converter assigned
`this.styles` from a detached promise, which would throw as soon as converters
could be created on the fly.

**Tests.** None of the original pipeline was covered — `test/` held the
generated stub.

- 63 unit tests in plain node: CRLF front matter, unknown-key preservation,
  write-back round trips, `MD → ENML → MD` losslessness, ENML empty elements,
  shard parsing, error classification.
- A live suite (`npm run test:live`) driving the real API: create, update,
  attachments, conflict detection, cleanup. It creates only
  `__evermonkey_selftest__` notes and permanently deletes them.

Two of the bugs in §2 were found *only* by running against a real account; no
amount of local testing would have surfaced the resource semantics.

---

## Known debt

1. `to-markdown@3.0.4` pulls in jsdom 9 — 382 files in the VSIX, and
   `npm audit --omit=dev` reports 27 vulnerabilities (2 critical). `turndown` is
   the replacement; it changes ENML→Markdown output, so it needs fixture tests
   first. Note it silently drops `<en-todo/>` unless `keep(['en-todo'])` is set.
2. `highlight.js@9` is EOL.
3. The VSIX is ~15.6 MB: `lodash` alone is 1051 files and `assets/` 10.9 MB of
   README GIFs. Bundling with esbuild would collapse this.
4. The extension-host layer — the `WorkspaceEdit` write-back, command
   registration, `SecretStorage`, the error dialogs — has no automated coverage.
   It is exercised by hand.
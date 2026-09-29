# Development

How to build, install, and work on this fork of evermonkey.

This tree is a fork of [`michalyao/evermonkey`](https://github.com/michalyao/evermonkey)
(MIT, © 2017 Yao Yao) that adds local-Markdown-to-Evernote sync and rebuilds the
toolchain. See [CHANGELOG.md](CHANGELOG.md) for what changed and why.

It keeps the upstream `publisher` / `name` (`michalyao.evermonkey`) so it
installs as a drop-in replacement over the marketplace version, inheriting the
existing keybindings and `evermonkey.*` settings. That is a choice for local
use — see [Publishing](#publishing-to-the-marketplace) if that ever changes.

## Requirements

- Node and npm (verified on Node 24.14.0 / npm 11.9.0)
- The `code` CLI on `PATH` — `install:local` shells out to it

## Build and install

```
npm install
npm run package          # -> evermonkey.vsix
npm run install:local    # package, then install over the existing extension
```

| Command | What it does |
| --- | --- |
| `npm run compile` | TypeScript only, no package. For the edit loop. |
| `npm run watch` | Incremental compile |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run package` | Produces `evermonkey.vsix` |
| `npm run install:local` | `package` + `code --install-extension --force` |
| `npm run publish` | Publishes to the marketplace (needs `vsce login` first) |

`vsce package` triggers `vscode:prepublish` → `npm run compile` on its own, so
there is no need to compile before packaging. The underlying command is:

```
npx vsce package --out evermonkey.vsix
```

The artifact is always `evermonkey.vsix` in the repo root (git-ignored), about
15.6 MB. **Reload VS Code** (`Developer: Reload Window`) after installing, or the
old build stays loaded.

### Installing the VSIX

```
code --install-extension evermonkey.vsix --force
```

`--force` overwrites the installed copy. Without it, reinstalling the same
version is a silent no-op, which reads as "the fix didn't take". The `code` CLI
must be on `PATH` (`Shell Command: Install 'code' command in PATH` in the
command palette); Cursor ships the same CLI as `cursor`.

From the UI instead: Extensions view → `...` → **Install from VSIX…** → pick
`evermonkey.vsix`.

**Double-clicking the file does not install it here.** Windows installs a
`.vsix` on double-click only when something has registered the `.vsix`
association; nothing has on this machine (`reg query HKCR\.vsix` finds no such
key), so the shell falls through to *"How do you want to open this file?"*.
Two further ways this misleads:

- The name has to end in `.vsix`. A renamed copy (`evermonkey-2.5.0.vsix.pg`,
  say, to keep the binary out of git) matches no association and does nothing.
- With both VS Code and Cursor installed the association can only belong to one
  of them, and that is where the install lands.

To make double-click work anyway: right-click the file → *Open with* → *Choose
another app* → Code → tick *Always*.

### After installing

1. **Reload VS Code.** Otherwise the previously loaded build stays in memory.
2. **Delete these two settings** if present (`Preferences: Open User Settings
   (JSON)`). Neither is used any more; the NoteStore URL is discovered from the
   token, and the second key is a typo that never did anything.

   ```jsonc
   "evermonkey.noteStoreUrl": "https://app.yinxiang.com/shard/sXX/notestore",  // delete
   "evernote.noteStoreUrl":   "https://app.yinxiang.com/shard/sXX/notestore"   // delete
   ```

   A stale value from a previous account is ignored automatically (its shard will
   not match the token's), but leaving it in place is misleading.
3. **Verify.** Open any `.md` and press `Alt+P`. The front matter should gain
   `guid`, `notebookGuid` and `updated` — the upstream version never wrote these,
   so their presence confirms the new code is running. Press `Alt+P` again: it
   should update the same note rather than create a second one.

### Keeping the marketplace version out of the way

The extension ID is identical to the marketplace entry, so VS Code may offer to
"update" this fork back to the upstream release. In the Extensions view, find
evermonkey → gear → **Ignore Updates**.

To go back to the marketplace build:

```
code --uninstall-extension michalyao.evermonkey
# then install evermonkey from the Extensions view
```

## Publishing to the marketplace

Only needed if this fork ever goes public. For local use, `install:local` is
enough.

Three fields have to change first — as they stand, the package claims someone
else's publisher and would collide with the existing marketplace entry:

```jsonc
"publisher": "yourPublisherId",   // required: "michalyao" is not yours
"name": "your-extension-name",    // recommended: avoid the same-ID collision
"repository": { "type": "git", "url": "..." }   // vsce asks for this
```

Then:

1. Register a publisher at <https://marketplace.visualstudio.com/manage>.
2. Create an Azure DevOps personal access token with the `Marketplace > Manage`
   scope.
3. `npx vsce login yourPublisherId`, or pass `-p <token>` to `vsce publish`.
4. `npm run publish`.

**Licence:** this is a fork of the 2017 `evermonkey`, which is MIT licensed.
`LICENSE.md` must keep the original `Copyright (c) 2017 Yao Yao` notice. `package.json`
declares `"license": "MIT"` to match.

Publishing under a changed ID also means the installed copy is a different
extension: settings under the `evermonkey.*` namespace carry over, but the
keybindings would be claimed by whichever copy is enabled, so disable the other
one.

## Using it

Open any `.md` and press `Alt+P` (`Ever publish`). The note is created in
Evernote and its identity is written back into the file:

```
---
title: note title
tags: tag1, tag2
notebook: notebook
notebookGuid: 8f2c1d2e-...
guid: 1a2b3c4d-...
updated: 1759123456789
---
```

- `guid` is what links the file to the remote note. Publishing the same file
  again **updates** that note instead of creating a duplicate.
- `notebookGuid` keeps a renamed notebook from being recreated on the next push.
- `updated` is the server's write time. If the remote note is newer, publishing
  asks before overwriting.
- Any other key you put in the header is preserved.

A file with no `guid` adopts an existing note only when the title matches exactly
and there is exactly one candidate in the target notebook — so files published by
the upstream version (which never wrote a `guid`) link up instead of duplicating.

Buffers with no file on disk (`Ever new`, or a note opened from the server) have
nowhere to write the `guid`, so re-publishing them only updates the same note
until the window is closed.

### Token

`Ever token` (`Alt+T`) — pick 印象笔记 (China) or Evernote International, paste
the developer token from the page it opens. The NoteStore URL is discovered
automatically and no longer needs to be configured; a stale
`evermonkey.noteStoreUrl` left over from another account is ignored.

The token is kept in the OS keychain (`SecretStorage`), not in settings.json.

## Testing

```
npm run test:unit    # plain node, no account, ~0.2s
npm test             # downloads VS Code, runs the extension host tests
npm run test:live    # against a real account
```

`test:live` drives the API layer against a real Evernote / 印象笔记 account. It
creates notes titled `__evermonkey_selftest__` and permanently deletes them
afterwards, including when a check fails; nothing else is touched. Credentials
come from the environment or `~/.evernote/.env`:

```
EV_TOKEN='S=s1:U=...' npm run test:live
```

To exercise the extension itself rather than the API layer:

```
code --extensionDevelopmentPath=D:/code-ai/dnn/evermonkey
```

Note the development host loads the same extension ID as the installed build, so
only one of them is active per window. Do not compare the two in side-by-side
windows — that is how the "no `guid` written back" confusion starts.

## Verified API behaviour

Measured against a live account. Each of these contradicted an assumption and
caused a real bug, so they are worth not re-deriving.

| Behaviour | Result |
| --- | --- |
| `new Evernote.Client({token})` | `sandbox` defaults to **true** → routes to `sandbox.evernote.com` regardless of `china`. `sandbox: false` is mandatory. |
| `client.getNoteStore()` with no URL | Discovers the NoteStore URL via `getUserUrls()`. No need to ask the user for one. |
| NoteStore URL shard vs token shard | Must match. A leftover URL from another account fails every call with `SHARD_UNAVAILABLE (12)`. |
| ENML without `<!DOCTYPE en-note SYSTEM ...>` | Rejected: `ENML_VALIDATION (11) no grammar found`. |
| `<en-media/>` / `<en-todo/>` written self-closing in Markdown | cheerio expands it to a paired element that swallows the following text → `must match "EMPTY"`. The paired form round-trips correctly. |
| `updateNote` without a `resources` field | **Preserves** the note's existing attachments. |
| `updateNote` with `resources: []` | **Wipes** them. Never send an empty array. |
| `updateNote` with `resources: [...]` | Replaces the whole set, so server-side resources must be carried along. |
| `getNoteWithResultSpec({includeResourceData: true})` | Accepted, but comes back with `data.body === null`. |
| `getNote(guid, false, true, false, false)` | Returns real resource bytes. |
| `Note.updated` | Server time at write; advances on API updates and is usable for conflict detection. |
| `EDAMNotFoundException` | Carries `identifier`/`key`, no `errorCode`, and `.name` is `undefined`. Only `instanceof` or `identifier` works. |
| Evernote search grammar | Tokenises on underscores, so `intitle:"__foo"` does not match `__foo_bar__`. Never verify a cleanup by title search — look notes up by guid. |

## Known debt

1. **`to-markdown@3.0.4`** — pulls in jsdom 9: 382 files in the VSIX and
   `npm audit --omit=dev` reports 27 vulnerabilities (2 critical). Replacing it
   with `turndown` fixes both, but changes ENML→Markdown output, so it needs
   fixture tests around `converterplus.toMd`. Note `turndown` silently drops
   `<en-todo/>` unless `keep(['en-todo'])` is set.
2. **`highlight.js@9`** is EOL — upgrading to v11 changes
   `hljs.highlight(lang, code, true)` to `highlight(code, { language })`.
3. **VSIX size** — `lodash` contributes 1051 files and `assets/` 10.9 MB
   (README GIFs). Bundling with esbuild would collapse this; it is a separate
   build change.
4. **`docs/`** is the upstream project's GitHub Pages site, untouched.

## Extension host layer

The API layer (`everapi`, `converterplus`, `metadata`) is covered by unit tests
and the live suite. The parts that need the VS Code API — the `WorkspaceEdit`
write-back, command registration, `SecretStorage`, and the error dialogs — have
no automated coverage and are exercised by hand with `Alt+P`.
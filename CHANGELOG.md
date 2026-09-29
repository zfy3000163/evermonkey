# Change Log

## [2.5.0]
- Fixed `SHARD_UNAVAILABLE` after switching to a different Evernote account. A
  `noteStoreUrl` left in settings by a previous account pointed at the old
  shard, and it took precedence over the token's own shard, so every call
  failed. The token now wins: an override addressing a different shard is
  ignored (with a warning in the Extension Host log), and `Ever token` clears
  it. Validation and real operations also build the client from the same
  options now, so validation can no longer pass while publishing fails.
- A rejected token now says so and offers to fix it. Previously a regenerated
  token, a revoked one, or a token for a different service than
  `evermonkey.region` produced "Evernote error 9: authenticationToken" on every
  command with no way forward. `INVALID_AUTH` / `AUTH_EXPIRED` / HTTP 401-403
  now explain the cause and offer "Re-enter token", which runs `Ever token`.
  Rate limiting is called out by name too, and the EDAM codes are reported by
  name rather than by number.
- Pointing the extension at a different account is handled: a `notebookGuid`
  recorded by a previous account no longer exists, so it falls back to the
  notebook name instead of failing.
- Verified against a live 印象笔记 account: create, update-in-place, markdown
  round trip, attachments and cleanup all behave as intended.
- Fixed `<en-media/>` / `<en-todo/>` written in markdown being turned into
  paired elements that swallowed the text after them. The service rejected
  those notes with `ENML_VALIDATION: The content of element type "en-media"
  must match "EMPTY"`. Self-closing forms are now normalised before rendering,
  and the inliner's `style` attribute is kept off ENML elements.
- Fixed attachments being destroyed by an update. `getNoteResources` used
  `getNoteWithResultSpec({ includeResourceData: true })`, which the service
  accepts but answers with `data.body: null`; re-sending those resources
  uploaded empty ones. It now uses `getNote(..., withResourcesData: true, ...)`.
- Updates no longer re-upload the note's existing attachments. Omitting
  `resources` leaves them untouched, so the server's own resources are only
  fetched when a new local attachment actually has to be merged in. Passing
  `resources: []` would wipe them, and is never done.
- Local file -> Evernote sync. The front matter now records the remote `guid`,
  which is written back to the file after the first successful push, so
  publishing a file again **updates** the note instead of creating a duplicate.
  The previous "find a note with this title" lookup is gone; a file with no
  `guid` adopts an existing note only when the title matches exactly and there
  is a single candidate in the target notebook.
- Front matter also records `notebookGuid` and `updated`, so a renamed notebook
  no longer produces a duplicate notebook, and a note edited remotely since the
  last push asks before being overwritten.
- Front matter parsing is line-ending tolerant. The old pattern only matched
  `\n`, so every CRLF file silently pushed its whole header as note body.
- `Ever token` now asks only for the developer token: pick 印象笔记 (China) or
  Evernote International, the NoteStore URL is discovered automatically, and the
  token is validated against the API before it is saved.
- The developer token is stored in the OS keychain instead of plaintext
  settings.json. An existing `evermonkey.token` setting is migrated on first run.
- Settings changes (token, theme, region) no longer require a window reload.
- Fixed the client being constructed with the SDK's default `sandbox: true`,
  which routed requests to sandbox.evernote.com.
- Toolchain: `@types/vscode` + TypeScript 5 + `@vscode/test-electron` replace the
  deprecated `vscode` package; dropped `bluebird`, the `crypto` stub, `opener`
  and `eslint`. The extension no longer rewrites your global editor settings on
  activation.

## [Released]
- 2.4.5
    - fixed #97 update note failed when local cache crashed.

- 2.4.2
    - handle user token dismiss.

- 2.4.0
    - Readonly notes support.
    - CSS sytle tuned.

- 2.3.15
    - Enable markdown quickSuggestion as default.
    - Minor improve.

- 2.3.14
    - Fix bug. Note count returned by evernote configurable via "evermonkey.maxNotesCount"

- 2.3.12
    - Use "\n" as the default line seperator for windows user.
    - Performance improved.

- 2.3.11
    - Fixed enml-todo got error when transformed to markdown.
    - Add support for configuring code highlight font. See configuration.
    - Support insert attachment to current cursor. This is usually used when you want to upload local image.

- v2.3.8
    - New created note's editor cursor now starts after the title.
    - Add `ever everclient` command to support view note in client. (**Note: Editing note in multiple clients may cause a mess when converting the html to markdown, you will see <div>...</div> in vscode, and in result, you may get an error when you publish again. So try to edit in vscode only.**)
    - Add support for changing evernote font rendering in the extension settings.
    - Add support for customizing theme file.
    - Performance and experience improved.

    For more details, check the full documents [here](http://monkey.yoryor.me)

- v2.3.7
    - Performance improved.
    - Update `ever token` command to be friendly to the new user. -- fixed #39
    - Much better experience to use Monkey!

- v2.3.6
    - add support for markdown TOC. **Note: Navigation not supported in Evernote.**

- v2.3.5
    - Bug fixed. #30, #35, #36, #37

- v2.3.1
    - fixed tag cache.

- v2.2.0
    - Support markdown emoji
    - Support open note in Evernote Web.
    - Support attachment
    - Support open recent edited notes
    - Support command keyboard shortcut.
    - Small fixed.

- v2.0.0
    - Support markdown code highlight
    - Support markdown todo
    - Use typescript. Markdown lib change to markdown-it.

- v1.3.0
    - If none notebook specific, the default notebook will be chosen.
    - Add support for editing metadata to update note instead of creating a new one. -- title, tags, notebook

- v1.2.9
    - Search algorithm tuned. Support for a large notes count. -- #17


- v1.2.8
    - fixed #12 -- add new create note to local cache.

- v1.2.7
    - fixed notebook cache.
    - Markdown completion should be opened via configuration.

- v1.2.6
    - fixed can't create new notebook

- v1.2.5
    - Add search note support.
    - Minor experience improved.

- v1.2.4
    - Add metadata tips for tags and notebook.
    - Bug fixed.
    - Made documents better.

- v1.1.0
    - Add metadata support for tags.
    - Add new command ever new to create a file with metadata.

- v1.0.3
    - Fix some markdown error.

- v1.0.2
    - Fixed bug -- Can not create note in an empty notebook.
    - Update readme.

- v1.0.1
    - Fixed local cache crashed.

- v1.0.0 Initial release.




















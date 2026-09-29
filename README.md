# EverMonkey

Evernoting in vscode with *Markdown* Support!

### 中国的朋友可以加我的微信公众号，**自在极客(微信号:javadev_)**。我会分享一些编程以及工作生活经验。有evermonkey 的使用问题也可以通过公众号反馈。


[Get Full Doc And Star Me](http://monkey.yoryor.top)

## Features

You can use `ever new` to create an untitle file with metadata support, edit it and use `ever publish` to publish it to evernote. And of course more than that.

Why EverMonkey is better? EverMonkey is inspired by the Sublime Text one, make local cache to avoid making net request everytime and in result
you got a faster experience.


**For tags use: you may have to use comma "," to split tags**. You can get tips if you insert tags already exsist. Otherwise a new tag will be created.

```
---
title: note title
tags: tag1, tag2, tag3
notebook: notebook
---
```

## Syncing a local Markdown file

Open any `.md` file (with or without the header above) and run `Ever publish`.
The note is created in Evernote, and the extension writes the note's identity
back into the file:

```
---
title: note title
tags: tag1, tag2, tag3
notebook: notebook
notebookGuid: 8f2c1d2e-...
guid: 1a2b3c4d-...
updated: 1759123456789
---
```

`guid` is what links the file to the remote note. **Publish the same file again
and the note is updated, not duplicated** — the old behaviour of searching the
account for a note with the same title is gone. `notebookGuid` keeps a renamed
notebook from being recreated, and `updated` is compared against the server so
that a note edited in the Evernote client since your last push asks before it is
overwritten.

Anything else you put in the header is preserved verbatim.

If a file has no `title`, the file name is used. Buffers with no file on disk
(`Ever new`, or a note opened from the server) have nowhere to write the `guid`,
so publishing them again only updates the same note until you close the window.

Attachments are uploaded by `Ever attach` and travel with the note on the next
publish. Publishing does not upload new local files on its own.

## Example
![editnote](assets/editnote.gif)
![veiwnote](assets/viewnote.gif)


## Extension Settings

**IMPORTANT: Please read this carefully before you start using the extension**

Run the `ever token` command. Pick your service — 印象笔记 (China) or Evernote
International — paste the developer token from the page that opens, and you are
done. The NoteStore URL is discovered automatically and the token is validated
before it is saved.

The token is kept in the OS keychain (VS Code `SecretStorage`), not in
settings.json. If you configured a token with an older version it is migrated on
first run and the plaintext copy is cleared.

You can also visit the token page directly — [China](https://app.yinxiang.com/api/DeveloperToken.action) | [Other Countries](https://www.evernote.com/api/DeveloperToken.action).

* `evermonkey.region`: `china` or `international`; set by `ever token`
* `evermonkey.noteStoreUrl`: advanced override, normally auto-detected
* `evermonkey.token`: deprecated, only read once to migrate an old token

### Development

```
npm install
npm run compile          # one-shot build
npm run test:unit        # plain node, no account needed
npm run install:local    # package and install over the existing extension
```

See [DEVELOPMENT.md](DEVELOPMENT.md) for the build, install and release
workflow, the live test suite, and the Evernote API behaviour this extension
depends on.


-----------------------------------------------------------------------------------------------------------

## Buy me a coffee

If you really like evermonkey, what about buying me a coffee? :smile:

[paypal](https://paypal.me/Michalyao)

![支付宝](assets/alipay.png)

![微信](assets/wechatpay.jpeg)

**Have fun!**


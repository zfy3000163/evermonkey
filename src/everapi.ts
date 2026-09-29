import * as Evernote from "evernote";

export type Region = "china" | "international";

export interface EvernoteClientOptions {
  token: string;
  region: Region;
  /** Advanced override. Leave empty and the SDK discovers it from the UserStore. */
  noteStoreUrl?: string;
  /** Written to `Note.attributes.contentClass`. */
  contentClass?: string;
}

export interface EvernoteUser {
  id?: number;
  username?: string;
  shardId?: string;
}

export interface EvernoteNotebook {
  guid: string;
  name: string;
}

export interface EvernoteTag {
  guid: string;
  name: string;
}

export interface EvernoteResourceRef {
  guid: string;
  mime?: string;
  attributes?: { fileName?: string; timestamp?: number };
}

export interface EvernoteNote {
  guid: string;
  title: string;
  notebookGuid?: string;
  content?: string;
  tagGuids?: string[];
  tagNames?: string[];
  updated?: number;
  resources?: EvernoteResourceRef[];
}

export interface CreateNoteArgs {
  title: string;
  notebookGuid?: string;
  content: string;
  tagNames?: string[];
  resources?: any[];
}

export interface UpdateNoteArgs extends CreateNoteArgs {
  guid: string;
}

export const DEV_TOKEN_URL: Record<Region, string> = {
  china: "https://app.yinxiang.com/api/DeveloperToken.action",
  international: "https://www.evernote.com/api/DeveloperToken.action"
};

/** Web host backing each region, used for building browser links. */
export const WEB_HOST: Record<Region, string> = {
  china: "https://app.yinxiang.com",
  international: "https://www.evernote.com"
};

/** Shard a developer token belongs to: `"s8"` from `"S=s8:U=..."`. */
export function shardFromToken(token: string): string | undefined {
  if (!token) {
    return undefined;
  }
  const match = /(?:^|:)S=(s\d+)(?::|$)/.exec(token);
  return match ? match[1] : undefined;
}

/** Shard a NoteStore URL addresses: `"s13"` from `".../shard/s13/notestore"`. */
export function shardFromNoteStoreUrl(url: string): string | undefined {
  if (!url) {
    return undefined;
  }
  const match = /\/shard\/(s\d+)(?:\/|$)/.exec(url);
  return match ? match[1] : undefined;
}

export interface IgnoredNoteStoreUrl {
  configuredShard: string;
  tokenShard: string;
  url: string;
}

/**
 * The server no longer has the note we recorded locally (deleted in the client,
 * or from another device).
 *
 * `EDAMNotFoundException` is a thrift *named-field* exception: it carries
 * `identifier`/`key` rather than a numeric `errorCode`, and its `.name` is
 * `"ThriftException"` rather than the exception name -- so neither an
 * `errorCode` nor a `name` check can detect it. `instanceof` and the
 * `identifier` field are the only reliable tests.
 */
export function isNotFoundException(error: any): boolean {
  if (!error) {
    return false;
  }
  if (error instanceof Evernote.Errors.EDAMNotFoundException) {
    return true;
  }
  return typeof error.identifier === "string" && error.identifier.indexOf("Note") === 0;
}

export class EvernoteClient {
  private noteStore: any;
  private userStore: any;
  private attributes: any;
  /** Host the client will actually talk to -- what 印象笔记 routing depends on. */
  readonly serviceHost: string;
  /**
   * Set when a configured `noteStoreUrl` was discarded because it addresses a
   * different account's shard than the token does.
   */
  readonly ignoredNoteStoreUrl?: IgnoredNoteStoreUrl;

  constructor(options: EvernoteClientOptions) {
    if (!options.token) {
      throw new Error("Evernote token is not configured. Run the 'Ever token' command.");
    }

    // A token names its own shard, so an override for a different one can only
    // be a leftover from a previous account -- and talking to the wrong shard
    // fails with `SHARD_UNAVAILABLE` on every call. The token wins.
    let noteStoreUrl = options.noteStoreUrl;
    const tokenShard = shardFromToken(options.token);
    const urlShard = shardFromNoteStoreUrl(noteStoreUrl || "");
    if (noteStoreUrl && tokenShard && urlShard && tokenShard !== urlShard) {
      this.ignoredNoteStoreUrl = { configuredShard: urlShard, tokenShard, url: noteStoreUrl };
      console.warn(
        `evermonkey: ignoring evermonkey.noteStoreUrl (shard ${urlShard}) because the token ` +
        `belongs to shard ${tokenShard}. Clear the setting to silence this.`
      );
      noteStoreUrl = undefined;
    }

    // `sandbox` defaults to TRUE in the SDK and takes precedence over `china`,
    // which silently routes every request to sandbox.evernote.com. It must be
    // set explicitly.
    const client = new Evernote.Client({
      token: options.token,
      sandbox: false,
      china: options.region === "china"
    } as any);
    this.serviceHost = client.serviceHost;
    this.userStore = client.getUserStore();
    // Passing nothing lets the SDK resolve the NoteStore URL via the UserStore
    // and cache it, so the user never has to paste one.
    this.noteStore = client.getNoteStore(noteStoreUrl || undefined);
    this.attributes = options.contentClass ? { contentClass: options.contentClass } : {};
  }

  getUser(): Promise<EvernoteUser> {
    return this.userStore.getUser();
  }

  listNotebooks(): Promise<EvernoteNotebook[]> {
    return this.noteStore.listNotebooks();
  }

  getDefaultNotebook(): Promise<EvernoteNotebook> {
    return this.noteStore.getDefaultNotebook();
  }

  createNotebook(name: string): Promise<EvernoteNotebook> {
    return this.noteStore.createNotebook({ name });
  }

  /** Returns null when the notebook no longer exists server side. */
  async findNotebook(guid: string): Promise<EvernoteNotebook | null> {
    try {
      return await this.noteStore.getNotebook(guid);
    } catch (error) {
      if (isNotFoundException(error)) {
        return null;
      }
      throw error;
    }
  }

  listTags(): Promise<EvernoteTag[]> {
    return this.noteStore.listTags();
  }

  getTag(guid: string): Promise<EvernoteTag> {
    return this.noteStore.getTag(guid);
  }

  /**
   * Note metadata without the content body. Resources come back as references
   * (guid/mime/attributes) with no data, which is enough to decide whether an
   * update has to carry them along.
   */
  async findNoteByGuid(guid: string): Promise<EvernoteNote | null> {
    try {
      return await this.noteStore.getNote(guid, false, false, false, false);
    } catch (error) {
      if (isNotFoundException(error)) {
        return null;
      }
      throw error;
    }
  }

  getNoteContent(guid: string): Promise<EvernoteNote> {
    return this.noteStore.getNoteWithResultSpec(guid, {
      includeContent: true
    });
  }

  /**
   * Finds the single note in `notebookGuid` whose title matches exactly.
   *
   * Used once per file, to adopt a note that was created before the front
   * matter carried a `guid`. Requires an exact title match *and* a unique
   * candidate, so it cannot silently attach a file to the wrong note -- which
   * is what the old "take the last note with this title" search did.
   */
  async findUniqueNoteByTitle(title: string, notebookGuid: string): Promise<EvernoteNote | null> {
    const words = `intitle:"${title.replace(/"/g, "")}"`;
    const result = await this.noteStore.findNotesMetadata({ words }, 0, 25, {
      includeTitle: true,
      includeNotebookGuid: true
    });
    const matches = ((result && result.notes) || []).filter(
      (note: EvernoteNote) =>
        note.title === title && (!notebookGuid || note.notebookGuid === notebookGuid)
    );
    return matches.length === 1 ? matches[0] : null;
  }

  /**
   * Note *with* resource bodies, for carrying attachments through an update.
   *
   * Deliberately `getNote(..., withResourcesData: true, ...)` and not
   * `getNoteWithResultSpec({ includeResourceData: true })`: the latter is
   * accepted by the service but comes back with `data.body === null`, so
   * re-sending those resources would send empty attachments.
   */
  getNoteResources(guid: string): Promise<EvernoteNote> {
    return this.noteStore.getNote(guid, false, true, false, false);
  }

  getResource(guid: string) {
    return this.noteStore.getResource(guid, true, false, true, false);
  }

  createNote(args: CreateNoteArgs): Promise<EvernoteNote> {
    return this.noteStore.createNote({
      title: args.title,
      notebookGuid: args.notebookGuid,
      content: args.content,
      tagNames: args.tagNames,
      resources: args.resources,
      attributes: this.attributes
    });
  }

  updateNote(args: UpdateNoteArgs): Promise<EvernoteNote> {
    return this.noteStore.updateNote({
      guid: args.guid,
      title: args.title,
      notebookGuid: args.notebookGuid,
      content: args.content,
      tagNames: args.tagNames,
      resources: args.resources,
      attributes: this.attributes
    });
  }

  listRecentNotes(count: number) {
    return this.noteStore.findNotesMetadata({
      order: Evernote.Types.NoteSortOrder.UPDATED
    }, 0, count, {
      includeTitle: true,
      includeNotebookGuid: true,
      includeTagGuids: true
    });
  }

  listAllNoteMetadatas(notebookGuid: string, maxNotes: number) {
    return this.noteStore.findNotesMetadata({
      notebookGuid
    }, 0, maxNotes, {
      includeTitle: true,
      includeNotebookGuid: true,
      includeTagGuids: true
    });
  }

  searchNote(words: string, maxNotes: number) {
    return this.noteStore.findNotesMetadata({
      words
    }, 0, maxNotes, {
      includeNotebookGuid: true,
      includeTitle: true
    });
  }
}
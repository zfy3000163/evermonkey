import * as vscode from "vscode";
import { resetState } from "./account";
import { getConfiguration, getNoteStoreUrl, inferRegionFromUrl, storeToken } from "./config";
import { DEV_TOKEN_URL, EvernoteClient, Region } from "./everapi";
import { describeEvernoteError } from "./myutil";

const REGION_LABELS: Record<Region, string> = {
  china: "印象笔记 (China)",
  international: "Evernote International"
};

interface RegionPick extends vscode.QuickPickItem {
  region: Region;
}

/**
 * Walks the user through the Evernote developer-token setup.
 *
 * Only the token is asked for. The NoteStore URL is discovered from the
 * UserStore by the SDK, and the token is validated before anything is
 * persisted, so a bad paste cannot leave the extension in a broken state.
 */
export async function configureToken(context: vscode.ExtensionContext): Promise<void> {
  // 印象笔记 first: it is the more common choice here, and the first entry is
  // what the picker highlights.
  const picks: RegionPick[] = [
    { label: "$(globe) 印象笔记 (China)", description: "app.yinxiang.com", region: "china" },
    { label: "$(globe) Evernote International", description: "www.evernote.com", region: "international" }
  ];
  const picked = await vscode.window.showQuickPick(picks, {
    placeHolder: "Which Evernote service do you use?",
    ignoreFocusOut: true
  });
  if (!picked) {
    return;
  }
  const region = picked.region;
  warnOnRegionMismatch(region);

  await vscode.env.openExternal(vscode.Uri.parse(DEV_TOKEN_URL[region]));

  const token = ((await vscode.window.showInputBox({
    prompt: `Paste your ${REGION_LABELS[region]} developer token`,
    placeHolder: "S=s1:U=...:E=...:C=...:P=...",
    password: true,
    ignoreFocusOut: true
  })) || "").trim();
  if (!token) {
    return;
  }

  let username: string | undefined;
  let shardId: string | undefined;
  let staleNoteStoreUrl: string | undefined;
  try {
    // Built with exactly the options a real operation uses -- passing the
    // configured noteStoreUrl here too -- so validation cannot pass while
    // publishing later fails because the two disagreed.
    const client = new EvernoteClient({ token, region, noteStoreUrl: getNoteStoreUrl() });
    const user = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Validating token against ${client.serviceHost}...`
      },
      () => client.getUser()
    );
    username = user.username;
    shardId = user.shardId;
    // A noteStoreUrl left over from a previous account addresses the wrong
    // shard, which fails every call with SHARD_UNAVAILABLE. Reconfiguring is
    // the moment to drop it.
    staleNoteStoreUrl = client.ignoredNoteStoreUrl && client.ignoredNoteStoreUrl.url;
  } catch (error) {
    // Deliberately persist nothing: a token that does not authenticate is
    // worse than no token, because every later command would fail obscurely.
    vscode.window.showErrorMessage(`Token rejected: ${describeEvernoteError(error)}`);
    return;
  }

  await storeToken(context, token);
  const configuration = getConfiguration();
  await configuration.update("region", region, vscode.ConfigurationTarget.Global);
  // Clear the plaintext copy an older version may have left in settings.json.
  await configuration.update("token", undefined, vscode.ConfigurationTarget.Global);
  if (staleNoteStoreUrl) {
    await configuration.update("noteStoreUrl", undefined, vscode.ConfigurationTarget.Global);
  }
  resetState();

  const cleared = staleNoteStoreUrl
    ? ` The stale evermonkey.noteStoreUrl pointing at another account (${staleNoteStoreUrl}) was cleared.`
    : "";
  vscode.window.showInformationMessage(
    `evermonkey is connected to ${REGION_LABELS[region]} as ${username} (shard ${shardId}).${cleared}`
  );
}

/**
 * A NoteStore URL left over from a previous setup is the one clue we have about
 * which service an account belongs to before the token is validated.
 */
function warnOnRegionMismatch(region: Region): void {
  const existing = inferRegionFromUrl(getNoteStoreUrl());
  if (existing && existing !== region) {
    vscode.window.showWarningMessage(
      `Your existing noteStoreUrl belongs to ${REGION_LABELS[existing]}, but you picked ` +
      `${REGION_LABELS[region]}. The noteStoreUrl is now auto-detected, so you may want to ` +
      `clear the evermonkey.noteStoreUrl setting.`
    );
  }
}
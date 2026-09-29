import * as vscode from "vscode";
import { resetState } from "./account";
import { clearToken } from "./config";
import { describeEvernoteError, isAuthError, isRateLimitError } from "./myutil";

/**
 * One place for surfacing failures, so every command reacts the same way to the
 * two errors a user can actually do something about.
 */

let extensionContext: vscode.ExtensionContext | undefined;

export function initReporting(context: vscode.ExtensionContext): void {
  extensionContext = context;
}

export function reportError(error: any, prefix?: string): void {
  if (!error) {
    return;
  }
  console.error(prefix ? `${prefix}:` : "evermonkey:", error);
  const lead = prefix ? `${prefix}: ` : "";

  if (isAuthError(error)) {
    // A rejected token is worse than no token: every command would keep failing
    // with the same opaque error, so drop it and offer the one thing that fixes
    // it. The stored secret itself is only cleared if the user agrees.
    resetState();
    const RECONFIGURE = "Re-enter token";
    vscode.window
      .showErrorMessage(
        `${lead}Evernote rejected the token. It may have been regenerated in the ` +
        `developer page, revoked, or issued for a different service than ` +
        `"evermonkey.region" is set to.`,
        RECONFIGURE
      )
      .then(async choice => {
        if (choice !== RECONFIGURE || !extensionContext) {
          return;
        }
        await clearToken(extensionContext);
        resetState();
        await vscode.commands.executeCommand("extension.configureToken");
      });
    return;
  }

  if (isRateLimitError(error)) {
    vscode.window.showErrorMessage(
      `${lead}the Evernote API rate limit was reached. Wait a few minutes and try again.`
    );
    return;
  }

  vscode.window.showErrorMessage(lead + describeEvernoteError(error));
}
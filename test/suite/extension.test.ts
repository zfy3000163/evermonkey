import * as assert from "assert";
import * as vscode from "vscode";

const EXPECTED_COMMANDS = [
  "extension.navToNote",
  "extension.publishNote",
  "extension.configureToken",
  // Alias kept for older keybindings and docs.
  "extension.openDevPage",
  "extension.sync",
  "extension.newNote",
  "extension.searchNote",
  "extension.openRecentNotes",
  "extension.attachToNote",
  "extension.listResources",
  "extension.openNoteInBrowser",
  "extension.removeAttachment",
  "extension.viewInEverClient"
];

suite("Extension host", () => {
  test("activates without a token configured", async () => {
    const extension = vscode.extensions.getExtension("michalyao.evermonkey");
    assert.ok(extension, "extension should be installed in the test host");
    await extension.activate();
    assert.ok(extension.isActive, "extension should be active");
  });

  test("registers every contributed command", async () => {
    const registered = await vscode.commands.getCommands(true);
    const missing = EXPECTED_COMMANDS.filter(id => registered.indexOf(id) < 0);
    assert.deepStrictEqual(missing, [], `commands not registered: ${missing.join(", ")}`);
  });

  test("the contributes menu and the runtime agree", async () => {
    const extension = vscode.extensions.getExtension("michalyao.evermonkey");
    const contributed = extension.packageJSON.contributes.commands.map(item => item.command);
    const registered = await vscode.commands.getCommands(true);
    const missing = contributed.filter(id => registered.indexOf(id) < 0);
    assert.deepStrictEqual(missing, [], `contributed but not registered: ${missing.join(", ")}`);
  });
});
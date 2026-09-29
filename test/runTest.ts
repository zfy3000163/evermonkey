import * as path from "path";
import { runTests } from "@vscode/test-electron";

/**
 * Downloads a VS Code build and runs the `test/suite` mocha tests inside it.
 *
 * The pure logic (front matter, markdown -> ENML) is covered by
 * `npm run test:unit` in plain node, which is much faster; this host exists for
 * the things that genuinely need the VS Code API.
 */
async function main(): Promise<void> {
  try {
    await runTests({
      extensionDevelopmentPath: path.resolve(__dirname, "../../"),
      extensionTestsPath: path.resolve(__dirname, "./suite/index"),
      launchArgs: ["--disable-extensions"]
    });
  } catch (error) {
    console.error("Failed to run extension tests:", error);
    process.exit(1);
  }
}

main();
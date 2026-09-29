import * as fs from "fs";
import * as path from "path";
import Mocha = require("mocha");

/** Mocha runner that the extension host invokes. */
export function run(): Promise<void> {
  const mocha = new Mocha({ ui: "tdd", color: true, timeout: 30000 });
  const testsRoot = path.resolve(__dirname);
  for (const file of collect(testsRoot)) {
    mocha.addFile(file);
  }
  return new Promise((resolve, reject) => {
    try {
      mocha.run(failures => {
        if (failures > 0) {
          reject(new Error(`${failures} test(s) failed.`));
        } else {
          resolve();
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Recursively collects compiled tests. Deliberately not `glob`: glob@13 is
 * ESM-only and would drag a module-format decision into this one function.
 */
function collect(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collect(full));
    } else if (entry.name.endsWith(".test.js")) {
      found.push(full);
    }
  }
  return found;
}
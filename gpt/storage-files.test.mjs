import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
test("filesystem accounting and cleanup preserve isolation and deduplicate compressed extents", () => {
  execFileSync("python3", [fileURLToPath(new URL("./storage-files-test.py", import.meta.url))], {
    stdio: "pipe",
  });
});

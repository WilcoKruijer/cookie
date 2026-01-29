import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export function createUnifiedDiff(expected: string, actual: string): string | null {
  const tempDir = mkdtempSync(join(tmpdir(), "cookie-manager-diff-"));
  const expectedPath = join(tempDir, "expected");
  const actualPath = join(tempDir, "actual");

  try {
    writeFileSync(expectedPath, expected, "utf8");
    writeFileSync(actualPath, actual, "utf8");
    const diff =
      runDiffCommand("diff", ["-u", expectedPath, actualPath]) ??
      runDiffCommand("git", ["diff", "--no-index", "--no-color", "--", expectedPath, actualPath]);

    if (!diff || diff.trim().length === 0) {
      return null;
    }

    return diff;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function runDiffCommand(command: string, args: string[]): string | null {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) {
    return null;
  }
  return typeof result.stdout === "string" ? result.stdout : null;
}

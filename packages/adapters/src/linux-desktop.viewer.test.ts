import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NOVNC_WEB_ROOT_COMMAND } from "@rakazo/core/node/desktop-runtime";
import { describe, expect, it } from "vitest";
import { installViewerCommand, VIEWER_PAGE } from "./linux-desktop.js";

const computerRoot = path.resolve(import.meta.dirname, "../../../infra/sandboxes/computer");

describe("installViewerCommand", () => {
  it("copies the computer image's viewer into the noVNC directory", async () => {
    const web = await mkdtemp(path.join(tmpdir(), "rakazo-novnc-"));
    try {
      const command = await installViewerCommand();
      expect(command).toContain(NOVNC_WEB_ROOT_COMMAND);
      execFileSync("bash", ["-c", command.replace(NOVNC_WEB_ROOT_COMMAND, `web=${web}`)]);
      for (const name of [VIEWER_PAGE, "clipboard-bridge.js", "mobile-keyboard.js"]) {
        expect(await readFile(path.join(web, name), "utf8")).toBe(
          await readFile(path.join(computerRoot, name), "utf8"),
        );
        expect((await stat(path.join(web, name))).mode & 0o777).toBe(0o644);
      }
    } finally {
      await rm(web, { recursive: true, force: true });
    }
  });
});

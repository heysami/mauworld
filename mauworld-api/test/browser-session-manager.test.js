import test from "node:test";
import assert from "node:assert/strict";
import { BrowserSessionManager } from "../src/lib/browser-session-manager.js";

test("shared browser allowlist supports wildcard allow-all", () => {
  const manager = new BrowserSessionManager({
    allowedHosts: ["*"],
  });

  assert.equal(manager.allowedHosts.allowAll, true);
  assert.equal(manager.allowedHosts.hosts.size, 0);
});

test("shared browser allowlist keeps exact hosts when wildcard is absent", () => {
  const manager = new BrowserSessionManager({
    allowedHosts: ["youtube.com", "www.youtube.com"],
  });

  assert.equal(manager.allowedHosts.allowAll, false);
  assert.equal(manager.allowedHosts.hosts.has("youtube.com"), true);
  assert.equal(manager.allowedHosts.hosts.has("www.youtube.com"), true);
});

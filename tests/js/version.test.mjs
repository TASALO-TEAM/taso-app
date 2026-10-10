import test from "node:test";
import assert from "node:assert/strict";
import { compareVersions, isVersionAtLeast, parseVersion } from "../../static/js/modules/version.js";

test("parseVersion separa en números y tolera basura", () => {
  assert.deepEqual(parseVersion("7.10"), [7, 10]);
  assert.deepEqual(parseVersion("9"), [9]);
  assert.deepEqual(parseVersion(""), [0]);
  assert.deepEqual(parseVersion(undefined), [0]);
  assert.deepEqual(parseVersion("x.y"), [0, 0]);
  assert.deepEqual(parseVersion("-3.2"), [0, 2]);
});

test("compareVersions compara por números, no por texto", () => {
  assert.equal(compareVersions("7.10", "7.9"), 1);
  assert.equal(compareVersions("7.9", "7.10"), -1);
  assert.equal(compareVersions("6.0", "6"), 0);
  assert.equal(compareVersions("8.0", "7.99"), 1);
  assert.equal(compareVersions("6.1", "6.1.0"), 0);
});

test("isVersionAtLeast: versiones mínimas del SDK", () => {
  assert.equal(isVersionAtLeast("9.1", "6.1"), true);
  assert.equal(isVersionAtLeast("6.1", "6.1"), true);
  assert.equal(isVersionAtLeast("6.0", "6.1"), false);
  assert.equal(isVersionAtLeast("7.9", "7.10"), false);
  assert.equal(isVersionAtLeast("7.10", "7.10"), true);
});

test("isVersionAtLeast sin versión actual es falso (nunca asume soporte)", () => {
  assert.equal(isVersionAtLeast(undefined, "6.1"), false);
  assert.equal(isVersionAtLeast("", "6.1"), false);
  assert.equal(isVersionAtLeast(null, "6.1"), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCommandRelativeCwd, joinRemoteWorkingDirectory } from "../apps/panel/src/routes/saki/types.js";

test("the selected POSIX workspace root is a valid command cwd", () => {
  const root = "/Tool_third_verify";
  for (const cwd of ["", ".", root, `${root}/`, `${root}/.`]) {
    assert.equal(normalizeCommandRelativeCwd(cwd, root), "");
  }
  assert.equal(normalizeCommandRelativeCwd("/Tool_third_verify/src/tests", root), "src/tests");
  assert.equal(normalizeCommandRelativeCwd("./src//tests/", root), "src/tests");
  assert.equal(joinRemoteWorkingDirectory(root, normalizeCommandRelativeCwd(root, root)), root);
  assert.equal(normalizeCommandRelativeCwd("/tmp", "/"), "tmp");
});

test("remote Windows and UNC paths use their own path rules", () => {
  const root = "C:\\Projects\\Verify";
  assert.equal(normalizeCommandRelativeCwd("c:/projects/verify/", root), "");
  assert.equal(normalizeCommandRelativeCwd("C:\\Projects\\Verify\\src", root), "src");
  assert.equal(normalizeCommandRelativeCwd("\\\\server\\share\\Verify", "\\\\server\\share\\Verify"), "");
  assert.equal(normalizeCommandRelativeCwd("//server/share/Verify/src", "//server/share/Verify"), "src");
});

test("an absolute cwd never expands the selected workspace scope", () => {
  const root = "/Tool_third_verify";
  for (const cwd of ["/", "/etc", "/Tool_third_verify_other", "/Tool_third_verify_other/src", "/tool_third_verify", "../other", `${root}/../other`, `${root}/src/../../etc`, "C:relative", "src\u0000", "src\n", "src\r"]) {
    assert.throws(() => normalizeCommandRelativeCwd(cwd, root), undefined, cwd);
  }
  for (const cwd of ["D:/Projects/Verify", "C:/Projects/Verify_other", "C:Projects/Verify", "/Projects/Verify", "\\Projects\\Verify", "//other/share/Verify"]) {
    assert.throws(() => normalizeCommandRelativeCwd(cwd, "C:\\Projects\\Verify"), undefined, cwd);
  }
  assert.throws(() => normalizeCommandRelativeCwd(root));
  assert.throws(() => normalizeCommandRelativeCwd("/tmp/Verify", "Verify"));
});

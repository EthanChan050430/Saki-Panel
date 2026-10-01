import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  commitGit,
  gitDiff,
  gitHistory,
  gitStatus,
  initGit,
  parseGitStatus,
  saveGitIgnore,
} from "../src/git-manager.js";

const exec = promisify(execFile);
const author = { authorName: "Git Test", authorEmail: "test@example.com" };

test("first-commit diff reads the current file, not an older staged version", () =>
  fixture(async (root, git) => {
    await initGit(root);
    await fs.writeFile(path.join(root, "draft.txt"), "staged version\n");
    await git("add", "draft.txt");
    await fs.writeFile(path.join(root, "draft.txt"), "working version\n");
    const result = await gitDiff(root, ["draft.txt"]);
    assert.match(result.diff, /\+working version/);
    assert.doesNotMatch(result.diff, /staged version/);
    assert.equal(await git("show", ":draft.txt"), "staged version");
  }));

test("filtered files are rejected without executing repository-defined programs", () =>
  fixture(async (root, git) => {
    await initGit(root);
    const marker = path.join(root, "filter-ran.txt");
    const helper = path.join(root, "filter.cjs");
    await fs.writeFile(helper, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');`);
    await fs.writeFile(path.join(root, ".gitattributes"), "*.txt filter=custom\n");
    await git("config", "filter.custom.clean", `node "${helper.replace(/\\/g, "/")}"`);
    await git("config", "filter.custom.required", "true");
    await fs.writeFile(path.join(root, "safe.txt"), "unchanged content\n");
    await assert.rejects(commitGit(root, { paths: ["safe.txt"], message: "safe commit", expectedHead: null, ...author }), /使用 Git 过滤器/);
    const filterRun = await fs.readFile(marker, "utf8").catch(() => null);
    assert.equal(filterRun, null);
    assert.equal((await gitStatus(root)).head, null);
    await fs.writeFile(path.join(root, ".gitattributes"), "*.txt -filter\n");
    const result = await commitGit(root, { paths: ["safe.txt"], message: "unfiltered commit", expectedHead: null, ...author });
    assert.equal(await git("show", `${result.hash}:safe.txt`), "unchanged content");
  }));

test("exclusion rules enforce the size limit after adding selected paths", () =>
  fixture(async (root) => {
    await initGit(root);
    await assert.rejects(saveGitIgnore(root, { content: "#".repeat(65530), expectedContent: "", paths: ["long-name.txt"] }), /超过 64 KB/);
    assert.equal((await gitStatus(root)).ignoreContent, "");
  }));

test("large tracked diffs return a truncated preview instead of a buffer error", () =>
  fixture(async (root) => {
    await initGit(root);
    await fs.writeFile(path.join(root, "large.txt"), "old\n");
    const first = await commitGit(root, { paths: ["large.txt"], message: "base", expectedHead: null, ...author });
    await fs.writeFile(path.join(root, "large.txt"), "a".repeat(9 * 1024 * 1024));
    const result = await gitDiff(root, ["large.txt"]);
    assert.equal(result.truncated, true);
    assert.equal(result.diff.length, 120000);
    assert.match(result.diff, /\+aaaa/);
    const next = await commitGit(root, { paths: ["large.txt"], message: "large file", expectedHead: first.hash, ...author });
    assert.equal((await gitDiff(root, undefined, next.hash)).truncated, true);
  }));
async function fixture(
  run: (
    root: string,
    git: (...args: string[]) => Promise<string>,
  ) => Promise<void>,
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "saki-git-test-"));
  const git = async (...args: string[]) =>
    (
      await exec(
        "git",
        [
          ...(args[0] === "check-ignore" ? [] : ["--literal-pathspecs"]),
          "-C",
          root,
          ...args,
        ],
        { windowsHide: true },
      )
    ).stdout.trim();
  try {
    await run(root, git);
  } finally {
    assert.ok(
      path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) &&
        path.basename(root).startsWith("saki-git-test-"),
    );
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("status parser preserves Unicode, spaces and rename source paths", () => {
  assert.deepEqual(
    parseGitStatus("R  新 文件.txt\0旧 文件.txt\0?? [x].txt\0!! logs/\0"),
    {
      changes: [
        {
          path: "新 文件.txt",
          originalPath: "旧 文件.txt",
          index: "R",
          worktree: " ",
        },
        { path: "[x].txt", index: "?", worktree: "?" },
      ],
      ignored: ["logs/"],
    },
  );
});

test("init, initial commit, history, root diff, pagination and staged isolation", () =>
  fixture(async (root, git) => {
    assert.equal((await gitStatus(root)).initialized, false);
    assert.equal((await initGit(root)).branch, "main");
    assert.deepEqual(await gitHistory(root, 0, 1), {
      commits: [],
      hasMore: false,
    });
    await fs.writeFile(path.join(root, "中文 [draft].txt"), "first\n");
    await fs.writeFile(path.join(root, "other.txt"), "unrelated\n");
    await git("add", "other.txt");
    const first = await commitGit(root, {
      ...author,
      paths: ["中文 [draft].txt"],
      message: "首次提交\n\n正文内容",
      expectedHead: null,
    });
    assert.equal(await git("show", "HEAD:中文 [draft].txt"), "first");
    assert.equal(await git("diff", "--cached", "--name-only"), "other.txt");
    assert.ok(
      (await gitDiff(root, undefined, first.hash)).diff.includes("+first"),
    );
    const history = await gitHistory(root, 0, 1);
    assert.equal(history.commits[0]?.subject, "首次提交");
    assert.equal(history.commits[0]?.body.trim(), "正文内容");
    assert.equal((await gitStatus(root)).authorName, author.authorName);
    await assert.rejects(
      commitGit(root, {
        ...author,
        paths: ["中文 [draft].txt"],
        message: "empty",
        expectedHead: first.hash,
      }),
      /没有需要提交/,
    );
    await fs.writeFile(path.join(root, "中文 [draft].txt"), "second\n");
    await fs.writeFile(path.join(root, "other.txt"), "worktree newer\n");
    await commitGit(root, {
      ...author,
      paths: ["中文 [draft].txt"],
      message: "更新",
      expectedHead: first.hash,
    });
    assert.equal(await git("show", ":other.txt"), "unrelated");
    assert.equal((await gitHistory(root, 0, 1)).hasMore, true);
    assert.equal((await gitHistory(root, 1, 1)).commits[0]?.hash, first.hash);
  }));

test("exclude tracked directories without deleting disk files; literal rules and stale edits", () =>
  fixture(async (root, git) => {
    await initGit(root);
    await fs.mkdir(path.join(root, "logs"));
    await fs.writeFile(path.join(root, "logs", "app.log"), "private log\n");
    await fs.writeFile(path.join(root, "[exact].txt"), "exact\n");
    await fs.writeFile(path.join(root, "e.txt"), "keep\n");
    const first = await commitGit(root, {
      ...author,
      paths: ["logs", "[exact].txt", "e.txt"],
      message: "initial",
      expectedHead: null,
    });
    const next = await saveGitIgnore(root, {
      content: "# keep rules\n",
      expectedContent: "",
      paths: ["logs", "[exact].txt"],
    });
    assert.equal(
      await fs.readFile(path.join(root, "logs", "app.log"), "utf8"),
      "private log\n",
    );
    assert.ok(
      next.changes.some(
        (change) => change.path === "logs/app.log" && change.index === "D",
      ),
    );
    assert.equal(
      await git("check-ignore", "--no-index", "[exact].txt"),
      "[exact].txt",
    );
    await assert.rejects(exec("git", ["-C", root, "check-ignore", "e.txt"]));
    await assert.rejects(
      saveGitIgnore(root, {
        content: "changed",
        expectedContent: "stale",
        paths: [],
      }),
      /已被其他操作修改/,
    );
    await commitGit(root, {
      ...author,
      paths: [".gitignore", "logs/app.log", "[exact].txt"],
      message: "exclude",
      expectedHead: first.hash,
    });
    assert.equal(await git("ls-files", "logs", "[exact].txt"), "");
    assert.equal(
      await fs.readFile(path.join(root, "[exact].txt"), "utf8"),
      "exact\n",
    );
    assert.equal((await gitStatus(root)).changes.length, 0);
  }));

test("selected renames, deletions and untracked diffs; reject traversal and stale HEAD", () =>
  fixture(async (root, git) => {
    await initGit(root);
    await fs.writeFile(path.join(root, "old.txt"), "old\n");
    const first = await commitGit(root, {
      ...author,
      paths: ["old.txt"],
      message: "first",
      expectedHead: null,
    });
    await git("mv", "old.txt", "new.txt");
    const changes = (await gitStatus(root)).changes;
    assert.equal(changes[0]?.originalPath, "old.txt");
    await assert.rejects(
      commitGit(root, {
        ...author,
        paths: ["new.txt"],
        message: "stale",
        expectedHead: null,
      }),
      /新的提交/,
    );
    await assert.rejects(gitDiff(root, ["../outside"]), /路径必须/);
    await assert.rejects(gitDiff(root, [".git/config"]), /路径必须/);
    await fs.writeFile(path.join(root, "new untracked.txt"), "fresh\n");
    assert.ok(
      (await gitDiff(root, ["new untracked.txt"])).diff.includes("+fresh"),
    );
    const second = await commitGit(root, {
      ...author,
      paths: ["old.txt", "new.txt"],
      message: "rename",
      expectedHead: first.hash,
    });
    assert.equal(await git("ls-files"), "new.txt");
    await fs.unlink(path.join(root, "new.txt"));
    await commitGit(root, {
      ...author,
      paths: ["new.txt"],
      message: "delete",
      expectedHead: second.hash,
    });
    assert.equal(await git("ls-files"), "");
  }));

test("history includes side branches and merge parents", () =>
  fixture(async (root, git) => {
    await initGit(root);
    await git("config", "user.name", author.authorName);
    await git("config", "user.email", author.authorEmail);
    await fs.writeFile(path.join(root, "base.txt"), "base\n");
    await commitGit(root, {
      ...author,
      paths: ["base.txt"],
      message: "base",
      expectedHead: null,
    });
    await git("checkout", "-b", "side");
    await fs.writeFile(path.join(root, "side.txt"), "side\n");
    await commitGit(root, {
      ...author,
      paths: ["side.txt"],
      message: "side",
      expectedHead: (await gitStatus(root)).head,
    });
    await git("checkout", "main");
    await fs.writeFile(path.join(root, "main.txt"), "main\n");
    await commitGit(root, {
      ...author,
      paths: ["main.txt"],
      message: "main",
      expectedHead: (await gitStatus(root)).head,
    });
    assert.equal((await gitHistory(root, 0, 40)).commits.length, 3);
    await git("merge", "--no-ff", "side", "-m", "merge");
    const history = await gitHistory(root, 0, 40);
    assert.equal(history.commits.length, 4);
    assert.equal(history.commits[0]?.parents.length, 2);
    assert.ok(
      (await gitDiff(root, undefined, history.commits[0]!.hash)).diff.includes(
        "+side",
      ),
    );
  }));

test("reject parent repositories and metadata links; do not inherit Git environment", () =>
  fixture(async (root, git) => {
    await initGit(root);
    const nested = path.join(root, "nested");
    await fs.mkdir(nested);
    await assert.rejects(initGit(nested), /上级 Git 仓库/);
    const previous = process.env.GIT_DIR;
    process.env.GIT_DIR = path.join(root, "nonexistent-git-dir");
    try {
      assert.equal((await gitStatus(root)).initialized, true);
    } finally {
      if (previous === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = previous;
    }
    await fs.writeFile(
      path.join(nested, ".git"),
      `gitdir: ${path.join(root, ".git")}\n`,
    );
    await assert.rejects(gitStatus(nested), /链接工作树/);
  }));

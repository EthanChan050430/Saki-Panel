import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import type {
  InstanceGitChange,
  InstanceGitCommitRequest,
  InstanceGitHistory,
  InstanceGitIgnoreRequest,
  InstanceGitStatus,
  InstanceGitDiff,
} from "@webops/shared";
import { daemonPaths } from "./config.js";

const exec = promisify(execFile);
const mutations = new Set<string>();
const maxDiffChars = 120000;

export class GitError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

function environment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  // 避免继承守护进程自身仓库的 Git 环境。
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")),
  );
  return {
    ...env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    ...extra,
  };
}

async function git(
  root: string,
  args: string[],
  extra: NodeJS.ProcessEnv = {},
): Promise<string> {
  try {
    const filterOptions: string[] = [];
    if (args[0] !== "config" && args[0] !== "--version") {
      const names = await git(root, [
        "config", "--name-only", "--get-regexp", "^filter\\..*\\.(clean|smudge|process|required)$",
      ]);
      const filters = new Set(names.split("\n").filter(Boolean).map((name) => name.slice(0, name.lastIndexOf("."))));
      // .gitattributes 可指定仓库配置中的外部过滤程序。
      for (const filter of filters) {
        filterOptions.push("-c", `${filter}.clean=`, "-c", `${filter}.smudge=`, "-c", `${filter}.process=`, "-c", `${filter}.required=false`);
      }
    }
    const result = await exec(
      "git",
      [
        "--no-pager",
        "--literal-pathspecs",
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "color.ui=false",
        ...filterOptions,
        "-C",
        root,
        ...args,
      ],
      {
        env: environment(extra),
        encoding: "utf8",
        timeout: 30000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      },
    );
    return result.stdout;
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
    if (
      failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" &&
      ["diff", "show"].includes(args[0] ?? "") &&
      typeof failure.stdout === "string" &&
      failure.stdout.length > maxDiffChars
    ) return failure.stdout.slice(0, maxDiffChars + 1);
    if (Number(failure.code) === 1 && args[0] === "config" && args[1] === "--name-only" && failure.stderr === "") return "";
    if (error instanceof GitError) throw error;
    if (failure.code === "ENOENT")
      throw new GitError("实例节点未安装 Git，请安装 Git 后重试。", 503);
    throw new GitError(
      failure.stderr?.trim().slice(0, 2000) || "Git 操作失败，请检查仓库状态。",
      409,
    );
  }
}

async function optionalGit(root: string, args: string[]): Promise<string> {
  try {
    return (await git(root, args)).trim();
  } catch {
    return "";
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function resolveGitRoot(
  workingDirectory: unknown,
): Promise<string> {
  if (typeof workingDirectory !== "string" || !workingDirectory.trim())
    throw new GitError("缺少实例工作目录。");
  const root = path.resolve(daemonPaths.workspaceDir, workingDirectory);
  await fs.mkdir(root, { recursive: true });
  return fs.realpath(root);
}

async function isRepository(root: string): Promise<boolean> {
  const metadata = path.join(root, ".git");
  if (!(await exists(metadata))) return false;
  const stat = await fs.lstat(metadata);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new GitError(
      "此仓库的 Git 元数据位于实例目录之外，暂不支持链接工作树。",
    );
  const actual = await git(root, ["rev-parse", "--show-toplevel"]);
  if (
    path.relative(await fs.realpath(root), await fs.realpath(actual.trim())) !==
    ""
  )
    throw new GitError("仓库根目录必须是实例工作目录。");
  return true;
}

async function requireRepository(root: string): Promise<void> {
  if (!(await isRepository(root)))
    throw new GitError("请先在实例工作目录创建 Git 仓库。");
}

async function validatePaths(root: string, value: unknown): Promise<string[]> {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500)
    throw new GitError("请选择 1 至 500 个文件或文件夹。");
  const result: string[] = [];
  for (const entry of value) {
    if (
      typeof entry !== "string" ||
      !entry ||
      entry.length > 4096 ||
      /[\x00-\x1f]/.test(entry)
    )
      throw new GitError("文件路径无效。");
    const normalized = (process.platform === "win32" ? entry.replace(/\\/g, "/") : entry).replace(/\/$/, "");
    if (
      normalized.startsWith("/") ||
      /^[A-Za-z]:/.test(normalized) ||
      normalized
        .split("/")
        .some(
          (piece) =>
            !piece ||
            piece === "." ||
            piece === ".." ||
            piece.toLowerCase() === ".git",
        )
    )
      throw new GitError("路径必须位于实例目录中，且不能操作 .git。");
    // 中间目录也不能是符号链接。
    let target = root;
    for (const piece of normalized.split("/")) {
      target = path.join(target, piece);
      if ((await exists(target)) && (await fs.lstat(target)).isSymbolicLink())
        throw new GitError("Git 管理暂不支持符号链接路径。");
    }
    result.push(normalized);
  }
  return [...new Set(result)];
}

async function withMutation<T>(
  root: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (mutations.has(root))
    throw new GitError("仓库正在处理其他操作，请稍后重试。", 409);
  mutations.add(root);
  try {
    return await operation();
  } finally {
    mutations.delete(root);
  }
}

async function ignoreContent(root: string): Promise<string> {
  const target = path.join(root, ".gitignore");
  if (!(await exists(target))) return "";
  await validatePaths(root, [".gitignore"]);
  if ((await fs.stat(target)).size > 65536)
    throw new GitError(".gitignore 超过 64 KB，请使用文件编辑器管理。");
  return fs.readFile(target, "utf8");
}

export function parseGitStatus(output: string): {
  changes: InstanceGitChange[];
  ignored: string[];
} {
  const changes: InstanceGitChange[] = [];
  const ignored: string[] = [];
  const fields = output.split("\0");
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (!field || field.length < 4) continue;
    const index = field[0]!;
    const worktree = field[1]!;
    const filePath = field.slice(3);
    if (index === "!" && worktree === "!") {
      ignored.push(filePath);
      continue;
    }
    const originalPath =
      index === "R" || index === "C" || worktree === "R" || worktree === "C"
        ? fields[++i]
        : undefined;
    changes.push({
      path: filePath,
      index,
      worktree,
      ...(originalPath ? { originalPath } : {}),
    });
  }
  return { changes, ignored };
}

export async function gitStatus(root: string): Promise<InstanceGitStatus> {
  const empty: InstanceGitStatus = {
    available: true,
    initialized: false,
    branch: "",
    head: null,
    changes: [],
    ignored: [],
    ignoreContent: "",
    authorName: "",
    authorEmail: "",
  };
  try {
    await git(root, ["--version"]);
  } catch (error) {
    if (error instanceof GitError && error.statusCode === 503)
      return { ...empty, available: false };
    throw error;
  }
  if (!(await isRepository(root))) return empty;
  const [output, branch, head, content, authorName, authorEmail] =
    await Promise.all([
      git(root, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--ignored=matching",
      ]),
      optionalGit(root, ["symbolic-ref", "--short", "HEAD"]),
      optionalGit(root, ["rev-parse", "--verify", "HEAD"]),
      ignoreContent(root),
      optionalGit(root, ["config", "user.name"]),
      optionalGit(root, ["config", "user.email"]),
    ]);
  return {
    ...empty,
    initialized: true,
    branch: branch || "游离 HEAD",
    head: head || null,
    ...parseGitStatus(output),
    ignoreContent: content,
    authorName,
    authorEmail,
  };
}

export async function initGit(root: string): Promise<InstanceGitStatus> {
  return withMutation(root, async () => {
    if (!(await isRepository(root))) {
      const enclosing = await optionalGit(root, [
        "rev-parse",
        "--show-toplevel",
      ]);
      if (enclosing)
        throw new GitError(
          "实例目录属于上级 Git 仓库，请为实例使用独立工作目录。",
        );
      await git(root, ["init", "--initial-branch=main"]);
    }
    return gitStatus(root);
  });
}

function pageNumber(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > max)
    throw new GitError("分页参数无效。");
  return number;
}

export async function gitHistory(
  root: string,
  offset: unknown,
  limit: unknown,
): Promise<InstanceGitHistory> {
  await requireRepository(root);
  const skip = pageNumber(offset, 0, 10000000);
  const size = Math.max(1, pageNumber(limit, 40, 100));
  const head = await optionalGit(root, ["rev-parse", "--verify", "HEAD"]);
  const output = await git(root, [
    "log",
    "--all",
    ...(head ? ["HEAD"] : []),
    "--topo-order",
    `--skip=${skip}`,
    `--max-count=${size + 1}`,
    "--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%D%x00%s%x00%b%x00",
  ]);
  const fields = output.split("\0");
  const commits: InstanceGitHistory["commits"] = [];
  for (let i = 0; i + 7 < fields.length; i += 8) {
    const hash = fields[i]!.trim();
    if (!/^[a-f0-9]{40,64}$/.test(hash)) continue;
    commits.push({
      hash,
      parents: fields[i + 1]!.split(" ").filter(Boolean),
      author: fields[i + 2]!,
      email: fields[i + 3]!,
      date: fields[i + 4]!,
      refs: fields[i + 5]!,
      subject: fields[i + 6]!,
      body: fields[i + 7]!,
    });
  }
  return { commits: commits.slice(0, size), hasMore: commits.length > size };
}

export async function gitDiff(
  root: string,
  pathsValue?: unknown,
  hash?: unknown,
): Promise<InstanceGitDiff> {
  await requireRepository(root);
  let diff = "";
  let omitted = false;
  if (hash !== undefined) {
    if (typeof hash !== "string" || !/^[a-f0-9]{40,64}$/.test(hash))
      throw new GitError("提交 ID 无效。");
    diff = await git(root, [
      "show",
      "--format=",
      "--root",
      "--first-parent",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      hash,
      "--",
    ]);
  } else {
    const paths = await validatePaths(root, pathsValue);
    const head = await optionalGit(root, ["rev-parse", "--verify", "HEAD"]);
    if (head)
      diff = await git(root, [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "HEAD",
        "--",
        ...paths,
      ]);
    const untracked = (
      await git(root, [
        "ls-files",
        ...(!head ? ["--cached"] : []),
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        ...paths,
      ])
    )
      .split("\0")
      .filter(Boolean);
    for (const file of new Set(untracked)) {
      if (diff.length > maxDiffChars) break;
      await validatePaths(root, [file]);
      const target = path.join(root, file);
      if (!(await exists(target))) continue;
      const stats = await fs.stat(target);
      if (!stats.isFile()) continue;
      if (stats.size > 65536) {
        omitted = true;
        diff += `\n新增文件 ${file}（${stats.size} bytes，省略内容）\n`;
        continue;
      }
      const buffer = await fs.readFile(path.join(root, file));
      diff += buffer.includes(0)
        ? `\nBinary file added: ${file}\n`
        : `\ndiff --git a/${file} b/${file}\nnew file\n--- /dev/null\n+++ b/${file}\n${buffer
            .toString("utf8")
            .split("\n")
            .map((line) => `+${line}`)
            .join("\n")}\n`;
    }
  }
  return {
    diff: diff.slice(0, maxDiffChars),
    truncated: omitted || diff.length > maxDiffChars,
  };
}

export async function saveGitIgnore(
  root: string,
  input: InstanceGitIgnoreRequest,
): Promise<InstanceGitStatus> {
  return withMutation(root, async () => {
    await requireRepository(root);
    if (
      typeof input.content !== "string" ||
      Buffer.byteLength(input.content) > 65536 ||
      input.content.includes("\0")
    )
      throw new GitError("排除规则无效或超过 64 KB。");
    const previous = await ignoreContent(root);
    if (input.expectedContent !== previous)
      throw new GitError("排除规则已被其他操作修改，请刷新后重试。", 409);
    const paths =
      Array.isArray(input.paths) && input.paths.length
        ? await validatePaths(root, input.paths)
        : [];
    if (paths.includes(".gitignore"))
      throw new GitError("请保留 .gitignore，以便记录排除规则。");
    let content = input.content;
    for (const entry of paths) {
      // 选择的路径按字面值写入排除规则。
      const rule = `/${entry.replace(/([\\*?\[\]#! ])/g, "\\$1")}`;
      if (!content.split(/\r?\n/).includes(rule))
        content += `${content && !content.endsWith("\n") ? "\n" : ""}${rule}\n`;
    }
    if (Buffer.byteLength(content) > 65536)
      throw new GitError("添加所选路径后排除规则超过 64 KB。");
    await validatePaths(root, [".gitignore"]);
    await fs.writeFile(path.join(root, ".gitignore"), content, "utf8");
    try {
      if (paths.length) {
        await git(root, [
          "rm",
          "--cached",
          "-r",
          "--ignore-unmatch",
          "--",
          ...paths,
        ]);
      }
    } catch (error) {
      await fs.writeFile(path.join(root, ".gitignore"), previous, "utf8");
      throw error;
    }
    return gitStatus(root);
  });
}

export async function commitGit(
  root: string,
  input: InstanceGitCommitRequest,
): Promise<{ hash: string }> {
  return withMutation(root, async () => {
    await requireRepository(root);
    const paths = await validatePaths(root, input.paths);
    if (
      typeof input.message !== "string" ||
      !input.message.trim() ||
      input.message.length > 16000 ||
      input.message.includes("\0")
    )
      throw new GitError("请填写提交说明（最多 16000 字符）。");
    if (
      typeof input.authorName !== "string" ||
      !input.authorName.trim() ||
      /[\x00-\x1f<>]/.test(input.authorName) ||
      input.authorName.length > 100
    )
      throw new GitError("请填写有效的提交者姓名。");
    if (
      typeof input.authorEmail !== "string" ||
      !/^[^\s<>@]+@[^\s<>@]+$/.test(input.authorEmail) ||
      input.authorEmail.length > 254
    )
      throw new GitError("请填写有效的提交者邮箱。");
    const head = await optionalGit(root, ["rev-parse", "--verify", "HEAD"]);
    if (input.expectedHead !== (head || null))
      throw new GitError("仓库已产生新的提交，请刷新后重试。", 409);
    for (const name of [
      "MERGE_HEAD",
      "CHERRY_PICK_HEAD",
      "REVERT_HEAD",
      "rebase-merge",
      "rebase-apply",
    ]) {
      if (await exists(path.join(root, ".git", name)))
        throw new GitError("请先在终端完成正在进行的合并、变基或拣选。");
    }
    const status = await gitStatus(root);
    if (
      status.changes.some(
        (change) =>
          change.index === "U" ||
          change.worktree === "U" ||
          ["AA", "DD"].includes(change.index + change.worktree),
      )
    )
      throw new GitError("请先解决仓库中的冲突。");
    // 独立索引保留其他文件的暂存内容。
    const indexFile = path.join(root, ".git", `saki-index-${randomUUID()}`);
    const env = {
      GIT_INDEX_FILE: indexFile,
      GIT_AUTHOR_NAME: input.authorName.trim(),
      GIT_AUTHOR_EMAIL: input.authorEmail.trim(),
      GIT_COMMITTER_NAME: input.authorName.trim(),
      GIT_COMMITTER_EMAIL: input.authorEmail.trim(),
    };
    try {
      await git(
        root,
        head ? ["read-tree", head] : ["read-tree", "--empty"],
        env,
      );
      const removed = status.changes
        .filter(
          (change) =>
            change.index === "D" &&
            paths.some(
              (entry) =>
                change.path === entry || change.path.startsWith(`${entry}/`),
            ),
        )
        .map((change) => change.path);
      const normal = paths.filter((entry) => !removed.includes(entry));
      if (normal.length) await git(root, ["add", "-A", "--", ...normal], env);
      if (removed.length)
        await git(
          root,
          ["update-index", "--force-remove", "--", ...removed],
          env,
        );
      const files = (await git(root, ["ls-files", "-z", "--", ...paths], env))
        .split("\0")
        .filter(Boolean);
      const batches: string[][] = [];
      let batch: string[] = [];
      let argumentSize = 0;
      for (const file of files) {
        const size = file.length * 2 + 3;
        if (batch.length && (argumentSize + size > 16000 || batch.length >= 100)) {
          batches.push(batch);
          batch = [];
          argumentSize = 0;
        }
        batch.push(file);
        argumentSize += size;
      }
      if (batch.length) batches.push(batch);
      for (const files of batches) {
        for (const cached of [false, true]) {
          const attributes = (
            await git(root, ["check-attr", ...(cached ? ["--cached"] : []), "-z", "filter", "--", ...files], env)
          ).split("\0");
          for (let i = 0; i + 2 < attributes.length; i += 3) {
            if (!["unspecified", "unset"].includes(attributes[i + 2]!))
              throw new GitError(`文件 ${attributes[i]} 使用 Git 过滤器，请在终端提交以保留 Git LFS 等文件的存储格式。`);
          }
        }
      }
      const tree = (await git(root, ["write-tree"], env)).trim();
      if (
        head &&
        tree === (await optionalGit(root, ["rev-parse", `${head}^{tree}`]))
      )
        throw new GitError("所选文件没有需要提交的变更。");
      if (!head && !(await git(root, ["ls-files", "-z"], env)))
        throw new GitError("请选择有内容的文件进行首次提交。");
      await git(root, [
        "config",
        "--local",
        "user.name",
        input.authorName.trim(),
      ]);
      await git(root, [
        "config",
        "--local",
        "user.email",
        input.authorEmail.trim(),
      ]);
      const hash = (
        await git(
          root,
          [
            "-c",
            "commit.gpgsign=false",
            "commit-tree",
            tree,
            ...(head ? ["-p", head] : []),
            "-m",
            input.message.trim(),
          ],
          env,
        )
      ).trim();
      // 外部工具改变 HEAD 时拒绝覆盖。
      await git(root, [
        "update-ref",
        "-m",
        `commit: ${input.message.split("\n")[0]}`,
        "HEAD",
        hash,
        head,
      ]);
      try {
        await git(root, ["reset", "-q", hash, "--", ...paths]);
      } catch {
        throw new GitError(
          `提交 ${hash.slice(0, 7)} 已创建，但暂存区刷新失败。请刷新仓库并检查索引锁。`,
          409,
        );
      }
      return { hash };
    } finally {
      await fs.rm(indexFile, { force: true });
      await fs.rm(`${indexFile}.lock`, { force: true });
    }
  });
}

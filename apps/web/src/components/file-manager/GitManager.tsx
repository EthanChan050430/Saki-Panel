import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  FileText,
  Folder,
  GitBranch,
  GitCommitHorizontal,
  History,
  Loader2,
  RefreshCw,
  Search,
  ShieldOff,
} from "lucide-react";
import type {
  InstanceFileEntry,
  InstanceGitCommit,
  InstanceGitDiff,
  InstanceGitStatus,
} from "@webops/shared";
import { api } from "../../api.js";
import { gitGraph, type GitGraphRow } from "./gitGraph.js";
type Tab = "changes" | "history" | "ignore";
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "操作失败，请重试。";
const dateText = (date: string) =>
  new Date(date).toLocaleString("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
function CommitGraph({
  row,
  width,
  merge,
}: {
  row: GitGraphRow;
  width: number;
  merge: boolean;
}) {
  const x = (lane: number) => Math.min(lane, 7) * 12 + 6;
  return (
    <span
      className="git-graph"
      style={{
        width,
      }}
      aria-hidden="true"
    >
      <svg viewBox={`0 0 ${width} 100`} preserveAspectRatio="none">
        {row.incoming && <path d={`M${x(row.lane)} 0 V30`} />}
        {row.edges.map((edge, i) => (
          <path
            key={i}
            d={
              edge.fromNode
                ? `M${x(edge.from)} 30 C${x(edge.from)} 65 ${x(edge.to)} 65 ${x(edge.to)} 100`
                : `M${x(edge.from)} 0 C${x(edge.from)} 50 ${x(edge.to)} 50 ${x(edge.to)} 100`
            }
          />
        ))}
      </svg>
      <span
        className={`git-graph-dot ${merge ? "merge" : ""}`}
        style={{
          left: x(row.lane) - 3,
        }}
      />
    </span>
  );
}
function changeLabel(index: string, worktree: string) {
  const code = index + worktree;
  if (code.includes("U") || ["AA", "DD"].includes(code)) return "冲突";
  if (index === "?") return "新增";
  if (code.includes("D")) return "删除";
  if (code.includes("R")) return "重命名";
  if (code.includes("A")) return "新增";
  return "修改";
}
function DiffView({ data }: { data: InstanceGitDiff | null }) {
  if (!data)
    return (
      <div className="git-placeholder">
        <FileText size={24} />
        <span>选择文件或提交，查看变更内容</span>
      </div>
    );
  return (
    <>
      {data.truncated && (
        <div className="git-notice">差异未完整展示：较大文件的内容已省略，或文本超过 120,000 个字符。</div>
      )}
      <pre className="git-diff" aria-label="Git 差异">
        {data.diff
          ? data.diff.split("\n").map((line, i) => (
              <div
                key={i}
                className={
                  line.startsWith("diff ") || line.startsWith("@@")
                    ? "git-diff-heading"
                    : line.startsWith("+")
                      ? "git-diff-add"
                      : line.startsWith("-")
                        ? "git-diff-remove"
                        : ""
                }
              >
                {line || " "}
              </div>
            ))
          : "没有文本差异，文件可能为二进制文件或仅修改了元数据。"}
      </pre>
    </>
  );
}
export function GitManager({
  active,
  token,
  instanceId,
  initialExcludedPaths,
  onFilesChanged,
}: {
  active: boolean;
  token: string;
  instanceId: string;
  initialExcludedPaths: string[];
  onFilesChanged: () => void;
}) {
  const [status, setStatus] = useState<InstanceGitStatus | null>(null);
  const [tab, setTab] = useState<Tab>(
    initialExcludedPaths.length ? "ignore" : "changes",
  );
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [issue, setIssue] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [diff, setDiff] = useState<InstanceGitDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [activePath, setActivePath] = useState("");
  const [commits, setCommits] = useState<InstanceGitCommit[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyReady, setHistoryReady] = useState(false);
  const [activeCommit, setActiveCommit] = useState<InstanceGitCommit | null>(
    null,
  );
  const [search, setSearch] = useState("");
  const [ignore, setIgnore] = useState("");
  const [excluded, setExcluded] = useState<Set<string>>(
    new Set(initialExcludedPaths),
  );
  const [browsePath, setBrowsePath] = useState("");
  const [entries, setEntries] = useState<InstanceFileEntry[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const alive = useRef(true);
  const statusRef = useRef<InstanceGitStatus | null>(null);
  const diffRequest = useRef(0);
  const browseRequest = useRef(0);
  const statusRequest = useRef(0);
  const historyRequest = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, [token, instanceId]);
  useEffect(() => {
    if (active) void refresh();
  }, [token, instanceId, active]);
  useEffect(() => {
    if (initialExcludedPaths.length) {
      setExcluded(new Set(initialExcludedPaths));
      setTab("ignore");
    }
  }, [initialExcludedPaths]);
  async function refresh() {
    const request = ++statusRequest.current;
    setBusy("refresh");
    setError("");
    try {
      const next = await api.instanceGitStatus(token, instanceId);
      if (!alive.current || request !== statusRequest.current) return;
      const previous = statusRef.current;
      setIgnore((current) =>
        !previous || current === previous.ignoreContent
          ? next.ignoreContent
          : current,
      );
      statusRef.current = next;
      setStatus(next);
      ++diffRequest.current;
      setDiff(null);
      setDiffLoading(false);
      setActivePath("");
      setActiveCommit(null);
      setName((current) => current || next.authorName);
      setEmail((current) => current || next.authorEmail);
      setSelected(
        (current) =>
          new Set(
            [...current].filter((item) =>
              next.changes.some((change) => change.path === item),
            ),
          ),
      );
      setHistoryReady(false);
      ++historyRequest.current;
      setHistoryLoading(false);
    } catch (error) {
      if (alive.current && request === statusRequest.current) setError(errorText(error));
    } finally {
      if (alive.current && request === statusRequest.current) setBusy("");
    }
  }
  useEffect(() => {
    if (
      tab === "history" &&
      status?.initialized &&
      !historyReady &&
      !historyLoading
    )
      void loadHistory(false);
  }, [tab, status?.initialized, historyReady, historyLoading]);
  async function loadHistory(more: boolean) {
    const request = ++historyRequest.current;
    setHistoryLoading(true);
    setError("");
    try {
      const result = await api.instanceGitHistory(
        token,
        instanceId,
        more ? commits.length : 0,
      );
      if (!alive.current || request !== historyRequest.current) return;
      setCommits((current) =>
        more ? [...new Map([...current, ...result.commits].map((commit) => [commit.hash, commit])).values()] : result.commits,
      );
      setHasMore(result.hasMore);
      setHistoryReady(true);
    } catch (error) {
      if (alive.current && request === historyRequest.current) {
        setError(errorText(error));
        setHistoryReady(true);
      }
    } finally {
      if (alive.current && request === historyRequest.current) setHistoryLoading(false);
    }
  }
  useEffect(() => {
    if (tab !== "ignore" || !status?.initialized) return;
    const request = ++browseRequest.current;
    setBrowseLoading(true);
    void api
      .listInstanceFiles(token, instanceId, browsePath)
      .then((result) => {
        if (alive.current && request === browseRequest.current)
          setEntries(
            result.entries.filter(
              (entry) =>
                entry.name !== ".git" &&
                entry.path !== ".gitignore" &&
                entry.type !== "symlink",
            ),
          );
      })
      .catch((error) => {
        if (alive.current && request === browseRequest.current)
          setError(errorText(error));
      })
      .finally(() => {
        if (alive.current && request === browseRequest.current)
          setBrowseLoading(false);
      });
  }, [token, instanceId, tab, browsePath, status?.initialized]);
  async function preview(
    selection:
      | {
          paths: string[];
        }
      | {
          hash: string;
        },
  ) {
    const request = ++diffRequest.current;
    setDiff(null);
    setDiffLoading(true);
    setError("");
    try {
      const result = await api.instanceGitDiff(token, instanceId, selection);
      if (alive.current && request === diffRequest.current) setDiff(result);
    } catch (error) {
      if (alive.current && request === diffRequest.current)
        setError(errorText(error));
    } finally {
      if (alive.current && request === diffRequest.current)
        setDiffLoading(false);
    }
  }
  async function run(label: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (error) {
      if (alive.current) setError(errorText(error));
    } finally {
      if (alive.current) setBusy("");
    }
  }
  function toggle(
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    value: string,
  ) {
    setter((current) => {
      const next = new Set(current);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });
  }
  const selectedChanges =
    status?.changes.filter((change) => selected.has(change.path)) ?? [];
  const commitPaths = [
    ...new Set(
      selectedChanges.flatMap((change) => [
        change.path,
        ...(change.originalPath ? [change.originalPath] : []),
      ]),
    ),
  ];
  const allSelected =
    !!status?.changes.length && selected.size === status.changes.length;
  const graph = gitGraph(commits);
  const visibleCommits = commits
    .map((commit, index) => ({
      commit,
      graph: graph.rows[index]!,
    }))
    .filter(({ commit }) =>
      `${commit.subject} ${commit.author} ${commit.hash} ${commit.refs}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
  const switchTab = (next: Tab) => {
    ++diffRequest.current;
    setTab(next);
    setDiff(null);
    setDiffLoading(false);
    setActivePath("");
    setActiveCommit(null);
  };
  return (
    <section
      className="git-manager"
      aria-label="实例 Git 管理"
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header className="git-header">
        <div className="git-heading">
          <GitBranch size={19} />
          <div>
            <strong>版本管理</strong>
            <span>
              {status?.initialized
                ? "管理实例文件的版本"
                : "为实例文件建立版本记录"}
            </span>
          </div>
        </div>
        <div className="git-header-actions">
          {status?.initialized && (
            <span className="git-branch">
              <GitBranch size={13} />
              {status.branch}
            </span>
          )}
          <button
            type="button"
            className="git-button git-icon-button"
            aria-label="刷新仓库"
            disabled={!!busy || historyLoading}
            onClick={() => void refresh()}
          >
            <RefreshCw
              size={16}
              className={busy === "refresh" ? "git-spin" : ""}
            />
          </button>
        </div>
      </header>
      {error && (
        <div className="git-error" role="alert">
          {error}
          <button
            type="button"
            onClick={() => setError("")}
            aria-label="关闭错误提示"
          >
            ×
          </button>
        </div>
      )}
      {notice && (
        <div className="git-success" role="status">
          <CheckCircle2 size={15} />
          {notice}
        </div>
      )}
      {!status ? (
        <div className="git-placeholder">
          {busy ? (
            <Loader2 size={22} className="git-spin" />
          ) : (
            <GitBranch size={22} />
          )}
          <span>
            {busy ? "正在读取仓库…" : "无法读取仓库，点击右上角刷新重试。"}
          </span>
        </div>
      ) : !status.available ? (
        <div className="git-empty">
          <GitBranch size={38} />
          <h3>节点尚未安装 Git</h3>
          <p>在实例所在节点安装 Git 后，即可在这里管理版本。</p>
          <button
            type="button"
            className="git-button"
            onClick={() => void refresh()}
            disabled={!!busy}
          >
            重新检测
          </button>
        </div>
      ) : !status.initialized ? (
        <div className="git-empty">
          <div className="git-empty-mark">
            <GitBranch size={34} />
          </div>
          <span className="git-eyebrow">实例工作目录</span>
          <h3>此实例尚未创建仓库</h3>
          <p>
            在实例工作目录创建仓库，选择要记录的文件，
            <br />
            随时查看提交历史与代码差异。
          </p>
          <button
            type="button"
            className="git-button git-primary"
            disabled={!!busy}
            onClick={() =>
              void run("init", async () => {
                const next = await api.initInstanceGit(token, instanceId);
                if (!alive.current) return;
                statusRef.current = next;
                setStatus(next);
                setIgnore(next.ignoreContent);
                onFilesChanged();
                setNotice(
                  "仓库已创建。先在排除规则中选择无需记录的文件，再进行首次提交。",
                );
              })
            }
          >
            {busy === "init" ? (
              <Loader2 size={16} className="git-spin" />
            ) : (
              <GitBranch size={16} />
            )}
            创建 Git 仓库
          </button>
          <small>初始分支 main · 文件保留在当前目录</small>
        </div>
      ) : (
        <>
          <nav className="git-tabs" aria-label="版本管理视图">
            {(
              [
                {
                  id: "changes",
                  label: "工作区",
                  icon: GitBranch,
                },
                {
                  id: "history",
                  label: "提交记录",
                  icon: History,
                },
                {
                  id: "ignore",
                  label: "排除规则",
                  icon: ShieldOff,
                },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                type="button"
                key={id}
                className={tab === id ? "active" : ""}
                aria-current={tab === id ? "page" : undefined}
                onClick={() => switchTab(id)}
              >
                <Icon size={15} />
                {label}
                {id === "changes" && (
                  <span className="git-count">{status.changes.length}</span>
                )}
              </button>
            ))}
          </nav>
          {tab === "changes" && (
            <div className="git-changes-layout">
              <div className="git-change-column">
                <div className="git-section-caption">
                  <label>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      disabled={!!busy || !status.changes.length}
                      onChange={() =>
                        setSelected(
                          allSelected
                            ? new Set()
                            : new Set(
                                status.changes.map((change) => change.path),
                              ),
                        )
                      }
                    />
                    待提交文件 <span>{status.changes.length}</span>
                  </label>
                  <button
                    type="button"
                    className="git-text-button"
                    disabled={!selected.size || !!busy}
                    onClick={() => {
                      setExcluded(
                        new Set(
                          [...selected].filter(
                            (entry) => entry !== ".gitignore",
                          ),
                        ),
                      );
                      switchTab("ignore");
                    }}
                  >
                    排除所选
                  </button>
                </div>
                <div className="git-change-list">
                  {!status.changes.length ? (
                    <div className="git-placeholder">
                      <CheckCircle2 size={26} />
                      <strong>工作区干净</strong>
                      <span>所有改动都已记录</span>
                    </div>
                  ) : (
                    status.changes.map((change) => (
                      <div
                        className={`git-change-row ${activePath === change.path ? "active" : ""}`}
                        key={change.path}
                      >
                        <input
                          aria-label={`提交 ${change.path}`}
                          type="checkbox"
                          checked={selected.has(change.path)}
                          disabled={!!busy}
                          onChange={() => toggle(setSelected, change.path)}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setActivePath(change.path);
                            void preview({
                              paths: [
                                change.path,
                                ...(change.originalPath
                                  ? [change.originalPath]
                                  : []),
                              ],
                            });
                          }}
                        >
                          <span className="git-file-path" title={change.path}>
                            {change.path}
                          </span>
                          <span
                            className={`git-status-tag ${changeLabel(change.index, change.worktree) === "新增" ? "added" : changeLabel(change.index, change.worktree) === "删除" ? "removed" : ""}`}
                          >
                            {changeLabel(change.index, change.worktree)}
                          </span>
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <form
                  className="git-commit-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run("commit", async () => {
                      const result = await api.commitInstanceGit(
                        token,
                        instanceId,
                        {
                          paths: commitPaths,
                          message: [title.trim(), body.trim()]
                            .filter(Boolean)
                            .join("\n\n"),
                          authorName: name,
                          authorEmail: email,
                          expectedHead: status.head,
                        },
                      );
                      if (!alive.current) return;
                      setTitle("");
                      setBody("");
                      setIssue("");
                      setSelected(new Set());
                      setDiff(null);
                      setActivePath("");
                      await refresh();
                      onFilesChanged();
                      setNotice(`已提交 ${result.hash.slice(0, 7)}`);
                    });
                  }}
                >
                  <div className="git-form-label">
                    <strong>提交说明</strong>
                    <button
                      type="button"
                      className="git-text-button"
                      disabled={!!busy || !selected.size}
                      title="使用已配置的 Saki 模型生成提交说明和 Issue 草稿"
                      onClick={() =>
                        void run("draft", async () => {
                          const draft = await api.draftInstanceGit(
                            token,
                            instanceId,
                            commitPaths,
                          );
                          if (!alive.current) return;
                          setTitle(draft.title);
                          setBody(draft.body);
                          setIssue(draft.issue);
                          setNotice("Saki 草稿已生成，可编辑后提交。");
                        })
                      }
                    >
                      {busy === "draft" && (
                        <Loader2 size={13} className="git-spin" />
                      )}
                      Saki 生成草稿
                    </button>
                  </div>
                  <input
                    aria-label="提交标题"
                    placeholder="一句话描述这次改动"
                    value={title}
                    maxLength={200}
                    disabled={!!busy}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                  <textarea
                    aria-label="提交正文"
                    placeholder="补充变更原因与细节（可选）"
                    value={body}
                    maxLength={12000}
                    disabled={!!busy}
                    rows={3}
                    onChange={(event) => setBody(event.target.value)}
                  />
                  <details className="git-author" open={!name || !email}>
                    <summary>
                      提交者
                      {!name || !email ? " · 首次提交请填写" : ` · ${name}`}
                    </summary>
                    <div>
                      <input
                        aria-label="提交者姓名"
                        placeholder="姓名"
                        value={name}
                        disabled={!!busy}
                        maxLength={100}
                        onChange={(event) => setName(event.target.value)}
                      />
                      <input
                        aria-label="提交者邮箱"
                        placeholder="邮箱"
                        type="email"
                        value={email}
                        disabled={!!busy}
                        maxLength={254}
                        onChange={(event) => setEmail(event.target.value)}
                      />
                    </div>
                  </details>
                  <button
                    type="submit"
                    className="git-button git-primary git-commit-button"
                    disabled={
                      !!busy ||
                      !selected.size ||
                      !title.trim() ||
                      !name.trim() ||
                      !email.trim()
                    }
                  >
                    {busy === "commit" ? (
                      <Loader2 size={16} className="git-spin" />
                    ) : (
                      <GitCommitHorizontal size={16} />
                    )}
                    提交{" "}
                    {selected.size ? `${selected.size} 个文件` : "所选文件"}
                  </button>
                </form>
              </div>
              <div className="git-detail-column">
                <div className="git-detail-title">
                  <FileText size={15} />
                  <span>{activePath || "变更预览"}</span>
                </div>
                <div className="git-diff-scroll">
                  {diffLoading ? (
                    <div className="git-placeholder">
                      <Loader2 size={22} className="git-spin" />
                      <span>读取差异…</span>
                    </div>
                  ) : (
                    <DiffView data={diff} />
                  )}
                </div>
                {issue && (
                  <details className="git-issue" open>
                    <summary>Issue 草稿</summary>
                    <p>根据所选变更生成，编辑后可复制到代码托管平台。</p>
                    <textarea
                      aria-label="Issue 草稿"
                      value={issue}
                      rows={7}
                      disabled={!!busy}
                      onChange={(event) => setIssue(event.target.value)}
                    />
                    <button
                      type="button"
                      className="git-button"
                      onClick={() =>
                        void run("copy", async () => {
                          await navigator.clipboard.writeText(issue);
                          setNotice("Issue 草稿已复制。");
                        })
                      }
                    >
                      <Copy size={14} />
                      复制草稿
                    </button>
                  </details>
                )}
              </div>
            </div>
          )}
          {tab === "history" && (
            <div className="git-history-layout">
              <div className="git-history-column">
                <label className="git-search">
                  <Search size={15} />
                  <input
                    placeholder="搜索已加载的提交、作者或分支"
                    aria-label="搜索提交"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                <div className="git-history-note">
                  所有本地与远程分支 · 按拓扑排序
                </div>
                <div className="git-timeline">
                  {visibleCommits.map(({ commit, graph: row }) => (
                    <button
                      type="button"
                      key={commit.hash}
                      className={`git-timeline-item ${activeCommit?.hash === commit.hash ? "active" : ""}`}
                      onClick={() => {
                        setActiveCommit(commit);
                        void preview({
                          hash: commit.hash,
                        });
                      }}
                    >
                      <CommitGraph
                        row={
                          search
                            ? {
                                lane: 0,
                                incoming: false,
                                edges: [],
                              }
                            : row
                        }
                        width={search ? 22 : graph.width}
                        merge={commit.parents.length > 1}
                      />
                      <span className="git-timeline-content">
                        <strong>{commit.subject}</strong>
                        {commit.refs && (
                          <span className="git-ref-label">{commit.refs}</span>
                        )}
                        <span className="git-commit-meta">
                          <code>{commit.hash.slice(0, 7)}</code>
                          <span>{commit.author}</span>
                          <time>{dateText(commit.date)}</time>
                        </span>
                      </span>
                    </button>
                  ))}
                  {!historyLoading && !visibleCommits.length && (
                    <div className="git-placeholder">
                      <History size={26} />
                      <span>
                        {commits.length
                          ? "没有匹配的提交"
                          : "首次提交后，记录会出现在这里"}
                      </span>
                    </div>
                  )}
                </div>
                {historyLoading && (
                  <div className="git-loading-line">
                    <Loader2 size={16} className="git-spin" />
                    读取提交记录…
                  </div>
                )}
                {hasMore && (
                  <button
                    type="button"
                    className="git-button git-load-more"
                    disabled={historyLoading || !!busy}
                    onClick={() => void loadHistory(true)}
                  >
                    加载更早的提交
                  </button>
                )}
              </div>
              <div className="git-detail-column">
                {activeCommit ? (
                  <div className="git-commit-detail">
                    <div className="git-section-caption">
                      <span>提交</span>
                      <code>{activeCommit.hash.slice(0, 12)}</code>
                    </div>
                    <h3>{activeCommit.subject}</h3>
                    <p>
                      {activeCommit.author} &lt;{activeCommit.email}&gt; ·{" "}
                      {dateText(activeCommit.date)}
                    </p>
                    {activeCommit.body && <pre>{activeCommit.body}</pre>}
                    {activeCommit.parents.length > 1 && (
                      <small>合并提交 · 差异相对于第一个父提交</small>
                    )}
                    <div className="git-parent-links">
                      {activeCommit.parents.map((parent) => (
                        <button
                          type="button"
                          className="git-text-button"
                          key={parent}
                          disabled={
                            !commits.some((commit) => commit.hash === parent)
                          }
                          title="查看父提交（需已加载）"
                          onClick={() => {
                            const commit = commits.find(
                              (item) => item.hash === parent,
                            );
                            if (commit) {
                              setActiveCommit(commit);
                              void preview({
                                hash: parent,
                              });
                            }
                          }}
                        >
                          父提交 {parent.slice(0, 7)}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="git-detail-title">
                    <History size={15} />
                    提交详情
                  </div>
                )}
                <div className="git-diff-scroll">
                  {diffLoading ? (
                    <div className="git-placeholder">
                      <Loader2 size={22} className="git-spin" />
                    </div>
                  ) : (
                    <DiffView data={diff} />
                  )}
                </div>
              </div>
            </div>
          )}
          {tab === "ignore" && (
            <div className="git-ignore-layout">
              <div className="git-ignore-picker">
                <div className="git-section-caption">
                  <strong>选择排除文件</strong>
                  <span>{excluded.size} 项</span>
                </div>
                <p className="git-helper">
                  选择文件夹会排除整个目录。已跟踪文件会取消跟踪，磁盘文件保留。
                </p>
                <div className="git-browse-path">
                  <button
                    type="button"
                    className="git-button git-icon-button"
                    aria-label="返回上一级目录"
                    disabled={!browsePath || browseLoading}
                    onClick={() =>
                      setBrowsePath(
                        browsePath.split("/").slice(0, -1).join("/"),
                      )
                    }
                  >
                    <ArrowLeft size={14} />
                  </button>
                  <span>/{browsePath}</span>
                </div>
                <div className="git-browse-list">
                  {browseLoading ? (
                    <div className="git-loading-line">
                      <Loader2 size={16} className="git-spin" />
                      读取文件…
                    </div>
                  ) : (
                    entries.map((entry) => (
                      <div className="git-browse-row" key={entry.path}>
                        <input
                          type="checkbox"
                          aria-label={`排除 ${entry.path}`}
                          checked={excluded.has(entry.path)}
                          disabled={!!busy}
                          onChange={() => toggle(setExcluded, entry.path)}
                        />
                        {entry.type === "directory" ? (
                          <Folder size={17} />
                        ) : (
                          <FileText size={16} />
                        )}
                        <button
                          type="button"
                          disabled={entry.type !== "directory"}
                          onClick={() => setBrowsePath(entry.path)}
                        >
                          <span>{entry.name}</span>
                          {entry.type === "directory" && (
                            <ChevronRight size={14} />
                          )}
                        </button>
                      </div>
                    ))
                  )}
                  {!browseLoading && !entries.length && (
                    <p className="git-helper">此目录没有可选文件</p>
                  )}
                </div>
                {excluded.size > 0 && (
                  <div className="git-excluded-list">
                    <span>本次排除</span>
                    {[...excluded].map((entry) => (
                      <button
                        type="button"
                        key={entry}
                        disabled={!!busy}
                        title="取消选择"
                        onClick={() => toggle(setExcluded, entry)}
                      >
                        <span>{entry}</span>×
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="git-ignore-editor">
                <div className="git-section-caption">
                  <strong>.gitignore</strong>
                  <span>
                    {ignore !== status.ignoreContent ? "未保存" : "已同步"}
                  </span>
                </div>
                <p className="git-helper">
                  可以直接编辑规则。左侧所选路径会在保存时追加；手写规则仅影响未跟踪文件。
                </p>
                <textarea
                  aria-label="Git 排除规则"
                  spellCheck={false}
                  placeholder={
                    "# 每行一条规则\nnode_modules/\nlogs/\n.env\n*.log"
                  }
                  value={ignore}
                  disabled={!!busy}
                  onChange={(event) => setIgnore(event.target.value)}
                />
                <div className="git-ignore-footer">
                  <span>取消跟踪与 .gitignore 改动需要提交后生效于历史。</span>
                  <button
                    type="button"
                    className="git-button git-primary"
                    disabled={
                      !!busy ||
                      (ignore === status.ignoreContent && !excluded.size)
                    }
                    onClick={() =>
                      void run("ignore", async () => {
                        const next = await api.saveInstanceGitIgnore(
                          token,
                          instanceId,
                          {
                            content: ignore,
                            expectedContent: status.ignoreContent,
                            paths: [...excluded],
                          },
                        );
                        if (!alive.current) return;
                        statusRef.current = next;
                        setStatus(next);
                        setIgnore(next.ignoreContent);
                        setExcluded(new Set());
                        setSelected(new Set());
                        setHistoryReady(false);
                        onFilesChanged();
                        setNotice(
                          "排除规则已保存，磁盘文件已保留。可在工作区提交规则及取消跟踪变更。",
                        );
                      })
                    }
                  >
                    {busy === "ignore" ? (
                      <Loader2 size={15} className="git-spin" />
                    ) : (
                      <Check size={15} />
                    )}
                    保存排除规则
                  </button>
                </div>
                {status.ignored.length > 0 && (
                  <details className="git-ignored">
                    <summary>当前已忽略 {status.ignored.length} 项</summary>
                    <div>
                      {status.ignored.map((entry) => (
                        <code key={entry}>{entry}</code>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

import { useEffect, useState } from "react";
import type { InstanceGitChangesSummary, SakiInputAttachment } from "@webops/shared";
import { isSakiImageAttachment } from "@webops/shared";
import { api } from "../../../api.js";
import type { LocalSakiMessage } from "../../../types/app.js";
import { fileExtension, filePreviewKindFromPath, imageMimeTypeFromPath } from "../../../utils/path.js";
import { MarkdownContent } from "../../common/MarkdownContent.js";
import { SakiChatImage, mergeSakiMessageAttachments } from "./SakiChatImages.js";
import { SakiChatVideo } from "./SakiChatVideo.js";
import { SakiCodeChangesDetails, filterGitChangesForSession, isSakiActionExecutedCodeChange } from "./SakiCodeChanges.js";
import type { SakiMessagesListProps } from "./SakiMessagesList.js";
import { shouldDeferLocalVoiceModel } from "./sakiCallVoice.js";

type Artifact =
  | { id: string; name: string; attachment: SakiInputAttachment }
  | { id: string; name: string; path: string; workspaceId: string };

type Review = { artifacts: Artifact[]; changes: InstanceGitChangesSummary | null };
type Copy = (cn: string, en: string) => string;

const documentExtensions = new Set(["txt", "csv", "tsv", "pdf", "docx", "xlsx", "xls", "pptx"]);

function isArtifactPath(path: string) {
  return Boolean(filePreviewKindFromPath(path) || documentExtensions.has(fileExtension(path)));
}

export function getSakiCallReview(
  message: LocalSakiMessage,
  summary: InstanceGitChangesSummary | null | undefined,
  workspaceId: string | undefined,
  workspaces: Array<{ id: string; name: string }> = []
): Review {
  const workspaceForAction = (action: NonNullable<LocalSakiMessage["actions"]>[number]) => {
    if (action.workspaceFile) return action.workspaceFile.instanceId;
    const lookup = action.args.instanceId || action.args.id || action.args.instance;
    if (typeof lookup !== "string" || !lookup.trim()) return workspaceId;
    const requested = lookup.trim();
    if (requested === workspaceId || workspaces.some(item => item.id === requested)) return requested;
    const exact = workspaces.filter(item => item.name === requested);
    const matches = exact.length ? exact : workspaces.filter(item => item.name.toLowerCase().includes(requested.toLowerCase()));
    return matches.length === 1 ? matches[0]?.id : requested;
  };
  const changes = filterGitChangesForSession(summary, [{
    actions: message.actions?.filter(action => workspaceForAction(action) === workspaceId),
    timeline: message.timeline?.filter(item => item.kind !== "action" || workspaceForAction(item.action) === workspaceId)
  }]);
  const artifacts: Artifact[] = mergeSakiMessageAttachments(message.attachments, undefined, message.actions)
    .filter(item => item.text !== undefined || item.dataUrl || item.generatedImageId || item.generatedVideoId)
    .map((item, index) => ({
      id: `attachment:${item.generatedVideoId ?? item.generatedImageId ?? item.id ?? index}`,
      name: item.name,
      attachment: item
    }));
  const paths = new Set<string>();
  const addPath = (value: unknown, targetId: string | undefined) => {
    if (typeof value !== "string" || !targetId) return;
    const path = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    const id = `workspace:${JSON.stringify([targetId, path])}`;
    if (!path || !isArtifactPath(path) || paths.has(id) || artifacts.some(item => "attachment" in item && item.name === path)) return;
    paths.add(id);
    artifacts.push({ id, name: path, path, workspaceId: targetId });
  };
  for (const action of message.actions ?? []) {
    if (!action.ok || action.status === "rolled_back" || !isSakiActionExecutedCodeChange(action)) continue;
    if (action.workspaceFile || /^(?:write_?file|generate_?image|upload_?base64)$/i.test(action.tool)) {
      addPath(action.workspaceFile?.path ?? action.args.path, workspaceForAction(action));
    }
  }
  for (const change of changes?.changes ?? []) {
    if (change.status === "added") addPath(change.path, workspaceId);
  }
  return { artifacts, changes: changes?.filesCount ? changes : null };
}

export function getSakiCallInterruption(message: LocalSakiMessage) {
  if (message.streaming) return null;
  if (message.retry) return { reason: message.retry.reason, resumable: true };
  for (let index = (message.timeline?.length ?? 0) - 1; index >= 0; index--) {
    const entry = message.timeline?.[index];
    if (entry?.kind === "text" && entry.source === "error" && entry.content.trim()) {
      return { reason: entry.content, resumable: false };
    }
  }
  return null;
}

function tableRows(text: string, extension: string) {
  const delimiter = extension === "tsv" ? "\t" : ",";
  const field = new RegExp(`(?:"((?:[^"]|"")*)"|([^${delimiter}\\r\\n]*))(${delimiter}|\\r\\n|\\r|\\n|$)`, "g");
  const rows: string[][] = [];
  let row: string[] = [];
  for (const match of text.matchAll(field)) {
    if (match.index === text.length && row.length === 0) break;
    if (row.length < 24) row.push(match[1]?.replaceAll('""', '"') ?? match[2] ?? "");
    if (match[3] === delimiter) continue;
    rows.push(row);
    if (rows.length === 60) break;
    row = [];
  }
  return rows;
}

function TextArtifact({ name, text }: { name: string; text: string }) {
  const kind = filePreviewKindFromPath(name);
  if (kind === "html") {
    const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'">`;
    return <iframe className="saki-call-artifact-page" title={name} sandbox="" srcDoc={policy + text} />;
  }
  if (kind === "markdown") return <MarkdownContent content={text.slice(0, 32_000)} />;
  const extension = fileExtension(name);
  if (extension === "csv" || extension === "tsv") {
    const rows = tableRows(text.slice(0, 40_000), extension);
    return <div className="saki-call-artifact-table">
      <table aria-label={name}><tbody>
        {rows.map((row, index) => <tr key={index}>
          {row.map((cell, column) => <td key={column}>{cell}</td>)}
        </tr>)}
      </tbody></table>
    </div>;
  }
  return <pre className="saki-call-artifact-text">{text.slice(0, 32_000)}</pre>;
}

function WorkspaceArtifact({ artifact, conversation, copy, onOpenArtifact }: {
  artifact: Extract<Artifact, { path: string }>;
  conversation: SakiMessagesListProps;
  copy: Copy;
  onOpenArtifact: ((path: string, workspaceId: string) => void) | undefined;
}) {
  const { path, workspaceId } = artifact;
  const { token } = conversation;
  const mime = imageMimeTypeFromPath(path);
  const textPreview = ["html", "markdown"].includes(filePreviewKindFromPath(path) ?? "") || /\.(?:txt|csv|tsv)$/i.test(path);
  const canPreview = Boolean(mime || textPreview);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  useEffect(() => {
    if (!canPreview) return;
    let active = true;
    const request = mime
      ? api.downloadInstanceFile(token, workspaceId, path, { base64: true }).then(file => `data:${mime};base64,${file.contentBase64}`)
      : api.readInstanceFile(token, workspaceId, path).then(file => file.content);
    void request.then(content => { if (active) setPreview(content); })
      .catch(() => { if (active) setPreviewError(true); });
    return () => { active = false; };
  }, [canPreview, mime, path, token, workspaceId]);

  async function download() {
    setDownloading(true);
    setDownloadError(false);
    try { await api.saveInstanceFileDownload(token, workspaceId, path); }
    catch { setDownloadError(true); }
    finally { setDownloading(false); }
  }

  return <>
    <div className="saki-call-artifact-actions">
      {canPreview && onOpenArtifact ? <button className="small-button" type="button" onClick={() => onOpenArtifact(path, workspaceId)}>
        {copy("在工作区打开", "Open in workspace")}
      </button> : null}
      <button className="small-button" type="button" disabled={downloading} onClick={() => void download()}>
        {copy("下载", "Download")}
      </button>
    </div>
    {downloadError ? <p role="alert">{copy("下载失败，请重试。", "Download failed. Try again.")}</p> : null}
    {previewError ? <p role="status">{copy("预览加载失败。", "Could not load the preview.")}</p>
      : !canPreview ? <p>{copy("下载后查看此文件。", "Download this file to view it.")}</p>
      : preview === null ? <p role="status">{copy("正在加载预览…", "Loading preview…")}</p>
      : mime ? <SakiChatImage attachment={{ kind: "image", name: path, dataUrl: preview }} token={token}
        onPreview={attachment => conversation.onPreviewAttachment({ attachment, editable: false })} compact />
      : <TextArtifact name={path} text={preview} />}
  </>;
}

function AttachedArtifact({ attachment, conversation, copy }: {
  attachment: SakiInputAttachment;
  conversation: SakiMessagesListProps;
  copy: Copy;
}) {
  if (attachment.generatedVideoId) return <SakiChatVideo attachment={attachment} token={conversation.token} compact autoLoad={!shouldDeferLocalVoiceModel()} />;
  if (isSakiImageAttachment(attachment)) return <SakiChatImage attachment={attachment} token={conversation.token}
    downloadLabel={copy("下载图片", "Download image")} compact
    onPreview={item => conversation.onPreviewAttachment({ attachment: item, editable: false })} />;
  return <AttachedDocument attachment={attachment} copy={copy} />;
}

function AttachedDocument({ attachment, copy }: { attachment: SakiInputAttachment; copy: Copy }) {
  const downloadUrl = attachment.dataUrl?.startsWith("data:") ? attachment.dataUrl : null;
  const [textUrl, setTextUrl] = useState("");
  useEffect(() => {
    if (downloadUrl || attachment.text === undefined) return;
    const url = URL.createObjectURL(new Blob([attachment.text], { type: "application/octet-stream" }));
    setTextUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [attachment.text, downloadUrl]);
  return <>
    {downloadUrl || textUrl ? <a download={attachment.name} href={downloadUrl || textUrl}>{copy("下载", "Download")}</a> : null}
    {attachment.text !== undefined ? <TextArtifact name={attachment.name} text={attachment.text} /> : null}
  </>;
}

export function SakiCallResults({ review, conversation, copy, onOpenArtifact }: {
  review: Review;
  conversation: SakiMessagesListProps;
  copy: Copy;
  onOpenArtifact: ((path: string, workspaceId: string) => void) | undefined;
}) {
  const [section, setSection] = useState<"artifacts" | "changes">(review.artifacts.length ? "artifacts" : "changes");
  const [selection, setSelection] = useState(review.artifacts[0]?.id ?? "");
  const artifact = review.artifacts.find(item => item.id === selection) ?? review.artifacts[0];
  const showChanges = review.changes && (section === "changes" || !artifact);
  return <div className="saki-call-results">
    {review.changes && artifact ? <div className="saki-call-artifact-actions">
      <button className="small-button" type="button" aria-pressed={!showChanges} onClick={() => setSection("artifacts")}>{copy("成果预览", "Outputs")}</button>
      <button className="small-button" type="button" aria-pressed={Boolean(showChanges)} onClick={() => setSection("changes")}>{copy("代码改动", "Changes")}</button>
    </div> : null}
    {showChanges ? <SakiCodeChangesDetails className="saki-call-code-review" summary={review.changes}
      onOpenPath={conversation.onOpenPath} /> : artifact ? <>
      {review.artifacts.length > 1 ? <select className="saki-call-artifact-select" aria-label={copy("选择成果", "Select output")}
        value={artifact.id} onChange={event => setSelection(event.target.value)}>
        {review.artifacts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select> : <p className="saki-call-artifact-name">{artifact.name}</p>}
      {"attachment" in artifact
        ? <AttachedArtifact key={artifact.id} attachment={artifact.attachment} conversation={conversation} copy={copy} />
        : <WorkspaceArtifact key={artifact.id} artifact={artifact} conversation={conversation} copy={copy} onOpenArtifact={onOpenArtifact} />}
    </> : null}
  </div>;
}

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Video } from "lucide-react";
import type { SakiInputAttachment } from "@webops/shared";
import { api } from "../../../api.js";

export function SakiChatVideo({ attachment, token, compact, autoLoad = false }: { attachment: SakiInputAttachment; token: string; compact: boolean; autoLoad?: boolean }) {
  const [src, setSrc] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const activeRequest = useRef<AbortController | null>(null);
  const objectUrl = useRef("");

  const load = useCallback(async () => {
    if (!attachment.generatedVideoId) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    setError("");
    try {
      const blob = await api.sakiGeneratedVideoBlob(token, attachment.generatedVideoId, controller.signal);
      if (controller.signal.aborted) return;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = URL.createObjectURL(blob);
      setSrc(objectUrl.current);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "视频加载失败");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [attachment.generatedVideoId, token]);

  useEffect(() => {
    setSrc("");
    setLoading(false);
    setError("");
    if (autoLoad) void load();
    return () => {
      activeRequest.current?.abort();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = "";
    };
  }, [autoLoad, load]);

  return (
    <figure className={`saki-chat-generated-image saki-chat-generated-video ${compact ? "is-compact" : ""}`}>
      {src ? <>
        <video src={src} controls playsInline preload="metadata" aria-label={attachment.name} />
        <a href={src} download={attachment.name}>下载视频</a>
      </> : <button type="button" className="secondary-button" disabled={loading} onClick={() => void load()}>
        {loading ? <Loader2 size={16} className="status-spinner" /> : <Video size={16} />}
        {loading ? "载入视频…" : error ? "重试加载视频" : "加载视频"}
      </button>}
      {error && <span role="alert">{error}</span>}
      <figcaption>{attachment.name}{attachment.size ? ` · ${(attachment.size / 1024 / 1024).toFixed(1)} MB` : ""}</figcaption>
    </figure>
  );
}

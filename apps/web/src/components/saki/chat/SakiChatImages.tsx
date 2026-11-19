import React, { useEffect, useMemo, useState } from "react";
import { ImageOff, Loader2 } from "lucide-react";
import { isSakiImageAttachment, type SakiAgentAction, type SakiInputAttachment } from "@webops/shared";
import { api } from "../../../api.js";
import { SakiChatVideo } from "./SakiChatVideo.js";

const generatedImageSrcCache = new Map<string, string>();
const generatedImageInflightCache = new Map<string, Promise<string>>();
type SakiMediaMessage = { attachments?: SakiInputAttachment[] | undefined; actions?: SakiAgentAction[] | undefined };

export function collectSakiMessageImages(message: SakiMediaMessage): SakiInputAttachment[] {
  const items: SakiInputAttachment[] = [];
  const seen = new Set<string>();
  const push = (attachment: SakiInputAttachment | undefined) => {
    if (!attachment || !isSakiImageAttachment(attachment)) return;
    const key = attachment.generatedImageId || attachment.id || attachment.dataUrl || attachment.name;
    if (!key || seen.has(key)) return;
    seen.add(key);
    items.push(attachment);
  };
  for (const attachment of message.attachments ?? []) push(attachment);
  for (const action of message.actions ?? []) {
    for (const attachment of action.attachments ?? []) push(attachment);
  }
  return items;
}

export function collectSakiActionImages(action: SakiAgentAction): SakiInputAttachment[] {
  return (action.attachments ?? []).filter(isSakiImageAttachment);
}

export function mergeSakiMessageAttachments(
  current: SakiInputAttachment[] | undefined,
  incoming?: SakiInputAttachment[],
  actions?: SakiAgentAction[]
): SakiInputAttachment[] {
  const items: SakiInputAttachment[] = [];
  const seen = new Set<string>();
  const push = (attachment: SakiInputAttachment | undefined) => {
    if (!attachment) return;
    const key = attachment.generatedImageId || attachment.id || attachment.dataUrl || attachment.name;
    if (!key || seen.has(key)) return;
    seen.add(key);
    items.push(attachment);
  };
  for (const attachment of current ?? []) push(attachment);
  for (const attachment of incoming ?? []) push(attachment);
  for (const action of actions ?? []) {
    for (const attachment of action.attachments ?? []) push(attachment);
  }
  return items;
}

function useSakiChatImageSource(attachment: SakiInputAttachment, token: string) {
  const imageId = attachment.generatedImageId || (attachment.id && !attachment.dataUrl ? attachment.id : "");
  const cacheKey = `${token}:${imageId}`;
  const [src, setSrc] = useState(
    attachment.dataUrl || (imageId && token ? generatedImageSrcCache.get(cacheKey) : "") || ""
  );
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(!src && Boolean(imageId && token));

  useEffect(() => {
    if (attachment.dataUrl) {
      setSrc(attachment.dataUrl);
      setFailed(false);
      setLoading(false);
      return;
    }
    if (!imageId || !token) {
      setSrc("");
      setLoading(false);
      setFailed(true);
      return;
    }
    const cached = generatedImageSrcCache.get(cacheKey);
    if (cached) {
      setSrc(cached);
      setFailed(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setFailed(false);
    setLoading(true);
    let request = generatedImageInflightCache.get(cacheKey);
    if (!request) {
      request = api
        .sakiGeneratedImageBlob(token, imageId)
        .then((blob) => {
          const objectUrl = URL.createObjectURL(blob);
          generatedImageSrcCache.set(cacheKey, objectUrl);
          return objectUrl;
        })
        .finally(() => {
          generatedImageInflightCache.delete(cacheKey);
        });
      generatedImageInflightCache.set(cacheKey, request);
    }
    void request
      .then((objectUrl) => {
        if (cancelled) return;
        setSrc(objectUrl);
        setFailed(false);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attachment.dataUrl, imageId, token, cacheKey]);

  const previewAttachment = useMemo(
    () => (src ? { ...attachment, dataUrl: src, kind: "image" as const } : attachment),
    [attachment, src]
  );

  return { src, failed, setFailed, loading, previewAttachment };
}

export function SakiChatImage({
  attachment,
  token,
  compact = false,
  hideCaption = false,
  downloadLabel,
  onPreview
}: {
  attachment: SakiInputAttachment;
  token: string;
  compact?: boolean;
  hideCaption?: boolean;
  downloadLabel?: string;
  onPreview?: (attachment: SakiInputAttachment) => void;
}) {
  const { src, failed, setFailed, loading, previewAttachment } = useSakiChatImageSource(attachment, token);

  if (loading) {
    return (
      <div className={`saki-chat-generated-image is-loading ${compact ? "is-compact" : ""}`}>
        <Loader2 size={18} className="status-spinner" />
        <span>载入图片...</span>
      </div>
    );
  }

  if (failed || !src) {
    return (
      <div className={`saki-chat-generated-image is-failed ${compact ? "is-compact" : ""}`}>
        <ImageOff size={16} />
        <span>{attachment.name || "图片加载失败"}</span>
      </div>
    );
  }

  return (<>
    <figure
      className={`saki-chat-generated-image ${compact ? "is-compact" : ""} ${onPreview ? "is-clickable" : ""}`}
      onClick={onPreview ? () => onPreview(previewAttachment) : undefined}
      onKeyDown={
        onPreview
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onPreview(previewAttachment);
              }
            }
          : undefined
      }
      role={onPreview ? "button" : undefined}
      tabIndex={onPreview ? 0 : undefined}
      title={onPreview ? "点击查看大图" : attachment.name}
    >
      <img src={src} alt={attachment.name || "generated"} draggable={false} onError={() => setFailed(true)} />
      {!hideCaption && attachment.name ? <figcaption>{attachment.name}</figcaption> : null}
    </figure>
    {downloadLabel ? <a href={src} download={attachment.name}>{downloadLabel}</a> : null}
  </>);
}

function SakiChatImageThumb({
  attachment,
  token,
  index,
  active,
  compact = false,
  onSelect,
  onKeyDown
}: {
  attachment: SakiInputAttachment;
  token: string;
  index: number;
  active: boolean;
  compact?: boolean;
  onSelect: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const { src, failed, setFailed, loading } = useSakiChatImageSource(attachment, token);

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`saki-chat-image-thumb ${active ? "is-active" : ""} ${compact ? "is-compact" : ""}`}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      title={attachment.name || `图片 ${index + 1}`}
      aria-label={attachment.name || `第 ${index + 1} 张图片`}
    >
      <span className="saki-chat-image-thumb-inner">
        {loading ? (
          <Loader2 size={14} className="status-spinner" />
        ) : failed || !src ? (
          <ImageOff size={14} />
        ) : (
          <img
            src={src}
            alt={attachment.name || `thumbnail-${index + 1}`}
            draggable={false}
            onError={() => setFailed(true)}
          />
        )}
      </span>
    </button>
  );
}

function SakiChatImageGallery({
  images,
  token,
  compact = false,
  onPreview
}: {
  images: SakiInputAttachment[];
  token: string;
  compact?: boolean;
  onPreview?: (attachment: SakiInputAttachment) => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const safeIndex = Math.min(selectedIndex, Math.max(0, images.length - 1));
  const activeAttachment = images[safeIndex] ?? images[0]!;

  return (
    <div className={`saki-chat-image-gallery ${compact ? "is-compact" : ""}`}>
      <div className="saki-chat-image-gallery-stage">
        <SakiChatImage
          key={activeAttachment.generatedImageId || activeAttachment.id || `${activeAttachment.name}-${safeIndex}`}
          attachment={activeAttachment}
          token={token}
          compact={compact}
          hideCaption
          {...(onPreview ? { onPreview } : {})}
        />
      </div>
      <div className="saki-chat-image-gallery-thumbs" role="tablist" aria-label="生成图片列表">
        {images.map((attachment, index) => (
          <SakiChatImageThumb
            key={attachment.generatedImageId || attachment.id || `${attachment.name}-${index}`}
            attachment={attachment}
            token={token}
            index={index}
            active={index === safeIndex}
            compact={compact}
            onSelect={() => setSelectedIndex(index)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowRight") {
                event.preventDefault();
                setSelectedIndex((safeIndex + 1) % images.length);
              } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
                event.preventDefault();
                setSelectedIndex((safeIndex - 1 + images.length) % images.length);
              } else if (event.key === "Home") {
                event.preventDefault();
                setSelectedIndex(0);
              } else if (event.key === "End") {
                event.preventDefault();
                setSelectedIndex(images.length - 1);
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function SakiChatGeneratedImages({
  message,
  token,
  compact = false,
  onPreview
}: {
  message: SakiMediaMessage;
  token: string;
  compact?: boolean;
  onPreview?: (attachment: SakiInputAttachment) => void;
}) {
  const images = collectSakiMessageImages(message);
  const videos = mergeSakiMessageAttachments(message.attachments, undefined, message.actions).filter((item) => item.generatedVideoId);
  if ((!images.length && !videos.length) || !token) return null;
  const singleImage = images.length === 1 ? images[0] : undefined;
  return (
    <div className={`saki-chat-generated-images ${compact ? "is-compact" : ""}`}>
      {singleImage ? (
        <SakiChatImage
          key={singleImage.generatedImageId || singleImage.id || `${singleImage.name}-0`}
          attachment={singleImage}
          token={token}
          compact={compact}
          {...(onPreview ? { onPreview } : {})}
        />
      ) : images.length > 1 ? (
        <SakiChatImageGallery
          images={images}
          token={token}
          compact={compact}
          {...(onPreview ? { onPreview } : {})}
        />
      ) : null}
      {videos.map((attachment) => <SakiChatVideo key={attachment.generatedVideoId} attachment={attachment} token={token} compact={compact} />)}
    </div>
  );
}

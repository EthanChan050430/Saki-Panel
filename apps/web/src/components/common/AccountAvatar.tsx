import React from "react";

export function accountInitials(displayName: string, username: string): string {
  const source = (displayName || username).trim();
  if (!source) return "U";
  const parts = source.split(/\s+/).filter(Boolean);
  const initials = parts.length > 1 ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}` : source.slice(0, 2);
  return initials.toUpperCase();
}

export function AccountAvatar({
  avatarDataUrl,
  displayName,
  username,
  className = ""
}: {
  avatarDataUrl?: string | null | undefined;
  displayName: string;
  username: string;
  className?: string;
}) {
  return (
    <span className={`account-avatar ${className}`}>
      {avatarDataUrl ? <img src={avatarDataUrl} alt="" /> : <span>{accountInitials(displayName, username)}</span>}
    </span>
  );
}

export async function avatarFileToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("请选择图片文件");
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("头像读取失败"));
      image.src = objectUrl;
    });

    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height) {
      throw new Error("头像读取失败");
    }

    const side = Math.min(width, height);
    const sourceX = Math.floor((width - side) / 2);
    const sourceY = Math.floor((height - side) / 2);
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("浏览器无法处理头像");
    }
    context.drawImage(image, sourceX, sourceY, side, side, 0, 0, size, size);
    return canvas.toDataURL("image/webp", 0.86);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function appearanceMediaFileToDataUrl(file: File, allowVideo = false): Promise<string> {
  const fileName = (file.name || "").toLowerCase();
  const isVideoExt = /\.(mp4|webm|ogg|mov|m4v)$/i.test(fileName);
  const isImageExt = /\.(png|jpe?g|webp|gif)$/i.test(fileName);
  const isVideo = file.type.startsWith("video/") || isVideoExt;
  const isImage = file.type.startsWith("image/") || isImageExt;

  if (!isImage && (!allowVideo || !isVideo)) {
    throw new Error(allowVideo ? "请选择图片或视频文件" : "请选择图片文件");
  }

  if (isVideo) {
    if (file.size > 50 * 1024 * 1024) {
      throw new Error("视频大小不能超过 50MB");
    }
  } else {
    if (file.size > 10 * 1024 * 1024) {
      throw new Error("图片大小不能超过 10MB");
    }
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(isVideo ? "视频读取失败" : "图片读取失败"));
    reader.onload = () => {
      let result = typeof reader.result === "string" ? reader.result : "";

      if (isVideo && /^data:(?:application\/octet-stream|video\/[a-z0-9-]+)?;base64,/i.test(result)) {
        if (!/^data:video\/(?:mp4|webm|ogg|quicktime);base64,/i.test(result)) {
          let mime = "video/mp4";
          if (fileName.endsWith(".webm")) mime = "video/webm";
          else if (fileName.endsWith(".ogg")) mime = "video/ogg";
          else if (fileName.endsWith(".mov")) mime = "video/quicktime";
          result = result.replace(/^data:[^;]*;base64,/, `data:${mime};base64,`);
        }
      }

      const validImage = /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(result);
      const validVideo = allowVideo && /^data:video\/(?:mp4|webm|ogg|quicktime);base64,/i.test(result);

      if (!validImage && !validVideo) {
        reject(new Error(allowVideo ? "仅支持 PNG、JPG、WebP、GIF 图片或 MP4、WebM、OGG 视频" : "仅支持 PNG、JPG、WebP 或 GIF 图片"));
        return;
      }
      resolve(result);
    };
    reader.readAsDataURL(file);
  });
}

export async function appearanceFileToDataUrl(file: File): Promise<string> {
  return appearanceMediaFileToDataUrl(file, false);
}

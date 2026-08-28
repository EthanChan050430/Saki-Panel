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

export async function appearanceFileToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("请选择图片文件");
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("图片不能超过 10MB");
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(result)) {
        reject(new Error("仅支持 PNG、JPG、WebP 或 GIF 图片"));
        return;
      }
      resolve(result);
    };
    reader.readAsDataURL(file);
  });
}

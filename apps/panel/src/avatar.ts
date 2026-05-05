const maxAvatarDataUrlLength = 1_000_000;

function avatarValidationError(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 400 });
}

export function normalizeAvatarDataUrl(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") {
    throw avatarValidationError("Avatar must be an image data URL");
  }

  const trimmed = value.trim();
  if (trimmed.length > maxAvatarDataUrlLength) {
    throw avatarValidationError("Avatar image is too large");
  }
  if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(trimmed)) {
    throw avatarValidationError("Avatar must be a PNG, JPG, WebP or GIF data URL");
  }
  return trimmed;
}

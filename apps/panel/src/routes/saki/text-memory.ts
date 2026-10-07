// A slice can retain the entire earlier streaming response through its backing
// string. Copy UTF-16 code units so split surrogate pairs survive unchanged.
export function copyText(text: string): string {
  return Buffer.from(text, "utf16le").toString("utf16le");
}

import { Image as ImageIcon } from "lucide-react";
import type { SakiInputAttachment } from "@webops/shared";
import { sakiAttachmentMentionToken } from "@webops/shared";

export function SakiMentionMenu({
  candidates,
  activeIndex,
  onHover,
  onSelect
}: {
  candidates: SakiInputAttachment[];
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (attachment: SakiInputAttachment) => void;
}) {
  return (
    <div className="saki-mention-menu" role="listbox" aria-label="引用参考图">
      <div className="saki-mention-title">引用参考图</div>
      {candidates.length === 0 ? (
        <div className="saki-mention-empty">没有匹配的参考图</div>
      ) : (
        candidates.map((attachment, index) => (
          <button
            key={attachment.id ?? `${attachment.name}-${index}`}
            className={`saki-mention-item ${index === activeIndex ? "active" : ""}`}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            onMouseEnter={() => onHover(index)}
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(attachment);
            }}
          >
            {attachment.dataUrl ? (
              <img src={attachment.dataUrl} alt="" draggable={false} />
            ) : (
              <span className="saki-mention-icon">
                <ImageIcon size={15} />
              </span>
            )}
            <span className="saki-mention-copy">
              <strong>{attachment.name}</strong>
              <em>{sakiAttachmentMentionToken(attachment)}</em>
            </span>
          </button>
        ))
      )}
    </div>
  );
}

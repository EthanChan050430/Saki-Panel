import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { api } from "../../../api.js";

export function SakiConversationExportButton({ token, conversationId, className = "icon-button mini", disabled = false, onError, onExported }: {
  token: string;
  conversationId: string;
  className?: string;
  disabled?: boolean;
  onError: (message: string) => void;
  onExported?: () => void;
}) {
  const [exporting, setExporting] = useState(false);
  return <button className={className} type="button" disabled={disabled || exporting}
    title="导出完整对话为 Markdown（含工具输入、返回及审批记录）" aria-label="导出完整对话为 Markdown"
    aria-busy={exporting} onClick={async event => {
      event.stopPropagation();
      if (exporting) return;
      setExporting(true);
      try {
        await api.sakiExportConversation(token, conversationId);
        onExported?.();
      } catch (error) {
        onError(error instanceof Error ? error.message : "导出失败，请重试。");
      } finally { setExporting(false); }
    }}>
    {exporting ? <Loader2 size={14} className="status-spinner" /> : <Download size={14} />}
  </button>;
}

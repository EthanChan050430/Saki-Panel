import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { api } from "../../../api.js";
import { translateDomText, usePanelLanguage } from "../../../i18n/index.js";

export function SakiConversationExportButton({ token, conversationId, className = "icon-button mini", disabled = false, onError, onExported, children, iconClassName }: {
  token: string;
  conversationId: string;
  className?: string;
  disabled?: boolean;
  onError: (message: string) => void;
  onExported?: () => void;
  children?: React.ReactNode;
  iconClassName?: string;
}) {
  const [exporting, setExporting] = useState(false);
  const { language } = usePanelLanguage();
  return <button className={className} type="button" disabled={disabled || exporting}
    title={translateDomText("导出完整对话为 Markdown（含工具输入、返回及审批记录）", language)} aria-label={translateDomText("导出完整对话为 Markdown", language)}
    aria-busy={exporting} onClick={async event => {
      event.stopPropagation();
      if (exporting) return;
      setExporting(true);
      try {
        await api.sakiExportConversation(token, conversationId);
        onExported?.();
      } catch (error) {
        onError(error instanceof Error ? error.message : translateDomText("导出失败，请重试。", language));
      } finally { setExporting(false); }
    }}>
    {exporting ? <Loader2 size={14} className={`status-spinner ${iconClassName ?? ""}`} /> : <Download size={14} className={iconClassName} style={{ flexShrink: 0 }} />}
    {children}
  </button>;
}

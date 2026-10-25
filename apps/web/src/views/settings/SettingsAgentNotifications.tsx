import { useEffect, useState } from "react";
import { Bell, CheckCheck, CircleHelp, Monitor, ShieldCheck, Sparkles, Volume2 } from "lucide-react";
import { useNotificationCenter } from "../../NotificationCenter.js";
import { desktopNotificationPermission, playAgentNotificationSound, requestDesktopNotificationPermission, useAgentNotificationPreferences } from "../../hooks/useAgentNotifications.js";
import type { AgentNotificationPreferences } from "../../utils/agent-notification-policy.js";

export function SettingsAgentNotifications({ userId }: { userId: string }) {
  const { preferences, update } = useAgentNotificationPreferences(userId);
  const { pushNotification } = useNotificationCenter();
  const [permission, setPermission] = useState(desktopNotificationPermission);
  useEffect(() => {
    const refresh = () => setPermission(desktopNotificationPermission());
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  const change = (key: keyof AgentNotificationPreferences, checked: boolean) => {
    update({ [key]: checked });
    if (checked && (key === "enabled" && preferences.desktop || key === "desktop")) {
      void requestDesktopNotificationPermission().then(setPermission);
    }
    if (checked && (key === "sound" || key === "enabled" && preferences.sound)) void playAgentNotificationSound();
  };
  const toggle = (key: keyof AgentNotificationPreferences, label: string, disabled = false) => (
    <label className="settings-switch-toggle">
      <input type="checkbox" role="switch" aria-label={label} checked={preferences[key]} disabled={disabled} onChange={event => change(key, event.target.checked)} />
      <span className="settings-switch-slider" />
    </label>
  );
  const kinds = [
    { key: "approval", title: "需要审批", detail: "操作等待你的批准时", icon: ShieldCheck },
    { key: "question", title: "需要回答", detail: "Agent 有问题想向你确认时", icon: CircleHelp },
    { key: "completed", title: "工作完成", detail: "任务顺利完成，可以查看结果时", icon: CheckCheck }
  ] as const;
  const channels = [
    { key: "desktop", title: "桌面通知", detail: "切换到其他窗口后也能收到提醒", icon: Monitor },
    { key: "sound", title: "轻柔提示音", detail: "提醒到来时，播放一声短音", icon: Volume2 }
  ] as const;
  const testNotification = () => {
    pushNotification("success", "提醒已准备好。重要进展，不再错过。", { title: "Agent 提醒", durationMs: 5000 });
    if (preferences.sound) void playAgentNotificationSound();
    if (preferences.desktop && permission === "granted") {
      try {
        const alert = new window.Notification("Agent 提醒", { body: "提醒已准备好。重要进展，不再错过。", icon: "/assets/saki-panel-icon.webp", silent: true });
        window.setTimeout(() => alert.close(), 5000);
      } catch { /* In-page preview remains available. */ }
    }
  };
  return <section className={`agent-reminder-settings ${preferences.enabled ? "is-enabled" : ""}`} aria-labelledby="agent-reminder-title">
    <div className="agent-reminder-heading">
      <span className="agent-reminder-emblem"><Bell size={20} strokeWidth={1.7} /></span>
      <div className="agent-reminder-intro"><h4 id="agent-reminder-title">Agent 提醒</h4><p>需要你时，轻轻提醒。</p></div>
      {toggle("enabled", "开启 Agent 提醒")}
    </div>
    <fieldset className="agent-reminder-options" disabled={!preferences.enabled}>
      <legend>提醒时机</legend>
      {kinds.map(({ key, title, detail, icon: Icon }) => <div className="agent-reminder-row" key={key}>
        <Icon size={18} strokeWidth={1.6} aria-hidden="true" />
        <div><strong>{title}</strong><span>{detail}</span></div>
        {toggle(key, title)}
      </div>)}
      <div className="agent-reminder-divider" />
      <p className="agent-reminder-eyebrow">提醒方式<span>页面内提示始终保留</span></p>
      {channels.map(({ key, title, detail, icon: Icon }) => <div className="agent-reminder-row" key={key}>
        <Icon size={18} strokeWidth={1.6} aria-hidden="true" />
        <div><strong>{title}</strong><span>{detail}</span></div>
        {toggle(key, title)}
      </div>)}
      {preferences.desktop && permission !== "granted" ? <div className="agent-reminder-permission" role="status">
        <span>{permission === "denied" ? "桌面通知已被浏览器阻止。可在网站权限中允许，页面内提醒仍然可用。" : permission === "unsupported" ? "当前浏览器或连接不支持桌面通知，将使用页面内提醒。" : "允许浏览器通知后，可在其他窗口收到提醒。"}</span>
        {permission === "default" ? <button type="button" onClick={() => void requestDesktopNotificationPermission().then(setPermission)}>允许通知</button> : null}
      </div> : null}
    </fieldset>
    <footer className="agent-reminder-footer">
      <span><Sparkles size={13} />仅此账号与浏览器 · 即时生效 · 保持面板打开时可接收</span>
      <button type="button" disabled={!preferences.enabled} onClick={testNotification}>试一下</button>
    </footer>
  </section>;
}

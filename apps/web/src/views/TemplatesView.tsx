import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Code2,
  Copy,
  Edit3,
  LayoutTemplate,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X
} from "lucide-react";
import type { InstanceTemplate, ManagedNode, RestartPolicy } from "@webops/shared";
import { api, ApiError } from "../api.js";
import { usePanelT } from "../i18n/index.js";
import { PageErrorToast } from "../components/common/CommonUI.js";
import { sakiArtAssets } from "../constants.js";

function restartPolicyLabel(policy: RestartPolicy): string {
  const labels: Record<RestartPolicy, string> = {
    never: "不自动重启",
    on_failure: "异常退出重启",
    always: "总是重启",
    fixed_interval: "固定间隔重启"
  };
  return labels[policy];
}

export function TemplatesView({ token, onLogout, refreshTick }: { token: string; onLogout: () => void; refreshTick: number }) {
  const [nodes, setNodes] = useState<ManagedNode[]>([]);
  const [templates, setTemplates] = useState<InstanceTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [suggestingStartCommand, setSuggestingStartCommand] = useState(false);
  const [form, setForm] = useState({
    nodeId: "",
    name: "",
    workingDirectory: "",
    startCommand: "",
    autoStart: false,
    restartPolicy: "never" as RestartPolicy,
    restartMaxRetries: 3
  });

  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? null;

  const refresh = useCallback(async () => {
    setError("");
    try {
      const [nextNodes, nextTemplates] = await Promise.all([api.nodes(token), api.templates(token)]);
      setNodes(nextNodes);
      setTemplates(nextTemplates);
      setSelectedTemplateId((current) => current || nextTemplates[0]?.id || "");
      setForm((current) => ({
        ...current,
        nodeId: current.nodeId || nextNodes[0]?.id || ""
      }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : "模板读取失败");
    }
  }, [onLogout, token]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshTick]);

  useEffect(() => {
    if (!selectedTemplate) return;
    setForm((current) => ({
      ...current,
      name: current.name || selectedTemplate.id,
      startCommand: selectedTemplate.defaultStartCommand
    }));
  }, [selectedTemplate]);

  async function suggestTemplateStartCommand() {
    const nodeId = form.nodeId.trim();
    const workingDirectory = form.workingDirectory.trim();
    if (!nodeId || !workingDirectory) return;

    setSuggestingStartCommand(true);
    setError("");
    try {
      const suggestion = await api.suggestInstanceStartCommand(token, {
        nodeId,
        workingDirectory
      });
      if (!suggestion.startCommand) {
        setError(`AI 未能识别启动命令：${suggestion.reason}`);
        return;
      }
      setForm((current) => ({ ...current, startCommand: suggestion.startCommand }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI 分析启动命令失败");
    } finally {
      setSuggestingStartCommand(false);
    }
  }

  async function createFromTemplate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTemplate) return;
    setCreating(true);
    setError("");
    try {
      const payload = {
        nodeId: form.nodeId,
        name: form.name,
        autoStart: form.autoStart,
        restartPolicy: form.restartPolicy,
        restartMaxRetries: form.restartMaxRetries
      };
      await api.createInstanceFromTemplate(token, selectedTemplate.id, {
        ...payload,
        ...(form.workingDirectory ? { workingDirectory: form.workingDirectory } : {}),
        ...(form.startCommand ? { startCommand: form.startCommand } : {})
      });
      setForm((current) => ({ ...current, name: "", workingDirectory: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "模板创建失败");
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <PageErrorToast error={error} onDismiss={() => setError("")} />
      <section className="template-layout">
        <div className="panel-block templates-panel">
          <div className="section-heading">
            <h2>实例模板</h2>
            <span>{templates.length} 个</span>
          </div>
          <div className="template-list">
            {templates.map((template) => (
              <button
                className={`template-item ${selectedTemplateId === template.id ? "active" : ""}`}
                key={template.id}
                onClick={() => {
                  setSelectedTemplateId(template.id);
                  setForm((current) => ({
                    ...current,
                    name: template.id,
                    startCommand: template.defaultStartCommand
                  }));
                }}
              >
                <strong>{template.name}</strong>
                <span>{template.description}</span>
                <code>{template.defaultStartCommand}</code>
              </button>
            ))}
          </div>
        </div>

        <div className="panel-block template-create-panel">
          <div className="section-heading">
            <h2>{selectedTemplate ? `创建 ${selectedTemplate.name}` : "创建实例"}</h2>
          </div>
          <form className="task-form" onSubmit={createFromTemplate}>
            <label>
              节点
              <select value={form.nodeId} onChange={(event) => setForm((current) => ({ ...current, nodeId: event.target.value }))} required>
                <option value="" disabled>
                  选择节点
                </option>
                {nodes.map((node) => (
                  <option value={node.id} key={node.id}>
                    {node.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              名称
              <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required />
            </label>
            <label className="wide-field">
              工作目录
              <input
                value={form.workingDirectory}
                onChange={(event) => setForm((current) => ({ ...current, workingDirectory: event.target.value }))}
                placeholder="留空按模板生成"
              />
            </label>
            <label className="wide-field">
              启动命令
              <div className="start-command-control">
                <input
                  value={form.startCommand}
                  onChange={(event) => setForm((current) => ({ ...current, startCommand: event.target.value }))}
                  placeholder="填写工作目录后可用 AI 分析"
                />
                <button
                  className="icon-button mini ai-suggest-button"
                  type="button"
                  title={form.workingDirectory.trim() ? "AI 分析并填写启动命令" : "请先填写工作目录"}
                  disabled={!form.workingDirectory.trim() || !form.nodeId || suggestingStartCommand}
                  onClick={() => void suggestTemplateStartCommand()}
                >
                  {suggestingStartCommand ? <Loader2 size={14} className="status-spinner" /> : <Sparkles size={14} />}
                </button>
              </div>
            </label>
            <label className="checkbox-field">
              <input type="checkbox" checked={form.autoStart} onChange={(event) => setForm((current) => ({ ...current, autoStart: event.target.checked }))} />
              自启动
            </label>
            <label>
              重启策略
              <select value={form.restartPolicy} onChange={(event) => setForm((current) => ({ ...current, restartPolicy: event.target.value as RestartPolicy }))}>
                <option value="never">不自动重启</option>
                <option value="on_failure">异常退出重启</option>
                <option value="always">总是重启</option>
              </select>
            </label>
            <label>
              最大重试
              <input type="number" min={0} max={99} value={form.restartMaxRetries} onChange={(event) => setForm((current) => ({ ...current, restartMaxRetries: Number(event.target.value) || 0 }))} />
            </label>
            <button className="primary-button form-submit" type="submit" disabled={creating || !selectedTemplate || nodes.length === 0 || !form.startCommand.trim()}>
              <LayoutTemplate size={18} />
              {creating ? "创建中" : "用模板创建"}
            </button>
          </form>
        </div>
      </section>
    </>
  );
}


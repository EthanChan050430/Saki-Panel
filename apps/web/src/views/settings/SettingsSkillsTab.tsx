import React, { memo, useRef, useState } from "react";
import {
  BookOpen,
  ChevronLeft,
  Download,
  DownloadCloud,
  FileUp,
  Layers,
  Loader2,
  Plus,
  Power,
  PowerOff,
  Search,
  Save,
  Sparkles,
  Trash2,
  X
} from "lucide-react";
import type {
  CreateSakiSkillRequest,
  SakiSkillDetail,
  SakiSkillSummary,
  UpdateSakiSkillRequest
} from "@webops/shared";
import { api, ApiError } from "../../api.js";
import {
  emptySakiSkillDraft,
  parseSakiSkillTags,
  sakiSkillDraftFromDetail,
  type SakiSkillDraft
} from "./settingsHelpers.js";

export interface SettingsSkillsTabProps {
  token: string;
  onLogout: () => void;
  skillList: SakiSkillSummary[];
  onSkillListChange: (skills: SakiSkillSummary[]) => void;
  onError: (error: string) => void;
  onNotice: (notice: string) => void;
}

export const SettingsSkillsTab = memo(function SettingsSkillsTab({
  token,
  onLogout,
  skillList,
  onSkillListChange,
  onError,
  onNotice
}: SettingsSkillsTabProps) {
  const [skillCreatorOpen, setSkillCreatorOpen] = useState(false);
  const [skillDraft, setSkillDraft] = useState<SakiSkillDraft>(emptySakiSkillDraft);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<SakiSkillDetail | null>(null);
  const [skillEditDraft, setSkillEditDraft] = useState<SakiSkillDraft>(emptySakiSkillDraft);
  const [skillDownloadUrl, setSkillDownloadUrl] = useState("");
  const [skillSearchQuery, setSkillSearchQuery] = useState("");
  const [skillFilter, setSkillFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [skillBusy, setSkillBusy] = useState<string | null>(null);
  const [skillDetailLoading, setSkillDetailLoading] = useState(false);
  const skillDetailRequestRef = useRef(0);
  const skillImportInputRef = useRef<HTMLInputElement>(null);

  async function refreshSkillList() {
    try {
      const nextSkills = await api.sakiAllSkills(token);
      onSkillListChange(nextSkills);
      if (selectedSkillId && !nextSkills.some((skill) => skill.id === selectedSkillId)) {
        setSelectedSkillId(null);
        setSelectedSkill(null);
        setSkillEditDraft(emptySakiSkillDraft);
      }
      return nextSkills;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
      }
      return skillList;
    }
  }

  async function createSkill(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = skillDraft.name.trim();
    let content = skillDraft.content.trim();
    if (!name) {
      onError("请输入 Skill 名称。");
      onNotice("");
      return;
    }
    if (!content) {
      content = `# ${name}\n\n${skillDraft.description.trim() || "Custom Saki Skill instructions"}`;
    }
    const payload: CreateSakiSkillRequest = {
      name,
      description: skillDraft.description.trim(),
      content,
      tags: parseSakiSkillTags(skillDraft.tags),
      enabled: skillDraft.enabled
    };
    setSkillBusy("create");
    onError("");
    onNotice("");
    try {
      const skill = await api.createSakiSkill(token, payload);
      skillDetailRequestRef.current += 1;
      setSkillDraft(emptySakiSkillDraft);
      setSkillCreatorOpen(false);
      setSkillDetailLoading(false);
      setSelectedSkillId(skill.id);
      setSelectedSkill(skill);
      setSkillEditDraft(sakiSkillDraftFromDetail(skill));
      await refreshSkillList();
      onNotice(`Skill ${skill.name} saved.`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      onError(err instanceof Error ? err.message : "Skill save failed");
    } finally {
      setSkillBusy(null);
    }
  }

  async function downloadSkill(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = skillDownloadUrl.trim();
    if (!url) {
      onError("OpenClaw Skill URL is required.");
      onNotice("");
      return;
    }
    setSkillBusy("download");
    onError("");
    onNotice("");
    try {
      const skill = await api.downloadSakiSkill(token, { url, enabled: true });
      skillDetailRequestRef.current += 1;
      setSkillDownloadUrl("");
      setSkillCreatorOpen(false);
      setSkillDetailLoading(false);
      setSelectedSkillId(skill.id);
      setSelectedSkill(skill);
      setSkillEditDraft(sakiSkillDraftFromDetail(skill));
      await refreshSkillList();
      onNotice(`Downloaded ${skill.name}.`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      onError(err instanceof Error ? err.message : "Skill download failed");
    } finally {
      setSkillBusy(null);
    }
  }

  function extractSkillNameFromFile(fileName: string): string {
    const withoutExt = fileName.replace(/\.(md|markdown|txt)$/i, "");
    const cleaned = withoutExt.replace(/[_\s-]+/g, "-").trim();
    return cleaned || "imported-skill";
  }

  function extractSkillDescription(content: string): string {
    const lines = content.split(/\r?\n/);
    let description = "";
    let inBody = false;
    for (const line of lines) {
      if (!inBody) {
        if (/^---\s*$/.test(line)) {
          inBody = true;
          continue;
        }
        const m = line.match(/^description\s*:\s*(.+)$/i);
        if (m && m[1]) {
          description = m[1].trim().replace(/^["']|["']$/g, "");
        }
      } else {
        if (/^#\s+/.test(line)) continue;
        const trimmed = line.trim();
        if (trimmed && trimmed.length >= 8) {
          description = trimmed.slice(0, 160);
          break;
        }
      }
    }
    return description;
  }

  async function importSkillsFromFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setSkillBusy("import");
    onError("");
    onNotice("");
    const results: string[] = [];
    const errors: string[] = [];
    try {
      for (const file of Array.from(fileList)) {
        const name = file.name.toLowerCase();
        if (!/\.(md|markdown|txt)$/.test(name)) {
          errors.push(`${file.name}: 仅支持 .md / .txt 文件`);
          continue;
        }
        const content = await file.text();
        const trimmed = content.trim();
        if (!trimmed) {
          errors.push(`${file.name}: 文件为空`);
          continue;
        }
        const skillName = extractSkillNameFromFile(file.name);
        const description = extractSkillDescription(trimmed);
        const payload: CreateSakiSkillRequest = {
          name: skillName,
          description,
          content: trimmed,
          enabled: true,
          tags: ["imported"]
        };
        try {
          const created = await api.createSakiSkill(token, payload);
          results.push(created.name);
        } catch (err) {
          errors.push(`${file.name}: ${err instanceof Error ? err.message : "保存失败"}`);
        }
      }
      skillDetailRequestRef.current += 1;
      const updatedList = await refreshSkillList();
      if (results.length > 0) {
        onNotice(`已导入 ${results.length} 个 Skill：${results.slice(0, 3).join(", ")}${results.length > 3 ? ` 等` : ""}`);
        const last = results[results.length - 1];
        const match = updatedList.find((s) => s.name === last);
        if (match) {
          setSkillDetailLoading(false);
          setSelectedSkillId(match.id);
          const detail = await api.sakiSkill(token, match.id);
          setSelectedSkill(detail);
          setSkillEditDraft(sakiSkillDraftFromDetail(detail));
        }
      }
      if (errors.length > 0) {
        onError(errors.join("；"));
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "导入失败");
    } finally {
      setSkillBusy(null);
      if (skillImportInputRef.current) {
        skillImportInputRef.current.value = "";
      }
    }
  }

  async function selectSkill(skill: SakiSkillSummary) {
    const requestId = skillDetailRequestRef.current + 1;
    skillDetailRequestRef.current = requestId;
    setSkillCreatorOpen(false);
    setSelectedSkillId(skill.id);
    setSelectedSkill(null);
    setSkillEditDraft(emptySakiSkillDraft);
    setSkillDetailLoading(true);
    onError("");
    onNotice("");
    try {
      const detail = await api.sakiSkill(token, skill.id);
      if (skillDetailRequestRef.current !== requestId) return;
      setSelectedSkill(detail);
      setSkillEditDraft(sakiSkillDraftFromDetail(detail));
    } catch (err) {
      if (skillDetailRequestRef.current !== requestId) return;
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      onError(err instanceof Error ? err.message : "Skill load failed");
    } finally {
      if (skillDetailRequestRef.current === requestId) {
        setSkillDetailLoading(false);
      }
    }
  }

  async function saveSelectedSkill(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSkill) return;
    const name = skillEditDraft.name.trim();
    const content = skillEditDraft.content.trim();
    if (!name || !content) {
      onError("Skill name and content are required.");
      onNotice("");
      return;
    }
    const payload: UpdateSakiSkillRequest = {
      name,
      description: skillEditDraft.description.trim(),
      content,
      tags: parseSakiSkillTags(skillEditDraft.tags),
      enabled: skillEditDraft.enabled
    };
    setSkillBusy(selectedSkill.id);
    onError("");
    onNotice("");
    try {
      const skill = await api.updateSakiSkill(token, selectedSkill.id, payload);
      skillDetailRequestRef.current += 1;
      setSkillDetailLoading(false);
      setSelectedSkillId(skill.id);
      setSelectedSkill(skill);
      setSkillEditDraft(sakiSkillDraftFromDetail(skill));
      await refreshSkillList();
      onNotice(`Skill ${skill.name} updated.`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      onError(err instanceof Error ? err.message : "Skill update failed");
    } finally {
      setSkillBusy(null);
    }
  }

  async function toggleSkillEnabled(skill: SakiSkillSummary) {
    const patch: UpdateSakiSkillRequest = { enabled: skill.enabled === false };
    setSkillBusy(skill.id);
    onError("");
    onNotice("");
    try {
      const updatedSkill = await api.updateSakiSkill(token, skill.id, patch);
      if (selectedSkill?.id === skill.id) {
        setSelectedSkill(updatedSkill);
        setSkillEditDraft(sakiSkillDraftFromDetail(updatedSkill));
      }
      await refreshSkillList();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      onError(err instanceof Error ? err.message : "Skill update failed");
    } finally {
      setSkillBusy(null);
    }
  }

  async function deleteSkill(skill: SakiSkillSummary) {
    if (skill.builtin) {
      await toggleSkillEnabled(skill);
      return;
    }
    if (!window.confirm(`Delete Skill "${skill.name}"?`)) return;
    setSkillBusy(skill.id);
    onError("");
    onNotice("");
    try {
      await api.deleteSakiSkill(token, skill.id);
      if (selectedSkill?.id === skill.id) {
        skillDetailRequestRef.current += 1;
        setSkillDetailLoading(false);
        setSelectedSkillId(null);
        setSelectedSkill(null);
        setSkillEditDraft(emptySakiSkillDraft);
      }
      await refreshSkillList();
      onNotice(`Deleted ${skill.name}.`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      onError(err instanceof Error ? err.message : "Skill delete failed");
    } finally {
      setSkillBusy(null);
    }
  }

  return (
    <div className="settings-skills-page saki-skill-settings-panel">
      <div className="section-heading saki-skill-heading">
        <div className="saki-skill-title">
          <div>
            <h2>Saki Skills</h2>
            <span>{skillList.length} installed</span>
          </div>
        </div>
        <div className="saki-skill-header-actions">
          <button
            className="ghost-button saki-skill-header-import"
            type="button"
            disabled={skillBusy === "import"}
            onClick={() => skillImportInputRef.current?.click()}
            title="从 .md / .txt 文件导入 Skill"
          >
            <FileUp size={16} />
            <span>{skillBusy === "import" ? "导入中" : "导入文件"}</span>
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={() => setSkillCreatorOpen((current) => !current)}
          >
            {skillCreatorOpen ? <X size={17} /> : <Plus size={17} />}
            {skillCreatorOpen ? "收起添加" : "添加 Skill"}
          </button>
        </div>
      </div>

      {skillCreatorOpen ? (
        <div className="saki-skill-creator-section">
          <form className="saki-skill-editor saki-skill-editor-panel" onSubmit={(event) => void createSkill(event)}>
            <div className="saki-skill-editor-heading">
              <div>
                <strong>添加 Skill</strong>
                <span>Local SKILL.md</span>
              </div>
              <button type="button" className="icon-button" onClick={() => setSkillCreatorOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="saki-skill-form-grid">
              <label className="saki-skill-form-field">
                <span className="saki-skill-form-label">Skill name</span>
                <input
                  value={skillDraft.name}
                  onChange={(event) => setSkillDraft((current) => ({ ...current, name: event.target.value }))}
                  placeholder="my-framework-helper"
                />
              </label>
              <label className="saki-skill-form-field">
                <span className="saki-skill-form-label">Tags</span>
                <input
                  value={skillDraft.tags}
                  onChange={(event) => setSkillDraft((current) => ({ ...current, tags: event.target.value }))}
                  placeholder="python, plugin, review"
                />
              </label>
              <label className="saki-skill-form-field saki-skill-form-wide">
                <span className="saki-skill-form-label">Description</span>
                <input
                  value={skillDraft.description}
                  onChange={(event) => setSkillDraft((current) => ({ ...current, description: event.target.value }))}
                  placeholder="When this Skill should be used"
                />
              </label>
              <label className="saki-skill-form-field saki-skill-form-wide">
                <span className="saki-skill-form-label">SKILL.md</span>
                <textarea
                  value={skillDraft.content}
                  onChange={(event) => setSkillDraft((current) => ({ ...current, content: event.target.value }))}
                  rows={8}
                  placeholder="# Skill instructions"
                />
              </label>
              <label className={`saki-skill-form-field saki-skill-form-checkbox saki-skill-detail-checkbox ${skillDraft.enabled ? "is-enabled" : ""}`}>
                <div className="saki-skill-checkbox-meta">
                  <div className="saki-skill-checkbox-title-row">
                    <Sparkles size={15} className="saki-skill-checkbox-icon" />
                    <strong className="saki-skill-checkbox-title">启用此 Skill</strong>
                    <span className={`saki-skill-status-tag ${skillDraft.enabled ? "enabled" : "disabled"}`}>
                      {skillDraft.enabled ? "创建后立即生效" : "默认处于禁用状态"}
                    </span>
                  </div>
                  <span className="saki-skill-checkbox-desc">
                    {skillDraft.enabled
                      ? "创建成功后即刻加入 Saki 可用技能池，并在任务与对话中按需调度"
                      : "暂不载入执行环境，后续可在右侧详情面板随时手动开启"}
                  </span>
                </div>
                <div className="saki-skill-custom-switch">
                  <input
                    type="checkbox"
                    checked={skillDraft.enabled}
                    onChange={(event) => setSkillDraft((current) => ({ ...current, enabled: event.target.checked }))}
                  />
                  <span className="saki-skill-switch-slider" />
                </div>
              </label>
            </div>
            <div className="saki-skill-form-actions">
              <button className="primary-button" disabled={skillBusy === "create"} type="submit">
                <Plus size={17} />
                {skillBusy === "create" ? "Saving" : "Add Skill"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <div className={`saki-skill-workspace ${selectedSkillId ? "has-selected-skill" : "no-selected-skill"}`}>
        <div className="saki-skill-sidebar">
          <div className="saki-skill-sidebar-header">
            <div className="saki-skill-search">
              <Search size={15} />
              <input
                type="text"
                value={skillSearchQuery}
                onChange={(event) => setSkillSearchQuery(event.target.value)}
                placeholder="Search skills..."
              />
            </div>
            <div className="saki-skill-filter">
              {[
                { value: "all", label: "All" },
                { value: "enabled", label: "Enabled" },
                { value: "disabled", label: "Disabled" }
              ].map((option) => (
                <button
                  key={option.value}
                  className={skillFilter === option.value ? "active" : ""}
                  type="button"
                  onClick={() => setSkillFilter(option.value as typeof skillFilter)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <form className="saki-skill-download" onSubmit={(event) => void downloadSkill(event)}>
            <div className="saki-skill-download-header">
              <DownloadCloud size={15} />
              <span>Install from URL</span>
            </div>
            <input
              value={skillDownloadUrl}
              onChange={(event) => setSkillDownloadUrl(event.target.value)}
              placeholder="https://github.com/org/repo/SKILL.md"
            />
            <button className="ghost-button" disabled={skillBusy === "download"} type="submit">
              <Download size={15} />
              {skillBusy === "download" ? "Downloading" : "Install"}
            </button>
          </form>

          <div className="saki-skill-import">
            <div className="saki-skill-import-header">
              <FileUp size={15} />
              <span>Import from file</span>
            </div>
            <input
              ref={skillImportInputRef}
              className="hidden-file-input"
              type="file"
              multiple
              accept=".md,.markdown,.txt,text/markdown,text/plain"
              onChange={(event) => void importSkillsFromFiles(event.target.files)}
            />
            <button
              className="saki-skill-import-drop"
              type="button"
              disabled={skillBusy === "import"}
              onClick={() => skillImportInputRef.current?.click()}
            >
              <BookOpen size={18} />
              <span>
                <strong>{skillBusy === "import" ? "Importing..." : "选择 .md / .txt 文件"}</strong>
                <em>支持批量导入，从文件名和内容自动提取信息</em>
              </span>
            </button>
          </div>

          <div className="saki-skill-list">
            {skillList
              .filter((skill) => {
                const matchesSearch =
                  skill.name.toLowerCase().includes(skillSearchQuery.toLowerCase()) ||
                  skill.description?.toLowerCase().includes(skillSearchQuery.toLowerCase()) ||
                  skill.tags?.some((tag) => tag.toLowerCase().includes(skillSearchQuery.toLowerCase()));
                const matchesFilter =
                  skillFilter === "all" ||
                  (skillFilter === "enabled" && skill.enabled) ||
                  (skillFilter === "disabled" && skill.enabled === false);
                return matchesSearch && matchesFilter;
              })
              .map((skill) => {
                const skillCardClassName = [
                  "saki-skill-card",
                  skill.enabled === false ? "disabled" : "",
                  selectedSkillId === skill.id ? "active" : ""
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <article className={skillCardClassName} key={skill.id}>
                    <button className="saki-skill-card-main" type="button" onClick={() => void selectSkill(skill)}>
                      <div className="saki-skill-card-status">
                        <span className={skill.enabled ? "status-active" : "status-inactive"} />
                      </div>
                      <div className="saki-skill-card-content">
                        <div className="saki-skill-card-header">
                          <strong>{skill.name}</strong>
                          {skill.builtin && <span className="saki-skill-builtin">Built-in</span>}
                        </div>
                        {skill.description ? <p>{skill.description}</p> : null}
                        {skill.tags?.length ? (
                          <div className="saki-skill-card-tags">
                            {skill.tags.slice(0, 4).map((tag) => (
                              <span key={`${skill.id}-${tag}`}>{tag}</span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className="saki-skill-card-source">
                        <span>{skill.sourceType ?? "local"}</span>
                      </div>
                    </button>
                    <div className="saki-skill-card-actions">
                      <button
                        className={`icon-button ${skill.enabled ? "action-disable" : "action-enable"}`}
                        disabled={skillBusy === skill.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleSkillEnabled(skill);
                        }}
                        title={skill.enabled ? "Disable" : "Enable"}
                      >
                        {skill.enabled ? <PowerOff size={14} /> : <Power size={14} />}
                      </button>
                      {skill.builtin ? null : (
                        <button
                          className="icon-button action-delete"
                          disabled={skillBusy === skill.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void deleteSkill(skill);
                          }}
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
          </div>
        </div>

        <div className="saki-skill-detail">
          {skillDetailLoading ? (
            <div className="saki-skill-loading">
              <Loader2 size={28} className="spin" />
              <span>Loading Skill...</span>
            </div>
          ) : selectedSkill ? (
            <form className="saki-skill-detail-panel" onSubmit={(event) => void saveSelectedSkill(event)}>
              <button
                type="button"
                className="saki-skill-mobile-back-btn"
                onClick={() => {
                  setSelectedSkillId(null);
                  setSelectedSkill(null);
                }}
              >
                <ChevronLeft size={16} />
                <span>返回技能列表</span>
              </button>
              <div className="saki-skill-detail-header">
                <div className="saki-skill-detail-title">
                  <h3>{selectedSkill.name}</h3>
                  <span className="saki-skill-detail-id">{selectedSkill.id}</span>
                </div>
                <div className="saki-skill-detail-meta">
                  <span className="saki-skill-detail-source">{selectedSkill.sourceType ?? "local"}</span>
                  {selectedSkill.builtin && <span className="saki-skill-detail-builtin">Built-in</span>}
                </div>
              </div>

              <div className="saki-skill-detail-body">
                <div className="saki-skill-detail-row">
                  <label className="saki-skill-detail-field">
                    <span className="saki-skill-detail-label">Skill name</span>
                    <input
                      value={skillEditDraft.name}
                      onChange={(event) => setSkillEditDraft((current) => ({ ...current, name: event.target.value }))}
                      placeholder="my-framework-helper"
                    />
                  </label>
                  <label className="saki-skill-detail-field">
                    <span className="saki-skill-detail-label">Tags</span>
                    <input
                      value={skillEditDraft.tags}
                      onChange={(event) => setSkillEditDraft((current) => ({ ...current, tags: event.target.value }))}
                      placeholder="python, plugin, review"
                    />
                  </label>
                </div>

                <label className="saki-skill-detail-field saki-skill-detail-wide">
                  <span className="saki-skill-detail-label">Description</span>
                  <input
                    value={skillEditDraft.description}
                    onChange={(event) => setSkillEditDraft((current) => ({ ...current, description: event.target.value }))}
                    placeholder="When this Skill should be used"
                  />
                </label>

                <label className="saki-skill-detail-field saki-skill-detail-wide saki-skill-detail-textarea">
                  <span className="saki-skill-detail-label">SKILL.md</span>
                  <textarea
                    value={skillEditDraft.content}
                    onChange={(event) => setSkillEditDraft((current) => ({ ...current, content: event.target.value }))}
                    rows={12}
                    placeholder="# Skill instructions"
                  />
                </label>

                <label className={`saki-skill-detail-field saki-skill-detail-checkbox ${skillEditDraft.enabled ? "is-enabled" : ""}`}>
                  <div className="saki-skill-checkbox-meta">
                    <div className="saki-skill-checkbox-title-row">
                      <Sparkles size={15} className="saki-skill-checkbox-icon" />
                      <strong className="saki-skill-checkbox-title">启用此 Skill</strong>
                      <span className={`saki-skill-status-tag ${skillEditDraft.enabled ? "enabled" : "disabled"}`}>
                        {skillEditDraft.enabled ? "活跃生效中" : "已禁用"}
                      </span>
                    </div>
                    <span className="saki-skill-checkbox-desc">
                      {skillEditDraft.enabled
                        ? "Saki 将在对话、代码分析与自动化任务执行中自动识别并调用此 Skill"
                        : "已暂停生效，Saki 不会加载或运行此 Skill 的指示与扩展能力"}
                    </span>
                  </div>
                  <div className="saki-skill-custom-switch">
                    <input
                      type="checkbox"
                      checked={skillEditDraft.enabled}
                      onChange={(event) => setSkillEditDraft((current) => ({ ...current, enabled: event.target.checked }))}
                    />
                    <span className="saki-skill-switch-slider" />
                  </div>
                </label>
              </div>

              <div className="saki-skill-detail-footer">
                <div className="saki-skill-detail-info">
                  {selectedSkill.path && <span>Path: {selectedSkill.path}</span>}
                  {selectedSkill.sourceUrl && <span>Source: {selectedSkill.sourceUrl}</span>}
                </div>
                <div className="saki-skill-detail-actions">
                  <button className="primary-button" disabled={skillBusy === selectedSkill.id} type="submit">
                    <Save size={17} />
                    {skillBusy === selectedSkill.id ? "Saving" : "Save Skill"}
                  </button>
                  <button
                    className="ghost-button"
                    disabled={skillBusy === selectedSkill.id}
                    type="button"
                    onClick={() => void toggleSkillEnabled(selectedSkill)}
                  >
                    {selectedSkill.enabled === false ? "Enable" : "Disable"}
                  </button>
                  {selectedSkill.builtin ? null : (
                    <button
                      className="ghost-button danger-action"
                      disabled={skillBusy === selectedSkill.id}
                      type="button"
                      onClick={() => void deleteSkill(selectedSkill)}
                    >
                      <Trash2 size={16} />
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </form>
          ) : (
            <div className="saki-skill-detail-empty">
              <Layers size={48} />
              <h3>Select a Skill</h3>
              <p>Choose a skill from the list to view and edit its details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

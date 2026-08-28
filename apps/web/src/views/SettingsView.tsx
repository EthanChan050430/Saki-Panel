import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  BookMarked,
  BookOpen,
  Bot,
  Bug,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Code2,
  Copy,
  Cpu,
  Download,
  DownloadCloud,
  Edit3,
  Eye,
  EyeOff,
  FileArchive,
  FilePlus,
  FileSearch,
  FileText,
  FileUp,
  Folder,
  FolderArchive,
  FolderOpen,
  FolderPlus,
  FolderTree,
  GitBranch,
  Github,
  Globe,
  HardDrive,
  Heart,
  History,
  Image as ImageIcon,
  KeyRound,
  Layers,
  LayoutGrid,
  LayoutTemplate,
  Link2,
  List,
  Loader2,
  LogIn,
  LogOut,
  MemoryStick,
  MessageSquare,
  Moon,
  MoreHorizontal,
  Move,
  Paintbrush,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Play,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  RotateCw,
  Save,
  Search,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Terminal as TerminalIcon,
  TextQuote,
  Trash2,
  Upload,
  UserCheck,
  UserCog,
  UserPlus,
  UserRound,
  Wifi,
  WifiOff,
  Wrench,
  X,
  Zap
} from "lucide-react";
import type {
  CreateSakiSkillRequest,
  CurrentUser,
  PanelAppearanceSettings,
  RegistrationIdentity,
  SakiConfigResponse,
  SakiCopilotAuthStatusResponse,
  SakiCopilotLoginResponse,
  SakiModelOption,
  SakiProviderConfig,
  SakiSkillDetail,
  SakiSkillSummary,
  UpdateSakiConfigRequest,
  UpdateSakiSkillRequest
} from "@webops/shared";
import type { SakiSettingsSection } from "../types/app.js";
import { api, ApiError } from "../api.js";
import { panelLanguageOptions, type PanelLanguage, panelT, type PanelTextKey, usePanelT } from "../i18n/index.js";
import { defaultPanelAppearance, defaultSakiRequestTimeoutMs, sakiArtAssets } from "../constants.js";
import { appearanceFileToDataUrl } from "../components/common/AccountAvatar.js";
import { PageErrorToast } from "../components/common/CommonUI.js";
import { SakiEmptyState } from "../components/saki/SakiEmptyState.js";
import { formatDate } from "../utils/path.js";
import { normalizePanelAppearance } from "../utils/appearance.js";
import { parseHashRoute, updateHashRoute } from "../utils/route.js";
import { PointsUsageModal } from "../PointsUsageModal.js";
import { AdminUserPointsModal } from "../AdminUserPointsModal.js";

const emptySakiConfig: SakiConfigResponse = {
  requestTimeoutMs: defaultSakiRequestTimeoutMs,
  provider: "ollama",
  model: "llama3",
  ollamaUrl: "http://localhost:11434",
  baseUrl: "",
  apiKey: "",
  providerConfigs: {
    ollama: {
      model: "llama3",
      ollamaUrl: "http://localhost:11434"
    }
  },
  searchEnabled: true,
  mcpEnabled: false,
  systemPrompt: "",
  appearance: defaultPanelAppearance,
  configPath: "",
  globalConfigPath: ""
};

const providerBaseUrlDefaults: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  minimax: "https://api.minimaxi.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  moonshot: "https://api.moonshot.cn/v1",
  tongyi: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  doubao: "https://ark.cn-beijing.volces.com/api/v3",
  custom: ""
};

const localProviderUrlDefaults = {
  ollama: "http://localhost:11434",
  lmstudio: "http://localhost:1234"
};

const modelProviderOptions = [
  { value: "ollama", label: "Ollama" },
  { value: "lmstudio", label: "LM Studio" },
  { value: "copilot", label: "GitHub Copilot" },
  { value: "openai", label: "OpenAI Compatible" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "zhipu", label: "Zhipu" },
  { value: "gemini", label: "Gemini" },
  { value: "minimax", label: "MiniMax" },
  { value: "anthropic", label: "Anthropic" },
  { value: "moonshot", label: "Moonshot" },
  { value: "tongyi", label: "通义千问" },
  { value: "doubao", label: "豆包" },
  { value: "custom", label: "Custom" }
];

function isLocalProvider(provider: string): boolean {
  return provider === "ollama" || provider === "lmstudio";
}

function needsCloudApiFields(provider: string): boolean {
  return !isLocalProvider(provider) && provider !== "copilot";
}

function defaultProviderConfig(provider: string): SakiProviderConfig {
  if (provider === "ollama") {
    return {
      model: "llama3",
      ollamaUrl: localProviderUrlDefaults.ollama
    };
  }
  if (provider === "lmstudio") {
    return {
      model: "",
      ollamaUrl: localProviderUrlDefaults.lmstudio
    };
  }
  return {
    model: "",
    baseUrl: providerBaseUrlDefaults[provider] ?? "",
    apiKey: ""
  };
}

function providerConfigFromForm(form: SakiConfigResponse, provider: string): SakiProviderConfig {
  return {
    ...defaultProviderConfig(provider),
    ...(form.providerConfigs?.[provider] ?? {})
  };
}

interface SakiSkillDraft {
  name: string;
  description: string;
  tags: string;
  content: string;
  enabled: boolean;
}

const emptySakiSkillDraft: SakiSkillDraft = {
  name: "",
  description: "",
  tags: "",
  content: "",
  enabled: true
};

function parseSakiSkillTags(value: string): string[] {
  return value
    .split(/[,，;；\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 16);
}

function sakiSkillDraftFromDetail(skill: SakiSkillDetail): SakiSkillDraft {
  return {
    name: skill.name,
    description: skill.description ?? "",
    tags: skill.tags?.join(", ") ?? "",
    content: skill.content,
    enabled: skill.enabled !== false
  };
}

function formatSessionTimeoutMinutes(value: number): string {
  return Number.isFinite(value) ? String(value) : "120";
}

function parseSessionTimeoutMinutesDraft(value: string): number {
  const trimmed = value.trim();
  const parsed = Number(trimmed);
  if (!trimmed || !Number.isFinite(parsed) || parsed < 0) {
    throw new Error("登录超时时间必须是大于或等于 0 的数字。");
  }
  return Number(parsed.toFixed(3));
}
const registrationIdentityOptions: Array<{ value: RegistrationIdentity; label: string }> = [
  { value: "none", label: "无角色" },
  { value: "user", label: "用户" },
  { value: "admin", label: "管理员" },
  { value: "super_admin", label: "超级管理员" }
];

export function SettingsView({
  token,
  onLogout,
  onSessionRefresh,
  refreshTick,
  onAppearanceChange,
  language,
  onLanguageChange
}: {
  token: string;
  onLogout: () => void;
  onSessionRefresh: (token: string, user: CurrentUser) => void;
  refreshTick: number;
  onAppearanceChange: (appearance: PanelAppearanceSettings) => void;
  language: PanelLanguage;
  onLanguageChange: (language: PanelLanguage) => void;
}) {
  const [form, setForm] = useState<SakiConfigResponse>(emptySakiConfig);
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState("120");
  const [registrationIdentity, setRegistrationIdentity] = useState<RegistrationIdentity>("none");
  const [skillList, setSkillList] = useState<SakiSkillSummary[]>([]);
  const [skillCreatorOpen, setSkillCreatorOpen] = useState(false);
  const [skillDraft, setSkillDraft] = useState<SakiSkillDraft>(emptySakiSkillDraft);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<SakiSkillDetail | null>(null);
  const [skillEditDraft, setSkillEditDraft] = useState<SakiSkillDraft>(emptySakiSkillDraft);
  const [skillDownloadUrl, setSkillDownloadUrl] = useState("");
  const [skillSearchQuery, setSkillSearchQuery] = useState("");
  const [skillFilter, setSkillFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [activeSettingsSection, setActiveSettingsSectionState] = useState<SakiSettingsSection>(() => {
    return parseHashRoute().settingsSection ?? "system";
  });

  const setActiveSettingsSection = useCallback((sec: SakiSettingsSection) => {
    setActiveSettingsSectionState(sec);
    updateHashRoute({ view: "settings", settingsSection: sec });
  }, []);
  const [settingsMenuCollapsed, setSettingsMenuCollapsed] = useState(false);
  const [modelOptions, setModelOptions] = useState<SakiModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [detectingModels, setDetectingModels] = useState(false);
  const [copilotAuthStatus, setCopilotAuthStatus] = useState<SakiCopilotAuthStatusResponse | null>(null);
  const [copilotLoginState, setCopilotLoginState] = useState<SakiCopilotLoginResponse | null>(null);
  const [copilotBusy, setCopilotBusy] = useState<"status" | "login" | null>(null);
  const [skillBusy, setSkillBusy] = useState<string | null>(null);
  const [skillDetailLoading, setSkillDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const skillDetailRequestRef = useRef(0);
  const appLogoInputRef = useRef<HTMLInputElement>(null);
  const sidebarLogoInputRef = useRef<HTMLInputElement>(null);
  const loginCoverInputRef = useRef<HTMLInputElement>(null);
  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const mobileBackgroundInputRef = useRef<HTMLInputElement>(null);
  const skillImportInputRef = useRef<HTMLInputElement>(null);
  const t = useCallback((key: PanelTextKey) => panelT(language, key), [language]);
  const localizedRegistrationIdentityOptions = useMemo<Array<{ value: RegistrationIdentity; label: string }>>(
    () => registrationIdentityOptions.map((option) => ({ ...option, label: t(`registration.${option.value}` as PanelTextKey) })),
    [t]
  );

  const refresh = useCallback(async () => {
    setError("");
    setNotice("");
    setLoading(true);
    try {
      const [nextConfig, nextSkills, nextSessionSettings] = await Promise.all([
        api.sakiConfig(token),
        api.sakiAllSkills(token),
        api.sessionSettings(token)
      ]);
      setForm(nextConfig);
      setSessionTimeoutMinutes(formatSessionTimeoutMinutes(nextSessionSettings.sessionTimeoutMinutes));
      setRegistrationIdentity(nextSessionSettings.registrationIdentity);
      onAppearanceChange(nextConfig.appearance);
      setSkillList(nextSkills);
      setModelOptions([]);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : t("settings.readFailed"));
    } finally {
      setLoading(false);
    }
  }, [onAppearanceChange, onLogout, token]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshTick]);

  function withActiveProviderConfig(current: SakiConfigResponse, patch: SakiProviderConfig): SakiConfigResponse {
    const provider = current.provider;
    const nextConfig: SakiProviderConfig = providerConfigFromForm(current, provider);
    if (patch.model !== undefined) nextConfig.model = patch.model;
    if (patch.ollamaUrl !== undefined) nextConfig.ollamaUrl = patch.ollamaUrl;
    if (patch.baseUrl !== undefined) nextConfig.baseUrl = patch.baseUrl;
    if (patch.apiKey !== undefined) nextConfig.apiKey = patch.apiKey;

    const next: SakiConfigResponse = {
      ...current,
      providerConfigs: {
        ...current.providerConfigs,
        [provider]: nextConfig
      }
    };
    if (patch.model !== undefined) next.model = patch.model;
    if (patch.ollamaUrl !== undefined) next.ollamaUrl = patch.ollamaUrl;
    if (patch.baseUrl !== undefined) next.baseUrl = patch.baseUrl;
    if (patch.apiKey !== undefined) next.apiKey = patch.apiKey;
    return next;
  }

  function updateActiveProviderConfig(patch: SakiProviderConfig) {
    setModelOptions([]);
    setForm((current) => withActiveProviderConfig(current, patch));
  }

  function currentSakiConfigPayload(): UpdateSakiConfigRequest {
    const activeConfig = providerConfigFromForm(form, form.provider);
    const providerConfigs = {
      ...form.providerConfigs,
      [form.provider]: {
        ...activeConfig,
        model: form.model,
        ollamaUrl: form.ollamaUrl,
        baseUrl: form.baseUrl,
        apiKey: form.apiKey
      }
    };
    return {
      requestTimeoutMs: Number(form.requestTimeoutMs) || defaultSakiRequestTimeoutMs,
      provider: form.provider,
      model: form.model,
      ollamaUrl: form.ollamaUrl,
      baseUrl: form.baseUrl,
      apiKey: form.apiKey,
      providerConfigs,
      searchEnabled: form.searchEnabled,
      mcpEnabled: form.mcpEnabled,
      systemPrompt: form.systemPrompt ?? "",
      appearance: form.appearance
    };
  }

  function changeProvider(provider: string) {
    setModelOptions([]);
    setForm((current) => {
      const nextConfig = providerConfigFromForm(current, provider);
      return {
        ...current,
        provider,
        model: nextConfig.model ?? "",
        ollamaUrl: nextConfig.ollamaUrl ?? localProviderUrlDefaults[provider as keyof typeof localProviderUrlDefaults] ?? "",
        baseUrl: nextConfig.baseUrl ?? providerBaseUrlDefaults[provider] ?? "",
        apiKey: nextConfig.apiKey ?? ""
      };
    });
  }

  function updateAppearance(patch: Partial<PanelAppearanceSettings>) {
    setForm((current) => ({
      ...current,
      appearance: normalizePanelAppearance({
        ...current.appearance,
        ...patch
      })
    }));
  }

  async function chooseAppearanceImage(
    field: "appLogoSrc" | "sidebarLogoSrc" | "loginCoverSrc" | "backgroundSrc" | "mobileBackgroundSrc",
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setNotice("");
    try {
      const dataUrl = await appearanceFileToDataUrl(file);
      updateAppearance({ [field]: dataUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : "图片读取失败");
    }
  }

  const refreshCopilotAuthStatus = useCallback(async (silent = false) => {
    if (!silent) {
      setError("");
      setNotice("");
      setCopilotBusy("status");
    }
    try {
      const status = await api.sakiCopilotStatus(token);
      setCopilotAuthStatus(status);
      if (!silent) {
        setNotice(
          status.authenticated
            ? `GitHub Copilot 已登录${status.login ? `：${status.login}` : ""}。`
            : status.message || "GitHub Copilot 尚未登录。"
        );
      }
      return status;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return null;
      }
      if (!silent) {
        setError(err instanceof Error ? err.message : "GitHub Copilot 状态检查失败");
      }
      return null;
    } finally {
      if (!silent) setCopilotBusy(null);
    }
  }, [onLogout, token]);

  async function startCopilotLoginFromSettings() {
    setError("");
    setNotice("");
    setCopilotBusy("login");
    try {
      const loginState = await api.sakiCopilotLogin(token);
      setCopilotLoginState(loginState);
      if (loginState.verificationUri) {
        window.open(loginState.verificationUri, "_blank", "noopener,noreferrer");
      }
      const status = await refreshCopilotAuthStatus(true);
      if (status?.authenticated) {
        setNotice(`GitHub Copilot 已登录${status.login ? `：${status.login}` : ""}。`);
      } else {
        setNotice(loginState.message || "GitHub 登录已启动。");
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : "GitHub 登录启动失败");
    } finally {
      setCopilotBusy(null);
    }
  }

  async function detectModels(silent = false) {
    const provider = form.provider;
    if (needsCloudApiFields(provider) && (!form.baseUrl.trim() || !form.apiKey.trim())) {
      if (!silent) {
        setNotice("");
        setError("请先填写模型 API Base URL 和 API Key。");
      }
      return;
    }
    if (provider === "ollama" && !form.ollamaUrl.trim()) {
      if (!silent) {
        setNotice("");
        setError("请先填写 Ollama URL。");
      }
      return;
    }

    setDetectingModels(true);
    if (!silent) {
      setError("");
      setNotice("");
    }
    try {
      const result = await api.sakiModels(token, currentSakiConfigPayload());
      setModelOptions(result.models);
      if (result.models.length > 0) {
        setForm((current) => {
          const hasCurrent = result.models.some((model) => model.id === current.model);
          const nextModel = result.models[0]?.id ?? current.model;
          return hasCurrent ? current : withActiveProviderConfig(current, { model: nextModel });
        });
      }
      if (!silent) {
        const warningText = result.warnings.length > 0 ? `；警告 ${result.warnings.length} 条` : "";
        setNotice(
          result.models.length > 0
            ? `${result.provider} 模型 API 检测成功，发现 ${result.models.length} 个模型${warningText}。`
            : `${result.provider} 模型 API 已响应，但没有返回可用模型${warningText}。`
        );
      }
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : "模型 API 检测失败");
      }
    } finally {
      setDetectingModels(false);
    }
  }

  useEffect(() => {
    if (loading) return;
    const provider = form.provider;
    if (needsCloudApiFields(provider) && (!form.baseUrl.trim() || !form.apiKey.trim())) return;
    if (provider === "ollama" && !form.ollamaUrl.trim()) return;
    const timer = window.setTimeout(() => {
      void detectModels(true);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [form.apiKey, form.baseUrl, form.ollamaUrl, form.provider, loading]);

  useEffect(() => {
    if (loading || form.provider !== "copilot") return;
    void refreshCopilotAuthStatus(true);
  }, [form.provider, loading, refreshCopilotAuthStatus]);

  useEffect(() => {
    if (form.provider !== "copilot" || copilotLoginState?.status !== "running") return;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const [loginState, status] = await Promise.all([
            api.sakiCopilotLoginState(token),
            api.sakiCopilotStatus(token)
          ]);
          setCopilotLoginState(loginState);
          setCopilotAuthStatus(status);
          if (status.authenticated) {
            setNotice(`GitHub Copilot 已登录${status.login ? `：${status.login}` : ""}。`);
          }
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            onLogout();
          }
        }
      })();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [copilotLoginState?.status, form.provider, onLogout, token]);

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const nextSessionTimeoutMinutes = parseSessionTimeoutMinutesDraft(sessionTimeoutMinutes);
      const [saved, savedSessionSettings] = await Promise.all([
        api.updateSakiConfig(token, currentSakiConfigPayload()),
        api.updateSessionSettings(token, {
          sessionTimeoutMinutes: nextSessionTimeoutMinutes,
          registrationIdentity
        })
      ]);
      setForm(saved);
      setSessionTimeoutMinutes(formatSessionTimeoutMinutes(savedSessionSettings.sessionTimeoutMinutes));
      setRegistrationIdentity(savedSessionSettings.registrationIdentity);
      onAppearanceChange(saved.appearance);
      const refreshed = await api.refreshSession(token);
      onSessionRefresh(refreshed.token, refreshed.user);
      setNotice(t("settings.saved"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(err instanceof Error ? err.message : t("settings.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function refreshSkillList() {
    const nextSkills = await api.sakiAllSkills(token);
    setSkillList(nextSkills);
    if (selectedSkillId && !nextSkills.some((skill) => skill.id === selectedSkillId)) {
      setSelectedSkillId(null);
      setSelectedSkill(null);
      setSkillEditDraft(emptySakiSkillDraft);
    }
  }

  async function createSkill(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = skillDraft.name.trim();
    let content = skillDraft.content.trim();
    if (!name) {
      setError("请输入 Skill 名称。");
      setNotice("");
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
    setError("");
    setNotice("");
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
      setNotice(`Skill ${skill.name} saved.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Skill save failed");
    } finally {
      setSkillBusy(null);
    }
  }

  async function downloadSkill(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = skillDownloadUrl.trim();
    if (!url) {
      setError("OpenClaw Skill URL is required.");
      setNotice("");
      return;
    }
    setSkillBusy("download");
    setError("");
    setNotice("");
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
      setNotice(`Downloaded ${skill.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Skill download failed");
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
    setError("");
    setNotice("");
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
      await refreshSkillList();
      if (results.length > 0) {
        setNotice(`已导入 ${results.length} 个 Skill：${results.slice(0, 3).join(", ")}${results.length > 3 ? ` 等` : ""}`);
        const last = results[results.length - 1];
        const lastDetail = await api.sakiAllSkills(token);
        const match = lastDetail.find((s) => s.name === last);
        if (match) {
          setSkillDetailLoading(false);
          setSelectedSkillId(match.id);
          const detail = await api.sakiSkill(token, match.id);
          setSelectedSkill(detail);
          setSkillEditDraft(sakiSkillDraftFromDetail(detail));
        }
      }
      if (errors.length > 0) {
        setError(errors.join("；"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败");
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
    setError("");
    setNotice("");
    try {
      const detail = await api.sakiSkill(token, skill.id);
      if (skillDetailRequestRef.current !== requestId) return;
      setSelectedSkill(detail);
      setSkillEditDraft(sakiSkillDraftFromDetail(detail));
    } catch (err) {
      if (skillDetailRequestRef.current !== requestId) return;
      setError(err instanceof Error ? err.message : "Skill load failed");
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
      setError("Skill name and content are required.");
      setNotice("");
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
    setError("");
    setNotice("");
    try {
      const skill = await api.updateSakiSkill(token, selectedSkill.id, payload);
      skillDetailRequestRef.current += 1;
      setSkillDetailLoading(false);
      setSelectedSkillId(skill.id);
      setSelectedSkill(skill);
      setSkillEditDraft(sakiSkillDraftFromDetail(skill));
      await refreshSkillList();
      setNotice(`Skill ${skill.name} updated.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Skill update failed");
    } finally {
      setSkillBusy(null);
    }
  }

  async function toggleSkillEnabled(skill: SakiSkillSummary) {
    const patch: UpdateSakiSkillRequest = { enabled: skill.enabled === false };
    setSkillBusy(skill.id);
    setError("");
    setNotice("");
    try {
      const updatedSkill = await api.updateSakiSkill(token, skill.id, patch);
      if (selectedSkill?.id === skill.id) {
        setSelectedSkill(updatedSkill);
        setSkillEditDraft(sakiSkillDraftFromDetail(updatedSkill));
      }
      await refreshSkillList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Skill update failed");
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
    setError("");
    setNotice("");
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
      setNotice(`Deleted ${skill.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Skill delete failed");
    } finally {
      setSkillBusy(null);
    }
  }

  const settingsNavItems: Array<{ id: SakiSettingsSection; label: string; detail: string; icon: React.ReactNode }> = [
    { id: "system", label: t("settings.system"), detail: t("settings.system.detail"), icon: <Settings size={17} /> },
    { id: "model", label: t("settings.model"), detail: t("settings.model.detail"), icon: <Cpu size={17} /> },
    { id: "features", label: t("settings.features"), detail: t("settings.features.detail"), icon: <Wrench size={17} /> },
    { id: "appearance", label: t("settings.appearance"), detail: t("settings.appearance.detail"), icon: <ImageIcon size={17} /> },
    { id: "prompt", label: t("settings.prompt"), detail: t("settings.prompt.detail"), icon: <TextQuote size={17} /> },
    { id: "skills", label: "Skills", detail: `${skillList.length} ${t("settings.skills.detail")}`, icon: <Layers size={17} /> }
  ];

  return (
    <>
      <PageErrorToast error={error} onDismiss={() => setError("")} />
      {notice ? <div className="page-notice">{notice}</div> : null}
      <section className="panel-block settings-panel">
        <div className="section-heading">
          <h2>{t("settings.title")}</h2>
          <span>{loading ? t("settings.loading") : t("settings.runtime")}</span>
        </div>
        <div className={`settings-grid settings-wiki ${settingsMenuCollapsed ? "toc-collapsed" : ""}`}>
          <input
            ref={appLogoInputRef}
            className="hidden-file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => void chooseAppearanceImage("appLogoSrc", event)}
          />
          <input
            ref={sidebarLogoInputRef}
            className="hidden-file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => void chooseAppearanceImage("sidebarLogoSrc", event)}
          />
          <input
            ref={loginCoverInputRef}
            className="hidden-file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => void chooseAppearanceImage("loginCoverSrc", event)}
          />
          <input
            ref={backgroundInputRef}
            className="hidden-file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => void chooseAppearanceImage("backgroundSrc", event)}
          />
          <input
            ref={mobileBackgroundInputRef}
            className="hidden-file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => void chooseAppearanceImage("mobileBackgroundSrc", event)}
          />
          <nav className="settings-toc" aria-label={t("settings.toc")}>
            <button
              className="settings-toc-toggle"
              type="button"
              title={settingsMenuCollapsed ? t("settings.toc.expand") : t("settings.toc.collapse")}
              onClick={() => setSettingsMenuCollapsed((current) => !current)}
            >
              {settingsMenuCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
              <span>{t("settings.toc")}</span>
            </button>
            <div className="settings-toc-list">
              {settingsNavItems.map((item) => (
                <button
                  className={activeSettingsSection === item.id ? "active" : ""}
                  key={item.id}
                  type="button"
                  title={`${item.label} - ${item.detail}`}
                  onClick={() => setActiveSettingsSection(item.id)}
                >
                  <span className="settings-toc-icon">{item.icon}</span>
                  <span className="settings-toc-copy">
                    <strong>{item.label}</strong>
                    <span>{item.detail}</span>
                  </span>
                </button>
              ))}
            </div>
          </nav>
          <div className="settings-wiki-content">
          {activeSettingsSection !== "skills" ? (
          <form className="settings-config-form" onSubmit={(event) => void saveSettings(event)}>
            {/* System & Security */}
            <div className={`settings-group ${activeSettingsSection === "system" ? "active" : "settings-section-hidden"}`} id="settings-system">
              <div className="settings-group-title">
                <div className="settings-group-icon"><Settings size={20} /></div>
                <div>
                  <h3>{t("settings.system")}</h3>
                  <span>{t("settings.system.detail")}</span>
                </div>
              </div>
              <div className="settings-group-content">
                <div className="settings-form-row">
                  <label className="settings-field">
                    <span className="settings-field-label">{t("settings.language")}</span>
                    <select
                      className="settings-select"
                      value={language}
                      onChange={(event) => onLanguageChange(event.target.value as PanelLanguage)}
                    >
                      {panelLanguageOptions.map((option) => (
                        <option value={option.value} key={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="settings-field">
                    <span className="settings-field-label">{t("settings.registrationIdentity")}</span>
                    <select
                      className="settings-select"
                      value={registrationIdentity}
                      onChange={(event) => setRegistrationIdentity(event.target.value as RegistrationIdentity)}
                    >
                      {localizedRegistrationIdentityOptions.map((option) => (
                        <option value={option.value} key={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="settings-form-row">
                  <label className="settings-field">
                    <span className="settings-field-label">{t("settings.sessionTimeout")}</span>
                    <input
                      className="settings-input"
                      type="number"
                      min={0}
                      step={0.1}
                      value={sessionTimeoutMinutes}
                      onChange={(event) => setSessionTimeoutMinutes(event.target.value)}
                      placeholder={t("settings.sessionTimeout.placeholder")}
                    />
                    <span className="settings-field-hint">单位：分钟。设为 0 表示不自动过期。</span>
                  </label>

                  <label className="settings-field">
                    <span className="settings-field-label">{t("settings.requestTimeout")}</span>
                    <input
                      className="settings-input"
                      type="number"
                      min={5000}
                      max={600000}
                      step={1000}
                      value={form.requestTimeoutMs}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, requestTimeoutMs: Number(event.target.value) || defaultSakiRequestTimeoutMs }))
                      }
                      placeholder="60000"
                    />
                    <span className="settings-field-hint">单位：毫秒（建议 30000 ~ 120000）。</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Model Engine */}
            <div className={`settings-group ${activeSettingsSection === "model" ? "active" : "settings-section-hidden"}`} id="settings-model">
              <div className="settings-group-title">
                <div className="settings-group-icon"><Cpu size={20} /></div>
                <div>
                  <h3>{t("settings.model.title")}</h3>
                  <span>{t("settings.model.detail")}</span>
                </div>
              </div>
              <div className="settings-group-content">
                <div className="settings-form-row">
                  <label className="settings-field">
                    <span className="settings-field-label">服务商 (Provider)</span>
                    <select
                      className="settings-select"
                      value={form.provider}
                      onChange={(event) => changeProvider(event.target.value)}
                    >
                      {modelProviderOptions.map((option) => (
                        <option value={option.value} key={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="settings-field">
                    <span className="settings-field-label">模型名称 (Model)</span>
                    {modelOptions.length > 0 ? (
                      <select
                        className="settings-select"
                        value={form.model}
                        onChange={(event) => updateActiveProviderConfig({ model: event.target.value })}
                        required
                      >
                        {modelOptions.map((model) => (
                          <option value={model.id} key={`${model.provider}:${model.id}`}>
                            {model.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="settings-input-with-action">
                        <input
                          className="settings-input"
                          value={form.model}
                          onChange={(event) => updateActiveProviderConfig({ model: event.target.value })}
                          placeholder={form.provider === "ollama" ? "llama3" : "输入模型 ID 或点击检测"}
                          required
                        />
                        <button
                          type="button"
                          className="settings-inline-action-btn"
                          disabled={detectingModels || loading}
                          onClick={() => void detectModels(false)}
                          title="检测当前服务商可用模型"
                        >
                          <RefreshCw size={14} className={detectingModels ? "animate-spin" : ""} />
                          <span>{detectingModels ? "检测中" : "检测"}</span>
                        </button>
                      </div>
                    )}
                  </label>
                </div>

                {isLocalProvider(form.provider) ? (
                  <label className="settings-field">
                    <span className="settings-field-label">{form.provider === "lmstudio" ? "LM Studio URL" : "Ollama 服务地址"}</span>
                    <input
                      className="settings-input"
                      value={form.ollamaUrl}
                      onChange={(event) => {
                        updateActiveProviderConfig({ ollamaUrl: event.target.value });
                      }}
                      placeholder={form.provider === "lmstudio" ? "http://localhost:1234" : "http://localhost:11434"}
                    />
                    <span className="settings-field-hint">本地运行的模型服务 HTTP 监听地址</span>
                  </label>
                ) : null}

                {needsCloudApiFields(form.provider) ? (
                  <div className="settings-form-row">
                    <label className="settings-field">
                      <span className="settings-field-label">API Base URL</span>
                      <input
                        className="settings-input"
                        value={form.baseUrl}
                        onChange={(event) => {
                          updateActiveProviderConfig({ baseUrl: event.target.value });
                        }}
                        placeholder={providerBaseUrlDefaults[form.provider] || "https://api.example.com/v1"}
                      />
                    </label>

                    <label className="settings-field">
                      <span className="settings-field-label">API Key</span>
                      <div className="settings-input-with-action">
                        <input
                          className="settings-input"
                          type={showApiKey ? "text" : "password"}
                          value={form.apiKey}
                          onChange={(event) => {
                            updateActiveProviderConfig({ apiKey: event.target.value });
                          }}
                          placeholder="sk-..."
                        />
                        <button
                          type="button"
                          className="settings-inline-action-btn icon-only"
                          onClick={() => setShowApiKey((s) => !s)}
                          title={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                        >
                          {showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      </div>
                    </label>
                  </div>
                ) : null}

                {form.provider === "copilot" ? (
                  <div className="copilot-auth-panel wide-field">
                    <div className="copilot-auth-status">
                      <div className={`copilot-auth-badge ${copilotAuthStatus?.authenticated ? "authenticated" : "pending"}`}>
                        {copilotAuthStatus?.authenticated ? <CheckCircle2 size={18} /> : <Github size={18} />}
                        <span>{copilotAuthStatus?.authenticated ? "已授权连接" : "未授权"}</span>
                      </div>
                      <div className="copilot-auth-copy">
                        <strong>GitHub Copilot 认证状态</strong>
                        <span>
                          {copilotAuthStatus?.authenticated
                            ? `当前绑定账号：${copilotAuthStatus.login || "已登录"}${copilotAuthStatus.authType ? ` (${copilotAuthStatus.authType})` : ""}`
                            : copilotAuthStatus?.message || "点击下方登录获取授权码以绑定 GitHub 账号。"}
                        </span>
                      </div>
                    </div>
                    <div className="copilot-auth-actions">
                      <button
                        className="ghost-button"
                        disabled={copilotBusy === "status" || loading}
                        type="button"
                        onClick={() => void refreshCopilotAuthStatus(false)}
                      >
                        <RefreshCw size={15} />
                        <span>{copilotBusy === "status" ? "检查中" : "检查状态"}</span>
                      </button>
                      <button
                        className="primary-button"
                        disabled={copilotBusy === "login" || loading}
                        type="button"
                        onClick={() => void startCopilotLoginFromSettings()}
                      >
                        <LogIn size={15} />
                        <span>{copilotBusy === "login" ? "连接中..." : "登录 GitHub"}</span>
                      </button>
                    </div>
                    {copilotLoginState?.message ? (
                      <div className="copilot-login-progress">
                        <div>
                          <KeyRound size={16} />
                          <span>{copilotLoginState.message}</span>
                        </div>
                        {copilotLoginState.userCode || copilotLoginState.verificationUri ? (
                          <div className="copilot-device-row">
                            {copilotLoginState.userCode ? <code>{copilotLoginState.userCode}</code> : null}
                            {copilotLoginState.verificationUri ? (
                              <a href={copilotLoginState.verificationUri} target="_blank" rel="noopener noreferrer">
                                前往 GitHub 设备验证页 <ArrowRight size={14} />
                              </a>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            {/* Smart Features */}
            <div className={`settings-group ${activeSettingsSection === "features" ? "active" : "settings-section-hidden"}`} id="settings-features">
              <div className="settings-group-title">
                <div className="settings-group-icon"><Wrench size={20} /></div>
                <div>
                  <h3>{t("settings.features")}</h3>
                  <span>{t("settings.features.detail")}</span>
                </div>
              </div>
              <div className="settings-group-content">
                <div className="settings-switch-card">
                  <div className="settings-switch-info">
                    <div className="settings-switch-title">
                      <Globe size={18} className="settings-switch-icon" />
                      <strong>联网搜索与网页内容提取</strong>
                    </div>
                    <span>允许 Saki 在回答技术问题或排查故障时自主检索最新互联网资料与官方文档。</span>
                  </div>
                  <label className="settings-switch-toggle">
                    <input
                      type="checkbox"
                      checked={form.searchEnabled ?? false}
                      onChange={(event) => setForm((current) => ({ ...current, searchEnabled: event.target.checked }))}
                    />
                    <span className="settings-switch-slider" />
                  </label>
                </div>

                <div className="settings-switch-card">
                  <div className="settings-switch-info">
                    <div className="settings-switch-title">
                      <Zap size={18} className="settings-switch-icon" />
                      <strong>Model Context Protocol (MCP)</strong>
                    </div>
                    <span>启用标准化 MCP 扩展工具与外部上下文集成协议，为 Saki 提供深度工具交互。</span>
                  </div>
                  <label className="settings-switch-toggle">
                    <input
                      type="checkbox"
                      checked={form.mcpEnabled ?? false}
                      onChange={(event) => setForm((current) => ({ ...current, mcpEnabled: event.target.checked }))}
                    />
                    <span className="settings-switch-slider" />
                  </label>
                </div>
              </div>
            </div>

            {/* Appearance & Branding */}
            <div className={`settings-group ${activeSettingsSection === "appearance" ? "active" : "settings-section-hidden"}`} id="settings-appearance">
              <div className="settings-group-title">
                <div className="settings-group-icon"><ImageIcon size={20} /></div>
                <div>
                  <h3>{t("settings.appearance")}</h3>
                  <span>{t("settings.appearance.titleDetail")}</span>
                </div>
              </div>
              <div className="settings-group-content">
                <div className="settings-form-row">
                  <label className="settings-field">
                    <span className="settings-field-label">侧边栏标题</span>
                    <input
                      className="settings-input"
                      value={form.appearance?.sidebarTitle ?? ""}
                      onChange={(event) => updateAppearance({ sidebarTitle: event.target.value })}
                      placeholder="Saki Panel"
                    />
                  </label>

                  <label className="settings-field">
                    <span className="settings-field-label">登录页主标题</span>
                    <input
                      className="settings-input"
                      value={form.appearance?.appTitle ?? ""}
                      onChange={(event) => updateAppearance({ appTitle: event.target.value })}
                      placeholder="Saki Panel"
                    />
                  </label>
                </div>

                <label className="settings-field">
                  <span className="settings-field-label">登录页副标题</span>
                  <input
                    className="settings-input"
                    value={form.appearance?.appSubtitle ?? ""}
                    onChange={(event) => updateAppearance({ appSubtitle: event.target.value })}
                    placeholder="System Administration"
                  />
                </label>

                <div className="settings-asset-grid">
                  {/* Login Cover */}
                  <div className="settings-asset-card">
                    <div className="settings-asset-preview-box cover">
                      {form.appearance?.loginCoverSrc ? (
                        <img src={form.appearance.loginCoverSrc} alt="登录封面" />
                      ) : (
                        <div className="settings-asset-empty">
                          <ImageIcon size={28} />
                          <span>未设置封面</span>
                        </div>
                      )}
                    </div>
                    <div className="settings-asset-meta">
                      <strong>登录页封面大图</strong>
                      <div className="settings-asset-input-wrap">
                        <input
                          className="settings-input mini"
                          value={form.appearance?.loginCoverSrc ?? ""}
                          onChange={(event) => updateAppearance({ loginCoverSrc: event.target.value })}
                          placeholder="/assets/cover.png"
                        />
                        <button
                          className="ghost-button mini"
                          type="button"
                          onClick={() => loginCoverInputRef.current?.click()}
                          title="选择本地图片"
                        >
                          <Upload size={14} />
                          <span>上传</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* App Logo */}
                  <div className="settings-asset-card">
                    <div className="settings-asset-preview-box square">
                      {form.appearance?.appLogoSrc ? (
                        <img src={form.appearance.appLogoSrc} alt="应用图标" />
                      ) : (
                        <div className="settings-asset-empty">
                          <ImageIcon size={24} />
                          <span>默认图标</span>
                        </div>
                      )}
                    </div>
                    <div className="settings-asset-meta">
                      <strong>应用图标 (Favicon/Logo)</strong>
                      <div className="settings-asset-input-wrap">
                        <input
                          className="settings-input mini"
                          value={form.appearance?.appLogoSrc ?? ""}
                          onChange={(event) => updateAppearance({ appLogoSrc: event.target.value })}
                          placeholder="/assets/saki-panel-icon.png"
                        />
                        <button
                          className="ghost-button mini"
                          type="button"
                          onClick={() => appLogoInputRef.current?.click()}
                          title="选择本地图片"
                        >
                          <Upload size={14} />
                          <span>上传</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Sidebar Logo */}
                  <div className="settings-asset-card">
                    <div className="settings-asset-preview-box square">
                      {form.appearance?.sidebarLogoSrc ? (
                        <img src={form.appearance.sidebarLogoSrc} alt="侧边栏图标" />
                      ) : (
                        <div className="settings-asset-empty">
                          <ImageIcon size={24} />
                          <span>侧栏图标</span>
                        </div>
                      )}
                    </div>
                    <div className="settings-asset-meta">
                      <strong>侧边栏 Logo</strong>
                      <div className="settings-asset-input-wrap">
                        <input
                          className="settings-input mini"
                          value={form.appearance?.sidebarLogoSrc ?? ""}
                          onChange={(event) => updateAppearance({ sidebarLogoSrc: event.target.value })}
                          placeholder="/assets/saki-panel-icon.png"
                        />
                        <button
                          className="ghost-button mini"
                          type="button"
                          onClick={() => sidebarLogoInputRef.current?.click()}
                          title="选择本地图片"
                        >
                          <Upload size={14} />
                          <span>上传</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Web Background */}
                  <div className="settings-asset-card">
                    <div className="settings-asset-preview-box cover">
                      {form.appearance?.backgroundSrc ? (
                        <img src={form.appearance.backgroundSrc} alt="网页背景" />
                      ) : (
                        <div className="settings-asset-empty">
                          <Paintbrush size={24} />
                          <span>默认壁纸</span>
                        </div>
                      )}
                    </div>
                    <div className="settings-asset-meta">
                      <strong>桌面端全局背景壁纸</strong>
                      <div className="settings-asset-input-wrap">
                        <input
                          className="settings-input mini"
                          value={form.appearance?.backgroundSrc ?? ""}
                          onChange={(event) => updateAppearance({ backgroundSrc: event.target.value })}
                          placeholder="/assets/background.png"
                        />
                        <button
                          className="ghost-button mini"
                          type="button"
                          onClick={() => backgroundInputRef.current?.click()}
                          title="选择本地图片"
                        >
                          <Upload size={14} />
                          <span>上传</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Mobile Background */}
                  <div className="settings-asset-card">
                    <div className="settings-asset-preview-box portrait">
                      {form.appearance?.mobileBackgroundSrc ? (
                        <img src={form.appearance.mobileBackgroundSrc} alt="移动端背景" />
                      ) : (
                        <div className="settings-asset-empty">
                          <Paintbrush size={24} />
                          <span>默认竖屏壁纸</span>
                        </div>
                      )}
                    </div>
                    <div className="settings-asset-meta">
                      <strong>移动端竖屏背景壁纸</strong>
                      <div className="settings-asset-input-wrap">
                        <input
                          className="settings-input mini"
                          value={form.appearance?.mobileBackgroundSrc ?? ""}
                          onChange={(event) => updateAppearance({ mobileBackgroundSrc: event.target.value })}
                          placeholder="/assets/background_mobile.png"
                        />
                        <button
                          className="ghost-button mini"
                          type="button"
                          onClick={() => mobileBackgroundInputRef.current?.click()}
                          title="选择本地图片"
                        >
                          <Upload size={14} />
                          <span>上传</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Prompt & Personality */}
            <div className={`settings-group ${activeSettingsSection === "prompt" ? "active" : "settings-section-hidden"}`} id="settings-prompt">
              <div className="settings-group-title">
                <div className="settings-group-icon"><TextQuote size={20} /></div>
                <div>
                  <h3>{t("settings.prompt")}</h3>
                  <span>{t("settings.prompt.detail")}</span>
                </div>
              </div>
              <div className="settings-group-content">
                <label className="settings-field">
                  <div className="settings-field-head">
                    <span className="settings-field-label">全局系统提示词 (System Prompt)</span>
                    <span className="settings-char-count">{(form.systemPrompt ?? "").length} 字符</span>
                  </div>
                  <textarea
                    className="settings-textarea prompt-editor"
                    value={form.systemPrompt ?? ""}
                    onChange={(event) => setForm((current) => ({ ...current, systemPrompt: event.target.value }))}
                    rows={8}
                    placeholder="设定 Saki 的性格特点、回复语气、运维管理规范与操作约束..."
                  />
                  <span className="settings-field-hint">此提示词将作为 Saki 在所有会话与运维排查中的全局基准系统人设。</span>
                </label>
              </div>
            </div>

            {/* Floating Footer Action Bar */}
            <div className="settings-sticky-footer">
              <div className="settings-footer-info">
                <span className="settings-footer-dot" />
                <span>修改配置后请点击右侧保存生效</span>
              </div>
              <div className="settings-footer-actions">
                <button
                  className="ghost-button"
                  disabled={detectingModels || loading}
                  type="button"
                  onClick={() => void detectModels(false)}
                >
                  <RefreshCw size={16} className={detectingModels ? "animate-spin" : ""} />
                  <span>{detectingModels ? t("settings.detecting") : t("settings.detectModels")}</span>
                </button>
                <button className="primary-button settings-save" disabled={saving || loading} type="submit">
                  <Save size={16} />
                  <span>{saving ? t("common.saving") : t("settings.save")}</span>
                </button>
              </div>
            </div>
          </form>
          ) : (
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
            <button className="ghost-button" type="button" onClick={() => setSkillCreatorOpen((current) => !current)}>
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
                <label className="saki-skill-form-field saki-skill-form-checkbox">
                  <input
                    type="checkbox"
                    checked={skillDraft.enabled}
                    onChange={(event) => setSkillDraft((current) => ({ ...current, enabled: event.target.checked }))}
                  />
                  <span>Enabled</span>
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
                  const matchesSearch = skill.name.toLowerCase().includes(skillSearchQuery.toLowerCase()) ||
                    skill.description?.toLowerCase().includes(skillSearchQuery.toLowerCase()) ||
                    skill.tags?.some((tag) => tag.toLowerCase().includes(skillSearchQuery.toLowerCase()));
                  const matchesFilter = skillFilter === "all" ||
                    (skillFilter === "enabled" && skill.enabled) ||
                    (skillFilter === "disabled" && skill.enabled === false);
                  return matchesSearch && matchesFilter;
                })
                .map((skill) => {
                  const skillCardClassName = [
                    "saki-skill-card",
                    skill.enabled === false ? "disabled" : "",
                    selectedSkillId === skill.id ? "active" : ""
                  ].filter(Boolean).join(" ");
                  return (
                    <article className={skillCardClassName} key={skill.id}>
                      <button className="saki-skill-card-main" type="button" onClick={() => void selectSkill(skill)}>
                        <div className="saki-skill-card-status">
                          <span className={skill.enabled ? "status-active" : "status-inactive"}></span>
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
                          onClick={(e) => { e.stopPropagation(); void toggleSkillEnabled(skill); }}
                          title={skill.enabled ? "Disable" : "Enable"}
                        >
                          {skill.enabled ? <PowerOff size={14} /> : <Power size={14} />}
                        </button>
                        {skill.builtin ? null : (
                          <button
                            className="icon-button action-delete"
                            disabled={skillBusy === skill.id}
                            type="button"
                            onClick={(e) => { e.stopPropagation(); void deleteSkill(skill); }}
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

                  <label className="saki-skill-detail-field saki-skill-detail-checkbox">
                    <input
                      type="checkbox"
                      checked={skillEditDraft.enabled}
                      onChange={(event) => setSkillEditDraft((current) => ({ ...current, enabled: event.target.checked }))}
                    />
                    <span>Enabled</span>
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
          )}
          </div>
        </div>
      </section>
    </>
  );
}


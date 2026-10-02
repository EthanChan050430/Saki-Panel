import { createHash } from "node:crypto";
import { CopilotClient, type MessageOptions, type ModelInfo, type PermissionHandler, type SessionConfig, type Tool } from "@github/copilot-sdk";
import type { SakiChatRequest, SakiConfigResponse, SakiCopilotAuthStatusResponse, SakiCopilotLoginResponse, SakiModelOption } from "@webops/shared";
import { sakiListedModelSupportsVision } from "@webops/shared";
import { panelConfig } from "../../../config.js";
import type { SakiModelToolTurn } from "../types.js";
import {
  createStreamingTextState,
  fetchWithTimeout,
  flushStreamingTextState,
  imageAttachments,
  logSakiModelEvent,
  normalizeProviderId,
  providerConfigFor,
  pushStreamingTextDelta,
  RouteError,
  stripThinking,
  trimString,
  uniqueModels
} from "../types.js";
import { buildDirectMessages, buildDirectSystemPrompt } from "../prompt.js";
import { agentSystemPromptForConfig, currentAgentTurnConversation, serializeTurnMessagesForPrompt } from "../agent-messages.js";
import { requireChatModel } from "./catalog.js";
import { resolveCopilotCliPath } from "./copilot-runtime.js";
import { requestCopilotAgentTurn } from "./copilot-agent.js";

export let copilotClient: CopilotClient | null = null;
export let copilotClientPromise: Promise<CopilotClient> | null = null;
export let copilotClientTokenFingerprint = "";
export let copilotClientPromiseTokenFingerprint = "";
export let copilotLoginState: SakiCopilotLoginResponse = {
  status: "idle",
  command: "GitHub Device Flow",
  message: "\u5C1A\u672A\u767B\u5F55 GitHub Copilot\u3002"
};
export const copilotMissingTokenMessage = "\u8BF7\u5148\u70B9\u51FB\u767B\u5F55 GitHub \u5B8C\u6210\u6388\u6743\u3002";
export const copilotClassicTokenMessage =
  "当前保存的是 classic PAT，Copilot 不支持这种 Token。请点击登录 GitHub 使用 OAuth 授权，或使用带 Copilot Requests 权限的 Fine-grained PAT。";
export const githubDeviceCodeUrl = "https://github.com/login/device/code";
export const githubAccessTokenUrl = "https://github.com/login/oauth/access_token";
export const githubDeviceGrantType = "urn:ietf:params:oauth:grant-type:device_code";

export interface GitHubDeviceCodeResponse {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  expires_in?: number;
  interval?: number;
  error?: string;
  error_description?: string;
}

export interface GitHubAccessTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
  interval?: number;
}

export interface CopilotDeviceLoginSession {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  intervalMs: number;
  nextPollAt: number;
  polling?: Promise<void>;
}

export let copilotDeviceLoginSession: CopilotDeviceLoginSession | null = null;

export const denyCopilotToolUse: PermissionHandler = () => ({
  kind: "user-not-available"
});

export function copilotErrorMessage(error: unknown, token = ""): string {
  let message = error instanceof Error ? error.message : String(error || "");
  if (token) message = message.split(token).join("[REDACTED]");
  message = message
    .replace(/\b(?:gh[opusr]_|github_pat_)[a-zA-Z0-9_]+\b/g, "[REDACTED]")
    .replace(/\bBearer\s+[^\s"'<>]+/gi, "Bearer [REDACTED]");
  if (error instanceof RouteError) return message;
  if (/could not find @github\/copilot|(?:copilot cli|cli executable|cli runtime).*not.*found/i.test(message)) {
    return `GitHub Copilot CLI 运行时未找到。请在运行面板的目录执行 npm ci，确认 @github/copilot 及其平台依赖已安装；如使用自定义 CLI，请检查 COPILOT_CLI_PATH。详细原因：${message}`;
  }
  if (/\b403\b|forbidden|access denied|denied by policy|no copilot (?:license|subscription)/i.test(message)) {
    return `Copilot 拒绝访问，请检查账号的 Copilot 许可、组织策略；手动填写的 Fine-grained PAT 还需 Copilot Requests 权限。详细原因：${message}`;
  }
  if (/\b401\b|unauthorized|not authenticated|authentication failed|invalid (?:github )?token|token (?:expired|revoked)/i.test(message)) {
    return `Copilot 认证失败。网页登录取得的 OAuth Token 受支持，可尝试重新授权；只有手动使用 Fine-grained PAT 时才需检查 Copilot Requests 权限。详细原因：${message}`;
  }
  return message || "GitHub Copilot \u6682\u65F6\u4E0D\u53EF\u7528\u3002";
}

export function copilotTokenProblem(token: string): string | null {
  if (!token) return copilotMissingTokenMessage;
  if (/^ghp_/i.test(token)) return copilotClassicTokenMessage;
  return null;
}

export function copilotTokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function copilotTokenFromConfig(config: SakiConfigResponse, includeActiveApiKey = false): string {
  const savedToken = trimString(providerConfigFor(config.providerConfigs, "copilot").apiKey);
  if (includeActiveApiKey && normalizeProviderId(config.provider) === "copilot") {
    return trimString(config.apiKey) || savedToken;
  }
  return savedToken;
}

export async function resetCopilotClient(): Promise<void> {
  const client = copilotClient;
  copilotClient = null;
  copilotClientPromise = null;
  copilotClientTokenFingerprint = "";
  copilotClientPromiseTokenFingerprint = "";
  if (client) {
    await client.stop().catch(() => []);
  }
}

export async function getCopilotClient(gitHubToken: string): Promise<CopilotClient> {
  const token = trimString(gitHubToken);
  const tokenProblem = copilotTokenProblem(token);
  if (tokenProblem) throw new RouteError(tokenProblem, 400);

  const fingerprint = copilotTokenFingerprint(token);
  if (copilotClient && copilotClientTokenFingerprint === fingerprint) return copilotClient;
  if (copilotClient && copilotClientTokenFingerprint !== fingerprint) {
    await resetCopilotClient();
  }
  if (copilotClientPromise && copilotClientPromiseTokenFingerprint !== fingerprint) {
    await copilotClientPromise.catch(() => undefined);
    await resetCopilotClient();
  }
  if (!copilotClientPromise) {
    copilotClientPromiseTokenFingerprint = fingerprint;
    copilotClientPromise = (async () => {
      let client: CopilotClient | null = null;
      try {
        client = new CopilotClient({
          cliPath: resolveCopilotCliPath(),
          logLevel: "error",
          sessionIdleTimeoutSeconds: 90,
          gitHubToken: token,
          useLoggedInUser: false,
          env: {
            ...process.env,
            COPILOT_GITHUB_TOKEN: token
          }
        });
        await client.start();
        copilotClient = client;
        copilotClientTokenFingerprint = fingerprint;
        return client;
      } catch (error) {
        await client?.forceStop().catch(() => undefined);
        throw new RouteError(copilotErrorMessage(error, token), 503);
      }
    })().finally(() => {
      copilotClientPromise = null;
      copilotClientPromiseTokenFingerprint = "";
    });
  }
  return copilotClientPromise;
}

export function copilotModelOptionFromInfo(model: ModelInfo): SakiModelOption | null {
  const id = trimString(model.id);
  if (!id) return null;
  if (model.policy?.state === "disabled") return null;
  return {
    provider: "copilot",
    id,
    name: trimString(model.name) || id,
    label: trimString(model.name) || id,
    vendor: "GitHub Copilot",
    supportsVision: sakiListedModelSupportsVision({
      id,
      provider: "copilot",
      name: trimString(model.name) || id,
      label: trimString(model.name) || id
    })
  };
}

export async function fetchCopilotModelCatalog(config: SakiConfigResponse): Promise<SakiModelOption[]> {
  try {
    const client = await getCopilotClient(copilotTokenFromConfig(config, true));
    const models = await client.listModels();
    return uniqueModels(
      models
        .map(copilotModelOptionFromInfo)
        .filter((model): model is SakiModelOption => Boolean(model))
    ).sort((a, b) => a.label.localeCompare(b.label));
  } catch (error) {
    if (error instanceof RouteError) throw error;
    throw new RouteError(copilotErrorMessage(error, copilotTokenFromConfig(config, true)), 502);
  }
}

// exported inline

export function getCopilotLoginState(): SakiCopilotLoginResponse {
  return copilotLoginState;
}

export function githubOAuthClientId(): string {
  return trimString(panelConfig.githubOAuthClientId);
}

export function githubOAuthErrorMessage(payload: { error?: string; error_description?: string }, fallback: string): string {
  const code = trimString(payload.error);
  const description = trimString(payload.error_description);
  if (code === "authorization_pending") return "\u7B49\u5F85 GitHub \u6388\u6743\u5B8C\u6210\u3002";
  if (code === "slow_down") return "GitHub \u8981\u6C42\u964D\u4F4E\u8F6E\u8BE2\u9891\u7387\uFF0C\u6B63\u5728\u7EE7\u7EED\u7B49\u5F85\u6388\u6743\u3002";
  if (code === "expired_token" || code === "token_expired") return "\u9A8C\u8BC1\u7801\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u70B9\u51FB\u767B\u5F55 GitHub\u3002";
  if (code === "access_denied") return "GitHub \u6388\u6743\u5DF2\u53D6\u6D88\uFF0C\u8BF7\u91CD\u65B0\u70B9\u51FB\u767B\u5F55 GitHub\u3002";
  if (code === "device_flow_disabled") {
    return "GitHub OAuth App \u6CA1\u6709\u542F\u7528 Device Flow\uFF0C\u8BF7\u5728 OAuth App \u8BBE\u7F6E\u4E2D\u5F00\u542F\u3002";
  }
  if (code === "incorrect_client_credentials") {
    return "GITHUB_OAUTH_CLIENT_ID \u4E0D\u6B63\u786E\uFF0C\u8BF7\u68C0\u67E5 GitHub OAuth App \u7684 Client ID\u3002";
  }
  return description || code || fallback;
}

export async function postGitHubOAuth<T extends { error?: string; error_description?: string }>(
  url: string,
  body: Record<string, string>
): Promise<T> {
  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams(body)
    },
    15000
  );
  let payload: T;
  try {
    payload = (await response.json()) as T;
  } catch {
    throw new RouteError(`GitHub OAuth returned ${response.status} without JSON.`, 502);
  }
  if (!response.ok) {
    throw new RouteError(githubOAuthErrorMessage(payload, `GitHub OAuth request failed with ${response.status}.`), response.status);
  }
  return payload;
}

export async function startCopilotDeviceLogin(): Promise<SakiCopilotLoginResponse> {
  const clientId = githubOAuthClientId();
  if (!clientId) {
    throw new RouteError("\u8BF7\u5148\u914D\u7F6E GITHUB_OAUTH_CLIENT_ID\uFF0C\u5E76\u5728 GitHub OAuth App \u4E2D\u542F\u7528 Device Flow\u3002", 400);
  }
  const payload = await postGitHubOAuth<GitHubDeviceCodeResponse>(githubDeviceCodeUrl, {
    client_id: clientId,
    ...(panelConfig.githubOAuthScope ? { scope: panelConfig.githubOAuthScope } : {})
  });
  if (payload.error) {
    throw new RouteError(githubOAuthErrorMessage(payload, "GitHub OAuth \u8BBE\u5907\u767B\u5F55\u542F\u52A8\u5931\u8D25\u3002"), 400);
  }
  const deviceCode = trimString(payload.device_code);
  const userCode = trimString(payload.user_code);
  const verificationUri = trimString(payload.verification_uri) || "https://github.com/login/device";
  if (!deviceCode || !userCode) {
    throw new RouteError("GitHub OAuth \u6CA1\u6709\u8FD4\u56DE\u8BBE\u5907\u9A8C\u8BC1\u7801\u3002", 502);
  }
  const expiresInMs = Math.max(60, Number(payload.expires_in) || 900) * 1000;
  const intervalMs = Math.max(3, Number(payload.interval) || 5) * 1000;
  copilotDeviceLoginSession = {
    deviceCode,
    userCode,
    verificationUri,
    expiresAt: Date.now() + expiresInMs,
    intervalMs,
    nextPollAt: Date.now() + intervalMs
  };
  copilotLoginState = {
    status: "running",
    command: "GitHub Device Flow",
    startedAt: new Date().toISOString(),
    verificationUri,
    userCode,
    message: "\u8BF7\u5728 GitHub \u8BBE\u5907\u767B\u5F55\u9875\u8F93\u5165\u9A8C\u8BC1\u7801\uFF0C\u6388\u6743\u5B8C\u6210\u540E\u8FD9\u91CC\u4F1A\u81EA\u52A8\u4FDD\u5B58\u767B\u5F55\u72B6\u6001\u3002"
  };
  return copilotLoginState;
}

export async function pollCopilotDeviceLogin(): Promise<void> {
  const session = copilotDeviceLoginSession;
  if (!session || copilotLoginState.status !== "running") return;
  const now = Date.now();
  if (now >= session.expiresAt) {
    copilotDeviceLoginSession = null;
    copilotLoginState = {
      ...copilotLoginState,
      status: "failed",
      finishedAt: new Date().toISOString(),
      message: "\u9A8C\u8BC1\u7801\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u70B9\u51FB\u767B\u5F55 GitHub\u3002"
    };
    return;
  }
  if (session.polling) {
    await session.polling;
    return;
  }
  if (now < session.nextPollAt) return;
  const clientId = githubOAuthClientId();
  if (!clientId) {
    copilotDeviceLoginSession = null;
    copilotLoginState = {
      ...copilotLoginState,
      status: "failed",
      finishedAt: new Date().toISOString(),
      message: "GITHUB_OAUTH_CLIENT_ID \u672A\u914D\u7F6E\uFF0C\u65E0\u6CD5\u5B8C\u6210 GitHub \u767B\u5F55\u3002"
    };
    return;
  }

  session.nextPollAt = now + session.intervalMs;
  session.polling = (async () => {
    try {
      const payload = await postGitHubOAuth<GitHubAccessTokenResponse>(githubAccessTokenUrl, {
        client_id: clientId,
        device_code: session.deviceCode,
        grant_type: githubDeviceGrantType
      });
      const accessToken = trimString(payload.access_token);
      if (accessToken) {
        await persistCopilotToken(accessToken);
        copilotDeviceLoginSession = null;
        copilotLoginState = {
          status: "completed",
          command: "GitHub Device Flow",
          ...(copilotLoginState.startedAt ? { startedAt: copilotLoginState.startedAt } : {}),
          finishedAt: new Date().toISOString(),
          message: "GitHub \u767B\u5F55\u5B8C\u6210\uFF0CToken \u5DF2\u8BB0\u5F55\u3002"
        };
        return;
      }
      const code = trimString(payload.error);
      if (code === "authorization_pending") {
        copilotLoginState = {
          ...copilotLoginState,
          message: "\u7B49\u5F85 GitHub \u6388\u6743\u5B8C\u6210\u3002"
        };
        return;
      }
      if (code === "slow_down") {
        session.intervalMs = Math.max(session.intervalMs + 5000, (Number(payload.interval) || 0) * 1000);
        copilotLoginState = {
          ...copilotLoginState,
          message: "GitHub \u8981\u6C42\u964D\u4F4E\u8F6E\u8BE2\u9891\u7387\uFF0C\u6B63\u5728\u7EE7\u7EED\u7B49\u5F85\u6388\u6743\u3002"
        };
        return;
      }
      copilotDeviceLoginSession = null;
      copilotLoginState = {
        ...copilotLoginState,
        status: "failed",
        finishedAt: new Date().toISOString(),
        message: githubOAuthErrorMessage(payload, "GitHub \u767B\u5F55\u5931\u8D25\uFF0C\u8BF7\u91CD\u65B0\u5C1D\u8BD5\u3002")
      };
    } catch (error) {
      copilotDeviceLoginSession = null;
      copilotLoginState = {
        ...copilotLoginState,
        status: "failed",
        finishedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : "GitHub \u767B\u5F55\u5931\u8D25\uFF0C\u8BF7\u91CD\u65B0\u5C1D\u8BD5\u3002"
      };
    } finally {
      if (copilotDeviceLoginSession === session) {
        delete session.polling;
      }
    }
  })();
  await session.polling;
}

export async function readCopilotLoginState(): Promise<SakiCopilotLoginResponse> {
  await pollCopilotDeviceLogin();
  return copilotLoginState;
}

export interface CopilotConfigHost {
  readEffectiveConfig(): Promise<SakiConfigResponse>;
  persistCopilotToken(gitHubToken: string): Promise<void>;
}

export let copilotConfigHost: CopilotConfigHost | null = null;

export function registerCopilotConfigHost(host: CopilotConfigHost): void {
  copilotConfigHost = host;
}

export function requireCopilotConfigHost(): CopilotConfigHost {
  if (!copilotConfigHost) {
    throw new RouteError("Copilot config host is not registered.", 500);
  }
  return copilotConfigHost;
}

export async function readCopilotAuthStatus(): Promise<SakiCopilotAuthStatusResponse> {
  const config = await requireCopilotConfigHost().readEffectiveConfig();
  const token = copilotTokenFromConfig(config);
  const tokenProblem = copilotTokenProblem(token);
  if (tokenProblem) {
    return {
      available: true,
      authenticated: false,
      githubAuthenticated: false,
      message: tokenProblem
    };
  }
  const result: SakiCopilotAuthStatusResponse = {
    available: false,
    authenticated: false,
    githubAuthenticated: false,
    authType: /^gh[ou]_/.test(token) ? "OAuth" : "token"
  };
  // Token-based SDK status may omit the login and only confirm a credential exists.
  // Resolve the account separately; a GitHub REST failure must not block Copilot.
  try {
    const response = await fetchWithTimeout("https://api.github.com/user", {
      headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}` }
    }, 10000);
    if (response.ok) {
      const user = await response.json() as { login?: unknown };
      const login = trimString(user.login);
      if (login) {
        result.login = login;
        result.githubAuthenticated = true;
      }
    }
  } catch {
    // Account metadata is optional; the model endpoint below validates Copilot access.
  }
  try {
    const client = await getCopilotClient(token);
    result.available = true;
    const status = await client.getAuthStatus();
    if (status.authType) result.authType = status.authType;
    if (status.host) result.host = status.host;
    if (status.login) result.login = status.login;
    if (!status.isAuthenticated) {
      return { ...result, message: copilotErrorMessage(new Error(status.statusMessage || "Copilot 尚未认证，请重新登录 GitHub。"), token) };
    }
    const models = await client.listModels();
    if (!models.some((model) => copilotModelOptionFromInfo(model))) {
      return { ...result, message: "Copilot 没有可用模型，请检查 Copilot 许可和模型访问策略。" };
    }
    return {
      ...result,
      authenticated: true,
      githubAuthenticated: true,
      message: "Copilot 模型接口验证通过。"
    };
  } catch (error) {
    return {
      ...result,
      message: copilotErrorMessage(error, token)
    };
  }
}

export async function persistCopilotToken(gitHubToken: string): Promise<void> {
  await requireCopilotConfigHost().persistCopilotToken(gitHubToken);
  await resetCopilotClient();
}

export async function saveCopilotToken(gitHubToken: string): Promise<SakiCopilotLoginResponse> {
  const token = trimString(gitHubToken);
  await persistCopilotToken(token);
  copilotDeviceLoginSession = null;
  copilotLoginState = {
    status: "completed",
    command: "GitHub Token",
    finishedAt: new Date().toISOString(),
    message: token ? `GitHub Token 已保存。${copilotTokenProblem(token) ? ` ${copilotTokenProblem(token)}` : ""}` : "GitHub Token 已清除。"
  };
  return copilotLoginState;
}

export function copilotPromptFromMessages(input: SakiChatRequest, prompt: string): string {
  const conversation = currentAgentTurnConversation();
  if (conversation?.messages.length) {
    return serializeTurnMessagesForPrompt(conversation);
  }
  const messages = buildDirectMessages(input, prompt);
  return messages
    .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
    .join("\n\n");
}

export function copilotMessageOptions(input: SakiChatRequest, prompt: string): MessageOptions {
  const images = imageAttachments(input);
  if (images.length === 0) {
    return { prompt };
  }
  return {
    prompt,
    attachments: images.map((image, index) => ({
      type: "blob" as const,
      data: image.base64,
      mimeType: image.mimeType,
      displayName: `attachment-${index + 1}`
    }))
  };
}

export function copilotSessionConfig(config: SakiConfigResponse, streaming: boolean, tools?: Tool[]): SessionConfig {
  return {
    clientName: "Saki Panel",
    model: requireChatModel(config, "copilot"),
    enableConfigDiscovery: false,
    availableTools: tools?.map((tool) => tool.name) ?? [],
    ...(tools ? { tools } : {}),
    streaming,
    systemMessage: tools ? {
      mode: "customize",
      sections: { environment_context: { action: "remove" }, custom_instructions: { action: "remove" } },
      content: currentAgentTurnConversation()?.systemPrompt ?? agentSystemPromptForConfig(config)
    } : { content: buildDirectSystemPrompt(config) },
    infiniteSessions: {
      enabled: false
    },
    onPermissionRequest: denyCopilotToolUse
  };
}

export async function createCopilotSession(config: SakiConfigResponse, streaming: boolean, tools?: Tool[]) {
  const client = await getCopilotClient(copilotTokenFromConfig(config, true));
  return client.createSession(copilotSessionConfig(config, streaming, tools));
}

export async function callCopilotSdkModel(config: SakiConfigResponse, input: SakiChatRequest, prompt: string): Promise<string> {
  let session: Awaited<ReturnType<typeof createCopilotSession>> | null = null;
  try {
    session = await createCopilotSession(config, false);
    const response = await session.sendAndWait(
      copilotMessageOptions(input, copilotPromptFromMessages(input, prompt)),
      config.requestTimeoutMs
    );
    const text = stripThinking(response?.data.content ?? "");
    if (!text) throw new RouteError("GitHub Copilot returned an empty response.", 502);
    return text;
  } catch (error) {
    if (error instanceof RouteError) throw error;
    throw new RouteError(copilotErrorMessage(error, copilotTokenFromConfig(config, true)), 502);
  } finally {
    if (session) {
      await session.disconnect().catch(() => undefined);
    }
  }
}

export async function callCopilotSdkModelStream(
  config: SakiConfigResponse,
  input: SakiChatRequest,
  prompt: string,
  onDelta: (text: string) => void,
  onThinking?: (text: string) => void
): Promise<string> {
  let session: Awaited<ReturnType<typeof createCopilotSession>> | null = null;
  let unsubscribe: (() => void) | null = null;
  const state = createStreamingTextState();
  try {
    session = await createCopilotSession(config, true);
    unsubscribe = session.on("assistant.message_delta", (event) => {
      pushStreamingTextDelta(state, event.data.deltaContent, onDelta, onThinking);
    });
    const response = await session.sendAndWait(
      copilotMessageOptions(input, copilotPromptFromMessages(input, prompt)),
      config.requestTimeoutMs
    );
    const text = stripThinking(response?.data.content ?? state.raw);
    if (!text) throw new RouteError("GitHub Copilot returned an empty response.", 502);
    return text;
  } catch (error) {
    if (error instanceof RouteError) throw error;
    throw new RouteError(copilotErrorMessage(error, copilotTokenFromConfig(config, true)), 502);
  } finally {
    if (unsubscribe) unsubscribe();
    if (session) {
      await session.disconnect().catch(() => undefined);
    }
  }
}

export async function callCopilotSdkAgentTurn(
  config: SakiConfigResponse,
  input: SakiChatRequest,
  prompt: string,
  onDelta?: (text: string) => void,
  onThinking?: (text: string) => void
): Promise<SakiModelToolTurn> {
  try {
    return await requestCopilotAgentTurn(
      (tools) => createCopilotSession(config, Boolean(onDelta), tools),
      copilotMessageOptions(input, copilotPromptFromMessages(input, prompt)),
      config.requestTimeoutMs,
      onDelta,
      onThinking
    );
  } catch (error) {
    if (error instanceof RouteError || (error instanceof Error && error.name === "AbortError")) throw error;
    throw new RouteError(copilotErrorMessage(error, copilotTokenFromConfig(config, true)), 502);
  }
}

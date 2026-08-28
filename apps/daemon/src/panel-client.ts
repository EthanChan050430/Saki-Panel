import * as http from "node:http";
import * as https from "node:https";
import type {
  DaemonEventResponse,
  DaemonInstanceStatusEvent,
  HeartbeatRequest,
  HeartbeatResponse,
  RegisterDaemonResponse
} from "@webops/shared";
import { daemonConfig } from "./config.js";
import { clearIdentity, readIdentity, writeIdentity, type DaemonIdentity } from "./identity.js";
import { collectMetrics } from "./metrics.js";
import { applyRestartLeases, instanceManager, type InstanceStatusPush } from "./instance-manager.js";

type DaemonHeartbeatRequest = HeartbeatRequest & {
  host: string;
  port: number;
  protocol: string;
};

interface PanelHttpResponse {
  statusCode: number;
  statusMessage: string;
  body: string;
}

function postJsonRaw(path: string, body: unknown, headers: Record<string, string> = {}): Promise<PanelHttpResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, daemonConfig.panelUrl);
    const requestBody = JSON.stringify(body);
    const requestHeaders: http.OutgoingHttpHeaders = {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(requestBody),
      ...headers
    };
    const requestOptions: https.RequestOptions = {
      method: "POST",
      hostname: url.hostname,
      port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
      path: `${url.pathname}${url.search}`,
      headers: requestHeaders,
      timeout: 10000,
      ...(url.protocol === "https:" ? { rejectUnauthorized: false } : {})
    };

    const request = (url.protocol === "https:" ? https : http).request(requestOptions, (response) => {
      response.setEncoding("utf8");
      let responseBody = "";
      response.on("data", (chunk: string) => {
        responseBody += chunk;
      });
      response.on("end", () => {
        resolve({
          statusCode: response.statusCode ?? 0,
          statusMessage: response.statusMessage ?? "",
          body: responseBody
        });
      });
    });

    request.on("timeout", () => {
      request.destroy(new Error("Panel request timed out after 10000ms"));
    });
    request.on("error", reject);
    request.write(requestBody);
    request.end();
  });
}

async function postJson<TResponse>(
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<TResponse> {
  const response = await postJsonRaw(path, body, headers);

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Panel request failed: ${response.statusCode} ${response.body || response.statusMessage}`);
  }

  return JSON.parse(response.body) as TResponse;
}

export async function registerWithPanel(): Promise<DaemonIdentity> {
  const response = await postJson<RegisterDaemonResponse>(
    "/api/daemon/register",
    {
      name: daemonConfig.name,
      host: daemonConfig.publicHost,
      port: daemonConfig.port,
      protocol: daemonConfig.protocol,
      os: daemonConfig.osName,
      arch: daemonConfig.arch,
      version: daemonConfig.version
    },
    {
      "x-registration-token": daemonConfig.registrationToken
    }
  );

  const identity = {
    nodeId: response.nodeId,
    nodeToken: response.nodeToken
  };
  await writeIdentity(identity);
  return identity;
}

async function resolveIdentity(): Promise<DaemonIdentity> {
  const identity = await readIdentity();
  return identity ?? registerWithPanel();
}

async function identityHeaders(): Promise<Record<string, string>> {
  const identity = await resolveIdentity();
  return {
    "x-node-id": identity.nodeId,
    "x-node-token": identity.nodeToken
  };
}

export async function sendHeartbeat(): Promise<void> {
  const body: DaemonHeartbeatRequest = {
    status: "ONLINE",
    host: daemonConfig.publicHost,
    port: daemonConfig.port,
    protocol: daemonConfig.protocol,
    os: daemonConfig.osName,
    arch: daemonConfig.arch,
    version: daemonConfig.version,
    metrics: await collectMetrics(),
    instances: instanceManager.listSnapshots()
  };

  const postHeartbeat = async (headers: Record<string, string>) =>
    postJson<HeartbeatResponse>("/api/daemon/heartbeat", body, headers);

  try {
    const response = await postHeartbeat(await identityHeaders());
    applyRestartLeases(response.restartLeases ?? []);
  } catch (error) {
    if (error instanceof Error && error.message.includes("401")) {
      await clearIdentity();
      await registerWithPanel();
      const response = await postHeartbeat(await identityHeaders());
      applyRestartLeases(response.restartLeases ?? []);
      return;
    }
    throw error;
  }
}

export async function sendInstanceStatusEvent(
  push: InstanceStatusPush
): Promise<{ suppressRestartUntil?: string | null } | void> {
  const event: DaemonInstanceStatusEvent = {
    type: "instance.status",
    instanceId: push.instanceId,
    status: push.status,
    exitCode: push.exitCode,
    occurredAt: new Date().toISOString(),
    logTail: push.logTail.map((line) => ({ stream: line.stream, text: line.text })),
    restart: {
      policy: push.restartPolicy,
      attempts: push.restartAttempts,
      willRetry: push.willRetryByPolicy
    }
  };

  const postEvent = async (headers: Record<string, string>) =>
    postJson<DaemonEventResponse>("/api/daemon/events", event, headers);

  try {
    const response = await postEvent(await identityHeaders());
    if (response.suppressRestartUntil) {
      applyRestartLeases([{ instanceId: push.instanceId, suppressUntil: response.suppressRestartUntil }]);
    }
    return { suppressRestartUntil: response.suppressRestartUntil ?? null };
  } catch (error) {
    if (error instanceof Error && error.message.includes("401")) {
      await clearIdentity();
      await registerWithPanel();
      const response = await postEvent(await identityHeaders());
      if (response.suppressRestartUntil) {
        applyRestartLeases([{ instanceId: push.instanceId, suppressUntil: response.suppressRestartUntil }]);
      }
      return { suppressRestartUntil: response.suppressRestartUntil ?? null };
    }
    throw error;
  }
}

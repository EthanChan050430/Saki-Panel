import type { HeartbeatRequest, RegisterDaemonResponse } from "@webops/shared";
import { daemonConfig } from "./config.js";
import { clearIdentity, readIdentity, writeIdentity, type DaemonIdentity } from "./identity.js";
import { collectMetrics } from "./metrics.js";

async function postJson<TResponse>(
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<TResponse> {
  const response = await fetch(new URL(path, daemonConfig.panelUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Panel request failed: ${response.status} ${text}`);
  }

  return (await response.json()) as TResponse;
}

export async function registerWithPanel(): Promise<DaemonIdentity> {
  const response = await postJson<RegisterDaemonResponse>(
    "/api/daemon/register",
    {
      name: daemonConfig.name,
      host: daemonConfig.host,
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

export async function sendHeartbeat(): Promise<void> {
  let identity = await resolveIdentity();
  const body: HeartbeatRequest = {
    status: "ONLINE",
    os: daemonConfig.osName,
    arch: daemonConfig.arch,
    version: daemonConfig.version,
    metrics: await collectMetrics()
  };

  try {
    await postJson(
      "/api/daemon/heartbeat",
      body,
      {
        "x-node-id": identity.nodeId,
        "x-node-token": identity.nodeToken
      }
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("401")) {
      await clearIdentity();
      identity = await registerWithPanel();
      await postJson(
        "/api/daemon/heartbeat",
        body,
        {
          "x-node-id": identity.nodeId,
          "x-node-token": identity.nodeToken
        }
      );
      return;
    }
    throw error;
  }
}


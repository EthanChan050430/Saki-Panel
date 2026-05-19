import * as http from "node:http";
import * as https from "node:https";
import type { HeartbeatRequest, RegisterDaemonResponse } from "@webops/shared";
import { daemonConfig } from "./config.js";
import { clearIdentity, readIdentity, writeIdentity, type DaemonIdentity } from "./identity.js";
import { collectMetrics } from "./metrics.js";

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

export async function sendHeartbeat(): Promise<void> {
  let identity = await resolveIdentity();
  const body: DaemonHeartbeatRequest = {
    status: "ONLINE",
    host: daemonConfig.publicHost,
    port: daemonConfig.port,
    protocol: daemonConfig.protocol,
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

import type { FastifyReply, FastifyRequest } from "fastify";
import { readIdentity } from "./identity.js";
import { hashToken, safeEqual } from "./security.js";

export async function authenticatePanelRequest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const identity = await readIdentity();
  const nodeId = request.headers["x-node-id"];
  const panelToken = request.headers["x-panel-token"];

  if (!identity || typeof nodeId !== "string" || typeof panelToken !== "string") {
    reply.code(401).send({ message: "Missing daemon credentials" });
    return;
  }

  const expectedToken = hashToken(identity.nodeToken);
  if (nodeId !== identity.nodeId || !safeEqual(panelToken, expectedToken)) {
    reply.code(401).send({ message: "Invalid daemon credentials" });
  }
}


import type { FastifyReply, FastifyRequest } from "fastify";
import { readKnownIdentities } from "./identity.js";
import { hashToken, safeEqual } from "./security.js";

export async function authenticatePanelRequest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const identities = await readKnownIdentities();
  const nodeId = request.headers["x-node-id"];
  const panelToken = request.headers["x-panel-token"];

  if (identities.length === 0 || typeof nodeId !== "string" || typeof panelToken !== "string") {
    reply.code(401).send({ message: "Missing daemon credentials" });
    return;
  }

  for (const identity of identities) {
    const expectedToken = hashToken(identity.nodeToken);
    if (nodeId === identity.nodeId && safeEqual(panelToken, expectedToken)) {
      return;
    }
  }

  reply.code(401).send({ message: "Invalid daemon credentials" });
}

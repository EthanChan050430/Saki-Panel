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

  let tokenMatched = false;
  for (const identity of identities) {
    const expectedToken = hashToken(identity.nodeToken);
    if (!safeEqual(panelToken, expectedToken)) continue;
    tokenMatched = true;
    if (nodeId === identity.nodeId) return;
  }

  // Panel node.id can drift from daemon identity.nodeId after re-pairing
  // (register UUID vs node-key `node_xxx`). The hashed token still identifies this daemon.
  if (tokenMatched) return;

  reply.code(401).send({ message: "Invalid daemon credentials" });
}

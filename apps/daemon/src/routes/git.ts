import type { FastifyInstance } from "fastify";
import type {
  InstanceGitCommitRequest,
  InstanceGitIgnoreRequest,
} from "@webops/shared";
import { authenticatePanelRequest } from "../daemon-auth.js";
import {
  commitGit,
  GitError,
  gitDiff,
  gitHistory,
  gitStatus,
  initGit,
  resolveGitRoot,
  saveGitIgnore,
} from "../git-manager.js";
export async function registerGitRoutes(app: FastifyInstance): Promise<void> {
  for (const action of [
    "status",
    "history",
    "diff",
    "init",
    "ignore",
    "commit",
  ] as const) {
    const read =
      action === "status" || action === "history" || action === "diff";
    app.route({
      method: read ? "GET" : "POST",
      url: `/api/instances/:id/git/${action}`,
      preHandler: authenticatePanelRequest,
      handler: async (request, reply) => {
        const input = (read ? request.query : request.body) as Record<
          string,
          unknown
        > | null;
        try {
          const root = await resolveGitRoot(input?.workingDirectory);
          switch (action) {
            case "status":
              return await gitStatus(root);
            case "history":
              return await gitHistory(root, input?.offset, input?.limit);
            case "diff":
              return await gitDiff(
                root,
                typeof input?.paths === "string"
                  ? JSON.parse(input.paths)
                  : input?.paths,
                input?.hash,
              );
            case "init":
              return await initGit(root);
            case "ignore":
              return await saveGitIgnore(
                root,
                input as unknown as InstanceGitIgnoreRequest,
              );
            case "commit":
              return await commitGit(
                root,
                input as unknown as InstanceGitCommitRequest,
              );
          }
        } catch (error) {
          reply.code(error instanceof GitError ? error.statusCode : 400).send({
            message: error instanceof Error ? error.message : "Git 操作失败。",
          });
        }
      },
    });
  }
}

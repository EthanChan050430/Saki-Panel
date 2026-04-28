import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { MultipartFields } from "@fastify/multipart";
import type {
  DeleteInstanceFileRequest,
  ExtractInstanceArchiveRequest,
  MakeInstanceDirectoryRequest,
  RenameInstanceFileRequest,
  UploadInstanceFileRequest,
  WriteInstanceFileRequest
} from "@webops/shared";
import { requirePermission } from "../auth.js";
import { loadVisibleInstance, type InstanceWithAccess } from "../instance-access.js";
import { writeAuditLog } from "../audit.js";
import {
  deleteDaemonInstancePath,
  downloadDaemonInstanceFile,
  extractDaemonInstanceArchive,
  listDaemonInstanceFiles,
  makeDaemonInstanceDirectory,
  readDaemonInstanceFile,
  renameDaemonInstancePath,
  uploadDaemonInstanceFile,
  writeDaemonInstanceFile
} from "../daemon-client.js";

async function loadInstance(request: FastifyRequest, id: string): Promise<InstanceWithAccess | null> {
  return loadVisibleInstance(request.user.sub, id);
}

async function sendNotFound(reply: FastifyReply): Promise<void> {
  reply.code(404).send({ message: "Instance not found" });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Daemon request failed";
}

function queryPath(request: FastifyRequest): string {
  const query = request.query as { path?: string };
  return query.path ?? "";
}

async function handleFailure(
  request: FastifyRequest,
  reply: FastifyReply,
  action: string,
  instanceId: string,
  error: unknown,
  payload?: Record<string, unknown>
): Promise<void> {
  await writeAuditLog({
    request,
    userId: request.user.sub,
    action,
    resourceType: "instance_file",
    resourceId: instanceId,
    payload: {
      ...payload,
      error: errorMessage(error)
    },
    result: "FAILURE"
  });
  reply.code(502).send({ message: errorMessage(error) });
}

export async function registerFileRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/instances/:id/files", { preHandler: requirePermission("file.view") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const instance = await loadInstance(request, id);
    if (!instance) {
      await sendNotFound(reply);
      return;
    }

    try {
      return await listDaemonInstanceFiles(instance.node, id, instance.workingDirectory, queryPath(request));
    } catch (error) {
      await handleFailure(request, reply, "file.view", id, error, { path: queryPath(request) });
    }
  });

  app.get("/api/instances/:id/files/content", { preHandler: requirePermission("file.read") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const instance = await loadInstance(request, id);
    if (!instance) {
      await sendNotFound(reply);
      return;
    }

    try {
      return await readDaemonInstanceFile(instance.node, id, instance.workingDirectory, queryPath(request));
    } catch (error) {
      await handleFailure(request, reply, "file.read", id, error, { path: queryPath(request) });
    }
  });

  app.put("/api/instances/:id/files/content", { preHandler: requirePermission("file.write") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<WriteInstanceFileRequest>;
    const instance = await loadInstance(request, id);
    if (!instance) {
      await sendNotFound(reply);
      return;
    }
    if (!body.path || body.content === undefined) {
      reply.code(400).send({ message: "path and content are required" });
      return;
    }

    try {
      const response = await writeDaemonInstanceFile(instance.node, id, instance.workingDirectory, {
        path: body.path,
        content: body.content
      });
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "file.write",
        resourceType: "instance_file",
        resourceId: id,
        payload: { path: body.path, size: Buffer.byteLength(body.content, "utf8") }
      });
      return response;
    } catch (error) {
      await handleFailure(request, reply, "file.write", id, error, { path: body.path });
    }
  });

  app.post("/api/instances/:id/files/upload", { preHandler: requirePermission("file.write") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const instance = await loadInstance(request, id);
    if (!instance) {
      await sendNotFound(reply);
      return;
    }

    const contentType = request.headers["content-type"] ?? "";

    if (contentType.includes("multipart/form-data")) {
      try {
        const data = await request.file();
        if (!data) {
          reply.code(400).send({ message: "No file uploaded" });
          return;
        }

        const fields: MultipartFields = data.fields;
        const pathField = fields.path;
        const overwriteField = fields.overwrite;
        const filePath = pathField && "value" in pathField ? String(pathField.value) : "";
        const overwrite = overwriteField && "value" in overwriteField ? String(overwriteField.value) !== "false" : true;

        if (!filePath) {
          reply.code(400).send({ message: "path is required" });
          return;
        }

        const fileBuffer = await data.toBuffer();
        const contentBase64 = fileBuffer.toString("base64");

        const response = await uploadDaemonInstanceFile(instance.node, id, instance.workingDirectory, {
          path: filePath,
          contentBase64,
          overwrite
        });
        await writeAuditLog({
          request,
          userId: request.user.sub,
          action: "file.upload",
          resourceType: "instance_file",
          resourceId: id,
          payload: { path: filePath, size: response.size }
        });
        return response;
      } catch (error) {
        await handleFailure(request, reply, "file.upload", id, error);
      }
      return;
    }

    const body = request.body as Partial<UploadInstanceFileRequest>;
    if (!body.path || body.contentBase64 === undefined) {
      reply.code(400).send({ message: "path and contentBase64 are required" });
      return;
    }

    try {
      const response = await uploadDaemonInstanceFile(instance.node, id, instance.workingDirectory, {
        path: body.path,
        contentBase64: body.contentBase64,
        overwrite: body.overwrite ?? true
      });
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "file.upload",
        resourceType: "instance_file",
        resourceId: id,
        payload: { path: body.path, size: response.size }
      });
      return response;
    } catch (error) {
      await handleFailure(request, reply, "file.upload", id, error, { path: body.path });
    }
  });

  app.get("/api/instances/:id/files/download", { preHandler: requirePermission("file.read") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const instance = await loadInstance(request, id);
    if (!instance) {
      await sendNotFound(reply);
      return;
    }

    try {
      const response = await downloadDaemonInstanceFile(instance.node, id, instance.workingDirectory, queryPath(request));
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "file.download",
        resourceType: "instance_file",
        resourceId: id,
        payload: { path: response.path, size: response.size }
      });
      return response;
    } catch (error) {
      await handleFailure(request, reply, "file.download", id, error, { path: queryPath(request) });
    }
  });

  app.post("/api/instances/:id/files/mkdir", { preHandler: requirePermission("file.write") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<MakeInstanceDirectoryRequest>;
    const instance = await loadInstance(request, id);
    if (!instance) {
      await sendNotFound(reply);
      return;
    }
    if (!body.path) {
      reply.code(400).send({ message: "path is required" });
      return;
    }

    try {
      const response = await makeDaemonInstanceDirectory(instance.node, id, instance.workingDirectory, { path: body.path });
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "file.mkdir",
        resourceType: "instance_file",
        resourceId: id,
        payload: { path: body.path }
      });
      return response;
    } catch (error) {
      await handleFailure(request, reply, "file.mkdir", id, error, { path: body.path });
    }
  });

  app.delete("/api/instances/:id/files", { preHandler: requirePermission("file.delete") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<DeleteInstanceFileRequest>;
    const instance = await loadInstance(request, id);
    if (!instance) {
      await sendNotFound(reply);
      return;
    }
    if (!body.path) {
      reply.code(400).send({ message: "path is required" });
      return;
    }

    try {
      const response = await deleteDaemonInstancePath(instance.node, id, instance.workingDirectory, { path: body.path });
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "file.delete",
        resourceType: "instance_file",
        resourceId: id,
        payload: { path: body.path }
      });
      return response;
    } catch (error) {
      await handleFailure(request, reply, "file.delete", id, error, { path: body.path });
    }
  });

  app.post("/api/instances/:id/files/rename", { preHandler: requirePermission("file.write") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<RenameInstanceFileRequest>;
    const instance = await loadInstance(request, id);
    if (!instance) {
      await sendNotFound(reply);
      return;
    }
    if (!body.fromPath || !body.toPath) {
      reply.code(400).send({ message: "fromPath and toPath are required" });
      return;
    }

    try {
      const response = await renameDaemonInstancePath(instance.node, id, instance.workingDirectory, {
        fromPath: body.fromPath,
        toPath: body.toPath
      });
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "file.rename",
        resourceType: "instance_file",
        resourceId: id,
        payload: { fromPath: body.fromPath, toPath: body.toPath }
      });
      return response;
    } catch (error) {
      await handleFailure(request, reply, "file.rename", id, error, {
        fromPath: body.fromPath,
        toPath: body.toPath
      });
    }
  });

  app.post("/api/instances/:id/files/extract", { preHandler: requirePermission("file.write") }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<ExtractInstanceArchiveRequest>;
    const instance = await loadInstance(request, id);
    if (!instance) {
      await sendNotFound(reply);
      return;
    }
    if (!body.path) {
      reply.code(400).send({ message: "path is required" });
      return;
    }

    try {
      const response = await extractDaemonInstanceArchive(instance.node, id, instance.workingDirectory, {
        path: body.path,
        ...(body.outputPath ? { outputPath: body.outputPath } : {})
      });
      await writeAuditLog({
        request,
        userId: request.user.sub,
        action: "file.extract",
        resourceType: "instance_file",
        resourceId: id,
        payload: {
          path: response.archivePath,
          outputPath: response.outputPath,
          extractedCount: response.extractedCount,
          totalBytes: response.totalBytes
        }
      });
      return response;
    } catch (error) {
      await handleFailure(request, reply, "file.extract", id, error, {
        path: body.path,
        outputPath: body.outputPath
      });
    }
  });
}

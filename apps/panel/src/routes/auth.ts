import type { FastifyInstance } from "fastify";
import type { LoginRequest, UpdateCurrentUserRequest } from "@webops/shared";
import { prisma } from "../db.js";
import { loadCurrentUser } from "../auth.js";
import { hashPassword, verifyPassword } from "../security.js";
import { writeAuditLog } from "../audit.js";
import { createLoginResponse } from "../session.js";

const loginFailures = new Map<string, { count: number; blockedUntil?: number; firstFailureAt: number }>();
const maxLoginFailures = 5;
const loginWindowMs = 10 * 60 * 1000;
const loginBlockMs = 10 * 60 * 1000;
const maxAvatarDataUrlLength = 1_000_000;

function loginKey(requestIp: string, username: string): string {
  return `${requestIp}:${username.toLowerCase()}`;
}

function loginIsBlocked(key: string): boolean {
  const state = loginFailures.get(key);
  return Boolean(state?.blockedUntil && state.blockedUntil > Date.now());
}

function recordLoginFailure(key: string): void {
  const now = Date.now();
  const current = loginFailures.get(key);
  const state =
    current && now - current.firstFailureAt <= loginWindowMs
      ? current
      : {
          count: 0,
          firstFailureAt: now
        };
  state.count += 1;
  if (state.count >= maxLoginFailures) {
    state.blockedUntil = now + loginBlockMs;
  }
  loginFailures.set(key, state);
}

function clearLoginFailures(key: string): void {
  loginFailures.delete(key);
}

function normalizeAvatarDataUrl(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new Error("Avatar must be an image data URL");
  }

  const trimmed = value.trim();
  if (trimmed.length > maxAvatarDataUrlLength) {
    throw new Error("Avatar image is too large");
  }
  if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(trimmed)) {
    throw new Error("Avatar must be a PNG, JPG, WebP or GIF data URL");
  }
  return trimmed;
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/login", async (request, reply) => {
    const body = request.body as Partial<LoginRequest>;
    if (!body.username || !body.password) {
      reply.code(400).send({ message: "Username and password are required" });
      return;
    }
    const key = loginKey(request.ip, body.username);
    if (loginIsBlocked(key)) {
      await writeAuditLog({
        request,
        action: "auth.login.rate_limited",
        resourceType: "user",
        payload: { username: body.username },
        result: "FAILURE"
      });
      reply.code(429).send({ message: "Too many failed login attempts. Try again later." });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { username: body.username }
    });

    if (!user || user.status !== "ACTIVE") {
      await writeAuditLog({
        request,
        action: "auth.login",
        resourceType: "user",
        resourceId: user?.id ?? null,
        payload: { username: body.username },
        result: "FAILURE"
      });
      recordLoginFailure(key);
      reply.code(401).send({ message: "Invalid username or password" });
      return;
    }

    const passwordOk = await verifyPassword(body.password, user.passwordHash);
    if (!passwordOk) {
      await writeAuditLog({
        request,
        userId: user.id,
        action: "auth.login",
        resourceType: "user",
        resourceId: user.id,
        result: "FAILURE"
      });
      recordLoginFailure(key);
      reply.code(401).send({ message: "Invalid username or password" });
      return;
    }
    clearLoginFailures(key);

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });

    const currentUser = await loadCurrentUser(user.id);
    if (!currentUser) {
      reply.code(500).send({ message: "Unable to load user" });
      return;
    }

    await writeAuditLog({
      request,
      userId: user.id,
      action: "auth.login",
      resourceType: "user",
      resourceId: user.id,
      result: "SUCCESS"
    });

    return createLoginResponse(app, currentUser);
  });

  app.post("/api/auth/refresh", { preHandler: app.authenticate }, async (request, reply) => {
    const currentUser = await loadCurrentUser(request.user.sub);
    if (!currentUser || currentUser.status !== "ACTIVE") {
      reply.code(401).send({ message: "Unauthorized" });
      return;
    }

    return createLoginResponse(app, currentUser);
  });

  app.get("/api/auth/me", { preHandler: app.authenticate }, async (request, reply) => {
    const user = await loadCurrentUser(request.user.sub);
    if (!user || user.status !== "ACTIVE") {
      reply.code(401).send({ message: "Unauthorized" });
      return;
    }
    return user;
  });

  app.put("/api/auth/profile", { preHandler: app.authenticate }, async (request, reply) => {
    const body = request.body as Partial<UpdateCurrentUserRequest>;
    const existing = await prisma.user.findUnique({ where: { id: request.user.sub } });
    if (!existing || existing.status !== "ACTIVE") {
      reply.code(401).send({ message: "Unauthorized" });
      return;
    }

    const data: {
      displayName?: string;
      avatarDataUrl?: string | null;
      passwordHash?: string;
    } = {};

    if (body.displayName !== undefined) {
      const displayName = body.displayName.trim();
      if (!displayName) {
        reply.code(400).send({ message: "Display name is required" });
        return;
      }
      data.displayName = displayName;
    }

    let avatarChanged = false;
    try {
      const avatarDataUrl = normalizeAvatarDataUrl(body.avatarDataUrl);
      if (avatarDataUrl !== undefined) {
        data.avatarDataUrl = avatarDataUrl;
        avatarChanged = true;
      }
    } catch (error) {
      reply.code(400).send({ message: error instanceof Error ? error.message : "Invalid avatar" });
      return;
    }

    const newPassword = body.newPassword?.trim();
    if (newPassword) {
      if (newPassword.length < 8) {
        reply.code(400).send({ message: "Password must be at least 8 characters" });
        return;
      }
      if (!body.currentPassword) {
        reply.code(400).send({ message: "Current password is required" });
        return;
      }
      const passwordOk = await verifyPassword(body.currentPassword, existing.passwordHash);
      if (!passwordOk) {
        await writeAuditLog({
          request,
          userId: existing.id,
          action: "auth.profile.update",
          resourceType: "user",
          resourceId: existing.id,
          payload: { password: true },
          result: "FAILURE"
        });
        reply.code(401).send({ message: "Current password is incorrect" });
        return;
      }
      data.passwordHash = await hashPassword(newPassword);
    }

    if (Object.keys(data).length > 0) {
      await prisma.user.update({
        where: { id: existing.id },
        data
      });
      await writeAuditLog({
        request,
        userId: existing.id,
        action: "auth.profile.update",
        resourceType: "user",
        resourceId: existing.id,
        payload: {
          displayName: data.displayName !== undefined,
          avatar: avatarChanged,
          password: data.passwordHash !== undefined
        }
      });
    }

    const currentUser = await loadCurrentUser(existing.id);
    if (!currentUser) {
      reply.code(500).send({ message: "Unable to load user" });
      return;
    }
    return currentUser;
  });

  app.post("/api/auth/logout", { preHandler: app.authenticate }, async (request) => {
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "auth.logout",
      resourceType: "user",
      resourceId: request.user.sub
    });
    return { ok: true };
  });
}

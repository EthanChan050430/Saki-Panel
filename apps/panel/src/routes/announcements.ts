import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { authenticate, loadCurrentUser } from "../auth.js";
import { writeAuditLog } from "../audit.js";
import { globalEventBus } from "../global-events.js";

const levels = ["info", "warning", "critical"] as const;
const audiences = ["ALL", "USERS"] as const;
const maxTitleLength = 100;
const maxBodyLength = 10000;
const maxTargetUsers = 500;

interface AnnouncementInput {
  title?: unknown;
  body?: unknown;
  level?: unknown;
  pinned?: unknown;
  popup?: unknown;
  audience?: unknown;
  userIds?: unknown;
  startsAt?: unknown;
  expiresAt?: unknown;
}

interface ParsedAnnouncement {
  title: string;
  body: string;
  level: string;
  pinned: boolean;
  popup: boolean;
  audience: string;
  userIds: string[];
  startsAt: Date | null;
  expiresAt: Date | null;
}

type AnnouncementWithRelations = Prisma.AnnouncementGetPayload<{
  include: { targets: true; receipts: true; createdBy: { select: { username: true; displayName: true } } };
}>;

function parseDate(value: unknown, field: string): Date | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error(`${field} 格式无效`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${field} 格式无效`);
  return date;
}

function parseInput(input: AnnouncementInput | undefined): ParsedAnnouncement {
  const title = typeof input?.title === "string" ? input.title.trim() : "";
  const body = typeof input?.body === "string" ? input.body.trim() : "";
  if (!title) throw new Error("标题不能为空");
  if (title.length > maxTitleLength) throw new Error(`标题不能超过 ${maxTitleLength} 个字符`);
  if (!body) throw new Error("正文不能为空");
  if (body.length > maxBodyLength) throw new Error(`正文不能超过 ${maxBodyLength} 个字符`);

  const level = input?.level === undefined ? "info" : String(input.level);
  if (!(levels as readonly string[]).includes(level)) throw new Error("级别无效");
  const audience = input?.audience === undefined ? "ALL" : String(input.audience);
  if (!(audiences as readonly string[]).includes(audience)) throw new Error("受众无效");

  let userIds: string[] = [];
  if (audience === "USERS") {
    if (!Array.isArray(input?.userIds) || input.userIds.some((id) => typeof id !== "string")) {
      throw new Error("请选择接收用户");
    }
    userIds = [...new Set(input.userIds as string[])];
    if (userIds.length === 0) throw new Error("请至少选择一位用户");
    if (userIds.length > maxTargetUsers) throw new Error(`最多选择 ${maxTargetUsers} 位用户`);
  }

  const startsAt = parseDate(input?.startsAt, "开始时间");
  const expiresAt = parseDate(input?.expiresAt, "过期时间");
  if (startsAt && expiresAt && expiresAt <= startsAt) throw new Error("过期时间必须晚于开始时间");

  return {
    title,
    body,
    level,
    pinned: input?.pinned === true,
    popup: input?.popup === true,
    audience,
    userIds,
    startsAt,
    expiresAt
  };
}

function visibleWhere(userId: string, now: Date): Prisma.AnnouncementWhereInput {
  return {
    AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      { OR: [{ audience: "ALL" }, { targets: { some: { userId } } }] }
    ]
  };
}

function toUserView(
  row: Prisma.AnnouncementGetPayload<{
    include: {
      receipts: true;
      createdBy: { select: { username: true; displayName: true; avatarDataUrl: true } };
    };
  }>,
  userId: string
) {
  const receipt = row.receipts.find((item) => item.userId === userId);
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    level: row.level,
    pinned: row.pinned,
    popup: row.popup,
    startsAt: row.startsAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdByName: row.createdBy?.displayName || row.createdBy?.username || null,
    createdByAvatarDataUrl: row.createdBy?.avatarDataUrl ?? null,
    readAt: receipt?.readAt?.toISOString() ?? null,
    popupShownAt: receipt?.popupShownAt?.toISOString() ?? null
  };
}

function toManageView(row: AnnouncementWithRelations) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    level: row.level,
    pinned: row.pinned,
    popup: row.popup,
    audience: row.audience,
    userIds: row.targets.map((target) => target.userId),
    startsAt: row.startsAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdByName: row.createdBy?.displayName || row.createdBy?.username || null,
    readCount: row.receipts.filter((receipt) => receipt.readAt).length,
    popupShownCount: row.receipts.filter((receipt) => receipt.popupShownAt).length
  };
}

const manageInclude = {
  targets: true,
  receipts: true,
  createdBy: { select: { username: true, displayName: true } }
} satisfies Prisma.AnnouncementInclude;

async function requireAnnouncementAdmin(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  await authenticate(request, reply);
  if (reply.sent) return false;
  const user = await loadCurrentUser(request.user.sub);
  if (!user || user.status !== "ACTIVE" || !user.isAdmin) {
    reply.code(403).send({ message: "仅管理员可管理公告" });
    return false;
  }
  return true;
}

function notifyChanged(
  payload: { id: string; popup: boolean; deleted?: boolean },
  audience: string,
  userIds: Iterable<string>
): void {
  if (audience === "ALL") {
    globalEventBus.broadcast("announcement.changed", payload);
  } else {
    globalEventBus.sendToUsers("announcement.changed", payload, userIds);
  }
}

export async function registerAnnouncementRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/announcements", { preHandler: authenticate }, async (request) => {
    const userId = request.user.sub;
    const rows = await prisma.announcement.findMany({
      where: visibleWhere(userId, new Date()),
      include: {
        receipts: { where: { userId } },
        createdBy: { select: { username: true, displayName: true, avatarDataUrl: true } }
      },
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      take: 100
    });
    return rows.map((row) => toUserView(row, userId));
  });

  app.post("/api/announcements/:id/ack", { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user.sub;
    const { id } = request.params as { id: string };
    const body = request.body as { popupShown?: unknown; read?: unknown } | undefined;
    const visible = await prisma.announcement.findFirst({
      where: { AND: [{ id }, visibleWhere(userId, new Date())] },
      select: { id: true }
    });
    if (!visible) {
      reply.code(404).send({ message: "公告不存在" });
      return;
    }
    const now = new Date();
    const existing = await prisma.announcementReceipt.findUnique({
      where: { announcementId_userId: { announcementId: id, userId } }
    });
    const popupShownAt = existing?.popupShownAt ?? (body?.popupShown === true ? now : null);
    const readAt = existing?.readAt ?? (body?.read === true ? now : null);
    await prisma.announcementReceipt.upsert({
      where: { announcementId_userId: { announcementId: id, userId } },
      create: { announcementId: id, userId, popupShownAt, readAt },
      update: {
        ...(body?.popupShown === true && !existing?.popupShownAt ? { popupShownAt: now } : {}),
        ...(body?.read === true && !existing?.readAt ? { readAt: now } : {})
      }
    });
    return { ok: true };
  });

  app.get(
    "/api/announcements/manage",
    { preHandler: requireAnnouncementAdmin },
    async () => {
      const rows = await prisma.announcement.findMany({
        include: manageInclude,
        orderBy: [{ createdAt: "desc" }],
        take: 200
      });
      return rows.map(toManageView);
    }
  );

  app.get(
    "/api/announcements/audience-users",
    { preHandler: requireAnnouncementAdmin },
    async () => {
      const users = await prisma.user.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, username: true, displayName: true },
        orderBy: { username: "asc" }
      });
      return users;
    }
  );

  app.post("/api/announcements", { preHandler: requireAnnouncementAdmin }, async (request, reply) => {
    let parsed: ParsedAnnouncement;
    try {
      parsed = parseInput(request.body as AnnouncementInput | undefined);
    } catch (error) {
      reply.code(400).send({ message: (error as Error).message });
      return;
    }
    if (parsed.audience === "USERS") {
      const count = await prisma.user.count({ where: { id: { in: parsed.userIds } } });
      if (count !== parsed.userIds.length) {
        reply.code(400).send({ message: "所选用户中包含不存在的用户" });
        return;
      }
    }
    const created = await prisma.announcement.create({
      data: {
        title: parsed.title,
        body: parsed.body,
        level: parsed.level,
        pinned: parsed.pinned,
        popup: parsed.popup,
        audience: parsed.audience,
        startsAt: parsed.startsAt,
        expiresAt: parsed.expiresAt,
        createdById: request.user.sub,
        targets: { create: parsed.userIds.map((userId) => ({ userId })) }
      },
      include: manageInclude
    });
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "announcement.create",
      resourceType: "announcement",
      resourceId: created.id,
      payload: { title: created.title, popup: created.popup, audience: created.audience, userCount: parsed.userIds.length }
    });
    notifyChanged({ id: created.id, popup: created.popup }, created.audience, parsed.userIds);
    return toManageView(created);
  });

  app.put("/api/announcements/:id", { preHandler: requireAnnouncementAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.announcement.findUnique({ where: { id }, include: { targets: true } });
    if (!existing) {
      reply.code(404).send({ message: "公告不存在" });
      return;
    }
    let parsed: ParsedAnnouncement;
    try {
      parsed = parseInput(request.body as AnnouncementInput | undefined);
    } catch (error) {
      reply.code(400).send({ message: (error as Error).message });
      return;
    }
    if (parsed.audience === "USERS") {
      const count = await prisma.user.count({ where: { id: { in: parsed.userIds } } });
      if (count !== parsed.userIds.length) {
        reply.code(400).send({ message: "所选用户中包含不存在的用户" });
        return;
      }
    }
    const [, updated] = await prisma.$transaction([
      prisma.announcementTarget.deleteMany({ where: { announcementId: id } }),
      prisma.announcement.update({
        where: { id },
        data: {
          title: parsed.title,
          body: parsed.body,
          level: parsed.level,
          pinned: parsed.pinned,
          popup: parsed.popup,
          audience: parsed.audience,
          startsAt: parsed.startsAt,
          expiresAt: parsed.expiresAt,
          targets: { create: parsed.userIds.map((userId) => ({ userId })) }
        },
        include: manageInclude
      })
    ]);
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "announcement.update",
      resourceType: "announcement",
      resourceId: id,
      payload: { title: updated.title, popup: updated.popup, audience: updated.audience, userCount: parsed.userIds.length }
    });
    const affected = new Set([...existing.targets.map((target) => target.userId), ...parsed.userIds]);
    const audience = existing.audience === "ALL" || updated.audience === "ALL" ? "ALL" : "USERS";
    notifyChanged({ id, popup: updated.popup }, audience, affected);
    return toManageView(updated);
  });

  app.delete("/api/announcements/:id", { preHandler: requireAnnouncementAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.announcement.findUnique({ where: { id }, include: { targets: true } });
    if (!existing) {
      reply.code(404).send({ message: "公告不存在" });
      return;
    }
    await prisma.announcement.delete({ where: { id } });
    await writeAuditLog({
      request,
      userId: request.user.sub,
      action: "announcement.delete",
      resourceType: "announcement",
      resourceId: id,
      payload: { title: existing.title }
    });
    notifyChanged(
      { id, popup: false, deleted: true },
      existing.audience,
      existing.targets.map((target) => target.userId)
    );
    return { ok: true };
  });
}

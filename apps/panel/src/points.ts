import type { PointRecordItem, UpdateUserPointsRequest, UserPointsSummary } from "@webops/shared";
import { prisma } from "./db.js";

export const insufficientPointsMessage = "积分不足，无法使用 Saki。请联系管理员充值后再试。";

export class InsufficientPointsError extends Error {
  readonly statusCode = 402;

  constructor(message = insufficientPointsMessage) {
    super(message);
    this.name = "InsufficientPointsError";
  }
}

export async function assertUserHasSpendablePoints(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { points: true, unlimitedPoints: true }
  });
  if (!user) {
    throw new InsufficientPointsError("用户不存在，无法使用 Saki。");
  }
  if (user.unlimitedPoints) return;
  if ((user.points ?? 0) <= 0) {
    throw new InsufficientPointsError();
  }
}

/**
 * 换算规则：1000 Tokens = 1 积分 × 乘区倍率（向上取整，最低 1 积分；0 tokens 或 0 倍率扣 0 积分）
 */
export function calculatePointsForTokens(tokens: number, multiplier = 1): number {
  if (tokens <= 0) return 0;
  const rate = Number.isFinite(multiplier) && multiplier >= 0 ? multiplier : 1;
  if (rate === 0) return 0;
  return Math.max(1, Math.ceil((tokens / 1000) * rate));
}

/**
 * 获取指定用户的积分概览与近 14 天图表数据
 */
export async function getUserPointsSummary(userId: string): Promise<UserPointsSummary> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { points: true, unlimitedPoints: true }
  });

  if (!user) {
    throw new Error("用户不存在");
  }  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setHours(0, 0, 0, 0);
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 13);  const records = await prisma.pointRecord.findMany({
    where: {
      userId,
      createdAt: { gte: fourteenDaysAgo }
    },
    orderBy: { createdAt: "asc" }
  });  const dayMap = new Map<string, { tokens: number; points: number }>();
  for (let i = 0; i < 14; i++) {
    const d = new Date(fourteenDaysAgo);
    d.setDate(d.getDate() + i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    dayMap.set(dateStr, { tokens: 0, points: 0 });
  }

  let totalTokensUsed = 0;
  let totalPointsConsumed = 0;

  for (const rec of records) {
    const d = new Date(rec.createdAt);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const tokens = rec.tokensUsed ?? 0;
    const pointsConsumed = rec.delta < 0 ? Math.abs(rec.delta) : 0;

    totalTokensUsed += tokens;
    totalPointsConsumed += pointsConsumed;

    const current = dayMap.get(dateStr);
    if (current) {
      current.tokens += tokens;
      current.points += pointsConsumed;
    }
  }

  const dailyUsage = Array.from(dayMap.entries()).map(([date, data]) => ({
    date,
    tokens: data.tokens,
    points: data.points
  }));  const recentRaw = await prisma.pointRecord.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 30
  });

  const recentRecords: PointRecordItem[] = recentRaw.map((r) => ({
    id: r.id,
    userId: r.userId,
    delta: r.delta,
    balanceAfter: r.balanceAfter,
    type: r.type,
    tokensUsed: r.tokensUsed,
    description: r.description,
    createdAt: r.createdAt.toISOString()
  }));

  return {
    points: user.points,
    unlimitedPoints: Boolean(user.unlimitedPoints),
    totalTokensUsed,
    totalPointsConsumed,
    dailyUsage,
    recentRecords
  };
}

/**
 * 记录 Agent 调用的 Token 与扣减积分（支持模型乘区倍率）
 */
export async function recordAgentTokenUsage(
  userId: string,
  tokensUsed: number,
  description = "Agent 任务执行",
  multiplier = 1
): Promise<{
  tokensUsed: number;
  pointsUsed: number;
  isUnlimited: boolean;
  remainingPoints: number;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { points: true, unlimitedPoints: true }
  });

  if (!user) {
    return { tokensUsed, pointsUsed: 0, isUnlimited: false, remainingPoints: 0 };
  }

  const billedTokens = Math.max(0, Math.round(tokensUsed));
  const isUnlimited = Boolean(user.unlimitedPoints);
  const rate = Number.isFinite(multiplier) && multiplier >= 0 ? multiplier : 1;
  const pointsToDeduct = isUnlimited ? 0 : calculatePointsForTokens(billedTokens, rate);

  return await prisma.$transaction(async (tx) => {
    let nextBalance = user.points;
    if (!isUnlimited && pointsToDeduct > 0) {
      nextBalance = Math.max(0, user.points - pointsToDeduct);
      await tx.user.update({
        where: { id: userId },
        data: { points: nextBalance }
      });
    }

    const rateDesc = rate !== 1 ? ` [${rate}x 乘区]` : "";
    const recordDesc = isUnlimited ? `${description}${rateDesc} (无限积分)` : `${description}${rateDesc}`;

    await tx.pointRecord.create({
      data: {
        userId,
        delta: isUnlimited ? 0 : -pointsToDeduct,
        balanceAfter: isUnlimited ? null : nextBalance,
        type: "agent_consume",
        tokensUsed: billedTokens,
        description: recordDesc
      }
    });

    return {
      tokensUsed: billedTokens,
      pointsUsed: pointsToDeduct,
      isUnlimited,
      remainingPoints: nextBalance
    };
  });
}

/**
 * 管理员操作用户积分
 */
export async function adminUpdateUserPoints(
  targetUserId: string,
  operatorName: string,
  input: UpdateUserPointsRequest
): Promise<{ points: number; unlimitedPoints: boolean }> {
  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { points: true, unlimitedPoints: true, username: true }
  });

  if (!targetUser) {
    throw new Error("目标用户不存在");
  }

  return await prisma.$transaction(async (tx) => {
    let nextPoints = targetUser.points;
    let nextUnlimited = Boolean(targetUser.unlimitedPoints);
    let delta = 0;
    let type = "admin_adjust";
    let desc = input.note || `管理员 ${operatorName} 调整积分`;

    if (input.action === "set_unlimited") {
      nextUnlimited = Boolean(input.unlimited);
      type = "admin_unlimited";
      desc = input.note || `管理员 ${operatorName} ${nextUnlimited ? "开启" : "关闭"}了无限积分`;
      await tx.user.update({
        where: { id: targetUserId },
        data: { unlimitedPoints: nextUnlimited }
      });
    } else if (input.action === "set") {
      const targetAmount = Math.max(0, Math.round(input.amount ?? 0));
      delta = targetAmount - targetUser.points;
      nextPoints = targetAmount;
      type = "admin_set";
      desc = input.note || `管理员 ${operatorName} 将积分设置为 ${targetAmount}`;
      await tx.user.update({
        where: { id: targetUserId },
        data: { points: targetAmount }
      });
    } else if (input.action === "adjust") {
      const amount = Math.round(input.amount ?? 0);
      delta = amount;
      nextPoints = Math.max(0, targetUser.points + amount);
      type = "admin_adjust";
      desc = input.note || `管理员 ${operatorName} ${amount >= 0 ? `增加 ${amount}` : `扣除 ${Math.abs(amount)}`} 积分`;
      await tx.user.update({
        where: { id: targetUserId },
        data: { points: nextPoints }
      });
    }

    await tx.pointRecord.create({
      data: {
        userId: targetUserId,
        delta,
        balanceAfter: nextUnlimited ? null : nextPoints,
        type,
        description: desc
      }
    });

    return {
      points: nextPoints,
      unlimitedPoints: nextUnlimited
    };
  });
}

/**
 * 获取指定用户的积分记录列表
 */
export async function getTargetUserPointRecords(targetUserId: string, take = 50): Promise<PointRecordItem[]> {
  const records = await prisma.pointRecord.findMany({
    where: { userId: targetUserId },
    orderBy: { createdAt: "desc" },
    take
  });

  return records.map((r) => ({
    id: r.id,
    userId: r.userId,
    delta: r.delta,
    balanceAfter: r.balanceAfter,
    type: r.type,
    tokensUsed: r.tokensUsed,
    description: r.description,
    createdAt: r.createdAt.toISOString()
  }));
}

/**
 * 消费用户积分（如投喂食物、购买道具等）
 */
export async function consumeUserPoints(
  userId: string,
  pointsToDeduct: number,
  description = "投喂 Saki"
): Promise<{ points: number; unlimitedPoints: boolean }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { points: true, unlimitedPoints: true }
  });

  if (!user) {
    throw new Error("用户不存在");
  }

  const cost = Math.max(0, Math.round(pointsToDeduct));
  const isUnlimited = Boolean(user.unlimitedPoints);

  if (!isUnlimited && user.points < cost) {
    throw new InsufficientPointsError("当前 Saki 积分不足");
  }

  return await prisma.$transaction(async (tx) => {
    let nextBalance = user.points;
    if (!isUnlimited && cost > 0) {
      nextBalance = Math.max(0, user.points - cost);
      await tx.user.update({
        where: { id: userId },
        data: { points: nextBalance }
      });
    }

    await tx.pointRecord.create({
      data: {
        userId,
        delta: isUnlimited ? 0 : -cost,
        balanceAfter: isUnlimited ? null : nextBalance,
        type: "saki_feed",
        description: isUnlimited ? `${description} (无限积分)` : description
      }
    });

    return {
      points: nextBalance,
      unlimitedPoints: isUnlimited
    };
  });
}


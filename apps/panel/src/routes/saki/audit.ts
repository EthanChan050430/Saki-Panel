import type { AuditLogEntry } from "@webops/shared";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { trimString, type OperationLogWithUser } from "./types.js";

function classifyDiagnostic(source: string): string[] {
  const text = source.toLowerCase();
  const diagnostics: string[] = [];
  if (/eaddrinuse|address already in use|port .*in use/.test(text)) {
    diagnostics.push("端口已被占用，先确认实例配置的端口或停止占用进程。");
  }
  if (/cannot find module|module_not_found|err_module_not_found/.test(text)) {
    diagnostics.push("依赖或启动目录不对，优先在工作目录执行安装命令并检查 package.json。");
  }
  if (/enoent|no such file|not found/.test(text)) {
    diagnostics.push("路径或文件不存在，检查工作目录、启动脚本路径和大小写。");
  }
  if (/eacces|permission denied|access is denied/.test(text)) {
    diagnostics.push("权限不足，检查文件权限或运行用户。");
  }
  if (/syntaxerror|typeerror|referenceerror/.test(text)) {
    diagnostics.push("运行时代码错误，定位堆栈顶部的源文件和行号后再改。");
  }
  if (/invalid character|u\+fffc|u\+fffd|object replacement|replacement character/.test(text)) {
    diagnostics.push("源文件里混入了不可见或损坏字符，优先检查报错行并用纯 UTF-8 文本重新写入该行。");
  }
  if (/connection refused|econnrefused|timeout|timed out/.test(text)) {
    diagnostics.push("依赖服务不可达，检查目标服务是否启动、端口是否正确。");
  }
  return diagnostics;
}

function auditActionHints(query: string): string[] {
  const text = query.toLowerCase();
  const hints: string[] = [];
  const add = (...actions: string[]) => hints.push(...actions);

  if (/登录|login|auth|认证/.test(text)) add("auth.login", "auth.login.rate_limited", "auth.logout");
  if (/退出|logout/.test(text)) add("auth.logout");
  if (/限流|rate|blocked|拦截/.test(text)) add("auth.login.rate_limited");
  if (/终端|控制台|输入|terminal|console|stdin|命令|command/.test(text)) add("terminal.input", "instance.logs");
  if (/实例|instance|启动|停止|重启|强杀|kill|start|stop|restart/.test(text)) {
    add("instance.create", "instance.start", "instance.stop", "instance.restart", "instance.kill", "instance.update", "instance.delete");
  }
  if (/文件|file|上传|下载|删除|目录|写入|read|write|upload|download/.test(text)) {
    add("file.read", "file.write", "file.upload", "file.download", "file.delete", "file.mkdir", "file.rename");
  }
  if (/任务|task|计划|定时|cron/.test(text)) add("task.create", "task.update", "task.delete", "task.run");
  if (/用户|user|角色|role|权限|permission/.test(text)) add("user.create", "user.update", "role.permissions.update");
  if (/节点|node|daemon/.test(text)) add("node.create", "node.update", "node.delete", "node.test", "daemon.register");
  if (/模板|template/.test(text)) add("template.create");
  if (/saki|模型|model/.test(text)) add("saki.chat", "saki.config.update", "saki.models.detect");

  return [...new Set(hints)];
}

function auditResourceHints(query: string): string[] {
  const text = query.toLowerCase();
  const hints: string[] = [];
  if (/登录|login|auth|用户|user/.test(text)) hints.push("user");
  if (/实例|instance|终端|控制台|terminal|console|stdin/.test(text)) hints.push("instance", "terminal");
  if (/文件|file|目录/.test(text)) hints.push("file");
  if (/任务|task|计划/.test(text)) hints.push("task");
  if (/节点|node|daemon/.test(text)) hints.push("node", "daemon");
  if (/模板|template/.test(text)) hints.push("template");
  if (/角色|role|权限/.test(text)) hints.push("role");
  if (/saki|模型/.test(text)) hints.push("saki");
  return [...new Set(hints)];
}

function auditResultHint(query: string): "SUCCESS" | "FAILURE" | null {
  const text = query.toLowerCase();
  if (/失败|异常|错误|失败的|fail|failure|error|denied|blocked/.test(text)) return "FAILURE";
  if (/成功|正常|success|ok/.test(text)) return "SUCCESS";
  return null;
}

function auditSearchTokens(query: string): string[] {
  return query
    .split(/[,\s，。；;:：/\\|]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && token.length <= 80)
    .slice(0, 8);
}

function mapAuditLogEntry(log: OperationLogWithUser): AuditLogEntry {
  return {
    id: log.id,
    userId: log.userId,
    username: log.user?.username ?? null,
    action: log.action,
    resourceType: log.resourceType,
    resourceId: log.resourceId,
    ip: log.ip,
    userAgent: log.userAgent,
    payload: log.payload,
    result: log.result,
    createdAt: log.createdAt.toISOString()
  };
}

function formatAuditSearchEntry(log: AuditLogEntry, index: number): string {
  const payload = log.payload ? log.payload.replace(/\s+/g, " ").slice(0, 700) : "(none)";
  return [
    `#${index + 1} ${log.action} | ${log.result}`,
    `time=${log.createdAt}`,
    `user=${log.username ?? log.userId ?? "system"}`,
    `resource=${log.resourceType}${log.resourceId ? `/${log.resourceId}` : ""}`,
    `ip=${log.ip ?? "-"}`,
    `payload=${payload}`
  ].join("\n");
}

export async function buildAuditSearchContext(query: string, canViewAudit: boolean): Promise<string> {
  if (!canViewAudit) {
    return "当前用户没有 audit.view 权限，Saki 不能读取审计日志。";
  }

  const search = trimString(query).slice(0, 240);
  if (!search) return "";

  const actions = auditActionHints(search);
  const resources = auditResourceHints(search);
  const result = auditResultHint(search);
  const tokens = auditSearchTokens(search);
  const orConditions: Prisma.OperationLogWhereInput[] = [];

  if (actions.length > 0) {
    orConditions.push(...actions.map((action) => ({ action })));
  }
  if (resources.length > 0) {
    orConditions.push(...resources.map((resourceType) => ({ resourceType })));
  }
  for (const token of tokens.length ? tokens : [search]) {
    orConditions.push(
      { action: { contains: token } },
      { resourceType: { contains: token } },
      { resourceId: { contains: token } },
      { ip: { contains: token } },
      { payload: { contains: token } },
      { user: { username: { contains: token } } }
    );
  }

  const where: Prisma.OperationLogWhereInput = {
    ...(result ? { result } : {}),
    ...(orConditions.length > 0 ? { OR: orConditions } : {})
  };

  const logs = await prisma.operationLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 24,
    include: { user: true }
  });

  const fallbackWhere: Prisma.OperationLogWhereInput =
    orConditions.length > 0 ? { OR: orConditions } : result ? { result } : {};
  const fallbackLogs =
    logs.length > 0
      ? []
      : await prisma.operationLog.findMany({
          where: fallbackWhere,
          orderBy: { createdAt: "desc" },
          take: 12,
          include: { user: true }
        });
  const matchedLogs = (logs.length > 0 ? logs : fallbackLogs).map(mapAuditLogEntry);
  const entries = matchedLogs.map(formatAuditSearchEntry).join("\n\n");

  return [
    `Audit log search query: ${search}`,
    `Matched audit logs: ${matchedLogs.length}`,
    logs.length === 0 && fallbackLogs.length > 0 ? "No exact match; showing recent logs for the closest inferred action/resource." : "",
    entries || "(no matching audit logs)"
  ]
    .filter(Boolean)
    .join("\n\n");
}


---
id: docker-compose-service-guardian
name: Docker Compose 服务守护
description: 对 Docker Compose 服务执行证据优先的诊断、变更、验证与回滚。
tags: [docker, compose, self-hosted, deployment, rollback]
---

# Docker Compose 服务守护

当用户要求排查、升级、重启、修复或部署 Docker Compose 服务时，先执行本 Runbook。目标是以最小影响恢复服务，并让每一次有状态变更都具备可验证的回滚点。

## 不可绕过的安全边界

- 先读后写：在执行任何 `pull`、`up`、`restart`、配置编辑或数据库迁移前，先确认 Compose 根目录、目标服务、当前状态和最近日志。
- 绝不未经明确批准执行 `docker compose down -v`、`docker system prune`、`docker volume prune`、`docker image prune -a`、删除卷、删除数据库或覆盖备份。
- 不把 `.env`、Compose 文件、日志中的密码、Token、连接串或私钥原样发送给云模型；只保留经过脱敏的键名、错误类型和必要片段。
- 不把 `latest` 当作生产回滚点。升级前必须记录当前镜像 tag 或 digest，以及当前 Compose/环境文件的检查点。
- 单个服务无法启动时，优先读取 `docker compose ps`、`docker compose logs --tail 200 <service>`、健康检查和依赖状态；不要先把整套栈 `down` 掉。

## 先确认现场

1. 在实例工作目录找 `compose.yaml`、`compose.yml`、`docker-compose.yaml` 或 `docker-compose.yml`；若有多个文件，要求用户选定或说明 `-f` 顺序。
2. 运行只读检查：`docker compose config -q`、`docker compose config --services`、`docker compose ps`，并记录项目名、服务、端口、卷、网络与 profile。
3. 对故障服务读取最近日志和健康状态，区分：配置/变量缺失、端口冲突、镜像拉取、依赖未就绪、权限、磁盘、OOM、迁移失败、应用自身异常。
4. 检查 Compose 是否定义 `healthcheck`、`restart`、命名卷和显式镜像版本；缺失时只提出补丁，不默认改写。

## 诊断顺序

1. `docker compose config -q` 失败：优先定位 YAML、变量插值或 `env_file`，不要启动任何服务。
2. 服务未运行：比较 `docker compose ps` 与日志末尾，确认退出码、依赖服务与宿主端口占用。
3. 服务运行但不可用：读取 Compose healthcheck、应用健康端点和反向代理日志；不要仅以容器 Running 判断恢复。
4. 升级后失败：先冻结变更，回到已记录的镜像 digest/Compose 检查点，再做单服务验证。
5. 数据问题：先确认最近可恢复备份、数据库版本和迁移历史；没有验证过的备份时，不自动执行破坏性迁移或清理。

## 受控变更流程

对于任何会改变运行状态的操作，按以下顺序给出行动卡并等待批准：

1. **影响范围**：哪些服务、端口、卷、网络和用户请求会受影响。
2. **前置检查**：Compose 校验结果、健康基线、可用磁盘、备份位置、当前镜像版本。
3. **变更 Diff**：Compose / `.env` 的最小 Diff；敏感值只显示键名或掩码。
4. **执行策略**：优先 `docker compose up -d --no-deps <service>` 逐服务操作；只有用户要求时才处理全栈。
5. **验证标准**：容器健康、服务端点、关键日志、依赖连通性和用户定义的业务探针。
6. **回滚路径**：恢复检查点文件、固定镜像版本、重启目标服务；说明哪些数据迁移不可自动回滚。

## 升级与回滚

- 升级前创建只包含 Compose、环境变量键名清单和镜像版本的检查点；真实凭据不得写入对话或审计明文。
- 先执行 `docker compose pull <service>`，再验证镜像来源与预期版本。大规模更新时按服务逐个进行，并在每步通过健康验证后继续。
- 如验证失败，停止扩大影响范围，按已记录版本回滚目标服务；不要在同一次失败后盲目反复 `up -d`。
- 回滚完成后重新收集状态、健康和日志，明确区分“容器已运行”与“业务已恢复”。

## 日常防护建议

- 为每个有状态服务定义备份、保留期、异地副本和定期恢复演练。
- 为每个 HTTP 服务定义健康检查；非 HTTP 服务使用端口、协议或业务命令验证，不伪造 HTTP URL。
- 将可升级镜像固定到可追溯 tag/digest；把变更、备份和验证结果沉淀到事件记录。
- Watch 默认只做证据采集和诊断。涉及镜像更新、Compose 编辑、迁移、卷和数据操作时必须人工批准。

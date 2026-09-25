# Saki Panel 按需运维包

此目录是**在线发布源**，不是 Panel 的内置资源目录。Panel 首次打开“模板”页时只读取很小的注册表；管理员或有模板创建权限的用户明确点击下载后，Panel 才会拉取对应 manifest 和所选资源，并在 `data/panel/operations-packs/` 中校验、缓存。

## 已发布的首批垂直包

- `minecraft-paper`：Paper 稳定版解析与下载器、可参数化实例模板、只诊断日志规则、世界备份与 TCP 就绪探测。
- `docker-compose-service-guardian`：Compose 预检、诊断、受控部署、验证和回滚 Runbook 与模板建议。

两者均不含服务端 JAR、Docker 镜像、Compose 项目、插件、世界、数据库、凭据或备份。

## 安全发布规则

1. 对每个 manifest 和资源写入精确的 SHA-256；发布前运行 `npm run verify:operation-packs`。
2. 更新任一资源后，先更新资源哈希，再更新 manifest 的哈希与大小，最后更新 `registry.json` 中 manifest 的哈希与大小；递增版本号。
3. 资源 URL 可以是相对 URL（相对 registry 或 manifest），也可以是 HTTPS URL。Panel 拒绝私网地址，限制下载大小，并在重定向后重新检查地址。
4. 运维包下载永远不会执行脚本、写入实例、拉取镜像或修改工作目录；执行仍由实例操作者发起和审批。

在私有部署中，把 `OPERATIONS_PACK_REGISTRY_URL` 指向你的 HTTPS 镜像或受信任内部外网发布点。请将 manifest 和资源设为不可变版本路径，避免覆盖已发布内容。

# 验证记录

日期：2026-10-23（Asia/Shanghai）。

- `node --import tsx --test apps/panel/src/routes/saki/watch-approval.test.ts apps/panel/src/routes/saki/watch-prompt.test.ts`：5 项通过。覆盖 Watch 写入审批、权限模式不能绕过 Watch、只诊断模式、普通 Agent 原有行为和健康检查地址的凭据过滤。
- `npm run build -w @webops/panel`：通过，产物中相关的三个模块用于隔离环境重测。
- `npm run check`：共享包构建及 Panel、Daemon、Web 全部类型检查通过。
- `node docs/examples/port-recovery/verify-health.mjs`：三次实际请求均为 HTTP 200，服务名和 `status` 校验通过。
- 审批前的 `service.json` 与故障配置相同；批准后只修改端口。应用源码、绑定地址和启动命令未变；源码哈希见 `source-hashes.json`。
- 请求计量和失败尝试均保存为 JSON；界面 PNG 来自真实浏览器截图。

`npm run test:watch` 已加入项目脚本和 CI，便于后续回归检查。此次是单个受控演示场景，不能代表一般故障成功率。

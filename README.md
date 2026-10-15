# FirstPoint

私人 AI 思考与表达教练。**Think clearly. Speak freely.**

根据 FirstPoint PRD v1.0 实现的 Next.js 全栈 PWA。暖色纸张、圆点语义图、桌面侧栏与移动底栏；训练记录、原文、提示等级、复述、结构证据、Memory 及其修改历史都有真实服务端持久化。

## 当前交付状态

- 本地文字工作流可直接运行：Think / Speak → 原文确认 → 单点观察 → 选核心 / 纠正语义点 → 分级提示 → 自主重述 → 隐藏提示复述 → 保存 → Growth / Memory。
- 浏览器 MediaRecorder、暂停/继续、声量、试听、时长上限、上传、ASR 原文与确认文本分离、失败重试均已实现。
- OpenAI Responses Structured Outputs / Audio Transcriptions 与 Supabase Auth / PostgreSQL 接入代码、迁移和 RLS 已提供。
- **尚未进行真实 OpenAI 或远程 Supabase 联调**：当前环境没有这些配置。本地观察不是在线 AI 的替代验收；完整 V1 的语音、真实模型质量、云端双设备同步，仍需填写配置后验收。测试中的模型响应明确属于 fixtures，不写入真实用户数据。

## 快速运行

要求 Node.js 22.13+（推荐 24 LTS）、npm。

```bash
npm ci
npm run dev
```

在仓库根目录运行，默认端口 3000。开发时无需密钥就能使用文字观察模式。界面明确显示“AI 尚未连接”，所有本地分析的分数为 N/A，不进入独立成功率，也不会升级为稳定能力假设。

本地数据库在 `.data/firstpoint.sqlite`，刷新、重启应用后保留。第一次访问创建浏览器独有的访客空间；在“偏好与设置”中注册邮箱/密码可保留访客记录，并从另一台连接同一服务器的设备登录。密码使用带随机盐的 scrypt；会话使用随机令牌、数据库哈希与 HttpOnly Cookie。本地模式没有邮件验证/密码找回，应只用于开发或私人自托管。

生产构建：

```bash
npm run build
# 仅限私人自托管的本地存储模式；应有持久磁盘和 HTTPS。
FIRSTPOINT_ALLOW_LOCAL=true npm start
```

正式公网部署使用下面的 Supabase 配置，不要依赖 serverless 临时磁盘。运行中的服务器进程不随云环境快照保留，每次新任务需重新启动。

## 连接真实 AI

以 `.env.example` 为模板，在项目根目录创建忽略 Git 的 `.env.local`，通过环境设置安全填写值。不要将密钥提交到 Git 或发到聊天。

| 配置                    | 说明                                                     |
| ----------------------- | -------------------------------------------------------- |
| `OPENAI_API_KEY`        | 常规服务端 OpenAI 密钥；不会发给浏览器                   |
| `FIRSTPOINT_OPENAI_KEY` | 同等作用的备用变量；云环境代理保留 `OPENAI_*` 名称时用它 |
| `OPENAI_TEXT_MODEL`     | 默认 `gpt-4.1-mini`；以账户实际模型权限为准              |
| `OPENAI_ASR_MODEL`      | 默认 `gpt-4o-mini-transcribe`                            |
| `MAX_AUDIO_SECONDS`     | 默认 300，服务端限制在 30–300 秒；上传上限 12 MB         |
| `MEMORY_ENABLED`        | 新空间的记忆默认开关；已有用户可在界面自行关闭           |

配置后重启。文字发往 `api.openai.com` 的 Responses API，使用 Zod strict schema、`store: false`、45 秒超时、最多一次分析重试；校验原话引用、节点引用、分数适用性。没有 API Key 时只执行标明来源的本地分句观察；配置了 Key 但服务失败时返回可重试错误，**不会悄悄降级成假 AI 成功**。

录音只有在用户点击“转写为文字”后上传，内存转发给 OpenAI，应用不将音频保存到文件或数据库。保留 `raw_asr_text` 和 `confirmed_text`，语义分析只用后者。所有音频级指标为 `unavailable`。

“快速建议 / 看示范”只在用户主动选择时开放。快速建议排除首次独立资格；看过第三级示范后记录 `answer_revealed`。每个 Session 记录已完成的模型请求数及可取得的输入/输出 tokens；不硬编码金额。失败请求可能产生供应商费用，账单以 OpenAI 控制台为准。生产部署请额外设置供应商预算和网关限流。

## Supabase、跨设备与部署

1. 在自己的 Supabase 项目中执行 `supabase/migrations/202610140001_firstpoint.sql`（PostgreSQL 15+）。迁移只应用一次。
2. 配置 `FIRSTPOINT_STORAGE=supabase`、`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`。只使用公开 anon/publishable key；此应用不需要 service role。
3. Supabase Auth 开启邮箱密码登录，配置自己域名的 Site URL 和邮件确认流程。通过应用设置注册/登录；服务端 `getUser()` 验证身份、SSR cookies 处理会话刷新。
4. 设置 `APP_ORIGIN` 为部署的准确 HTTPS origin（不带末尾斜杠），用于反向代理下的来源校验；选择支持 Node 运行时的托管方式，执行 `npm ci && npm run build`，再运行 `npm start`。
5. 确保部署可访问 `api.openai.com` 与自己的 `<project>.supabase.co`。同一账户在手机/桌面登录，完成记录后另一个设备刷新或重新获得窗口焦点即可读取。

存储选择是明确的：切换到 Supabase **不会自动上传本地私人数据**。可先导出本地 JSON 备份；当前未提供跨存储导入工具。不要直接对已有生产数据库重复执行建表迁移。

### 数据结构的实现选择

个人笔记本使用一个每用户 `workspaces` JSONB 聚合，通过带 revision 的 `save_workspace` CAS RPC 事务提交。与 SQLite 适配器具有相同的并发与删除语义，避免训练、评测、Memory 审计部分保存。不是前端 localStorage 假持久化。

`profiles`、`sessions`、`attempts`、`assessments`、`semantic_maps`、`memories`、`memory_evidence`、`memory_versions`、`skill_history` 是 `security_invoker` 关系视图；底层 `workspaces` 强制启用 RLS，每个账户只读自己的行。固定 `practice_prompts` 是带 RLS 的实体表。RPC 不接受 user_id，始终取 `auth.uid()`，拒绝匿名调用和旧 revision。所有子记录的一致性由服务端规则与聚合事务保证，关系视图本身不提供独立写入。

这是面向个人产品的存储权衡。每个聚合上限 20 MB；数据量增长或多用户运营前，应改为物理子表、分页、分布式限流与数据库作业队列。当前同进程的模型 single-flight 防止常规重复调用；跨实例并发不会重复写 attempt，但可能发生重复的供应商请求。

## 关键规则

- 首次独立资格、提示等级、示范暴露、延迟复述资格由服务端计算，忽略前端提交的伪造标记。
- 反馈本身属于后续轮次的提示。隐藏反馈不会重置历史帮助。同题/相同原文复练、快速建议、挑战旧题不进入“首次独立”分母。
- 延迟复述单独计算，至少间隔 24 小时、当前挑战未看旧答案。历史原文默认折叠；挑战评分不接收原答案。
- Growth 只统计已完成、同场景、难度 1、有效独立且来源为 OpenAI 的可用评测。同一天同任务去重；少于 5 个样本不显示百分比或趋势结论。
- Memory 初期只是带来源的观察。至少 3 个独立评测、跨 2 天和 2 个任务才升级假设；反证降低置信。冻结/纠正/删除后的记录不会静默复活。删除 Memory 不会抹掉“曾用过提示”的事实。
- 删除源 Session 会清理引用原文的记忆、审计快照和相关提示内容，并根据剩余证据重算。删除所有数据要求输入确认短语。
- 模型评测隔离个人弱点标签。第三级个性化教练最多读取 3 条相关且未冻结/争议的 Memory，提示日志记录使用的 memory IDs。

## 测试与验收

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
node scripts/verify-restart.mjs
npm audit --omit=dev --audit-level=high
```

浏览器测试默认使用 `/usr/bin/chromium`（如存在），或 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定的已安装浏览器。没有浏览器时：

```bash
PLAYWRIGHT_BROWSERS_PATH=/tmp/firstpoint-browsers npx playwright install chromium
```

浏览器下载需要放行官方 CDN。测试服务器独立使用 3100 端口及 `.data/e2e.sqlite`，强制清空 OpenAI 测试进程变量，防止测试产生线上调用。测试会用虚拟麦克风验证实际 MediaRecorder；这不等同于真人中文 ASR 质量验收。

- `tests/unit/rules.test.ts`：聚焦规则、UTF-16 证据引用、场景适用性、独立资格、Memory 升级/反证/冻结/清理、成长样本门槛。
- `tests/integration/rls.test.ts`：在 PGlite 的实际 PostgreSQL 引擎中执行原始 migration，验证跨账户/匿名读取拒绝、RPC 与 CAS。
- `tests/integration/api.test.ts`：真实 Route Handler、SQLite、鉴权；仅模拟 AI 传输，验证原始/确认转写分离、失败保存/重试、删除。
- `tests/integration/ai.test.ts`：模拟供应商传输，验证严格结构、引用校验、超时、评分隔离和原始转写；不宣称真实模型已通过。
- `tests/e2e/product.spec.ts`：真实 Chromium，Think/Speak 完整文字闭环、移动端、拒绝麦克风、实际录音暂停/继续、失败后保留音频、幂等、跨账户隔离、同服务器双端登录、记忆纠错、删除、减少动态效果。

确定性样例文本与评测对象在 `tests/fixtures.ts`；本地结构观察同样是确定性的，可无在线模型复现圆点图。浏览器测试保存桌面/手机截图到 `test-results/`。

需要真实服务和设备的最终验收见 [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)。未执行的线上验收不会以 mock 通过来替代。

## 隐私与运维

- 无第三方分析埋点、外部字体或原文日志；错误响应不泄露供应商原始错误、密钥或文本。
- 写接口要求同源和自定义请求头；所有私有查询先鉴权。服务端返回 `Cache-Control: no-store`。
- PWA service worker 只缓存公开离线说明和图标，不缓存私有 API/训练 HTML；离线时可以看说明，当前浏览器的未提交文字草稿可在重连后恢复。离线历史阅读尚未提供。
- 已提交记录存在后端；未提交文字草稿暂存在当前浏览器 localStorage。共享设备请退出并清理草稿。原始音频在离开录音页/刷新时丢失，页面会提示；不会假装已提交。
- 数据库备份也包含私人数据，应受相同访问控制。应用内删除不等于自动擦除托管供应商备份；需按自己的备份保留政策处理。
- PWA 已含 manifest、192/512px 图标、Apple touch icon 和离线 shell；图标可通过 `node scripts/generate-icons.mjs` 从仓库 SVG 再生。真实 iOS/Android 安装与麦克风表现仍需设备测试。

## 工程结构

```text
app/                     四个页面、PWA、Node API 路由
components/              应用壳、录音、训练状态交互、语义图、设置
lib/domain.ts            类型、Zod 结构化输出 schema
lib/rules.ts             聚焦 / 独立资格 / Memory / 成长规则
lib/server/              SQLite/Supabase、认证、OpenAI 编排
supabase/migrations/     可执行 PostgreSQL 迁移与 RLS
tests/                   单元、集成和浏览器测试
docs/ACCEPTANCE.md        已验证范围与待执行线上验收
```

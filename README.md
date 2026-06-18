# 机械钟表擒纵调校 API

纯后端零依赖 Node 单文件服务，使用 `data/db.json` 持久化钟表档案、调校记录和复测记录。

---

## 目录

- [环境要求](#环境要求)
- [快速开始（新机器上手）](#快速开始新机器上手)
- [项目结构](#项目结构)
- [开发启动](#开发启动)
- [端口说明](#端口说明)
- [数据隔离](#数据隔离)
- [测试流程](#测试流程)
  - [运行所有测试](#运行所有测试)
  - [详细日志输出](#详细日志输出)
  - [监听模式](#监听模式)
  - [运行单个测试文件](#运行单个测试文件)
  - [测试架构说明](#测试架构说明)
- [NPM Scripts 一览](#npm-scripts-一览)
- [认证与权限](#认证与权限)
- [内置用户](#内置用户)
- [主要接口](#主要接口)
- [环境变量](#环境变量)
- [闭环示例](#闭环示例)
- [批量导入示例](#批量导入示例)
- [师傅交接记录示例](#师傅交接记录示例)
- [复测任务改期与取消示例](#复测任务改期与取消示例)

---

## 环境要求

| 依赖 | 版本要求 | 说明 |
|---|---|---|
| Node.js | >= 18.0.0 | 测试使用 Node 内置 `node:test` 运行器，需要 Node 18+ |

检查 Node 版本：

```bash
node --version
```

---

## 快速开始（新机器上手）

在全新机器上从零开始完成启动和回归验证：

```bash
# 1. 克隆项目
git clone <repository-url>
cd zfl-21

# 2. 无需安装依赖（零依赖项目），直接启动开发服务
npm run dev

# 3. 新开一个终端，运行完整回归测试
npm test

# 4. 所有测试通过即可确认服务运行正常
```

预期结果：
- 开发服务启动后监听 `http://127.0.0.1:3021`
- 测试输出显示所有用例通过（`pass` 数 > 0，`fail` 数 = 0）

---

## 项目结构

```
zfl-21/
├── server.js                  # 单文件零依赖主服务
├── package.json               # 工程化脚本配置
├── index.html                 # 前端页面
├── data/                      # 生产数据目录（开发环境）
│   ├── db.json                # 主数据库文件
│   └── backups/               # 备份文件目录
├── test/                      # 测试目录
│   ├── index.js               # 测试统一入口
│   ├── api-smoke.test.js      # 核心 API 冒烟测试
│   ├── backup-restore.test.js # 备份恢复流程测试
│   └── helpers/
│       └── test-harness.js    # 共享测试基础设施
└── .gitignore
```

---

## 开发启动

### 方式一：使用 NPM Script（推荐）

```bash
npm run dev
```

服务启动在 `http://127.0.0.1:3021`。

### 方式二：使用原生 Node

```bash
PORT=3021 node server.js
```

### 方式三：自定义端口和数据目录

```bash
PORT=8080 DATA_DIR=./my-data node server.js
```

### 优雅关闭

服务支持 `SIGTERM` 和 `SIGINT`（Ctrl+C）信号优雅关闭：

```bash
# 查找进程并发送 SIGTERM
kill <pid>

# 或直接在终端按 Ctrl+C
```

---

## 端口说明

| 端口范围 | 用途 | 说明 |
|---|---|---|
| 3021 | 开发服务默认端口 | `npm run dev` 启动使用 |
| 13000+ | 测试隔离服务端口 | 每个测试套件自动分配不冲突的端口，从 13001 递增 |

**端口自动分配机制**：测试使用 `createTestHarness()` 创建隔离服务时，会从 13000 端口开始递增分配，确保多个测试套件并行运行时无端口冲突。

---

## 数据隔离

### 开发环境 vs 测试环境

| 环境 | 数据目录 | 说明 |
|---|---|---|
| 开发 | `./data/` | 持久化数据，重启服务不丢失 |
| 测试 | 系统临时目录 `/tmp/clock-api-test-<random>/` | 每个测试套件独立目录，测试结束自动清理 |

### 测试数据隔离保证

1. **独立临时目录**：每个测试套件通过 `os.tmpdir()` + 随机哈希创建唯一数据目录
2. **独立数据库文件**：每个测试服务使用自己的 `db.json` 和 `backups/`
3. **自动清理**：测试 `after` 钩子调用 `harness.cleanup()` 递归删除临时目录
4. **不污染生产数据**：测试进程完全不会访问 `./data/` 下的任何文件

验证测试不污染生产数据：

```bash
# 1. 记录当前数据库哈希
md5sum data/db.json

# 2. 运行完整测试
npm test

# 3. 再次检查哈希，应与运行前一致
md5sum data/db.json
```

---

## 测试流程

项目使用 **Node.js 内置测试运行器**（`node:test`），无需安装任何第三方测试框架。

### 运行所有测试

```bash
npm test
```

### 详细日志输出

查看测试过程中服务的 stdout/stderr 输出：

```bash
npm run test:verbose
```

### 监听模式

文件变更时自动重跑测试：

```bash
npm run test:watch
```

### 运行单个测试文件

```bash
# 只跑冒烟测试
node --test test/api-smoke.test.js

# 只跑备份恢复测试
node --test test/backup-restore.test.js
```

### 测试架构说明

#### 测试基础设施（test/helpers/test-harness.js）

`createTestHarness()` 封装了完整的隔离测试生命周期：

| 能力 | 说明 |
|---|---|
| **隔离服务启动** | 在独立端口（13000+）spawn 子进程启动服务 |
| **临时数据目录** | 在 `/tmp/clock-api-test-<hash>/` 创建独立 db 和 backups |
| **服务就绪检测** | 轮询 `/health` 接口直到返回 200，超时 10s |
| **自动登录** | `loginAsAdmin()` / `loginAsTechnician()` 自动获取 Bearer Token |
| **HTTP 请求封装** | `request(method, path, { headers, body })` 自动处理 JSON |
| **优雅关闭** | `SIGTERM` → 等待退出 → 超时 `SIGKILL` 兜底 |
| **资源清理** | 递归删除临时数据目录，无残留 |

#### 编写新测试用例

```javascript
const { test, before, after, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createTestHarness } = require("./helpers/test-harness");

describe("My Feature", () => {
  let harness;
  let adminToken;

  before(async () => {
    harness = await createTestHarness();
    await harness.start();
    adminToken = await harness.loginAsAdmin();
  });

  after(async () => {
    if (harness) await harness.cleanup();
  });

  test("should do something", async () => {
    const res = await harness.request("GET", "/clocks", {
      headers: harness.authHeaders(adminToken)
    });
    assert.equal(res.status, 200);
  });
});
```

#### 现有测试套件

| 测试文件 | 覆盖范围 | 用例数 |
|---|---|---|
| `test/api-smoke.test.js` | 认证、用户、钟表、调校、复测、交接、复测任务、工作流、审计日志、错误处理、数据隔离 | ~25 |
| `test/backup-restore.test.js` | 备份创建、验证、预览差异、恢复（含确认 Token）、权限控制 | 10 |

---

## NPM Scripts 一览

| 命令 | 说明 |
|---|---|
| `npm start` | 启动服务（使用默认端口 3021） |
| `npm run dev` | 开发模式启动服务（PORT=3021） |
| `npm test` | 运行所有测试套件 |
| `npm run test:verbose` | 运行所有测试，输出服务详细日志 |
| `npm run test:watch` | 监听模式运行测试 |

---

## 认证与权限

### 认证方式
所有接口（除 `/health` 和登录接口外）均需在请求头中携带 Bearer Token：

```
Authorization: Bearer <token>
```

### 登录获取Token

```bash
curl -X POST http://127.0.0.1:3021/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin"}'
```

登录成功返回：
```json
{
  "data": {
    "user": { "id": "...", "username": "admin", "name": "管理员", "role": "admin", "createdAt": "..." },
    "token": "tok_xxx",
    "expiresAt": "2026-06-17T12:00:00.000Z",
    "permissions": ["user:view", "user:create", "..."]
  },
  "message": "登录成功，请在 Authorization 头中使用 Bearer token 访问受保护接口"
}
```

**说明：**
- Token有效期：2小时，过期需重新登录
- 退出登录会立即注销Token

### 退出登录

```bash
curl -X POST http://127.0.0.1:3021/auth/logout \
  -H 'Authorization: Bearer <token>'
```

### 获取当前登录用户信息

```bash
curl http://127.0.0.1:3021/auth/me \
  -H 'Authorization: Bearer <token>'
```

### 角色与权限矩阵

| 权限项 | admin | technician |
|---|---|---|
| 用户管理（查看/创建/更新/删除） | ✅ | 仅查看 |
| 钟表管理（查看/创建/更新/删除/导入/历史） | ✅ | ✅（负责钟表） |
| 钟表分配 | ✅ | ❌ |
| 调校记录（查看/创建） | ✅ | ✅（负责钟表） |
| 复测记录（查看/创建） | ✅ | ✅（负责钟表） |
| 交接记录（查看/创建） | ✅ | ✅（负责钟表） |
| 建议（查看/创建/状态更新） | ✅ | ✅（负责钟表） |
| 复测任务（查看/创建/更新/取消） | ✅ | ✅（负责钟表） |
| 工作流（查看/操作） | ✅ | ✅（负责钟表） |
| 审计日志查看 | ✅ | ✅（负责钟表相关） |
| 备份恢复（创建/查看/验证/预览/恢复） | ✅ | ❌ |
| 健康评分规则（查看/管理） | ✅ | 仅查看 |
| 总览视图 | ✅ | ✅ |

### 认证错误码

| 错误码 | HTTP状态 | 说明 |
|---|---|---|
| `TOKEN_MISSING` | 401 | 未携带Token |
| `TOKEN_EXPIRED` | 401 | Token已过期，需重新登录 |
| `TOKEN_INVALID` | 401 | Token无效或已注销 |
| `PERMISSION_DENIED` | 403 | 无权限执行此操作 |

错误响应示例：
```json
{
  "error": "认证令牌已过期，请重新登录",
  "code": "TOKEN_EXPIRED"
}
```

---

## 内置用户

| 用户名 | 姓名 | 角色 | 说明 |
|---|---|---|---|
| `admin` | 管理员 | admin | 系统内置，拥有所有权限 |
| `zhang` | 张师傅 | technician | 普通技师 |
| `wang` | 王师傅 | technician | 普通技师 |

---

## 主要接口

- `GET /health`
- `GET /auth/me`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /users`
- `POST /users`
- `PUT /users/:id`
- `DELETE /users/:id`
- `GET /overview`
- `GET /workflow/statuses`
- `GET /clocks`
- `POST /clocks`
- `POST /clocks/import/preview`
- `POST /clocks/import`
- `GET /clocks/not-qualified`
- `GET /clocks/:id/history`
- `POST /clocks/:id/adjustments`
- `POST /clocks/:id/retests`
- `GET /clocks/:id/latest-retest`
- `GET /adjustments?clockId=`
- `GET /retests?clockId=&qualified=`
- `GET /audit-logs`
- `POST /backups`
- `GET /backups`
- （更多接口请参考 routes 列表）

---

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3021` | 服务监听端口 |
| `DATA_DIR` | `./data` | 数据目录根路径 |
| `DB_FILE` | `$DATA_DIR/db.json` | 数据库文件路径 |
| `BACKUP_DIR` | `$DATA_DIR/backups` | 备份文件目录 |
| `CONFIRMATION_TOKEN_SECRET` | - | 备份恢复确认令牌签名密钥 |
| `VERBOSE_TESTS` | - | 设置为 `1` 时测试输出服务详细日志 |

---

## 闭环示例

```bash
# 第一步：登录获取Token（管理员）
TOKEN=$(curl -s -X POST http://127.0.0.1:3021/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")

echo "Token: $TOKEN"

# 第二步：查看不合格钟表
curl http://127.0.0.1:3021/clocks/not-qualified \
  -H "Authorization: Bearer $TOKEN"

# 第三步：提交复测记录
curl -X POST http://127.0.0.1:3021/clocks/clock_demo/retests \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"dailyRateSeconds":12,"amplitude":252,"note":"复测进入目标范围"}'
```

## 批量导入示例

### 字段规范化规则

导入时会自动进行以下规范化处理：
- **编号(code)、擒纵类型(escapementType)、摆频(balanceFrequency)**：自动清理前后空格
- **targetDailyRateSeconds**：校验必须是有效数字（可省略，默认 30）
- **assignedTechnicianId**：支持用**用户ID**或**用户名**指定负责人

### 第一步：登录获取Token

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:3021/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")
```

### 第二步：预览导入结果

```bash
curl -X POST http://127.0.0.1:3021/clocks/import/preview \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "clocks": [
      {
        "code":"  CLK-1900-01  ",
        "escapementType":"  英国销轮式  ",
        "balanceFrequency":"  16000vph  ",
        "targetDailyRateSeconds":30,
        "note":"爱德华时期座钟（字段前后空格会被自动清理）",
        "assignedTechnicianId": "zhang"
      },
      {
        "code":"CLK-1890-07",
        "escapementType":"瑞士杠杆式",
        "balanceFrequency":"18000vph",
        "note":"重复编号测试"
      },
      {
        "code":"CLK-1910-05",
        "escapementType":"",
        "balanceFrequency":"21600vph",
        "note":"缺少擒纵类型"
      },
      {
        "code":"CLK-INVALID-01",
        "escapementType":"瑞士杠杆式",
        "balanceFrequency":"18000vph",
        "targetDailyRateSeconds":"not-a-number",
        "note":"targetDailyRateSeconds 不是数字"
      },
      {
        "code":"CLK-TECH-NOEXIST",
        "escapementType":"德国工字轮式",
        "balanceFrequency":"14400vph",
        "targetDailyRateSeconds":25,
        "assignedTechnicianId": "nobody",
        "note":"指定不存在的负责人用户名"
      },
      {
        "code":"CLK-1920-12",
        "escapementType":"德国工字轮式",
        "balanceFrequency":"14400vph",
        "targetDailyRateSeconds":25,
        "assignedTechnicianId": "user_tech_wang",
        "note":"用用户ID指定负责人"
      }
    ]
  }'
```

预览返回结构：
- `summary`：汇总统计（total/importable/unimportable）及全局负责人信息
- `importable`：可导入记录，每条包含：
  - `normalized`：规范化后的字段值
  - `changes`：被清理的前后空格（如有）
  - `targetDailyRateSeconds`：数字校验后的结果
  - `technician`：负责人摘要（id/username/name/role/matchedBy/source）
- `unimportable`：不可导入记录，每条包含：
  - `normalized`：规范化后的字段值
  - `reasons`：不可导入原因列表
  - `technician`：负责人解析信息（如有错误）

### 第三步：确认写入（支持全局指定负责人）

可通过顶层 `assignedTechnicianId` 为所有记录统一指定负责人（优先级低于单条记录内的指定），同样支持用户名或用户ID：

```bash
curl -X POST http://127.0.0.1:3021/clocks/import \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "assignedTechnicianId": "zhang",
    "clocks": [
      {
        "code":"  CLK-1900-01  ",
        "escapementType":"  英国销轮式  ",
        "balanceFrequency":"  16000vph  ",
        "targetDailyRateSeconds":30,
        "note":"字段空格会被自动清理"
      },
      {
        "code":"CLK-1920-12",
        "escapementType":"德国工字轮式",
        "balanceFrequency":"14400vph",
        "targetDailyRateSeconds":25,
        "assignedTechnicianId": "user_tech_wang",
        "note":"单条指定优先于全局指定（用用户ID指定王师傅）"
      }
    ]
  }'
```

正式导入返回结构：
- `summary`：汇总统计（total/created/unimportable）及全局负责人信息
- `created`：成功创建的记录，每条包含规范化结果、负责人摘要、完整钟表信息
- `unimportable`：不可导入记录，包含不可导入原因

### 第四步：验证新档案已写入

```bash
curl http://127.0.0.1:3021/clocks \
  -H "Authorization: Bearer $TOKEN"
```

## 师傅交接记录示例

### 登录获取Token（张师傅）

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:3021/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"zhang"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")
```

### 新增交接记录

为指定钟表登记交接备注、下一步处理建议和接手人：

```bash
curl -X POST http://127.0.0.1:3021/clocks/clock_demo/handovers \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "handoverNote": "机芯已拆解清洗完毕，游丝有轻微变形需注意",
    "nextStepSuggestion": "建议先调校游丝外桩，再进行走时精度测试",
    "receiver": "王师傅"
  }'
```

必填字段：`handoverNote`（交接备注）、`receiver`（接手人）
可选字段：`nextStepSuggestion`（下一步处理建议）

### 按钟表查看交接历史

查看某只钟表的所有交接记录，按时间倒序排列：

```bash
curl http://127.0.0.1:3021/clocks/clock_demo/handovers \
  -H "Authorization: Bearer $TOKEN"
```

### 查询所有交接记录（支持按钟表筛选）

```bash
# 查询所有交接记录
curl http://127.0.0.1:3021/handovers \
  -H "Authorization: Bearer $TOKEN"

# 按钟表筛选
curl "http://127.0.0.1:3021/handovers?clockId=clock_demo" \
  -H "Authorization: Bearer $TOKEN"
```

### 未登录时的错误提示

```bash
curl http://127.0.0.1:3021/clocks/nonexistent/handovers
```

返回：
```json
{
  "error": "未提供认证令牌，请在 Authorization 头中携带 Bearer token",
  "code": "TOKEN_MISSING"
}
```

## 复测任务改期与取消示例

### 登录获取Token（管理员）

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:3021/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")
```

### 改期复测任务

修改待复测任务的计划复测时间、优先级或备注。只有 **管理员** 或 **该钟表的负责人** 可以操作，且 **已完成** 或 **已取消** 的任务不能改期。

```bash
curl -X PUT http://127.0.0.1:3021/retest-tasks/retestTask_demo \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "plannedRetestAt": "2026-07-05T00:00:00.000Z",
    "priority": "high",
    "note": "客户要求提前复测，改为高优先级"
  }'
```

可修改字段（均可选，至少传一个）：
- `plannedRetestAt`：新的计划复测时间（ISO 8601）
- `priority`：优先级，`high` / `medium` / `low`
- `note`：备注

返回中包含：
- `cancelledAt`：取消时间（未取消则为 `null`）
- `cancelledBy`：取消人ID（未取消则为 `null`）
- `cancelReason`：取消原因（未取消则为 `null`）
- `canceller`：取消人详情对象（包含 `id`、`name`、`role`）

### 取消复测任务

取消一个处于 `pending` 状态的复测任务，并记录取消原因。权限规则同改期。**已完成** 或 **已取消** 的任务不能再取消。

```bash
curl -X POST http://127.0.0.1:3021/retest-tasks/retestTask_demo/cancel \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "cancelReason": "客户临时送修其他故障，复测延后安排"
  }'
```

必填字段：`cancelReason`（取消原因）

取消成功后任务的 `status` 变为 `"cancelled"`，同时写入：
- `cancelledAt`：取消时间
- `cancelledBy`：操作人ID
- `cancelReason`：取消原因
- `canceller`：操作人详情（列表接口返回）

### 查看任务列表（含取消信息）

复测任务列表（`GET /retest-tasks`）和单只钟表任务列表（`GET /clocks/:id/retest-tasks`）都会返回取消相关字段。

```bash
# 全量任务（含已取消的）
curl http://127.0.0.1:3021/retest-tasks \
  -H "Authorization: Bearer $TOKEN"

# 按状态筛选已取消的任务
curl "http://127.0.0.1:3021/retest-tasks?status=cancelled" \
  -H "Authorization: Bearer $TOKEN"
```

### 权限与状态错误

**无权限（非负责人且非管理员，使用技师Token访问其他负责人任务）：**
```json
{
  "error": "无权限操作该复测任务",
  "code": "PERMISSION_DENIED"
}
```

**对已完成任务改期/取消：**
```json
{
  "error": "已完成的复测任务不能改期",
  "code": "TASK_ALREADY_COMPLETED"
}
```

**对已取消任务改期：**
```json
{
  "error": "已取消的复测任务不能改期",
  "code": "TASK_ALREADY_CANCELLED"
}
```

**Token过期：**
```json
{
  "error": "认证令牌已过期，请重新登录",
  "code": "TOKEN_EXPIRED"
}
```

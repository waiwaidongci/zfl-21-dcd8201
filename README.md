# 机械钟表擒纵调校API

纯后端零依赖Node服务，使用 `data/db.json` 持久化钟表档案、调校记录和复测记录。

## 启动

```bash
PORT=3021 node server.js
```

## 主要接口

- `GET /health`
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

## 闭环示例

```bash
curl http://127.0.0.1:3021/clocks/not-qualified
curl -X POST http://127.0.0.1:3021/clocks/clock_demo/retests \
  -H 'Content-Type: application/json' \
  -d '{"dailyRateSeconds":12,"amplitude":252,"note":"复测进入目标范围"}'
```

## 批量导入示例

### 字段规范化规则

导入时会自动进行以下规范化处理：
- **编号(code)、擒纵类型(escapementType)、摆频(balanceFrequency)**：自动清理前后空格
- **targetDailyRateSeconds**：校验必须是有效数字（可省略，默认 30）
- **assignedTechnicianId**：支持用**用户ID**或**用户名**指定负责人

### 第一步：预览导入结果

```bash
curl -X POST http://127.0.0.1:3021/clocks/import/preview \
  -H 'Content-Type: application/json' \
  -H 'X-User-Id: user_admin_default' \
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

### 第二步：确认写入（支持全局指定负责人）

可通过顶层 `assignedTechnicianId` 为所有记录统一指定负责人（优先级低于单条记录内的指定），同样支持用户名或用户ID：

```bash
curl -X POST http://127.0.0.1:3021/clocks/import \
  -H 'Content-Type: application/json' \
  -H 'X-User-Id: user_admin_default' \
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

### 第三步：验证新档案已写入

```bash
curl http://127.0.0.1:3021/clocks -H 'X-User-Id: user_admin_default'
```

## 师傅交接记录示例

### 新增交接记录

为指定钟表登记交接备注、下一步处理建议和接手人：

```bash
curl -X POST http://127.0.0.1:3021/clocks/clock_demo/handovers \
  -H 'Content-Type: application/json' \
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
curl http://127.0.0.1:3021/clocks/clock_demo/handovers
```

### 查询所有交接记录（支持按钟表筛选）

```bash
# 查询所有交接记录
curl http://127.0.0.1:3021/handovers

# 按钟表筛选
curl http://127.0.0.1:3021/handovers?clockId=clock_demo
```

### 钟表不存在时的错误提示

```bash
curl http://127.0.0.1:3021/clocks/nonexistent/handovers
```

返回：
```json
{
  "error": "钟表不存在"
}
```

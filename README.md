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

### 第一步：预览导入结果

```bash
curl -X POST http://127.0.0.1:3021/clocks/import/preview \
  -H 'Content-Type: application/json' \
  -d '{
    "clocks": [
      {"code":"CLK-1900-01","escapementType":"英国销轮式","balanceFrequency":"16000vph","targetDailyRateSeconds":30,"note":"爱德华时期座钟"},
      {"code":"CLK-1890-07","escapementType":"瑞士杠杆式","balanceFrequency":"18000vph","note":"重复编号测试"},
      {"code":"CLK-1910-05","escapementType":"","balanceFrequency":"21600vph","note":"缺少擒纵类型"},
      {"code":"CLK-1920-12","escapementType":"德国工字轮式","balanceFrequency":"14400vph","targetDailyRateSeconds":25}
    ]
  }'
```

返回结果将包含：
- `importable`：可正常导入的档案
- `duplicates`：编号已存在的档案
- `missingFields`：缺少关键字段（code、escapementType、balanceFrequency）的档案

### 第二步：确认写入

```bash
curl -X POST http://127.0.0.1:3021/clocks/import \
  -H 'Content-Type: application/json' \
  -d '{
    "clocks": [
      {"code":"CLK-1900-01","escapementType":"英国销轮式","balanceFrequency":"16000vph","targetDailyRateSeconds":30,"note":"爱德华时期座钟"},
      {"code":"CLK-1890-07","escapementType":"瑞士杠杆式","balanceFrequency":"18000vph","note":"重复编号测试"},
      {"code":"CLK-1910-05","escapementType":"","balanceFrequency":"21600vph","note":"缺少擒纵类型"},
      {"code":"CLK-1920-12","escapementType":"德国工字轮式","balanceFrequency":"14400vph","targetDailyRateSeconds":25}
    ]
  }'
```

### 第三步：验证新档案已写入

```bash
curl http://127.0.0.1:3021/clocks
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

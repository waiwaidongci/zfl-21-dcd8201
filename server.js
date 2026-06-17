const http = require("http");
const { readFile, writeFile, mkdir, readdir, stat, unlink, rename } = require("fs/promises");
const path = require("path");

const PORT = Number(process.env.PORT || 3021);
const DB_FILE = path.join(__dirname, "data", "db.json");
const BACKUP_DIR = path.join(__dirname, "data", "backups");

const BACKUP_ERROR_CODES = {
  BACKUP_NOT_FOUND: "BACKUP_NOT_FOUND",
  JSON_CORRUPTED: "JSON_CORRUPTED",
  SCHEMA_INVALID: "SCHEMA_INVALID"
};

const DB_SCHEMA = {
  clocks: "array",
  adjustments: "array",
  retests: "array",
  handovers: "array",
  retestTasks: "array",
  suggestions: "array",
  auditLogs: "array"
};

const initialData = {
  clocks: [
    {
      id: "clock_demo",
      code: "CLK-1890-07",
      escapementType: "瑞士杠杆式",
      balanceFrequency: "18000vph",
      targetDailyRateSeconds: 20,
      note: "怀表机芯，走时偏快",
      createdAt: new Date().toISOString()
    }
  ],
  adjustments: [
    {
      id: "adjustment_demo",
      clockId: "clock_demo",
      currentDailyRateSeconds: 68,
      direction: "慢针方向",
      amount: "游丝快慢针向慢侧微调0.4格",
      note: "初次调校，先保守处理",
      createdAt: new Date().toISOString()
    }
  ],
  retests: [
    {
      id: "retest_demo",
      clockId: "clock_demo",
      adjustmentId: "adjustment_demo",
      testedAt: new Date().toISOString(),
      dailyRateSeconds: 31,
      amplitude: 248,
      qualified: false,
      note: "仍偏快，振幅尚可"
    }
  ],
  handovers: [
    {
      id: "handover_demo",
      clockId: "clock_demo",
      handoverNote: "机芯已拆解清洗完毕，游丝有轻微变形需注意",
      nextStepSuggestion: "建议先调校游丝外桩，再进行走时精度测试",
      receiver: "王师傅",
      createdAt: new Date().toISOString()
    }
  ],
  retestTasks: [
    {
      id: "retestTask_demo",
      clockId: "clock_demo",
      adjustmentId: "adjustment_demo",
      plannedRetestAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      priority: "medium",
      status: "pending",
      completedAt: null,
      completedRetestId: null,
      note: "调校后一周复测",
      createdAt: new Date().toISOString()
    }
  ],
  suggestions: [],
  auditLogs: [
    {
      id: "audit_demo",
      operationType: "clock_create",
      resourceType: "clock",
      resourceId: "clock_demo",
      clockId: "clock_demo",
      beforeSnapshot: null,
      afterSnapshot: {
        id: "clock_demo",
        code: "CLK-1890-07",
        escapementType: "瑞士杠杆式",
        balanceFrequency: "18000vph",
        targetDailyRateSeconds: 20,
        note: "怀表机芯，走时偏快"
      },
      changedFields: null,
      summary: "创建钟表档案 CLK-1890-07",
      createdAt: new Date().toISOString()
    }
  ]
};

const AUDIT_OPERATION_TYPES = {
  CLOCK_CREATE: "clock_create",
  CLOCK_UPDATE: "clock_update",
  ADJUSTMENT_CREATE: "adjustment_create",
  RETEST_CREATE: "retest_create"
};

const AUDIT_RESOURCE_TYPES = {
  CLOCK: "clock",
  ADJUSTMENT: "adjustment",
  RETEST: "retest"
};

const CLOCK_KEY_FIELDS = [
  "code",
  "escapementType",
  "balanceFrequency",
  "targetDailyRateSeconds",
  "note"
];

const routes = [
  "GET /health",
  "GET /overview",
  "GET /clocks",
  "POST /clocks",
  "PUT /clocks/:id",
  "POST /clocks/import/preview",
  "POST /clocks/import",
  "GET /clocks/not-qualified",
  "GET /clocks/:id/history",
  "GET /clocks/:id/audit-logs",
  "GET /audit-logs",
  "GET /clocks/:id/health-score",
  "POST /clocks/:id/adjustments",
  "POST /clocks/:id/retests",
  "GET /clocks/:id/latest-retest",
  "GET /clocks/:id/handovers",
  "POST /clocks/:id/handovers",
  "POST /clocks/:id/suggestions/generate",
  "POST /clocks/:id/suggestions",
  "GET /clocks/:id/suggestions",
  "GET /clocks/health-scores",
  "GET /suggestions",
  "GET /suggestions/:id",
  "GET /adjustments",
  "GET /retests",
  "GET /retest-tasks",
  "POST /clocks/:id/retest-tasks",
  "GET /clocks/:id/retest-tasks",
  "GET /handovers",
  "POST /backups",
  "GET /backups",
  "GET /backups/:id/validate",
  "POST /backups/:id/restore"
];

const HEALTH_SCORE_RULES = {
  recentRetestCount: 5,
  minRetestCount: 2,
  weights: {
    dailyRateStability: 40,
    amplitudeStability: 30,
    consecutiveQualified: 30
  },
  dailyRate: {
    excellentStdDev: 5,
    goodStdDev: 10,
    fairStdDev: 20,
    excellentScore: 40,
    goodScore: 30,
    fairScore: 20,
    poorScore: 0
  },
  amplitude: {
    excellentStdDev: 15,
    goodStdDev: 30,
    fairStdDev: 50,
    excellentScore: 30,
    goodScore: 20,
    fairScore: 10,
    poorScore: 0,
    lowAmplitudeThreshold: 200,
    highAmplitudeThreshold: 320
  },
  consecutive: {
    noneFailed: 30,
    twoFailed: 15,
    threeOrMoreFailed: 0
  },
  thresholds: {
    stable: 80,
    observe: 60
  },
  conclusions: {
    stable: "稳定",
    observe: "需观察",
    rework: "需返工",
    insufficient: "数据不足"
  }
};

const CLOCK_REQUIRED_FIELDS = ["code", "escapementType", "balanceFrequency"];

function classifyImportItems(db, items) {
  const existingCodes = new Set(db.clocks.map((c) => c.code));
  const seenInBatch = new Set();
  const importable = [];
  const duplicates = [];
  const missingFields = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const missing = CLOCK_REQUIRED_FIELDS.filter(
      (f) => item[f] === undefined || item[f] === ""
    );
    if (missing.length > 0) {
      missingFields.push({ index: i, item, missing });
      continue;
    }
    if (existingCodes.has(item.code) || seenInBatch.has(item.code)) {
      duplicates.push({ index: i, item, code: item.code });
      continue;
    }
    seenInBatch.add(item.code);
    importable.push({ index: i, item });
  }

  return { importable, duplicates, missingFields };
}

function buildClockFromItem(item) {
  return {
    id: makeId("clock"),
    code: item.code,
    escapementType: item.escapementType,
    balanceFrequency: item.balanceFrequency,
    targetDailyRateSeconds: Number(item.targetDailyRateSeconds ?? 30),
    note: item.note || "",
    createdAt: new Date().toISOString()
  };
}

async function ensureDb() {
  await mkdir(path.dirname(DB_FILE), { recursive: true });
  try {
    JSON.parse(await readFile(DB_FILE, "utf8"));
  } catch {
    await writeFile(DB_FILE, JSON.stringify(initialData, null, 2));
  }
}

async function readDb() {
  await ensureDb();
  return JSON.parse(await readFile(DB_FILE, "utf8"));
}

async function writeDb(data) {
  await writeFile(DB_FILE, JSON.stringify(data, null, 2));
}

async function ensureBackupDir() {
  await mkdir(BACKUP_DIR, { recursive: true });
}

function formatTimestamp(date) {
  const d = date || new Date();
  const pad = (n) => n.toString().padStart(2, "0");
  const ms = d.getMilliseconds().toString().padStart(3, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}_${ms}`;
}

function getBackupFilePath(backupId) {
  return path.join(BACKUP_DIR, `${backupId}.json`);
}

function validateDbSchema(data) {
  const errors = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    errors.push("根节点必须是对象");
    return errors;
  }
  for (const [key, expectedType] of Object.entries(DB_SCHEMA)) {
    if (data[key] === undefined) {
      errors.push(`缺少字段: ${key}`);
      continue;
    }
    if (expectedType === "array" && !Array.isArray(data[key])) {
      errors.push(`字段 ${key} 必须是数组`);
    }
  }
  return errors;
}

function createBackupError(code, message) {
  const error = new Error(message);
  error.status = 400;
  error.code = code;
  return error;
}

async function createBackup() {
  await ensureBackupDir();
  const db = await readDb();
  const timestamp = formatTimestamp();
  const createdAt = new Date().toISOString();
  const counts = Object.fromEntries(
    Object.entries(DB_SCHEMA).map(([key]) => [key, Array.isArray(db[key]) ? db[key].length : 0])
  );
  let backupId;
  let filePath;
  let backupData;

  for (let attempt = 0; attempt < 100; attempt++) {
    const suffix = attempt === 0 ? "" : `_${attempt}`;
    backupId = `backup_${timestamp}${suffix}`;
    filePath = getBackupFilePath(backupId);
    backupData = {
      meta: {
        id: backupId,
        createdAt,
        schemaVersion: "1.0",
        counts
      },
      data: db
    };
    try {
      await writeFile(filePath, JSON.stringify(backupData, null, 2), { flag: "wx" });
      break;
    } catch (error) {
      if (error.code !== "EEXIST" || attempt === 99) {
        throw error;
      }
    }
  }

  const fileStat = await stat(filePath);
  return {
    id: backupId,
    createdAt: backupData.meta.createdAt,
    size: fileStat.size,
    counts: backupData.meta.counts
  };
}

async function listBackups() {
  await ensureBackupDir();
  const files = await readdir(BACKUP_DIR);
  const backupFiles = files.filter((f) => f.startsWith("backup_") && f.endsWith(".json"));
  const backups = [];
  for (const file of backupFiles) {
    const filePath = path.join(BACKUP_DIR, file);
    try {
      const fileStat = await stat(filePath);
      const content = JSON.parse(await readFile(filePath, "utf8"));
      backups.push({
        id: content.meta?.id || file.replace(".json", ""),
        createdAt: content.meta?.createdAt || fileStat.birthtime.toISOString(),
        size: fileStat.size,
        counts: content.meta?.counts || null
      });
    } catch {
      backups.push({
        id: file.replace(".json", ""),
        createdAt: null,
        size: null,
        counts: null,
        corrupted: true
      });
    }
  }
  backups.sort((a, b) => {
    if (!a.createdAt) return 1;
    if (!b.createdAt) return -1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  return backups;
}

async function validateBackup(backupId) {
  await ensureBackupDir();
  const filePath = getBackupFilePath(backupId);
  let rawContent;
  try {
    rawContent = await readFile(filePath, "utf8");
  } catch {
    throw createBackupError(
      BACKUP_ERROR_CODES.BACKUP_NOT_FOUND,
      `备份不存在: ${backupId}`
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    throw createBackupError(
      BACKUP_ERROR_CODES.JSON_CORRUPTED,
      `备份文件 JSON 格式损坏: ${backupId}`
    );
  }
  if (!parsed.data) {
    throw createBackupError(
      BACKUP_ERROR_CODES.SCHEMA_INVALID,
      `备份缺少 data 字段: ${backupId}`
    );
  }
  const schemaErrors = validateDbSchema(parsed.data);
  if (schemaErrors.length > 0) {
    const error = createBackupError(
      BACKUP_ERROR_CODES.SCHEMA_INVALID,
      `备份数据结构不符合预期: ${schemaErrors.join("; ")}`
    );
    error.details = schemaErrors;
    throw error;
  }
  return {
    valid: true,
    id: backupId,
    meta: parsed.meta || null,
    counts: parsed.meta?.counts || Object.fromEntries(
      Object.entries(DB_SCHEMA).map(([key]) => [key, Array.isArray(parsed.data[key]) ? parsed.data[key].length : 0])
    )
  };
}

async function restoreBackup(backupId) {
  const validation = await validateBackup(backupId);
  const filePath = getBackupFilePath(backupId);
  const rawContent = await readFile(filePath, "utf8");
  const parsed = JSON.parse(rawContent);
  const currentDbRaw = await readFile(DB_FILE, "utf8");
  const tempBackupId = `temp_before_restore_${formatTimestamp()}`;
  const tempBackupPath = getBackupFilePath(tempBackupId);
  try {
    await writeFile(tempBackupPath, currentDbRaw);
  } catch (writeErr) {
    const error = new Error(`恢复前创建临时备份失败: ${writeErr.message}`);
    error.status = 500;
    throw error;
  }
  try {
    await writeDb(parsed.data);
    try {
      await unlink(tempBackupPath);
    } catch {
    }
    return {
      restored: true,
      backupId,
      restoredAt: new Date().toISOString(),
      counts: validation.counts
    };
  } catch (writeErr) {
    try {
      await rename(tempBackupPath, DB_FILE);
    } catch {
    }
    const error = new Error(`写入恢复数据失败，已回滚: ${writeErr.message}`);
    error.status = 500;
    throw error;
  }
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

async function parseBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("请求体必须是合法JSON");
    error.status = 400;
    throw error;
  }
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function required(body, fields) {
  const missing = fields.filter((field) => body[field] === undefined || body[field] === "");
  if (missing.length) {
    const error = new Error(`缺少字段：${missing.join(", ")}`);
    error.status = 400;
    throw error;
  }
}

function findClock(db, clockId) {
  const clock = db.clocks.find((item) => item.id === clockId);
  if (!clock) {
    const error = new Error("钟表不存在");
    error.status = 404;
    throw error;
  }
  return clock;
}

function latestRetest(db, clockId) {
  return db.retests
    .filter((item) => item.clockId === clockId)
    .sort((a, b) => new Date(b.testedAt) - new Date(a.testedAt))[0] || null;
}

function latestAdjustment(db, clockId) {
  return db.adjustments
    .filter((item) => item.clockId === clockId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
}

function listHandovers(db, clockId) {
  return db.handovers
    .filter((item) => item.clockId === clockId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function parseAdjustmentAmount(amount) {
  if (!amount) return null;
  const match = amount.match(/([\d.]+)\s*格/);
  if (match) return Number(match[1]);
  return null;
}

function calculateConservativeAmount(db, deviationSeconds, lastAdjustment) {
  const absDeviation = Math.abs(deviationSeconds);
  const lastAmount = lastAdjustment ? parseAdjustmentAmount(lastAdjustment.amount) : null;

  let conservativeFactor;
  if (absDeviation > 60) {
    conservativeFactor = 0.4;
  } else if (absDeviation > 30) {
    conservativeFactor = 0.5;
  } else if (absDeviation > 15) {
    conservativeFactor = 0.6;
  } else {
    conservativeFactor = 0.7;
  }

  let recommendedAmount;
  if (lastAmount && lastAdjustment.currentDailyRateSeconds !== undefined) {
    const lastRateBefore = lastAdjustment.currentDailyRateSeconds;
    const retestAfter = db.retests.find((r) => r.adjustmentId === lastAdjustment.id);
    if (retestAfter) {
      const actualChange = Math.abs(lastRateBefore - retestAfter.dailyRateSeconds);
      if (actualChange > 0 && lastAmount > 0) {
        const changePerUnit = actualChange / lastAmount;
        const targetChange = absDeviation * conservativeFactor;
        recommendedAmount = targetChange / changePerUnit;
      }
    }
  }

  if (!recommendedAmount) {
    if (absDeviation > 60) {
      recommendedAmount = 0.8;
    } else if (absDeviation > 30) {
      recommendedAmount = 0.5;
    } else if (absDeviation > 15) {
      recommendedAmount = 0.3;
    } else {
      recommendedAmount = 0.2;
    }
  }

  return Math.round(recommendedAmount * 10) / 10;
}

function generateRiskWarning(db, deviationSeconds, lastAdjustment, retest, clock) {
  const warnings = [];
  const absDeviation = Math.abs(deviationSeconds);

  if (absDeviation > 60) {
    warnings.push("当前偏差较大，建议分多次微调，避免单次调校过量导致反向偏差");
  }

  if (retest && retest.amplitude !== undefined) {
    if (retest.amplitude < 200) {
      warnings.push("振幅偏低，调校前请检查发条状态和传动系统润滑情况");
    } else if (retest.amplitude > 320) {
      warnings.push("振幅偏高，注意游丝是否正常，避免摆幅过大影响走时稳定性");
    }
  }

  if (lastAdjustment) {
    const retestAfter = db.retests.find((r) => r.adjustmentId === lastAdjustment.id);
    if (retestAfter) {
      const actualChange = retestAfter.dailyRateSeconds - lastAdjustment.currentDailyRateSeconds;
      const expectedDirection = lastAdjustment.direction === "慢针方向" ? -1 : 1;
      if (actualChange * expectedDirection > 0) {
        warnings.push("上次调校后日差变化方向与预期一致，可继续沿此方向微调");
      } else if (actualChange * expectedDirection < 0) {
        warnings.push("注意：上次调校后日差变化方向与预期相反，可能存在其他影响因素，建议仔细检查机芯");
      }
    }
  }

  const consecutiveSameDirection = db.suggestions
    .filter((s) => s.clockId === clock.id && s.suggestedDirection)
    .slice(-3)
    .filter((s) => {
      const direction = deviationSeconds > 0 ? "慢针方向" : "快针方向";
      return s.suggestedDirection === direction;
    }).length;

  if (consecutiveSameDirection >= 3) {
    warnings.push("已连续多次建议同方向调校，请注意是否存在其他故障因素");
  }

  if (warnings.length === 0) {
    warnings.push("当前状态正常，按保守幅度调校后建议复测验证");
  }

  return warnings;
}

function generateAdjustmentSuggestion(db, clock) {
  const retest = latestRetest(db, clock.id);
  const lastAdjustment = latestAdjustment(db, clock.id);

  if (!retest) {
    const error = new Error("暂无复测记录，无法生成调校建议");
    error.status = 400;
    throw error;
  }

  const targetRate = clock.targetDailyRateSeconds;
  const currentRate = retest.dailyRateSeconds;
  const deviationSeconds = currentRate - targetRate;
  const absDeviation = Math.abs(deviationSeconds);

  let suggestedDirection;
  if (deviationSeconds > 0) {
    suggestedDirection = "慢针方向";
  } else if (deviationSeconds < 0) {
    suggestedDirection = "快针方向";
  } else {
    suggestedDirection = "无需调校";
  }

  const conservativeAmountValue = absDeviation > 0
    ? calculateConservativeAmount(db, deviationSeconds, lastAdjustment)
    : 0;

  const conservativeAmount = absDeviation > 0
    ? `游丝快慢针向${suggestedDirection === "慢针方向" ? "慢侧" : "快侧"}微调${conservativeAmountValue}格`
    : "无需调校";

  const riskWarnings = generateRiskWarning(db, deviationSeconds, lastAdjustment, retest, clock);

  const deviationDesc = deviationSeconds > 0
    ? `偏快 ${deviationSeconds.toFixed(1)} 秒/天`
    : deviationSeconds < 0
    ? `偏慢 ${Math.abs(deviationSeconds).toFixed(1)} 秒/天`
    : "日差在目标范围内";

  return {
    clockId: clock.id,
    clockCode: clock.code,
    targetDailyRateSeconds: targetRate,
    currentDailyRateSeconds: currentRate,
    deviationSeconds: Number(deviationSeconds.toFixed(2)),
    deviationDescription: deviationDesc,
    suggestedDirection,
    conservativeAmount,
    conservativeAmountValue,
    riskWarnings,
    referenceRetestId: retest.id,
    referenceAdjustmentId: lastAdjustment ? lastAdjustment.id : null,
    generatedAt: new Date().toISOString()
  };
}

function listSuggestions(db, clockId) {
  return db.suggestions
    .filter((item) => !clockId || item.clockId === clockId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function findSuggestion(db, suggestionId) {
  const suggestion = db.suggestions.find((item) => item.id === suggestionId);
  if (!suggestion) {
    const error = new Error("建议记录不存在");
    error.status = 404;
    throw error;
  }
  return suggestion;
}

function extractKeyFields(obj, fields) {
  if (!obj) return null;
  const result = {};
  for (const field of fields) {
    if (obj[field] !== undefined) {
      result[field] = obj[field];
    }
  }
  return result;
}

function summarizeFieldChanges(before, after, fields) {
  const changes = [];
  for (const field of fields) {
    const beforeValue = before ? before[field] : undefined;
    const afterValue = after ? after[field] : undefined;
    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      changes.push({
        field,
        before: beforeValue ?? null,
        after: afterValue ?? null
      });
    }
  }
  return changes.length > 0 ? changes : null;
}

function buildAuditSummary(operationType, resourceType, beforeSnapshot, afterSnapshot, changedFields) {
  switch (operationType) {
    case AUDIT_OPERATION_TYPES.CLOCK_CREATE:
      return `创建钟表档案 ${afterSnapshot?.code || ""}`;
    case AUDIT_OPERATION_TYPES.CLOCK_UPDATE:
      if (changedFields) {
        const fieldNames = changedFields.map((f) => f.field).join("、");
        return `更新钟表档案 ${afterSnapshot?.code || ""} 关键字段：${fieldNames}`;
      }
      return `更新钟表档案 ${afterSnapshot?.code || ""}`;
    case AUDIT_OPERATION_TYPES.ADJUSTMENT_CREATE:
      return `新增调校记录，方向：${afterSnapshot?.direction || ""}，调整量：${afterSnapshot?.amount || ""}`;
    case AUDIT_OPERATION_TYPES.RETEST_CREATE:
      return `新增复测记录，日差：${afterSnapshot?.dailyRateSeconds ?? ""}秒/天，振幅：${afterSnapshot?.amplitude ?? ""}，合格：${afterSnapshot?.qualified ? "是" : "否"}`;
    default:
      return `${operationType} ${resourceType}`;
  }
}

function createAuditLog(db, params) {
  const {
    operationType,
    resourceType,
    resourceId,
    clockId,
    beforeSnapshot,
    afterSnapshot,
    changedFields
  } = params;

  if (!db.auditLogs) db.auditLogs = [];

  const log = {
    id: makeId("audit"),
    operationType,
    resourceType,
    resourceId,
    clockId,
    beforeSnapshot,
    afterSnapshot,
    changedFields,
    summary: buildAuditSummary(operationType, resourceType, beforeSnapshot, afterSnapshot, changedFields),
    createdAt: new Date().toISOString()
  };
  db.auditLogs.push(log);
  return log;
}

function enrichAuditLog(db, log) {
  const clock = db.clocks.find((c) => c.id === log.clockId) || null;
  let resource = null;
  switch (log.resourceType) {
    case AUDIT_RESOURCE_TYPES.CLOCK:
      resource = clock ? { id: clock.id, code: clock.code } : null;
      break;
    case AUDIT_RESOURCE_TYPES.ADJUSTMENT:
      resource = db.adjustments.find((a) => a.id === log.resourceId) || null;
      break;
    case AUDIT_RESOURCE_TYPES.RETEST:
      resource = db.retests.find((r) => r.id === log.resourceId) || null;
      break;
  }
  return {
    ...log,
    clock: clock ? { id: clock.id, code: clock.code } : null,
    resource
  };
}

function listAuditLogsByClock(db, clockId) {
  return (db.auditLogs || [])
    .filter((log) => log.clockId === clockId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((log) => enrichAuditLog(db, log));
}

function listAllAuditLogs(db) {
  return (db.auditLogs || [])
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((log) => enrichAuditLog(db, log));
}

function getRecentRetests(db, clockId) {
  const count = HEALTH_SCORE_RULES.recentRetestCount;
  return db.retests
    .filter((item) => item.clockId === clockId)
    .sort((a, b) => new Date(b.testedAt) - new Date(a.testedAt))
    .slice(0, count)
    .reverse();
}

function calculateStdDev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
  const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.sqrt(variance);
}

function calculateDailyRateScore(retests) {
  const dailyRates = retests.map((r) => r.dailyRateSeconds);
  const stdDev = calculateStdDev(dailyRates);
  const rules = HEALTH_SCORE_RULES.dailyRate;

  if (stdDev <= rules.excellentStdDev) {
    return { score: rules.excellentScore, stdDev, level: "excellent" };
  } else if (stdDev <= rules.goodStdDev) {
    return { score: rules.goodScore, stdDev, level: "good" };
  } else if (stdDev <= rules.fairStdDev) {
    return { score: rules.fairScore, stdDev, level: "fair" };
  }
  return { score: rules.poorScore, stdDev, level: "poor" };
}

function calculateAmplitudeScore(retests) {
  const amplitudes = retests.map((r) => r.amplitude);
  const stdDev = calculateStdDev(amplitudes);
  const rules = HEALTH_SCORE_RULES.amplitude;

  let baseScore;
  let level;
  if (stdDev <= rules.excellentStdDev) {
    baseScore = rules.excellentScore;
    level = "excellent";
  } else if (stdDev <= rules.goodStdDev) {
    baseScore = rules.goodScore;
    level = "good";
  } else if (stdDev <= rules.fairStdDev) {
    baseScore = rules.fairScore;
    level = "fair";
  } else {
    baseScore = rules.poorScore;
    level = "poor";
  }

  const avgAmplitude = amplitudes.reduce((sum, v) => sum + v, 0) / amplitudes.length;
  const abnormalCount = amplitudes.filter(
    (a) => a < rules.lowAmplitudeThreshold || a > rules.highAmplitudeThreshold
  ).length;

  let abnormalPenalty = 0;
  if (abnormalCount > 0) {
    abnormalPenalty = Math.min(baseScore, abnormalCount * 5);
  }

  return {
    score: Math.max(0, baseScore - abnormalPenalty),
    stdDev,
    avgAmplitude,
    abnormalCount,
    level
  };
}

function calculateConsecutiveScore(retests) {
  const rules = HEALTH_SCORE_RULES.consecutive;
  let consecutiveFailed = 0;
  let maxConsecutiveFailed = 0;

  for (let i = retests.length - 1; i >= 0; i--) {
    if (!retests[i].qualified) {
      consecutiveFailed++;
      maxConsecutiveFailed = Math.max(maxConsecutiveFailed, consecutiveFailed);
    } else {
      consecutiveFailed = 0;
    }
  }

  if (maxConsecutiveFailed === 0) {
    return { score: rules.noneFailed, maxConsecutiveFailed, level: "excellent" };
  } else if (maxConsecutiveFailed === 1) {
    return { score: rules.twoFailed, maxConsecutiveFailed, level: "good" };
  } else if (maxConsecutiveFailed === 2) {
    return { score: rules.twoFailed, maxConsecutiveFailed, level: "fair" };
  }
  return { score: rules.threeOrMoreFailed, maxConsecutiveFailed, level: "poor" };
}

function calculateHealthScore(db, clock) {
  const recentRetests = getRecentRetests(db, clock.id);
  const rules = HEALTH_SCORE_RULES;

  if (recentRetests.length < rules.minRetestCount) {
    return {
      clockId: clock.id,
      clockCode: clock.code,
      totalScore: null,
      conclusion: rules.conclusions.insufficient,
      details: {
        retestCount: recentRetests.length,
        minRequired: rules.minRetestCount
      },
      recentRetests: recentRetests.map((r) => ({
        id: r.id,
        testedAt: r.testedAt,
        dailyRateSeconds: r.dailyRateSeconds,
        amplitude: r.amplitude,
        qualified: r.qualified
      })),
      calculatedAt: new Date().toISOString(),
      rulesVersion: "1.0"
    };
  }

  const dailyRateResult = calculateDailyRateScore(recentRetests);
  const amplitudeResult = calculateAmplitudeScore(recentRetests);
  const consecutiveResult = calculateConsecutiveScore(recentRetests);

  const totalScore = dailyRateResult.score + amplitudeResult.score + consecutiveResult.score;

  let conclusion;
  if (totalScore >= rules.thresholds.stable) {
    conclusion = rules.conclusions.stable;
  } else if (totalScore >= rules.thresholds.observe) {
    conclusion = rules.conclusions.observe;
  } else {
    conclusion = rules.conclusions.rework;
  }

  const suggestions = [];
  if (dailyRateResult.level === "poor" || dailyRateResult.level === "fair") {
    suggestions.push("日差波动较大，建议检查游丝状态和摆轮平衡");
  }
  if (amplitudeResult.level === "poor" || amplitudeResult.level === "fair") {
    suggestions.push("振幅不稳定，建议检查发条力矩和传动系统润滑");
  }
  if (amplitudeResult.abnormalCount > 0) {
    suggestions.push(`检测到 ${amplitudeResult.abnormalCount} 次振幅异常，需重点关注`);
  }
  if (consecutiveResult.maxConsecutiveFailed >= 2) {
    suggestions.push(`连续 ${consecutiveResult.maxConsecutiveFailed} 次不合格，建议重新调校或返工时序检查`);
  }
  if (suggestions.length === 0) {
    suggestions.push("各项指标正常，继续保持当前维护节奏");
  }

  return {
    clockId: clock.id,
    clockCode: clock.code,
    totalScore,
    conclusion,
    details: {
      retestCount: recentRetests.length,
      dailyRateStability: {
        weight: rules.weights.dailyRateStability,
        score: dailyRateResult.score,
        stdDev: Number(dailyRateResult.stdDev.toFixed(2)),
        level: dailyRateResult.level
      },
      amplitudeStability: {
        weight: rules.weights.amplitudeStability,
        score: amplitudeResult.score,
        stdDev: Number(amplitudeResult.stdDev.toFixed(2)),
        avgAmplitude: Number(amplitudeResult.avgAmplitude.toFixed(1)),
        abnormalCount: amplitudeResult.abnormalCount,
        level: amplitudeResult.level
      },
      consecutiveQualified: {
        weight: rules.weights.consecutiveQualified,
        score: consecutiveResult.score,
        maxConsecutiveFailed: consecutiveResult.maxConsecutiveFailed,
        level: consecutiveResult.level
      }
    },
    suggestions,
    recentRetests: recentRetests.map((r) => ({
      id: r.id,
      testedAt: r.testedAt,
      dailyRateSeconds: r.dailyRateSeconds,
      amplitude: r.amplitude,
      qualified: r.qualified
    })),
    calculatedAt: new Date().toISOString(),
    rulesVersion: "1.0"
  };
}

function clockSummary(db, clock) {
  const retest = latestRetest(db, clock.id);
  const adjustment = latestAdjustment(db, clock.id);
  return {
    ...clock,
    latestAdjustment: adjustment,
    latestRetest: retest,
    qualified: retest ? retest.qualified : false
  };
}

function classifyClockStatus(db, clock) {
  const retest = latestRetest(db, clock.id);
  const adjustment = latestAdjustment(db, clock.id);

  if (!adjustment && !retest) {
    return "neverRetested";
  }

  if (adjustment && !retest) {
    return "neverRetested";
  }

  if (retest && adjustment && new Date(adjustment.createdAt) > new Date(retest.testedAt)) {
    return "pendingRetest";
  }

  if (retest) {
    return retest.qualified ? "qualified" : "retestFailed";
  }

  return "neverRetested";
}

function buildOverview(db) {
  const statusBuckets = {
    pendingRetest: [],
    retestFailed: [],
    qualified: [],
    neverRetested: []
  };

  for (const clock of db.clocks) {
    const status = classifyClockStatus(db, clock);
    const summary = clockSummary(db, clock);
    statusBuckets[status].push(summary);
  }

  const overview = {
    totalClocks: db.clocks.length,
    pendingRetest: statusBuckets.pendingRetest.length,
    retestFailed: statusBuckets.retestFailed.length,
    qualified: statusBuckets.qualified.length,
    neverRetested: statusBuckets.neverRetested.length
  };

  let latestAdjustmentAt = null;
  if (db.adjustments.length > 0) {
    latestAdjustmentAt = db.adjustments
      .map((a) => new Date(a.createdAt))
      .sort((a, b) => b - a)[0]
      .toISOString();
  }

  let latestRetestAt = null;
  if (db.retests.length > 0) {
    latestRetestAt = db.retests
      .map((r) => new Date(r.testedAt))
      .sort((a, b) => b - a)[0]
      .toISOString();
  }

  return {
    overview,
    timestamps: {
      latestAdjustmentAt,
      latestRetestAt
    },
    breakdown: statusBuckets,
    generatedAt: new Date().toISOString()
  };
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const db = await readDb();

  if (req.method === "GET" && pathname === "/health") {
    return send(res, 200, { ok: true, service: "clock-escapement-tuning-api", routes });
  }

  if (req.method === "GET" && pathname === "/overview") {
    return send(res, 200, { data: buildOverview(db) });
  }

  if (req.method === "GET" && pathname === "/clocks") {
    const qualified = url.searchParams.get("qualified");
    let data = db.clocks.map((clock) => clockSummary(db, clock));
    if (qualified !== null) {
      const expected = qualified === "true";
      data = data.filter((clock) => clock.qualified === expected);
    }
    return send(res, 200, { data });
  }

  if (req.method === "POST" && pathname === "/clocks") {
    const body = await parseBody(req);
    required(body, ["code", "escapementType", "balanceFrequency"]);
    const clock = {
      id: makeId("clock"),
      code: body.code,
      escapementType: body.escapementType,
      balanceFrequency: body.balanceFrequency,
      targetDailyRateSeconds: Number(body.targetDailyRateSeconds ?? 30),
      note: body.note || "",
      createdAt: new Date().toISOString()
    };
    db.clocks.push(clock);
    createAuditLog(db, {
      operationType: AUDIT_OPERATION_TYPES.CLOCK_CREATE,
      resourceType: AUDIT_RESOURCE_TYPES.CLOCK,
      resourceId: clock.id,
      clockId: clock.id,
      beforeSnapshot: null,
      afterSnapshot: extractKeyFields(clock, CLOCK_KEY_FIELDS),
      changedFields: null
    });
    await writeDb(db);
    return send(res, 201, { data: clockSummary(db, clock) });
  }

  const clockUpdateMatch = pathname.match(/^\/clocks\/([^/]+)$/);
  if (clockUpdateMatch && req.method === "PUT") {
    const clock = findClock(db, clockUpdateMatch[1]);
    const body = await parseBody(req);

    const beforeKeySnapshot = extractKeyFields(clock, CLOCK_KEY_FIELDS);

    if (body.code !== undefined) clock.code = body.code;
    if (body.escapementType !== undefined) clock.escapementType = body.escapementType;
    if (body.balanceFrequency !== undefined) clock.balanceFrequency = body.balanceFrequency;
    if (body.targetDailyRateSeconds !== undefined) clock.targetDailyRateSeconds = Number(body.targetDailyRateSeconds);
    if (body.note !== undefined) clock.note = body.note || "";
    clock.updatedAt = new Date().toISOString();

    const afterKeySnapshot = extractKeyFields(clock, CLOCK_KEY_FIELDS);
    const changedFields = summarizeFieldChanges(beforeKeySnapshot, afterKeySnapshot, CLOCK_KEY_FIELDS);

    if (changedFields) {
      createAuditLog(db, {
        operationType: AUDIT_OPERATION_TYPES.CLOCK_UPDATE,
        resourceType: AUDIT_RESOURCE_TYPES.CLOCK,
        resourceId: clock.id,
        clockId: clock.id,
        beforeSnapshot: beforeKeySnapshot,
        afterSnapshot: afterKeySnapshot,
        changedFields
      });
    }

    await writeDb(db);
    return send(res, 200, {
      data: clockSummary(db, clock),
      auditChanged: changedFields ? changedFields.map((f) => f.field) : []
    });
  }

  if (req.method === "POST" && pathname === "/clocks/import/preview") {
    const body = await parseBody(req);
    if (!Array.isArray(body.clocks)) {
      const error = new Error("请求体必须包含 clocks 数组");
      error.status = 400;
      throw error;
    }
    const { importable, duplicates, missingFields } = classifyImportItems(db, body.clocks);
    return send(res, 200, {
      summary: {
        total: body.clocks.length,
        importable: importable.length,
        duplicates: duplicates.length,
        missingFields: missingFields.length
      },
      importable: importable.map(({ index, item }) => ({ index, item })),
      duplicates: duplicates.map(({ index, item, code }) => ({ index, code, item })),
      missingFields: missingFields.map(({ index, item, missing }) => ({ index, missing, item }))
    });
  }

  if (req.method === "POST" && pathname === "/clocks/import") {
    const body = await parseBody(req);
    if (!Array.isArray(body.clocks)) {
      const error = new Error("请求体必须包含 clocks 数组");
      error.status = 400;
      throw error;
    }
    const { importable, duplicates, missingFields } = classifyImportItems(db, body.clocks);
    const created = [];
    for (const { item } of importable) {
      const clock = buildClockFromItem(item);
      db.clocks.push(clock);
      createAuditLog(db, {
        operationType: AUDIT_OPERATION_TYPES.CLOCK_CREATE,
        resourceType: AUDIT_RESOURCE_TYPES.CLOCK,
        resourceId: clock.id,
        clockId: clock.id,
        beforeSnapshot: null,
        afterSnapshot: extractKeyFields(clock, CLOCK_KEY_FIELDS),
        changedFields: null
      });
      created.push(clock);
    }
    await writeDb(db);
    return send(res, 201, {
      summary: {
        total: body.clocks.length,
        created: created.length,
        duplicates: duplicates.length,
        missingFields: missingFields.length
      },
      created: created.map((clock) => clockSummary(db, clock)),
      duplicates: duplicates.map(({ index, code, item }) => ({ index, code, item })),
      missingFields: missingFields.map(({ index, item, missing }) => ({ index, missing, item }))
    });
  }

  if (req.method === "GET" && pathname === "/clocks/not-qualified") {
    const data = db.clocks.map((clock) => clockSummary(db, clock)).filter((clock) => !clock.qualified);
    return send(res, 200, { data });
  }

  if (req.method === "GET" && pathname === "/clocks/health-scores") {
    const conclusion = url.searchParams.get("conclusion");
    const data = db.clocks.map((clock) => calculateHealthScore(db, clock));
    let filtered = data;
    if (conclusion) {
      filtered = data.filter((item) => item.conclusion === conclusion);
    }
    const summary = {
      total: db.clocks.length,
      stable: filtered.filter((item) => item.conclusion === HEALTH_SCORE_RULES.conclusions.stable).length,
      observe: filtered.filter((item) => item.conclusion === HEALTH_SCORE_RULES.conclusions.observe).length,
      rework: filtered.filter((item) => item.conclusion === HEALTH_SCORE_RULES.conclusions.rework).length,
      insufficient: filtered.filter((item) => item.conclusion === HEALTH_SCORE_RULES.conclusions.insufficient).length
    };
    return send(res, 200, {
      summary,
      data: filtered,
      rules: HEALTH_SCORE_RULES,
      generatedAt: new Date().toISOString()
    });
  }

  const historyMatch = pathname.match(/^\/clocks\/([^/]+)\/history$/);
  if (historyMatch && req.method === "GET") {
    const clock = findClock(db, historyMatch[1]);
    const adjustments = db.adjustments.filter((item) => item.clockId === clock.id);
    const retests = db.retests.filter((item) => item.clockId === clock.id);
    const handovers = listHandovers(db, clock.id);
    const retestTasks = (db.retestTasks || []).filter((item) => item.clockId === clock.id);
    return send(res, 200, { data: { clock, adjustments, retests, handovers, retestTasks, latestRetest: latestRetest(db, clock.id) } });
  }

  const auditLogsByClockMatch = pathname.match(/^\/clocks\/([^/]+)\/audit-logs$/);
  if (auditLogsByClockMatch && req.method === "GET") {
    const clock = findClock(db, auditLogsByClockMatch[1]);
    const logs = listAuditLogsByClock(db, clock.id);

    const operationTypeLabels = {
      [AUDIT_OPERATION_TYPES.CLOCK_CREATE]: "创建档案",
      [AUDIT_OPERATION_TYPES.CLOCK_UPDATE]: "更新档案",
      [AUDIT_OPERATION_TYPES.ADJUSTMENT_CREATE]: "新增调校",
      [AUDIT_OPERATION_TYPES.RETEST_CREATE]: "新增复测"
    };

    const timeline = logs.map((log) => ({
      ...log,
      operationLabel: operationTypeLabels[log.operationType] || log.operationType
    }));

    const stats = {
      clockCreate: logs.filter((l) => l.operationType === AUDIT_OPERATION_TYPES.CLOCK_CREATE).length,
      clockUpdate: logs.filter((l) => l.operationType === AUDIT_OPERATION_TYPES.CLOCK_UPDATE).length,
      adjustmentCreate: logs.filter((l) => l.operationType === AUDIT_OPERATION_TYPES.ADJUSTMENT_CREATE).length,
      retestCreate: logs.filter((l) => l.operationType === AUDIT_OPERATION_TYPES.RETEST_CREATE).length
    };

    return send(res, 200, {
      data: {
        clock: { id: clock.id, code: clock.code, escapementType: clock.escapementType, balanceFrequency: clock.balanceFrequency },
        timeline,
        total: logs.length,
        stats,
        operationTypeLabels,
        keyFields: CLOCK_KEY_FIELDS,
        generatedAt: new Date().toISOString()
      }
    });
  }

  if (req.method === "GET" && pathname === "/audit-logs") {
    const operationType = url.searchParams.get("operationType");
    const resourceType = url.searchParams.get("resourceType");
    const clockId = url.searchParams.get("clockId");
    let data = listAllAuditLogs(db);
    if (operationType) {
      data = data.filter((log) => log.operationType === operationType);
    }
    if (resourceType) {
      data = data.filter((log) => log.resourceType === resourceType);
    }
    if (clockId) {
      data = data.filter((log) => log.clockId === clockId);
    }
    return send(res, 200, {
      data,
      total: data.length,
      operationTypes: AUDIT_OPERATION_TYPES,
      resourceTypes: AUDIT_RESOURCE_TYPES,
      keyFields: CLOCK_KEY_FIELDS
    });
  }

  const healthScoreMatch = pathname.match(/^\/clocks\/([^/]+)\/health-score$/);
  if (healthScoreMatch && req.method === "GET") {
    const clock = findClock(db, healthScoreMatch[1]);
    return send(res, 200, { data: calculateHealthScore(db, clock) });
  }

  const adjustmentMatch = pathname.match(/^\/clocks\/([^/]+)\/adjustments$/);
  if (adjustmentMatch && req.method === "POST") {
    const clock = findClock(db, adjustmentMatch[1]);
    const body = await parseBody(req);
    required(body, ["currentDailyRateSeconds", "direction", "amount"]);
    const adjustment = {
      id: makeId("adjustment"),
      clockId: clock.id,
      currentDailyRateSeconds: Number(body.currentDailyRateSeconds),
      direction: body.direction,
      amount: body.amount,
      note: body.note || "",
      createdAt: new Date().toISOString()
    };
    db.adjustments.push(adjustment);
    createAuditLog(db, {
      operationType: AUDIT_OPERATION_TYPES.ADJUSTMENT_CREATE,
      resourceType: AUDIT_RESOURCE_TYPES.ADJUSTMENT,
      resourceId: adjustment.id,
      clockId: clock.id,
      beforeSnapshot: null,
      afterSnapshot: {
        id: adjustment.id,
        currentDailyRateSeconds: adjustment.currentDailyRateSeconds,
        direction: adjustment.direction,
        amount: adjustment.amount,
        note: adjustment.note
      },
      changedFields: null
    });
    await writeDb(db);
    return send(res, 201, { data: adjustment });
  }

  const retestMatch = pathname.match(/^\/clocks\/([^/]+)\/retests$/);
  if (retestMatch && req.method === "POST") {
    const clock = findClock(db, retestMatch[1]);
    const body = await parseBody(req);
    required(body, ["dailyRateSeconds", "amplitude"]);

    let targetTask = null;
    if (body.retestTaskId && db.retestTasks) {
      targetTask = db.retestTasks.find(
        (t) => t.id === body.retestTaskId && t.clockId === clock.id && t.status === "pending"
      );
      if (!targetTask) {
        const error = new Error("指定的复测任务不存在或已完成");
        error.status = 404;
        throw error;
      }
      if (body.adjustmentId && body.adjustmentId !== targetTask.adjustmentId) {
        const error = new Error("复测任务与调校记录不匹配");
        error.status = 400;
        throw error;
      }
    }

    const adjustmentId = targetTask?.adjustmentId || body.adjustmentId || latestAdjustment(db, clock.id)?.id || null;
    const qualified = body.qualified !== undefined
      ? Boolean(body.qualified)
      : Math.abs(Number(body.dailyRateSeconds)) <= Number(clock.targetDailyRateSeconds);

    const retest = {
      id: makeId("retest"),
      clockId: clock.id,
      adjustmentId,
      testedAt: body.testedAt || new Date().toISOString(),
      dailyRateSeconds: Number(body.dailyRateSeconds),
      amplitude: Number(body.amplitude),
      qualified,
      note: body.note || ""
    };
    db.retests.push(retest);
    createAuditLog(db, {
      operationType: AUDIT_OPERATION_TYPES.RETEST_CREATE,
      resourceType: AUDIT_RESOURCE_TYPES.RETEST,
      resourceId: retest.id,
      clockId: clock.id,
      beforeSnapshot: null,
      afterSnapshot: {
        id: retest.id,
        adjustmentId: retest.adjustmentId,
        testedAt: retest.testedAt,
        dailyRateSeconds: retest.dailyRateSeconds,
        amplitude: retest.amplitude,
        qualified: retest.qualified,
        note: retest.note
      },
      changedFields: null
    });
    if (db.retestTasks) {
      let matchingTask = targetTask;
      if (!matchingTask) {
        const pendingTasks = db.retestTasks.filter(
          (t) => t.clockId === clock.id && t.status === "pending"
        );
        if (adjustmentId) {
          const sameAdjustmentTasks = pendingTasks.filter((t) => t.adjustmentId === adjustmentId);
          if (sameAdjustmentTasks.length > 0) {
            matchingTask = sameAdjustmentTasks.sort(
              (a, b) => new Date(a.plannedRetestAt) - new Date(b.plannedRetestAt)
            )[0];
          }
        } else if (pendingTasks.length > 0) {
          matchingTask = pendingTasks.sort(
            (a, b) => new Date(a.plannedRetestAt) - new Date(b.plannedRetestAt)
          )[0];
        }
      }
      if (matchingTask) {
        matchingTask.status = "completed";
        matchingTask.completedAt = new Date().toISOString();
        matchingTask.completedRetestId = retest.id;
      }
    }
    await writeDb(db);
    return send(res, 201, { data: retest, clock: clockSummary(db, clock) });
  }

  const latestMatch = pathname.match(/^\/clocks\/([^/]+)\/latest-retest$/);
  if (latestMatch && req.method === "GET") {
    findClock(db, latestMatch[1]);
    return send(res, 200, { data: latestRetest(db, latestMatch[1]) });
  }

  const handoverListMatch = pathname.match(/^\/clocks\/([^/]+)\/handovers$/);
  if (handoverListMatch && req.method === "GET") {
    const clock = findClock(db, handoverListMatch[1]);
    return send(res, 200, { data: listHandovers(db, clock.id) });
  }

  const handoverCreateMatch = pathname.match(/^\/clocks\/([^/]+)\/handovers$/);
  if (handoverCreateMatch && req.method === "POST") {
    const clock = findClock(db, handoverCreateMatch[1]);
    const body = await parseBody(req);
    required(body, ["handoverNote", "receiver"]);
    const handover = {
      id: makeId("handover"),
      clockId: clock.id,
      handoverNote: body.handoverNote,
      nextStepSuggestion: body.nextStepSuggestion || "",
      receiver: body.receiver,
      createdAt: new Date().toISOString()
    };
    db.handovers.push(handover);
    await writeDb(db);
    return send(res, 201, { data: handover });
  }

  if (req.method === "GET" && pathname === "/adjustments") {
    const clockId = url.searchParams.get("clockId");
    return send(res, 200, { data: db.adjustments.filter((item) => !clockId || item.clockId === clockId) });
  }

  if (req.method === "GET" && pathname === "/retests") {
    const clockId = url.searchParams.get("clockId");
    const qualified = url.searchParams.get("qualified");
    const data = db.retests.filter((item) => {
      const matchClock = !clockId || item.clockId === clockId;
      const matchQualified = qualified === null || item.qualified === (qualified === "true");
      return matchClock && matchQualified;
    });
    return send(res, 200, { data });
  }

  if (req.method === "GET" && pathname === "/retest-tasks") {
    const status = url.searchParams.get("status");
    const priority = url.searchParams.get("priority");
    const overdue = url.searchParams.get("overdue");
    const clockId = url.searchParams.get("clockId");
    const now = new Date();
    let data = (db.retestTasks || []).filter((item) => {
      const matchStatus = !status || item.status === status;
      const matchPriority = !priority || item.priority === priority;
      const matchClock = !clockId || item.clockId === clockId;
      let matchOverdue = true;
      if (overdue === "true") {
        matchOverdue = item.status === "pending" && new Date(item.plannedRetestAt) < now;
      } else if (overdue === "false") {
        matchOverdue = !(item.status === "pending" && new Date(item.plannedRetestAt) < now);
      }
      return matchStatus && matchPriority && matchClock && matchOverdue;
    });
    data = data.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      const pa = priorityOrder[a.priority] ?? 1;
      const pb = priorityOrder[b.priority] ?? 1;
      if (pa !== pb) return pa - pb;
      return new Date(a.plannedRetestAt) - new Date(b.plannedRetestAt);
    });
    data = data.map((task) => ({
      ...task,
      clock: db.clocks.find((c) => c.id === task.clockId) || null,
      adjustment: db.adjustments.find((a) => a.id === task.adjustmentId) || null,
      overdue: task.status === "pending" && new Date(task.plannedRetestAt) < now
    }));
    return send(res, 200, { data });
  }

  const retestTaskCreateMatch = pathname.match(/^\/clocks\/([^/]+)\/retest-tasks$/);
  if (retestTaskCreateMatch && req.method === "POST") {
    const clock = findClock(db, retestTaskCreateMatch[1]);
    const body = await parseBody(req);
    required(body, ["plannedRetestAt", "priority"]);
    const validPriorities = ["high", "medium", "low"];
    if (!validPriorities.includes(body.priority)) {
      const error = new Error(`priority 必须为 ${validPriorities.join("/")}`);
      error.status = 400;
      throw error;
    }
    const adjustmentId = body.adjustmentId || latestAdjustment(db, clock.id)?.id || null;
    if (!adjustmentId) {
      const error = new Error("该钟表无调校记录，无法创建复测任务");
      error.status = 400;
      throw error;
    }
    const task = {
      id: makeId("retestTask"),
      clockId: clock.id,
      adjustmentId,
      plannedRetestAt: body.plannedRetestAt,
      priority: body.priority,
      status: "pending",
      completedAt: null,
      completedRetestId: null,
      note: body.note || "",
      createdAt: new Date().toISOString()
    };
    if (!db.retestTasks) db.retestTasks = [];
    db.retestTasks.push(task);
    await writeDb(db);
    return send(res, 201, {
      data: {
        ...task,
        clock,
        adjustment: db.adjustments.find((a) => a.id === adjustmentId) || null,
        overdue: false
      }
    });
  }

  const retestTaskListMatch = pathname.match(/^\/clocks\/([^/]+)\/retest-tasks$/);
  if (retestTaskListMatch && req.method === "GET") {
    const clock = findClock(db, retestTaskListMatch[1]);
    const now = new Date();
    const data = (db.retestTasks || [])
      .filter((item) => item.clockId === clock.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((task) => ({
        ...task,
        adjustment: db.adjustments.find((a) => a.id === task.adjustmentId) || null,
        overdue: task.status === "pending" && new Date(task.plannedRetestAt) < now
      }));
    return send(res, 200, { data });
  }

  if (req.method === "GET" && pathname === "/handovers") {
    const clockId = url.searchParams.get("clockId");
    return send(res, 200, { data: db.handovers.filter((item) => !clockId || item.clockId === clockId) });
  }

  const generateSuggestionMatch = pathname.match(/^\/clocks\/([^/]+)\/suggestions\/generate$/);
  if (generateSuggestionMatch && req.method === "POST") {
    const clock = findClock(db, generateSuggestionMatch[1]);
    const suggestion = generateAdjustmentSuggestion(db, clock);
    return send(res, 200, { data: suggestion });
  }

  const saveSuggestionMatch = pathname.match(/^\/clocks\/([^/]+)\/suggestions$/);
  if (saveSuggestionMatch && req.method === "POST") {
    const clock = findClock(db, saveSuggestionMatch[1]);
    const body = await parseBody(req);
    const suggestion = generateAdjustmentSuggestion(db, clock);
    const savedSuggestion = {
      id: makeId("suggestion"),
      clockId: clock.id,
      targetDailyRateSeconds: suggestion.targetDailyRateSeconds,
      currentDailyRateSeconds: suggestion.currentDailyRateSeconds,
      deviationSeconds: suggestion.deviationSeconds,
      deviationDescription: suggestion.deviationDescription,
      suggestedDirection: suggestion.suggestedDirection,
      conservativeAmount: suggestion.conservativeAmount,
      conservativeAmountValue: suggestion.conservativeAmountValue,
      riskWarnings: suggestion.riskWarnings,
      referenceRetestId: suggestion.referenceRetestId,
      referenceAdjustmentId: suggestion.referenceAdjustmentId,
      note: body.note || "",
      createdAt: new Date().toISOString()
    };
    db.suggestions.push(savedSuggestion);
    await writeDb(db);
    return send(res, 201, { data: savedSuggestion });
  }

  const listSuggestionsMatch = pathname.match(/^\/clocks\/([^/]+)\/suggestions$/);
  if (listSuggestionsMatch && req.method === "GET") {
    const clock = findClock(db, listSuggestionsMatch[1]);
    const data = listSuggestions(db, clock.id).map((s) => ({
      ...s,
      referenceRetest: db.retests.find((r) => r.id === s.referenceRetestId) || null,
      referenceAdjustment: db.adjustments.find((a) => a.id === s.referenceAdjustmentId) || null
    }));
    return send(res, 200, { data });
  }

  if (req.method === "GET" && pathname === "/suggestions") {
    const clockId = url.searchParams.get("clockId");
    const data = listSuggestions(db, clockId).map((s) => ({
      ...s,
      referenceRetest: db.retests.find((r) => r.id === s.referenceRetestId) || null,
      referenceAdjustment: db.adjustments.find((a) => a.id === s.referenceAdjustmentId) || null
    }));
    return send(res, 200, { data });
  }

  const suggestionDetailMatch = pathname.match(/^\/suggestions\/([^/]+)$/);
  if (suggestionDetailMatch && req.method === "GET") {
    const suggestion = findSuggestion(db, suggestionDetailMatch[1]);
    const clock = db.clocks.find((c) => c.id === suggestion.clockId) || null;
    const referenceRetest = db.retests.find((r) => r.id === suggestion.referenceRetestId) || null;
    const referenceAdjustment = db.adjustments.find((a) => a.id === suggestion.referenceAdjustmentId) || null;
    return send(res, 200, {
      data: {
        ...suggestion,
        clock,
        referenceRetest,
        referenceAdjustment
      }
    });
  }

  if (req.method === "POST" && pathname === "/backups") {
    const backup = await createBackup();
    return send(res, 201, { data: backup });
  }

  if (req.method === "GET" && pathname === "/backups") {
    const backups = await listBackups();
    return send(res, 200, {
      data: backups,
      total: backups.length,
      errorCodes: BACKUP_ERROR_CODES
    });
  }

  const validateBackupMatch = pathname.match(/^\/backups\/([^/]+)\/validate$/);
  if (validateBackupMatch && req.method === "GET") {
    const result = await validateBackup(validateBackupMatch[1]);
    return send(res, 200, { data: result });
  }

  const restoreBackupMatch = pathname.match(/^\/backups\/([^/]+)\/restore$/);
  if (restoreBackupMatch && req.method === "POST") {
    const result = await restoreBackup(restoreBackupMatch[1]);
    return send(res, 200, { data: result });
  }

  return send(res, 404, { error: "接口不存在", routes });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    const body = { error: error.message || "服务器错误" };
    if (error.code) body.code = error.code;
    if (error.details) body.details = error.details;
    send(res, error.status || 500, body);
  });
});

server.listen(PORT, () => {
  console.log(`Clock escapement tuning API running at http://127.0.0.1:${PORT}`);
});

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
  users: "array",
  clocks: "array",
  adjustments: "array",
  retests: "array",
  handovers: "array",
  retestTasks: "array",
  suggestions: "array",
  auditLogs: "array",
  healthScoreRules: "array"
};

const USER_ROLES = {
  ADMIN: "admin",
  TECHNICIAN: "technician"
};

const DEFAULT_SYSTEM_USER_ID = "user_system";
const DEFAULT_ADMIN_USER_ID = "user_admin_default";

const initialData = {
  users: [
    {
      id: DEFAULT_SYSTEM_USER_ID,
      username: "system",
      name: "系统",
      role: USER_ROLES.ADMIN,
      createdAt: new Date().toISOString()
    },
    {
      id: DEFAULT_ADMIN_USER_ID,
      username: "admin",
      name: "管理员",
      role: USER_ROLES.ADMIN,
      createdAt: new Date().toISOString()
    },
    {
      id: "user_tech_zhang",
      username: "zhang",
      name: "张师傅",
      role: USER_ROLES.TECHNICIAN,
      createdAt: new Date().toISOString()
    },
    {
      id: "user_tech_wang",
      username: "wang",
      name: "王师傅",
      role: USER_ROLES.TECHNICIAN,
      createdAt: new Date().toISOString()
    }
  ],
  clocks: [
    {
      id: "clock_demo",
      code: "CLK-1890-07",
      escapementType: "瑞士杠杆式",
      balanceFrequency: "18000vph",
      targetDailyRateSeconds: 20,
      note: "怀表机芯，走时偏快",
      assignedTechnicianId: "user_tech_zhang",
      createdAt: new Date().toISOString(),
      createdBy: DEFAULT_SYSTEM_USER_ID
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
      createdAt: new Date().toISOString(),
      createdBy: DEFAULT_SYSTEM_USER_ID
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
      note: "仍偏快，振幅尚可",
      createdBy: DEFAULT_SYSTEM_USER_ID
    }
  ],
  handovers: [
    {
      id: "handover_demo",
      clockId: "clock_demo",
      handoverNote: "机芯已拆解清洗完毕，游丝有轻微变形需注意",
      nextStepSuggestion: "建议先调校游丝外桩，再进行走时精度测试",
      receiver: "王师傅",
      createdAt: new Date().toISOString(),
      createdBy: DEFAULT_SYSTEM_USER_ID
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
      cancelledAt: null,
      cancelledBy: null,
      cancelReason: null,
      note: "调校后一周复测",
      createdAt: new Date().toISOString(),
      createdBy: DEFAULT_SYSTEM_USER_ID
    }
  ],
  suggestions: [],
  healthScoreRules: [],
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
      createdAt: new Date().toISOString(),
      createdBy: DEFAULT_SYSTEM_USER_ID
    }
  ]
};

const AUDIT_OPERATION_TYPES = {
  CLOCK_CREATE: "clock_create",
  CLOCK_UPDATE: "clock_update",
  ADJUSTMENT_CREATE: "adjustment_create",
  RETEST_CREATE: "retest_create",
  HANDOVER_CREATE: "handover_create",
  TECHNICIAN_ASSIGN: "technician_assign",
  SUGGESTION_CREATE: "suggestion_create",
  SUGGESTION_STATUS_UPDATE: "suggestion_status_update",
  RETEST_TASK_CREATE: "retest_task_create",
  RETEST_TASK_UPDATE: "retest_task_update",
  RETEST_TASK_CANCEL: "retest_task_cancel",
  USER_CREATE: "user_create",
  USER_UPDATE: "user_update",
  USER_DELETE: "user_delete",
  BACKUP_CREATE: "backup_create",
  BACKUP_RESTORE: "backup_restore",
  WORKFLOW_ARCHIVE: "workflow_archive"
};

const AUDIT_RESOURCE_TYPES = {
  CLOCK: "clock",
  ADJUSTMENT: "adjustment",
  RETEST: "retest",
  HANDOVER: "handover",
  SUGGESTION: "suggestion",
  RETEST_TASK: "retest_task",
  USER: "user",
  BACKUP: "backup",
  WORKFLOW: "workflow"
};

const SUGGESTION_STATUSES = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  IGNORED: "ignored",
  APPLIED: "applied"
};

const SUGGESTION_STATUS_LABELS = {
  [SUGGESTION_STATUSES.PENDING]: "待处理",
  [SUGGESTION_STATUSES.ACCEPTED]: "已采纳",
  [SUGGESTION_STATUSES.IGNORED]: "已忽略",
  [SUGGESTION_STATUSES.APPLIED]: "已应用"
};

const WORKFLOW_STATUSES = {
  CREATED: "created",
  INITIAL_ADJUSTED: "initial_adjusted",
  PENDING_RETEST: "pending_retest",
  RETEST_FAILED: "retest_failed",
  QUALIFIED: "qualified",
  ARCHIVED: "archived"
};

const WORKFLOW_STATUS_LABELS = {
  [WORKFLOW_STATUSES.CREATED]: "建档",
  [WORKFLOW_STATUSES.INITIAL_ADJUSTED]: "初调",
  [WORKFLOW_STATUSES.PENDING_RETEST]: "待复测",
  [WORKFLOW_STATUSES.RETEST_FAILED]: "不合格待返工",
  [WORKFLOW_STATUSES.QUALIFIED]: "已达标",
  [WORKFLOW_STATUSES.ARCHIVED]: "达标归档"
};

const WORKFLOW_TRANSITIONS = {
  [WORKFLOW_STATUSES.CREATED]: [WORKFLOW_STATUSES.INITIAL_ADJUSTED],
  [WORKFLOW_STATUSES.INITIAL_ADJUSTED]: [WORKFLOW_STATUSES.PENDING_RETEST],
  [WORKFLOW_STATUSES.PENDING_RETEST]: [WORKFLOW_STATUSES.RETEST_FAILED, WORKFLOW_STATUSES.QUALIFIED],
  [WORKFLOW_STATUSES.RETEST_FAILED]: [WORKFLOW_STATUSES.PENDING_RETEST],
  [WORKFLOW_STATUSES.QUALIFIED]: [WORKFLOW_STATUSES.ARCHIVED, WORKFLOW_STATUSES.PENDING_RETEST],
  [WORKFLOW_STATUSES.ARCHIVED]: []
};

const WORKFLOW_OPERATIONS = {
  INITIAL_ADJUST: "initial_adjust",
  SUBMIT_RETEST: "submit_retest",
  COMPLETE_RETEST: "complete_retest",
  REWORK: "rework",
  ARCHIVE: "archive"
};

function deriveWorkflowStatus(db, clockId) {
  const clockAdjustments = db.adjustments
    .filter((a) => a.clockId === clockId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const clockRetests = db.retests
    .filter((r) => r.clockId === clockId)
    .sort((a, b) => new Date(a.testedAt) - new Date(b.testedAt));

  if (clockAdjustments.length === 0 && clockRetests.length === 0) {
    return WORKFLOW_STATUSES.CREATED;
  }

  if (clockAdjustments.length > 0) {
    const latestAdj = clockAdjustments[clockAdjustments.length - 1];

    if (clockRetests.length === 0) {
      if (latestAdj.workflowOperation === WORKFLOW_OPERATIONS.INITIAL_ADJUST) {
        return WORKFLOW_STATUSES.INITIAL_ADJUSTED;
      }
      return WORKFLOW_STATUSES.PENDING_RETEST;
    }

    const latestRetest = clockRetests[clockRetests.length - 1];
    const adjTime = new Date(latestAdj.createdAt);
    const retestTime = new Date(latestRetest.testedAt);

    if (adjTime > retestTime) {
      return WORKFLOW_STATUSES.PENDING_RETEST;
    }

    if (latestRetest.qualified) {
      const archivedFlag = db.clocks.find((c) => c.id === clockId)?.workflowArchived;
      if (archivedFlag) {
        return WORKFLOW_STATUSES.ARCHIVED;
      }
      return WORKFLOW_STATUSES.QUALIFIED;
    } else {
      return WORKFLOW_STATUSES.RETEST_FAILED;
    }
  }

  return WORKFLOW_STATUSES.CREATED;
}

function canTransition(currentStatus, targetStatus) {
  const allowed = WORKFLOW_TRANSITIONS[currentStatus] || [];
  return allowed.includes(targetStatus);
}

function validateWorkflowTransition(currentStatus, operation) {
  let targetStatus = null;
  switch (operation) {
    case WORKFLOW_OPERATIONS.INITIAL_ADJUST:
      targetStatus = WORKFLOW_STATUSES.INITIAL_ADJUSTED;
      break;
    case WORKFLOW_OPERATIONS.SUBMIT_RETEST:
      targetStatus = WORKFLOW_STATUSES.PENDING_RETEST;
      break;
    case WORKFLOW_OPERATIONS.REWORK:
      targetStatus = WORKFLOW_STATUSES.PENDING_RETEST;
      break;
    case WORKFLOW_OPERATIONS.ARCHIVE:
      targetStatus = WORKFLOW_STATUSES.ARCHIVED;
      break;
    default:
      targetStatus = null;
  }
  if (targetStatus && !canTransition(currentStatus, targetStatus)) {
    const error = new Error(
      `当前状态【${WORKFLOW_STATUS_LABELS[currentStatus]}】不允许执行【${operation}】操作`
    );
    error.status = 400;
    error.code = "INVALID_WORKFLOW_TRANSITION";
    error.currentStatus = currentStatus;
    error.operation = operation;
    throw error;
  }
  return targetStatus;
}

function getWorkflowAllowedOperations(currentStatus) {
  const allowed = [];
  switch (currentStatus) {
    case WORKFLOW_STATUSES.CREATED:
      allowed.push(WORKFLOW_OPERATIONS.INITIAL_ADJUST);
      break;
    case WORKFLOW_STATUSES.INITIAL_ADJUSTED:
      allowed.push(WORKFLOW_OPERATIONS.SUBMIT_RETEST);
      break;
    case WORKFLOW_STATUSES.PENDING_RETEST:
      allowed.push(WORKFLOW_OPERATIONS.COMPLETE_RETEST);
      break;
    case WORKFLOW_STATUSES.RETEST_FAILED:
      allowed.push(WORKFLOW_OPERATIONS.REWORK);
      break;
    case WORKFLOW_STATUSES.QUALIFIED:
      allowed.push(WORKFLOW_OPERATIONS.ARCHIVE, WORKFLOW_OPERATIONS.SUBMIT_RETEST);
      break;
    case WORKFLOW_STATUSES.ARCHIVED:
      break;
  }
  return allowed;
}

function buildWorkflowStatusInfo(db, clockId) {
  const status = deriveWorkflowStatus(db, clockId);
  const allowedOperations = getWorkflowAllowedOperations(status);
  const adjustments = db.adjustments
    .filter((a) => a.clockId === clockId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const retests = db.retests
    .filter((r) => r.clockId === clockId)
    .sort((a, b) => new Date(a.testedAt) - new Date(b.testedAt));

  return {
    clockId,
    status,
    statusLabel: WORKFLOW_STATUS_LABELS[status],
    allowedOperations,
    adjustmentCount: adjustments.length,
    retestCount: retests.length,
    latestAdjustment: adjustments.length > 0 ? adjustments[adjustments.length - 1] : null,
    latestRetest: retests.length > 0 ? retests[retests.length - 1] : null,
    transitions: WORKFLOW_TRANSITIONS,
    statusLabels: WORKFLOW_STATUS_LABELS
  };
}

const CLOCK_KEY_FIELDS = [
  "code",
  "escapementType",
  "balanceFrequency",
  "targetDailyRateSeconds",
  "note"
];

const RETEST_TASK_KEY_FIELDS = [
  "plannedRetestAt",
  "priority",
  "status",
  "note"
];

const USER_KEY_FIELDS = [
  "username",
  "name",
  "role"
];

const BACKUP_KEY_FIELDS = [
  "id",
  "createdAt",
  "size",
  "counts"
];

const WORKFLOW_KEY_FIELDS = [
  "workflowArchived",
  "workflowArchivedAt",
  "workflowArchiveNote"
];

const routes = [
  "GET /health",
  "GET /auth/me",
  "POST /auth/login",
  "GET /users",
  "POST /users",
  "PUT /users/:id",
  "DELETE /users/:id",
  "GET /overview",
  "GET /workflow/statuses",
  "GET /clocks",
  "POST /clocks",
  "PUT /clocks/:id",
  "PUT /clocks/:id/assign",
  "POST /clocks/import/preview",
  "POST /clocks/import",
  "GET /clocks/not-qualified",
  "GET /clocks/:id/history",
  "GET /clocks/:id/audit-logs",
  "GET /audit-logs",
  "GET /clocks/:id/health-score",
  "GET /clocks/:id/workflow-status",
  "POST /clocks/:id/workflow/initial-adjust",
  "POST /clocks/:id/workflow/submit-retest",
  "POST /clocks/:id/workflow/complete-retest",
  "POST /clocks/:id/workflow/rework",
  "POST /clocks/:id/workflow/archive",
  "POST /clocks/:id/adjustments",
  "POST /clocks/:id/retests",
  "GET /clocks/:id/latest-retest",
  "GET /clocks/:id/handovers",
  "POST /clocks/:id/handovers",
  "GET /clocks/:id/handover-timeline",
  "POST /clocks/:id/suggestions/generate",
  "POST /clocks/:id/suggestions",
  "GET /clocks/:id/suggestions",
  "GET /clocks/health-scores",
  "GET /suggestions",
  "GET /suggestions/:id",
  "PATCH /suggestions/:id/status",
  "GET /adjustments",
  "GET /retests",
  "GET /retest-tasks",
  "POST /clocks/:id/retest-tasks",
  "GET /clocks/:id/retest-tasks",
  "PUT /retest-tasks/:id",
  "POST /retest-tasks/:id/cancel",
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

const DEFAULT_HEALTH_SCORE_RULES_VERSION = "default";
const DEFAULT_HEALTH_SCORE_RULES_SOURCE = "system_default";

function getHealthScoreRulesForEscapement(db, escapementType) {
  const rules = db.healthScoreRules || [];
  const matched = rules.find(
    (r) => r.escapementType && r.escapementType.trim() === escapementType?.trim() && r.enabled !== false
  );
  if (matched) {
    return {
      rules: matched.rules,
      version: matched.version,
      source: "custom",
      ruleId: matched.id,
      escapementType: matched.escapementType
    };
  }
  return {
    rules: HEALTH_SCORE_RULES,
    version: DEFAULT_HEALTH_SCORE_RULES_VERSION,
    source: DEFAULT_HEALTH_SCORE_RULES_SOURCE,
    ruleId: null,
    escapementType: null
  };
}

function validateHealthScoreRulesConfig(rules) {
  const errors = [];
  if (!rules || typeof rules !== "object") {
    return ["规则配置必须是对象"];
  }
  if (typeof rules.recentRetestCount !== "number" || rules.recentRetestCount < 1) {
    errors.push("recentRetestCount 必须是大于0的数字");
  }
  if (typeof rules.minRetestCount !== "number" || rules.minRetestCount < 1) {
    errors.push("minRetestCount 必须是大于0的数字");
  }
  if (!rules.weights || typeof rules.weights !== "object") {
    errors.push("weights 必须是对象");
  } else {
    if (typeof rules.weights.dailyRateStability !== "number") errors.push("weights.dailyRateStability 必须是数字");
    if (typeof rules.weights.amplitudeStability !== "number") errors.push("weights.amplitudeStability 必须是数字");
    if (typeof rules.weights.consecutiveQualified !== "number") errors.push("weights.consecutiveQualified 必须是数字");
  }
  if (!rules.dailyRate || typeof rules.dailyRate !== "object") {
    errors.push("dailyRate 必须是对象");
  }
  if (!rules.amplitude || typeof rules.amplitude !== "object") {
    errors.push("amplitude 必须是对象");
  }
  if (!rules.consecutive || typeof rules.consecutive !== "object") {
    errors.push("consecutive 必须是对象");
  }
  if (!rules.thresholds || typeof rules.thresholds !== "object") {
    errors.push("thresholds 必须是对象");
  }
  if (!rules.conclusions || typeof rules.conclusions !== "object") {
    errors.push("conclusions 必须是对象");
  }
  return errors;
}

const CLOCK_REQUIRED_FIELDS = ["code", "escapementType", "balanceFrequency"];

function normalizeClockItem(rawItem) {
  const normalized = {};
  const changes = {};

  if (rawItem.code !== undefined) {
    const original = rawItem.code;
    const trimmed = typeof original === "string" ? original.trim() : original;
    normalized.code = trimmed;
    if (original !== trimmed) changes.code = { before: original, after: trimmed };
  }

  if (rawItem.escapementType !== undefined) {
    const original = rawItem.escapementType;
    const trimmed = typeof original === "string" ? original.trim() : original;
    normalized.escapementType = trimmed;
    if (original !== trimmed) changes.escapementType = { before: original, after: trimmed };
  }

  if (rawItem.balanceFrequency !== undefined) {
    const original = rawItem.balanceFrequency;
    const trimmed = typeof original === "string" ? original.trim() : original;
    normalized.balanceFrequency = trimmed;
    if (original !== trimmed) changes.balanceFrequency = { before: original, after: trimmed };
  }

  if (rawItem.targetDailyRateSeconds !== undefined && rawItem.targetDailyRateSeconds !== "") {
    normalized.targetDailyRateSeconds = rawItem.targetDailyRateSeconds;
  }

  if (rawItem.note !== undefined) {
    normalized.note = rawItem.note;
  }

  if (rawItem.assignedTechnicianId !== undefined) {
    normalized.assignedTechnicianId = rawItem.assignedTechnicianId;
  }

  return { normalized, changes };
}

function validateTargetDailyRateSeconds(value) {
  if (value === undefined || value === "" || value === null) return { valid: true, normalized: undefined };
  const num = Number(value);
  if (isNaN(num)) return { valid: false, reason: `targetDailyRateSeconds 必须是数字，当前值：${value}` };
  if (!isFinite(num)) return { valid: false, reason: `targetDailyRateSeconds 必须是有限数字，当前值：${value}` };
  return { valid: true, normalized: num };
}

function resolveTechnician(db, input) {
  if (!input) return { resolved: null, summary: null, error: null };
  const trimmed = typeof input === "string" ? input.trim() : input;
  if (!trimmed) return { resolved: null, summary: null, error: null };

  let user = db.users.find((u) => u.id === trimmed);
  let matchedBy = user ? "id" : null;

  if (!user) {
    user = db.users.find((u) => u.username === trimmed);
    matchedBy = user ? "username" : null;
  }

  if (!user) {
    return {
      resolved: null,
      summary: null,
      error: `未找到匹配的负责人：${trimmed}（支持用户ID或用户名）`
    };
  }

  return {
    resolved: user.id,
    summary: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      matchedBy
    },
    error: null
  };
}

function classifyImportItems(db, items) {
  const existingCodes = new Set(db.clocks.map((c) => c.code));
  const seenInBatch = new Set();
  const importable = [];
  const unimportable = [];

  for (let i = 0; i < items.length; i++) {
    const rawItem = items[i];
    const { normalized, changes } = normalizeClockItem(rawItem);
    const reasons = [];

    const missing = CLOCK_REQUIRED_FIELDS.filter(
      (f) => normalized[f] === undefined || normalized[f] === ""
    );
    if (missing.length > 0) {
      reasons.push(`缺少必填字段：${missing.join("、")}`);
    }

    const rateValidation = validateTargetDailyRateSeconds(normalized.targetDailyRateSeconds);
    if (!rateValidation.valid) {
      reasons.push(rateValidation.reason);
    }

    const techInput = normalized.assignedTechnicianId;
    const techResult = resolveTechnician(db, techInput);
    if (techInput && techResult.error) {
      reasons.push(techResult.error);
    }

    if (normalized.code && (existingCodes.has(normalized.code) || seenInBatch.has(normalized.code))) {
      reasons.push(`编号已存在：${normalized.code}`);
    }

    if (normalized.code) {
      seenInBatch.add(normalized.code);
    }

    const finalRate = rateValidation.valid ? rateValidation.normalized : undefined;

    if (reasons.length > 0) {
      unimportable.push({
        index: i,
        rawItem,
        normalized,
        changes,
        reasons,
        targetDailyRateSecondsValid: rateValidation.valid,
        technician: techResult.summary
          ? { ...techResult.summary, resolved: techResult.resolved }
          : techInput
          ? { input: techInput, error: techResult.error }
          : null
      });
    } else {
      importable.push({
        index: i,
        rawItem,
        normalized,
        changes,
        targetDailyRateSeconds: finalRate ?? 30,
        technician: techResult.summary
          ? { ...techResult.summary, resolved: techResult.resolved }
          : null
      });
    }
  }

  return {
    importable,
    unimportable,
    summary: {
      total: items.length,
      importable: importable.length,
      unimportable: unimportable.length
    }
  };
}

function buildClockFromItem(item, globalTechnicianId) {
  const effectiveTechnicianId = item.technician?.resolved ?? globalTechnicianId ?? null;
  return {
    id: makeId("clock"),
    code: item.normalized.code,
    escapementType: item.normalized.escapementType,
    balanceFrequency: item.normalized.balanceFrequency,
    targetDailyRateSeconds: Number(item.targetDailyRateSeconds ?? 30),
    note: item.normalized.note || "",
    assignedTechnicianId: effectiveTechnicianId,
    createdAt: new Date().toISOString()
  };
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

function compactUser(user, fallbackName = "") {
  if (user) return { id: user.id, name: user.name, role: user.role };
  if (fallbackName) return { id: null, name: fallbackName, role: null };
  return null;
}

function listResolvedHandovers(db, clockId) {
  const clock = db.clocks.find((c) => c.id === clockId) || null;
  const initialOwnerId = clock ? (clock.createdBy || clock.assignedTechnicianId || null) : null;
  let previousId = initialOwnerId;
  let previousName = "";
  if (previousId) {
    const initialUser = db.users.find((u) => u.id === previousId) || null;
    previousName = initialUser ? initialUser.name : "";
  }

  return db.handovers
    .filter((item) => item.clockId === clockId)
    .slice()
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map((handover) => {
      const receiverUser = handover.receiverId ? db.users.find((u) => u.id === handover.receiverId) || null : null;
      const receiverName = receiverUser?.name || handover.receiver || "";
      const currentPreviousId = handover.previousTechnicianId || previousId || null;
      const previousUser = currentPreviousId ? db.users.find((u) => u.id === currentPreviousId) || null : null;
      const currentPreviousName = previousUser?.name || previousName || handover.previousTechnicianName || "（初始）";
      const enriched = enrichWithCreator(db, {
        ...handover,
        receiver: receiverName,
        receiverId: handover.receiverId || null,
        previousTechnicianId: currentPreviousId,
        previousTechnicianName: currentPreviousName
      });

      enriched.receiverUser = compactUser(receiverUser, receiverName);
      enriched.previousTechnicianUser = currentPreviousName === "（初始）"
        ? null
        : compactUser(previousUser, currentPreviousName);

      if (handover.receiverId) {
        previousId = handover.receiverId;
        previousName = receiverName;
      }
      return enriched;
    })
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
    case AUDIT_OPERATION_TYPES.HANDOVER_CREATE:
      return `交接记录：${afterSnapshot?.receiverName || afterSnapshot?.receiver || ""} 接手，备注：${afterSnapshot?.handoverNote || "无"}`;
    case AUDIT_OPERATION_TYPES.TECHNICIAN_ASSIGN:
      return `负责人变更：${beforeSnapshot?.technicianName || "无"} → ${afterSnapshot?.technicianName || "无"}`;
    case AUDIT_OPERATION_TYPES.SUGGESTION_CREATE:
      return `创建调校建议，${afterSnapshot?.deviationDescription || ""}，建议：${afterSnapshot?.conservativeAmount || ""}`;
    case AUDIT_OPERATION_TYPES.SUGGESTION_STATUS_UPDATE:
      const beforeStatus = beforeSnapshot?.status ? SUGGESTION_STATUS_LABELS[beforeSnapshot.status] || beforeSnapshot.status : "待处理";
      const afterStatus = afterSnapshot?.status ? SUGGESTION_STATUS_LABELS[afterSnapshot.status] || afterSnapshot.status : "";
      return `建议状态变更：${beforeStatus} → ${afterStatus}`;
    case AUDIT_OPERATION_TYPES.RETEST_TASK_CREATE:
      return `创建复测任务，计划时间：${afterSnapshot?.plannedRetestAt || ""}，优先级：${afterSnapshot?.priority || ""}`;
    case AUDIT_OPERATION_TYPES.RETEST_TASK_UPDATE:
      if (changedFields) {
        const fieldNames = changedFields.map((f) => f.field).join("、");
        return `更新复测任务，变更字段：${fieldNames}`;
      }
      return `更新复测任务`;
    case AUDIT_OPERATION_TYPES.RETEST_TASK_CANCEL:
      return `取消复测任务，原因：${afterSnapshot?.cancelReason || "无"}`;
    case AUDIT_OPERATION_TYPES.USER_CREATE:
      return `创建用户 ${afterSnapshot?.username || ""}（${afterSnapshot?.name || ""}），角色：${afterSnapshot?.role || ""}`;
    case AUDIT_OPERATION_TYPES.USER_UPDATE:
      if (changedFields) {
        const fieldNames = changedFields.map((f) => f.field).join("、");
        return `更新用户 ${afterSnapshot?.username || beforeSnapshot?.username || ""} 字段：${fieldNames}`;
      }
      return `更新用户 ${afterSnapshot?.username || beforeSnapshot?.username || ""}`;
    case AUDIT_OPERATION_TYPES.USER_DELETE:
      return `删除用户 ${beforeSnapshot?.username || ""}（${beforeSnapshot?.name || ""}）`;
    case AUDIT_OPERATION_TYPES.BACKUP_CREATE:
      return `创建数据备份 ${afterSnapshot?.id || ""}`;
    case AUDIT_OPERATION_TYPES.BACKUP_RESTORE:
      return `恢复数据备份 ${beforeSnapshot?.id || afterSnapshot?.id || ""}`;
    case AUDIT_OPERATION_TYPES.WORKFLOW_ARCHIVE:
      return `工作流归档，备注：${afterSnapshot?.workflowArchiveNote || "无"}`;
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
    changedFields,
    createdBy
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
    createdAt: new Date().toISOString(),
    createdBy: createdBy || DEFAULT_SYSTEM_USER_ID
  };
  db.auditLogs.push(log);
  return log;
}

function enrichAuditLog(db, log) {
  const safeLog = {
    id: log.id,
    operationType: log.operationType || null,
    resourceType: log.resourceType || null,
    resourceId: log.resourceId || null,
    clockId: log.clockId || null,
    beforeSnapshot: log.beforeSnapshot ?? null,
    afterSnapshot: log.afterSnapshot ?? null,
    changedFields: log.changedFields ?? null,
    summary: log.summary || null,
    createdAt: log.createdAt || null,
    createdBy: log.createdBy || null
  };

  const clock = safeLog.clockId ? (db.clocks.find((c) => c.id === safeLog.clockId) || null) : null;
  let resource = null;
  switch (safeLog.resourceType) {
    case AUDIT_RESOURCE_TYPES.CLOCK:
      resource = clock ? { id: clock.id, code: clock.code } : null;
      break;
    case AUDIT_RESOURCE_TYPES.ADJUSTMENT:
      resource = safeLog.resourceId ? (db.adjustments.find((a) => a.id === safeLog.resourceId) || null) : null;
      break;
    case AUDIT_RESOURCE_TYPES.RETEST:
      resource = safeLog.resourceId ? (db.retests.find((r) => r.id === safeLog.resourceId) || null) : null;
      break;
    case AUDIT_RESOURCE_TYPES.HANDOVER:
      resource = safeLog.resourceId ? (db.handovers.find((h) => h.id === safeLog.resourceId) || null) : null;
      break;
    case AUDIT_RESOURCE_TYPES.SUGGESTION:
      resource = safeLog.resourceId ? (db.suggestions.find((s) => s.id === safeLog.resourceId) || null) : null;
      break;
    case AUDIT_RESOURCE_TYPES.RETEST_TASK:
      resource = safeLog.resourceId ? ((db.retestTasks || []).find((t) => t.id === safeLog.resourceId) || null) : null;
      break;
    case AUDIT_RESOURCE_TYPES.USER:
      resource = safeLog.resourceId ? (db.users.find((u) => u.id === safeLog.resourceId) || null) : null;
      break;
    case AUDIT_RESOURCE_TYPES.BACKUP:
      resource = safeLog.resourceId ? { id: safeLog.resourceId } : null;
      break;
    case AUDIT_RESOURCE_TYPES.WORKFLOW:
      resource = clock ? { id: clock.id, code: clock.code } : null;
      break;
    default:
      resource = null;
  }
  return {
    ...safeLog,
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

function getRecentRetests(db, clockId, rules) {
  const count = rules ? rules.recentRetestCount : HEALTH_SCORE_RULES.recentRetestCount;
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

function calculateDailyRateScore(retests, rules) {
  const dailyRates = retests.map((r) => r.dailyRateSeconds);
  const stdDev = calculateStdDev(dailyRates);
  const dailyRateRules = rules ? rules.dailyRate : HEALTH_SCORE_RULES.dailyRate;

  if (stdDev <= dailyRateRules.excellentStdDev) {
    return { score: dailyRateRules.excellentScore, stdDev, level: "excellent" };
  } else if (stdDev <= dailyRateRules.goodStdDev) {
    return { score: dailyRateRules.goodScore, stdDev, level: "good" };
  } else if (stdDev <= dailyRateRules.fairStdDev) {
    return { score: dailyRateRules.fairScore, stdDev, level: "fair" };
  }
  return { score: dailyRateRules.poorScore, stdDev, level: "poor" };
}

function calculateAmplitudeScore(retests, rules) {
  const amplitudes = retests.map((r) => r.amplitude);
  const stdDev = calculateStdDev(amplitudes);
  const amplitudeRules = rules ? rules.amplitude : HEALTH_SCORE_RULES.amplitude;

  let baseScore;
  let level;
  if (stdDev <= amplitudeRules.excellentStdDev) {
    baseScore = amplitudeRules.excellentScore;
    level = "excellent";
  } else if (stdDev <= amplitudeRules.goodStdDev) {
    baseScore = amplitudeRules.goodScore;
    level = "good";
  } else if (stdDev <= amplitudeRules.fairStdDev) {
    baseScore = amplitudeRules.fairScore;
    level = "fair";
  } else {
    baseScore = amplitudeRules.poorScore;
    level = "poor";
  }

  const avgAmplitude = amplitudes.reduce((sum, v) => sum + v, 0) / amplitudes.length;
  const abnormalCount = amplitudes.filter(
    (a) => a < amplitudeRules.lowAmplitudeThreshold || a > amplitudeRules.highAmplitudeThreshold
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

function calculateConsecutiveScore(retests, rules) {
  const consecutiveRules = rules ? rules.consecutive : HEALTH_SCORE_RULES.consecutive;
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
    return { score: consecutiveRules.noneFailed, maxConsecutiveFailed, level: "excellent" };
  } else if (maxConsecutiveFailed === 1) {
    return { score: consecutiveRules.twoFailed, maxConsecutiveFailed, level: "good" };
  } else if (maxConsecutiveFailed === 2) {
    return { score: consecutiveRules.twoFailed, maxConsecutiveFailed, level: "fair" };
  }
  return { score: consecutiveRules.threeOrMoreFailed, maxConsecutiveFailed, level: "poor" };
}

function calculateHealthScore(db, clock) {
  const ruleInfo = getHealthScoreRulesForEscapement(db, clock.escapementType);
  const rules = ruleInfo.rules;
  const recentRetests = getRecentRetests(db, clock.id, rules);

  if (recentRetests.length < rules.minRetestCount) {
    const conclusionKey = "insufficient";
    return {
      clockId: clock.id,
      clockCode: clock.code,
      escapementType: clock.escapementType,
      totalScore: null,
      conclusion: rules.conclusions[conclusionKey],
      conclusionKey,
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
      rulesVersion: ruleInfo.version,
      rulesSource: ruleInfo.source,
      ruleId: ruleInfo.ruleId
    };
  }

  const dailyRateResult = calculateDailyRateScore(recentRetests, rules);
  const amplitudeResult = calculateAmplitudeScore(recentRetests, rules);
  const consecutiveResult = calculateConsecutiveScore(recentRetests, rules);

  const totalScore = dailyRateResult.score + amplitudeResult.score + consecutiveResult.score;

  let conclusionKey;
  if (totalScore >= rules.thresholds.stable) {
    conclusionKey = "stable";
  } else if (totalScore >= rules.thresholds.observe) {
    conclusionKey = "observe";
  } else {
    conclusionKey = "rework";
  }
  const conclusion = rules.conclusions[conclusionKey];

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
    escapementType: clock.escapementType,
    totalScore,
    conclusion,
    conclusionKey,
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
    rulesVersion: ruleInfo.version,
    rulesSource: ruleInfo.source,
    ruleId: ruleInfo.ruleId
  };
}

function clockSummary(db, clock) {
  const retest = latestRetest(db, clock.id);
  const adjustment = latestAdjustment(db, clock.id);
  const workflowStatus = deriveWorkflowStatus(db, clock.id);
  const assignedTechnician = clock.assignedTechnicianId
    ? db.users.find((u) => u.id === clock.assignedTechnicianId) || null
    : null;
  return {
    ...clock,
    latestAdjustment: adjustment,
    latestRetest: retest,
    qualified: retest ? retest.qualified : false,
    workflowStatus,
    workflowStatusLabel: WORKFLOW_STATUS_LABELS[workflowStatus],
    assignedTechnician: assignedTechnician
      ? { id: assignedTechnician.id, name: assignedTechnician.name, role: assignedTechnician.role }
      : null
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

function buildOverview(db, user) {
  const accessibleClocks = user ? filterClocksByUser(db, user) : db.clocks;
  const statusBuckets = {
    pendingRetest: [],
    retestFailed: [],
    qualified: [],
    neverRetested: []
  };

  for (const clock of accessibleClocks) {
    const status = classifyClockStatus(db, clock);
    const summary = clockSummary(db, clock);
    statusBuckets[status].push(summary);
  }

  const overview = {
    totalClocks: accessibleClocks.length,
    pendingRetest: statusBuckets.pendingRetest.length,
    retestFailed: statusBuckets.retestFailed.length,
    qualified: statusBuckets.qualified.length,
    neverRetested: statusBuckets.neverRetested.length
  };

  const accessibleClockIds = new Set(accessibleClocks.map((c) => c.id));
  const accessibleAdjustments = db.adjustments.filter((a) => accessibleClockIds.has(a.clockId));
  const accessibleRetests = db.retests.filter((r) => accessibleClockIds.has(r.clockId));

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 86400000);
  const accessibleRetestTasks = (db.retestTasks || []).filter((t) => accessibleClockIds.has(t.clockId));
  const pendingTasks = accessibleRetestTasks.filter((t) => t.status === "pending");

  let todayPendingRetest = 0;
  let overdueRetest = 0;
  let highPriorityPendingRetest = 0;

  for (const task of pendingTasks) {
    const planned = new Date(task.plannedRetestAt);
    if (task.priority === "high") highPriorityPendingRetest++;
    if (planned < todayStart) {
      overdueRetest++;
    } else if (planned >= todayStart && planned < todayEnd) {
      todayPendingRetest++;
    }
  }

  overview.todayPendingRetest = todayPendingRetest;
  overview.overdueRetest = overdueRetest;
  overview.highPriorityPendingRetest = highPriorityPendingRetest;

  const retestTaskPreviews = pendingTasks
    .slice()
    .sort((a, b) => new Date(a.plannedRetestAt) - new Date(b.plannedRetestAt))
    .slice(0, 5)
    .map((task) => enrichRetestTask(db, task, now));

  let latestAdjustmentAt = null;
  if (accessibleAdjustments.length > 0) {
    latestAdjustmentAt = accessibleAdjustments
      .map((a) => new Date(a.createdAt))
      .sort((a, b) => b - a)[0]
      .toISOString();
  }

  let latestRetestAt = null;
  if (accessibleRetests.length > 0) {
    latestRetestAt = accessibleRetests
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
    retestTaskPreviews,
    generatedAt: new Date().toISOString()
  };
}

function migrateDbAddCreatedBy(db) {
  let changed = false;
  if (db.clocks) {
    for (const clock of db.clocks) {
      if (!clock.createdBy) {
        clock.createdBy = DEFAULT_SYSTEM_USER_ID;
        changed = true;
      }
      if (!clock.assignedTechnicianId) {
        clock.assignedTechnicianId = DEFAULT_ADMIN_USER_ID;
        changed = true;
      }
    }
  }
  if (db.adjustments) {
    for (const item of db.adjustments) {
      if (!item.createdBy) {
        item.createdBy = DEFAULT_SYSTEM_USER_ID;
        changed = true;
      }
    }
  }
  if (db.retests) {
    for (const item of db.retests) {
      if (!item.createdBy) {
        item.createdBy = DEFAULT_SYSTEM_USER_ID;
        changed = true;
      }
    }
  }
  if (db.handovers) {
    for (const item of db.handovers) {
      if (!item.createdBy) {
        item.createdBy = DEFAULT_SYSTEM_USER_ID;
        changed = true;
      }
    }
  }
  if (db.retestTasks) {
    for (const item of db.retestTasks) {
      if (!item.createdBy) {
        item.createdBy = DEFAULT_SYSTEM_USER_ID;
        changed = true;
      }
    }
  }
  if (db.suggestions) {
    for (const item of db.suggestions) {
      if (!item.createdBy) {
        item.createdBy = DEFAULT_SYSTEM_USER_ID;
        changed = true;
      }
    }
  }
  if (db.auditLogs) {
    for (const item of db.auditLogs) {
      if (!item.createdBy) {
        item.createdBy = DEFAULT_SYSTEM_USER_ID;
        changed = true;
      }
    }
  }
  return changed;
}

function migrateDbAddRetestTaskCancelFields(db) {
  let changed = false;
  if (db.retestTasks) {
    for (const item of db.retestTasks) {
      if (!item.cancelledAt) {
        item.cancelledAt = null;
        changed = true;
      }
      if (!item.cancelledBy) {
        item.cancelledBy = null;
        changed = true;
      }
      if (!item.cancelReason) {
        item.cancelReason = null;
        changed = true;
      }
    }
  }
  return changed;
}

function migrateDbAddHandoverFields(db) {
  let changed = false;
  if (db.handovers) {
    const clocksHandovers = {};
    for (const item of db.handovers) {
      if (!clocksHandovers[item.clockId]) clocksHandovers[item.clockId] = [];
      clocksHandovers[item.clockId].push(item);
    }
    for (const [clockId, items] of Object.entries(clocksHandovers)) {
      items.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      const clock = db.clocks.find((c) => c.id === clockId);
      let lastReceiverId = clock ? (clock.createdBy || clock.assignedTechnicianId || null) : null;
      let lastReceiverName = null;
      if (lastReceiverId) {
        const u = db.users.find((usr) => usr.id === lastReceiverId);
        lastReceiverName = u ? u.name : null;
      }
      for (let i = 0; i < items.length; i++) {
        const h = items[i];
        let hChanged = false;
        if (!h.receiverId) {
          const receiverUser = db.users.find((u) => u.name === h.receiver || u.username === h.receiver);
          if (receiverUser) {
            h.receiverId = receiverUser.id;
          } else {
            h.receiverId = null;
          }
          hChanged = true;
        }
        if (!h.previousTechnicianId || h.previousTechnicianId === null) {
          h.previousTechnicianId = lastReceiverId;
          hChanged = true;
        }
        if (h.previousTechnicianId && (!h.previousTechnicianName || h.previousTechnicianName === "")) {
          const prevUser = db.users.find((u) => u.id === h.previousTechnicianId);
          if (prevUser) {
            h.previousTechnicianName = prevUser.name;
            hChanged = true;
          }
        }
        if (hChanged) changed = true;
        if (h.receiverId) {
          lastReceiverId = h.receiverId;
          const u = db.users.find((usr) => usr.id === h.receiverId);
          lastReceiverName = u ? u.name : h.receiver || null;
        }
      }
    }
  }
  return changed;
}

async function ensureDb() {
  await mkdir(path.dirname(DB_FILE), { recursive: true });
  let dbData;
  try {
    dbData = JSON.parse(await readFile(DB_FILE, "utf8"));
  } catch {
    await writeFile(DB_FILE, JSON.stringify(initialData, null, 2));
    return;
  }
  const needsMigration1 = migrateDbAddCreatedBy(dbData);
  const needsMigration2 = migrateDbAddRetestTaskCancelFields(dbData);
  const needsMigration3 = migrateDbAddHandoverFields(dbData);
  const needsMigration4 = migrateDbAddHealthScoreRules(dbData);
  const needsMigration5 = migrateDbAddSuggestionStatusFields(dbData);
  if (!dbData.users || dbData.users.length === 0) {
    dbData.users = [...initialData.users];
    migrateDbAddCreatedBy(dbData);
  }
  if (needsMigration1 || needsMigration2 || needsMigration3 || needsMigration4 || needsMigration5 || !dbData.users) {
    await writeFile(DB_FILE, JSON.stringify(dbData, null, 2));
  }
}

function migrateDbAddHealthScoreRules(dbData) {
  let changed = false;
  if (!dbData.healthScoreRules || !Array.isArray(dbData.healthScoreRules)) {
    dbData.healthScoreRules = [];
    changed = true;
  }
  return changed;
}

function migrateDbAddSuggestionStatusFields(dbData) {
  let changed = false;
  if (dbData.suggestions) {
    for (const item of dbData.suggestions) {
      if (!item.status) {
        item.status = SUGGESTION_STATUSES.PENDING;
        changed = true;
      }
      if (!item.processedBy) {
        item.processedBy = null;
        changed = true;
      }
      if (!item.processedAt) {
        item.processedAt = null;
        changed = true;
      }
      if (!item.appliedAdjustmentId) {
        item.appliedAdjustmentId = null;
        changed = true;
      }
    }
  }
  return changed;
}

function findPendingSuggestionsByClockId(db, clockId) {
  return (db.suggestions || []).filter(
    (s) => s.clockId === clockId && s.status === SUGGESTION_STATUSES.PENDING
  );
}

function enrichWithProcessor(db, item) {
  if (!item) return item;
  const processor = item.processedBy ? db.users.find((u) => u.id === item.processedBy) || null : null;
  const appliedAdjustment = item.appliedAdjustmentId
    ? db.adjustments.find((a) => a.id === item.appliedAdjustmentId) || null
    : null;
  return {
    ...item,
    processor: processor ? { id: processor.id, name: processor.name, role: processor.role } : null,
    statusLabel: SUGGESTION_STATUS_LABELS[item.status] || item.status,
    appliedAdjustment
  };
}

function enrichSuggestion(db, suggestion) {
  if (!suggestion) return suggestion;
  const referenceRetest = db.retests.find((r) => r.id === suggestion.referenceRetestId) || null;
  const referenceAdjustment = db.adjustments.find((a) => a.id === suggestion.referenceAdjustmentId) || null;
  return enrichWithProcessor(
    db,
    enrichWithCreator(db, {
      ...suggestion,
      referenceRetest,
      referenceAdjustment
    })
  );
}

function getCurrentUser(req, db) {
  const userId = req.headers["x-user-id"];
  if (userId) {
    return db.users.find((u) => u.id === userId) || null;
  }
  return db.users.find((u) => u.id === DEFAULT_SYSTEM_USER_ID) || null;
}

function requireAuth(req, db) {
  const user = getCurrentUser(req, db);
  if (!user) {
    const error = new Error("未授权，请通过 X-User-Id 头传递用户ID");
    error.status = 401;
    error.code = "UNAUTHORIZED";
    throw error;
  }
  return user;
}

function requireAdmin(req, db) {
  const user = requireAuth(req, db);
  if (user.role !== USER_ROLES.ADMIN) {
    const error = new Error("需要管理员权限");
    error.status = 403;
    error.code = "FORBIDDEN";
    throw error;
  }
  return user;
}

function canAccessClock(clock, user) {
  if (!user) return false;
  if (user.role === USER_ROLES.ADMIN) return true;
  return clock.assignedTechnicianId === user.id;
}

function filterClocksByUser(db, user) {
  if (!user) return [];
  if (user.role === USER_ROLES.ADMIN) return db.clocks;
  return db.clocks.filter((c) => c.assignedTechnicianId === user.id);
}

function findUser(db, userId) {
  const user = db.users.find((u) => u.id === userId);
  if (!user) {
    const error = new Error("用户不存在");
    error.status = 404;
    throw error;
  }
  return user;
}

function userSummary(user) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt
  };
}

function enrichWithCreator(db, item) {
  if (!item) return item;
  const creator = db.users.find((u) => u.id === item.createdBy) || null;
  return {
    ...item,
    creator: creator ? { id: creator.id, name: creator.name, role: creator.role } : null
  };
}

function enrichWithCanceller(db, item) {
  if (!item) return item;
  const canceller = db.users.find((u) => u.id === item.cancelledBy) || null;
  return {
    ...item,
    canceller: canceller ? { id: canceller.id, name: canceller.name, role: canceller.role } : null
  };
}

function enrichRetestTask(db, task, now) {
  if (!task) return task;
  const enriched = enrichWithCanceller(db, enrichWithCreator(db, {
    ...task,
    clock: db.clocks.find((c) => c.id === task.clockId) || null,
    adjustment: db.adjustments.find((a) => a.id === task.adjustmentId) || null,
    overdue: task.status === "pending" && new Date(task.plannedRetestAt) < (now || new Date())
  }));
  return enriched;
}

function canManageRetestTask(db, task, user) {
  if (!user) return false;
  if (user.role === USER_ROLES.ADMIN) return true;
  const clock = db.clocks.find((c) => c.id === task.clockId);
  if (!clock) return false;
  return clock.assignedTechnicianId === user.id;
}

function findRetestTask(db, taskId) {
  const task = (db.retestTasks || []).find((t) => t.id === taskId);
  if (!task) {
    const error = new Error("复测任务不存在");
    error.status = 404;
    throw error;
  }
  return task;
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const db = await readDb();
  const currentUser = getCurrentUser(req, db);

  if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    try {
      const html = await readFile(path.join(__dirname, "index.html"), "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    } catch {
      const error = new Error("前端页面未找到");
      error.status = 404;
      throw error;
    }
  }

  if (req.method === "GET" && pathname === "/health") {
    return send(res, 200, { ok: true, service: "clock-escapement-tuning-api", routes, authEnabled: true });
  }

  if (req.method === "GET" && pathname === "/auth/me") {
    const user = currentUser;
    if (!user) {
      return send(res, 200, { data: null, roles: USER_ROLES });
    }
    return send(res, 200, { data: userSummary(user), roles: USER_ROLES });
  }

  if (req.method === "POST" && pathname === "/auth/login") {
    const body = await parseBody(req);
    required(body, ["username"]);
    const user = db.users.find((u) => u.username === body.username);
    if (!user) {
      const error = new Error("用户不存在");
      error.status = 401;
      error.code = "INVALID_USER";
      throw error;
    }
    return send(res, 200, {
      data: {
        user: userSummary(user),
        token: user.id
      },
      message: "本地开发模式：请将 token 放入 X-User-Id 请求头中使用"
    });
  }

  if (req.method === "GET" && pathname === "/users") {
    requireAuth(req, db);
    const role = url.searchParams.get("role");
    let data = db.users.map((u) => userSummary(u));
    if (role) {
      data = data.filter((u) => u.role === role);
    }
    const stats = {
      total: db.users.length,
      admin: db.users.filter((u) => u.role === USER_ROLES.ADMIN).length,
      technician: db.users.filter((u) => u.role === USER_ROLES.TECHNICIAN).length
    };
    return send(res, 200, { data, stats, roles: USER_ROLES });
  }

  if (req.method === "POST" && pathname === "/users") {
    requireAdmin(req, db);
    const body = await parseBody(req);
    required(body, ["username", "name", "role"]);
    const validRoles = Object.values(USER_ROLES);
    if (!validRoles.includes(body.role)) {
      const error = new Error(`角色必须是 ${validRoles.join("/")}`);
      error.status = 400;
      throw error;
    }
    const existing = db.users.find((u) => u.username === body.username);
    if (existing) {
      const error = new Error("用户名已存在");
      error.status = 400;
      error.code = "USERNAME_EXISTS";
      throw error;
    }
    const user = {
      id: makeId("user"),
      username: body.username,
      name: body.name,
      role: body.role,
      createdAt: new Date().toISOString()
    };
    db.users.push(user);

    createAuditLog(db, {
      operationType: AUDIT_OPERATION_TYPES.USER_CREATE,
      resourceType: AUDIT_RESOURCE_TYPES.USER,
      resourceId: user.id,
      clockId: null,
      beforeSnapshot: null,
      afterSnapshot: extractKeyFields(user, USER_KEY_FIELDS),
      changedFields: null,
      createdBy: currentUser.id
    });

    await writeDb(db);
    return send(res, 201, { data: userSummary(user) });
  }

  const userUpdateMatch = pathname.match(/^\/users\/([^/]+)$/);
  if (userUpdateMatch && req.method === "PUT") {
    requireAdmin(req, db);
    const user = findUser(db, userUpdateMatch[1]);
    const body = await parseBody(req);
    const beforeSnapshot = extractKeyFields(user, USER_KEY_FIELDS);
    if (body.name !== undefined) user.name = body.name;
    if (body.role !== undefined) {
      const validRoles = Object.values(USER_ROLES);
      if (!validRoles.includes(body.role)) {
        const error = new Error(`角色必须是 ${validRoles.join("/")}`);
        error.status = 400;
        throw error;
      }
      user.role = body.role;
    }
    user.updatedAt = new Date().toISOString();
    const afterSnapshot = extractKeyFields(user, USER_KEY_FIELDS);
    const changedFields = summarizeFieldChanges(beforeSnapshot, afterSnapshot, USER_KEY_FIELDS);
    if (changedFields) {
      createAuditLog(db, {
        operationType: AUDIT_OPERATION_TYPES.USER_UPDATE,
        resourceType: AUDIT_RESOURCE_TYPES.USER,
        resourceId: user.id,
        clockId: null,
        beforeSnapshot,
        afterSnapshot,
        changedFields,
        createdBy: currentUser.id
      });
    }
    await writeDb(db);
    return send(res, 200, { data: userSummary(user) });
  }

  if (userUpdateMatch && req.method === "DELETE") {
    requireAdmin(req, db);
    const userId = userUpdateMatch[1];
    const userIndex = db.users.findIndex((u) => u.id === userId);
    if (userIndex === -1) {
      const error = new Error("用户不存在");
      error.status = 404;
      throw error;
    }
    if (userId === DEFAULT_SYSTEM_USER_ID || userId === DEFAULT_ADMIN_USER_ID) {
      const error = new Error("系统内置用户不可删除");
      error.status = 400;
      error.code = "CANNOT_DELETE_SYSTEM_USER";
      throw error;
    }
    const deletedUser = db.users.splice(userIndex, 1)[0];
    for (const clock of db.clocks) {
      if (clock.assignedTechnicianId === userId) {
        clock.assignedTechnicianId = null;
      }
    }

    createAuditLog(db, {
      operationType: AUDIT_OPERATION_TYPES.USER_DELETE,
      resourceType: AUDIT_RESOURCE_TYPES.USER,
      resourceId: deletedUser.id,
      clockId: null,
      beforeSnapshot: extractKeyFields(deletedUser, USER_KEY_FIELDS),
      afterSnapshot: null,
      changedFields: null,
      createdBy: currentUser.id
    });

    await writeDb(db);
    return send(res, 200, { data: userSummary(deletedUser) });
  }

  if (req.method === "GET" && pathname === "/health-score-rules") {
    requireAuth(req, db);
    const rules = db.healthScoreRules || [];
    return send(res, 200, {
      data: rules,
      defaultRules: HEALTH_SCORE_RULES,
      defaultVersion: DEFAULT_HEALTH_SCORE_RULES_VERSION,
      total: rules.length
    });
  }

  const healthScoreRuleDetailMatch = pathname.match(/^\/health-score-rules\/([^/]+)$/);
  if (healthScoreRuleDetailMatch && req.method === "GET") {
    requireAuth(req, db);
    const ruleId = healthScoreRuleDetailMatch[1];
    if (ruleId === "default") {
      return send(res, 200, {
        data: {
          id: "default",
          name: "系统默认规则",
          escapementType: null,
          version: DEFAULT_HEALTH_SCORE_RULES_VERSION,
          source: DEFAULT_HEALTH_SCORE_RULES_SOURCE,
          rules: HEALTH_SCORE_RULES,
          enabled: true,
          isDefault: true
        }
      });
    }
    const rule = (db.healthScoreRules || []).find((r) => r.id === ruleId);
    if (!rule) {
      const error = new Error("规则不存在");
      error.status = 404;
      throw error;
    }
    return send(res, 200, { data: rule });
  }

  if (req.method === "POST" && pathname === "/health-score-rules") {
    requireAdmin(req, db);
    const body = await parseBody(req);
    required(body, ["name", "escapementType", "version", "rules"]);

    const existingByEscapement = (db.healthScoreRules || []).find(
      (r) => r.escapementType?.trim() === body.escapementType.trim() && r.enabled !== false
    );
    if (existingByEscapement) {
      const error = new Error(`该擒纵类型已存在规则：${existingByEscapement.name}`);
      error.status = 400;
      error.code = "DUPLICATE_ESCAPEMENT_TYPE";
      throw error;
    }

    const validationErrors = validateHealthScoreRulesConfig(body.rules);
    if (validationErrors.length > 0) {
      const error = new Error(`规则配置无效：${validationErrors.join("；")}`);
      error.status = 400;
      error.code = "INVALID_RULES_CONFIG";
      throw error;
    }

    const now = new Date().toISOString();
    const rule = {
      id: makeId("hsr"),
      name: body.name,
      description: body.description || "",
      escapementType: body.escapementType,
      version: body.version,
      rules: body.rules,
      enabled: body.enabled !== undefined ? Boolean(body.enabled) : true,
      createdAt: now,
      updatedAt: now,
      createdBy: currentUser.id,
      updatedBy: currentUser.id
    };

    if (!db.healthScoreRules) db.healthScoreRules = [];
    db.healthScoreRules.push(rule);
    await writeDb(db);
    return send(res, 201, { data: rule });
  }

  if (healthScoreRuleDetailMatch && req.method === "PUT") {
    requireAdmin(req, db);
    const ruleId = healthScoreRuleDetailMatch[1];
    if (ruleId === "default") {
      const error = new Error("默认规则不可修改");
      error.status = 400;
      throw error;
    }
    const rule = (db.healthScoreRules || []).find((r) => r.id === ruleId);
    if (!rule) {
      const error = new Error("规则不存在");
      error.status = 404;
      throw error;
    }
    const body = await parseBody(req);

    if (body.escapementType !== undefined) {
      const existingByEscapement = (db.healthScoreRules || []).find(
        (r) =>
          r.id !== ruleId &&
          r.escapementType?.trim() === body.escapementType.trim() &&
          r.enabled !== false
      );
      if (existingByEscapement) {
        const error = new Error(`该擒纵类型已存在规则：${existingByEscapement.name}`);
        error.status = 400;
        error.code = "DUPLICATE_ESCAPEMENT_TYPE";
        throw error;
      }
    }

    if (body.rules !== undefined) {
      const validationErrors = validateHealthScoreRulesConfig(body.rules);
      if (validationErrors.length > 0) {
        const error = new Error(`规则配置无效：${validationErrors.join("；")}`);
        error.status = 400;
        error.code = "INVALID_RULES_CONFIG";
        throw error;
      }
    }

    if (body.name !== undefined) rule.name = body.name;
    if (body.description !== undefined) rule.description = body.description;
    if (body.escapementType !== undefined) rule.escapementType = body.escapementType;
    if (body.version !== undefined) rule.version = body.version;
    if (body.rules !== undefined) rule.rules = body.rules;
    if (body.enabled !== undefined) rule.enabled = Boolean(body.enabled);
    rule.updatedAt = new Date().toISOString();
    rule.updatedBy = currentUser.id;

    await writeDb(db);
    return send(res, 200, { data: rule });
  }

  if (healthScoreRuleDetailMatch && req.method === "DELETE") {
    requireAdmin(req, db);
    const ruleId = healthScoreRuleDetailMatch[1];
    if (ruleId === "default") {
      const error = new Error("默认规则不可删除");
      error.status = 400;
      throw error;
    }
    const ruleIndex = (db.healthScoreRules || []).findIndex((r) => r.id === ruleId);
    if (ruleIndex === -1) {
      const error = new Error("规则不存在");
      error.status = 404;
      throw error;
    }
    const deletedRule = db.healthScoreRules.splice(ruleIndex, 1)[0];
    await writeDb(db);
    return send(res, 200, { data: deletedRule });
  }

  if (req.method === "GET" && pathname === "/overview") {
    requireAuth(req, db);
    return send(res, 200, { data: buildOverview(db, currentUser) });
  }

  if (req.method === "GET" && pathname === "/clocks") {
    requireAuth(req, db);
    const qualified = url.searchParams.get("qualified");
    const assignedTechnicianId = url.searchParams.get("assignedTechnicianId");
    let accessibleClocks = filterClocksByUser(db, currentUser);
    let data = accessibleClocks.map((clock) => clockSummary(db, clock));
    if (qualified !== null) {
      const expected = qualified === "true";
      data = data.filter((clock) => clock.qualified === expected);
    }
    if (assignedTechnicianId && currentUser.role === USER_ROLES.ADMIN) {
      data = data.filter((clock) => clock.assignedTechnicianId === assignedTechnicianId);
    }
    return send(res, 200, { data, total: data.length });
  }

  if (req.method === "POST" && pathname === "/clocks") {
    requireAuth(req, db);
    const body = await parseBody(req);
    required(body, ["code", "escapementType", "balanceFrequency"]);
    let assignedTechnicianId = body.assignedTechnicianId || null;
    if (assignedTechnicianId && currentUser.role !== USER_ROLES.ADMIN) {
      assignedTechnicianId = currentUser.id;
    }
    if (assignedTechnicianId) {
      const tech = db.users.find((u) => u.id === assignedTechnicianId);
      if (!tech) {
        const error = new Error("指定的负责人不存在");
        error.status = 400;
        throw error;
      }
    }
    const clock = {
      id: makeId("clock"),
      code: body.code,
      escapementType: body.escapementType,
      balanceFrequency: body.balanceFrequency,
      targetDailyRateSeconds: Number(body.targetDailyRateSeconds ?? 30),
      note: body.note || "",
      assignedTechnicianId,
      createdAt: new Date().toISOString(),
      createdBy: currentUser.id
    };
    db.clocks.push(clock);
    createAuditLog(db, {
      createdBy: currentUser.id,
      createdBy: currentUser.id,
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
    requireAdmin(req, db);
    const clock = findClock(db, clockUpdateMatch[1]);
    const body = await parseBody(req);

    const beforeKeySnapshot = extractKeyFields(clock, CLOCK_KEY_FIELDS);

    if (body.code !== undefined) clock.code = body.code;
    if (body.escapementType !== undefined) clock.escapementType = body.escapementType;
    if (body.balanceFrequency !== undefined) clock.balanceFrequency = body.balanceFrequency;
    if (body.targetDailyRateSeconds !== undefined) clock.targetDailyRateSeconds = Number(body.targetDailyRateSeconds);
    if (body.note !== undefined) clock.note = body.note || "";
    if (body.assignedTechnicianId !== undefined && currentUser.role === USER_ROLES.ADMIN) {
      if (body.assignedTechnicianId) {
        const tech = db.users.find((u) => u.id === body.assignedTechnicianId);
        if (!tech) {
          const error = new Error("指定的负责人不存在");
          error.status = 400;
          throw error;
        }
      }
      clock.assignedTechnicianId = body.assignedTechnicianId || null;
    }
    clock.updatedAt = new Date().toISOString();

    const afterKeySnapshot = extractKeyFields(clock, CLOCK_KEY_FIELDS);
    const changedFields = summarizeFieldChanges(beforeKeySnapshot, afterKeySnapshot, CLOCK_KEY_FIELDS);

    if (changedFields) {
      createAuditLog(db, {
        createdBy: currentUser.id,
      createdBy: currentUser.id,
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

  const clockAssignMatch = pathname.match(/^\/clocks\/([^/]+)\/assign$/);
  if (clockAssignMatch && req.method === "PUT") {
    requireAdmin(req, db);
    const clock = findClock(db, clockAssignMatch[1]);
    const body = await parseBody(req);
    const { technicianId, handoverNote, nextStepSuggestion } = body;

    const previousTechnicianId = clock.assignedTechnicianId;
    const previousTechnician = previousTechnicianId
      ? db.users.find((u) => u.id === previousTechnicianId)
      : null;

    if (technicianId) {
      const tech = db.users.find((u) => u.id === technicianId);
      if (!tech) {
        const error = new Error("指定的技师不存在");
        error.status = 400;
        throw error;
      }
      if (tech.role !== USER_ROLES.TECHNICIAN && tech.role !== USER_ROLES.ADMIN) {
        const error = new Error("只能分配给技师或管理员");
        error.status = 400;
        throw error;
      }
    }

    const technicianChanged = previousTechnicianId !== (technicianId || null);
    let handoverRecord = null;

    if (technicianChanged && technicianId) {
      const receiverUser = db.users.find((u) => u.id === technicianId);
      handoverRecord = {
        id: makeId("handover"),
        clockId: clock.id,
        handoverNote: handoverNote || "",
        nextStepSuggestion: nextStepSuggestion || "",
        receiver: receiverUser ? receiverUser.name : "",
        receiverId: technicianId,
        previousTechnicianId: previousTechnicianId || null,
        previousTechnicianName: previousTechnician ? previousTechnician.name : "",
        createdAt: new Date().toISOString(),
        createdBy: currentUser.id
      };
      db.handovers.push(handoverRecord);

      createAuditLog(db, {
        operationType: AUDIT_OPERATION_TYPES.HANDOVER_CREATE,
        resourceType: AUDIT_RESOURCE_TYPES.HANDOVER,
        resourceId: handoverRecord.id,
        clockId: clock.id,
        beforeSnapshot: {
          previousTechnicianId: previousTechnicianId || null,
          previousTechnicianName: previousTechnician ? previousTechnician.name : ""
        },
        afterSnapshot: {
          receiverId: technicianId,
          receiverName: receiverUser ? receiverUser.name : "",
          handoverNote: handoverNote || "",
          nextStepSuggestion: nextStepSuggestion || ""
        },
        changedFields: null,
        createdBy: currentUser.id
      });
    }

    clock.assignedTechnicianId = technicianId || null;
    clock.updatedAt = new Date().toISOString();

    if (technicianChanged) {
      const newTechnician = technicianId ? db.users.find((u) => u.id === technicianId) : null;
      createAuditLog(db, {
        operationType: AUDIT_OPERATION_TYPES.TECHNICIAN_ASSIGN,
        resourceType: AUDIT_RESOURCE_TYPES.CLOCK,
        resourceId: clock.id,
        clockId: clock.id,
        beforeSnapshot: {
          technicianId: previousTechnicianId || null,
          technicianName: previousTechnician ? previousTechnician.name : "无"
        },
        afterSnapshot: {
          technicianId: technicianId || null,
          technicianName: newTechnician ? newTechnician.name : "无"
        },
        changedFields: [
          {
            field: "assignedTechnicianId",
            before: previousTechnicianId || null,
            after: technicianId || null
          }
        ],
        createdBy: currentUser.id
      });
    }

    await writeDb(db);
    const result = {
      data: clockSummary(db, clock),
      message: technicianId
        ? `已分配给 ${db.users.find((u) => u.id === technicianId).name}`
        : "已取消分配"
    };
    if (handoverRecord) {
      result.handover = enrichWithCreator(db, handoverRecord);
    }
    return send(res, 200, result);
  }

  if (req.method === "POST" && pathname === "/clocks/import/preview") {
    requireAdmin(req, db);
    const body = await parseBody(req);
    if (!Array.isArray(body.clocks)) {
      const error = new Error("请求体必须包含 clocks 数组");
      error.status = 400;
      throw error;
    }
    const globalTechInput = body.assignedTechnicianId;
    const globalTechResult = globalTechInput ? resolveTechnician(db, globalTechInput) : null;
    if (globalTechInput && globalTechResult?.error) {
      const error = new Error(globalTechResult.error);
      error.status = 400;
      throw error;
    }

    const { importable, unimportable, summary } = classifyImportItems(db, body.clocks);

    const importablePreview = importable.map(({ index, normalized, changes, targetDailyRateSeconds, technician }) => {
      const hasItemTech = technician?.resolved ? true : false;
      const effectiveTech = hasItemTech
        ? { ...technician, source: "item" }
        : globalTechResult && globalTechResult.resolved
        ? { ...globalTechResult.summary, resolved: globalTechResult.resolved, source: "global" }
        : null;
      return {
        index,
        normalized,
        changes,
        targetDailyRateSeconds,
        technician: effectiveTech
      };
    });

    const unimportablePreview = unimportable.map(({ index, rawItem, normalized, changes, reasons, technician }) => ({
      index,
      rawItem,
      normalized,
      changes,
      reasons,
      technician
    }));

    return send(res, 200, {
      summary: {
        ...summary,
        globalTechnician: globalTechResult && globalTechResult.summary
          ? { ...globalTechResult.summary, resolved: globalTechResult.resolved }
          : null
      },
      importable: importablePreview,
      unimportable: unimportablePreview
    });
  }

  if (req.method === "POST" && pathname === "/clocks/import") {
    requireAdmin(req, db);
    const body = await parseBody(req);
    if (!Array.isArray(body.clocks)) {
      const error = new Error("请求体必须包含 clocks 数组");
      error.status = 400;
      throw error;
    }
    const globalTechInput = body.assignedTechnicianId || null;
    const globalTechResult = globalTechInput ? resolveTechnician(db, globalTechInput) : null;
    if (globalTechInput && globalTechResult?.error) {
      const error = new Error(globalTechResult.error);
      error.status = 400;
      throw error;
    }
    const globalTechnicianId = globalTechResult?.resolved || null;

    const { importable, unimportable, summary } = classifyImportItems(db, body.clocks);
    const created = [];
    const createdResults = [];

    for (const classified of importable) {
      const clock = buildClockFromItem(classified, globalTechnicianId);
      clock.createdBy = currentUser.id;
      db.clocks.push(clock);
      createAuditLog(db, {
        createdBy: currentUser.id,
        operationType: AUDIT_OPERATION_TYPES.CLOCK_CREATE,
        resourceType: AUDIT_RESOURCE_TYPES.CLOCK,
        resourceId: clock.id,
        clockId: clock.id,
        beforeSnapshot: null,
        afterSnapshot: extractKeyFields(clock, CLOCK_KEY_FIELDS),
        changedFields: null
      });
      created.push(clock);

      const hasItemTech = classified.technician?.resolved ? true : false;
      const effectiveTechId = hasItemTech
        ? classified.technician.resolved
        : globalTechnicianId;
      const effectiveTech = effectiveTechId
        ? db.users.find((u) => u.id === effectiveTechId)
        : null;

      createdResults.push({
        index: classified.index,
        normalized: classified.normalized,
        changes: classified.changes,
        targetDailyRateSeconds: classified.targetDailyRateSeconds,
        technician: effectiveTech
          ? {
              id: effectiveTech.id,
              username: effectiveTech.username,
              name: effectiveTech.name,
              role: effectiveTech.role,
              source: hasItemTech ? "item" : (globalTechnicianId ? "global" : null)
            }
          : null,
        created: clockSummary(db, clock)
      });
    }
    await writeDb(db);

    const unimportableResults = unimportable.map(({ index, rawItem, normalized, changes, reasons, technician }) => ({
      index,
      rawItem,
      normalized,
      changes,
      reasons,
      technician
    }));

    return send(res, 201, {
      summary: {
        total: summary.total,
        created: created.length,
        unimportable: unimportable.length,
        globalTechnician: globalTechResult && globalTechResult.summary
          ? { ...globalTechResult.summary, resolved: globalTechResult.resolved }
          : null
      },
      created: createdResults,
      unimportable: unimportableResults
    });
  }

  if (req.method === "GET" && pathname === "/clocks/not-qualified") {
    requireAuth(req, db);
    const accessibleClocks = filterClocksByUser(db, currentUser);
    const data = accessibleClocks.map((clock) => clockSummary(db, clock)).filter((clock) => !clock.qualified);
    return send(res, 200, { data, total: data.length });
  }

  if (req.method === "GET" && pathname === "/clocks/health-scores") {
    requireAuth(req, db);
    const conclusion = url.searchParams.get("conclusion");
    const conclusionKeyParam = url.searchParams.get("conclusionKey");
    const accessibleClocks = filterClocksByUser(db, currentUser);
    const data = accessibleClocks.map((clock) => calculateHealthScore(db, clock));
    let filtered = data;
    if (conclusionKeyParam) {
      filtered = data.filter((item) => item.conclusionKey === conclusionKeyParam);
    } else if (conclusion) {
      filtered = data.filter((item) => item.conclusion === conclusion);
    }
    const summary = {
      total: accessibleClocks.length,
      stable: filtered.filter((item) => item.conclusionKey === "stable").length,
      observe: filtered.filter((item) => item.conclusionKey === "observe").length,
      rework: filtered.filter((item) => item.conclusionKey === "rework").length,
      insufficient: filtered.filter((item) => item.conclusionKey === "insufficient").length
    };
    return send(res, 200, {
      summary,
      data: filtered,
      rules: HEALTH_SCORE_RULES,
      customRules: (db.healthScoreRules || []).filter((r) => r.enabled !== false),
      generatedAt: new Date().toISOString()
    });
  }

  const historyMatch = pathname.match(/^\/clocks\/([^/]+)\/history$/);
  if (historyMatch && req.method === "GET") {
    requireAuth(req, db);
    const clock = findClock(db, historyMatch[1]);
    if (!canAccessClock(clock, currentUser)) {
      const error = new Error("无权限访问该钟表档案");
      error.status = 403;
      error.code = "FORBIDDEN";
      throw error;
    }
    const adjustments = db.adjustments.filter((item) => item.clockId === clock.id).map((a) => enrichWithCreator(db, a));
    const retests = db.retests.filter((item) => item.clockId === clock.id).map((r) => enrichWithCreator(db, r));
    const handovers = listResolvedHandovers(db, clock.id);
    const retestTasks = (db.retestTasks || []).filter((item) => item.clockId === clock.id).map((t) => enrichRetestTask(db, t));

    const assignAuditLogs = (db.auditLogs || [])
      .filter((log) => log.clockId === clock.id && log.operationType === AUDIT_OPERATION_TYPES.TECHNICIAN_ASSIGN)
      .map((log) => enrichWithCreator(db, log));

    return send(res, 200, { data: { clock: clockSummary(db, clock), adjustments, retests, handovers, retestTasks, assignAuditLogs, latestRetest: enrichWithCreator(db, latestRetest(db, clock.id)) } });
  }

  const auditLogsByClockMatch = pathname.match(/^\/clocks\/([^/]+)\/audit-logs$/);
  if (auditLogsByClockMatch && req.method === "GET") {
    requireAuth(req, db);
    const clock = findClock(db, auditLogsByClockMatch[1]);
    if (!canAccessClock(clock, currentUser)) {
      const error = new Error("无权限访问该钟表档案");
      error.status = 403;
      error.code = "FORBIDDEN";
      throw error;
    }
    const logs = listAuditLogsByClock(db, clock.id);

    const operationTypeLabels = {
      [AUDIT_OPERATION_TYPES.CLOCK_CREATE]: "创建档案",
      [AUDIT_OPERATION_TYPES.CLOCK_UPDATE]: "更新档案",
      [AUDIT_OPERATION_TYPES.ADJUSTMENT_CREATE]: "新增调校",
      [AUDIT_OPERATION_TYPES.RETEST_CREATE]: "新增复测",
      [AUDIT_OPERATION_TYPES.HANDOVER_CREATE]: "师傅交接",
      [AUDIT_OPERATION_TYPES.TECHNICIAN_ASSIGN]: "负责人变更",
      [AUDIT_OPERATION_TYPES.SUGGESTION_CREATE]: "创建建议",
      [AUDIT_OPERATION_TYPES.SUGGESTION_STATUS_UPDATE]: "建议状态更新",
      [AUDIT_OPERATION_TYPES.RETEST_TASK_CREATE]: "创建复测任务",
      [AUDIT_OPERATION_TYPES.RETEST_TASK_UPDATE]: "更新复测任务",
      [AUDIT_OPERATION_TYPES.RETEST_TASK_CANCEL]: "取消复测任务",
      [AUDIT_OPERATION_TYPES.WORKFLOW_ARCHIVE]: "工作流归档"
    };

    const timeline = logs.map((log) => ({
      ...enrichWithCreator(db, log),
      operationLabel: operationTypeLabels[log.operationType] || log.operationType
    }));

    const stats = {
      clockCreate: logs.filter((l) => l.operationType === AUDIT_OPERATION_TYPES.CLOCK_CREATE).length,
      clockUpdate: logs.filter((l) => l.operationType === AUDIT_OPERATION_TYPES.CLOCK_UPDATE).length,
      adjustmentCreate: logs.filter((l) => l.operationType === AUDIT_OPERATION_TYPES.ADJUSTMENT_CREATE).length,
      retestCreate: logs.filter((l) => l.operationType === AUDIT_OPERATION_TYPES.RETEST_CREATE).length,
      handoverCreate: logs.filter((l) => l.operationType === AUDIT_OPERATION_TYPES.HANDOVER_CREATE).length,
      technicianAssign: logs.filter((l) => l.operationType === AUDIT_OPERATION_TYPES.TECHNICIAN_ASSIGN).length,
      suggestionCreate: logs.filter((l) => l.operationType === AUDIT_OPERATION_TYPES.SUGGESTION_CREATE).length,
      suggestionStatusUpdate: logs.filter((l) => l.operationType === AUDIT_OPERATION_TYPES.SUGGESTION_STATUS_UPDATE).length,
      retestTaskCreate: logs.filter((l) => l.operationType === AUDIT_OPERATION_TYPES.RETEST_TASK_CREATE).length,
      retestTaskUpdate: logs.filter((l) => l.operationType === AUDIT_OPERATION_TYPES.RETEST_TASK_UPDATE).length,
      retestTaskCancel: logs.filter((l) => l.operationType === AUDIT_OPERATION_TYPES.RETEST_TASK_CANCEL).length,
      workflowArchive: logs.filter((l) => l.operationType === AUDIT_OPERATION_TYPES.WORKFLOW_ARCHIVE).length
    };

    return send(res, 200, {
      data: {
        clock: { id: clock.id, code: clock.code, escapementType: clock.escapementType, balanceFrequency: clock.balanceFrequency },
        timeline,
        total: logs.length,
        stats,
        operationTypeLabels,
        keyFields: {
          clock: CLOCK_KEY_FIELDS,
          retestTask: RETEST_TASK_KEY_FIELDS,
          workflow: WORKFLOW_KEY_FIELDS
        },
        generatedAt: new Date().toISOString()
      }
    });
  }

  if (req.method === "GET" && pathname === "/audit-logs") {
    requireAuth(req, db);
    const operationType = url.searchParams.get("operationType");
    const resourceType = url.searchParams.get("resourceType");
    const clockId = url.searchParams.get("clockId");
    const createdBy = url.searchParams.get("createdBy");
    const createdFrom = url.searchParams.get("createdFrom");
    const createdTo = url.searchParams.get("createdTo");
    let data = listAllAuditLogs(db);
    if (currentUser.role !== USER_ROLES.ADMIN) {
      const accessibleClockIds = new Set(filterClocksByUser(db, currentUser).map((c) => c.id));
      data = data.filter((log) => log.clockId === undefined || log.clockId === null || accessibleClockIds.has(log.clockId));
    }
    if (operationType) {
      data = data.filter((log) => log.operationType === operationType);
    }
    if (resourceType) {
      data = data.filter((log) => log.resourceType === resourceType);
    }
    if (clockId) {
      data = data.filter((log) => log.clockId === clockId);
    }
    if (createdBy) {
      data = data.filter((log) => log.createdBy === createdBy);
    }
    if (createdFrom) {
      const fromTime = new Date(createdFrom).getTime();
      if (!isNaN(fromTime)) {
        data = data.filter((log) => {
          const logTime = log.createdAt ? new Date(log.createdAt).getTime() : NaN;
          return !isNaN(logTime) && logTime >= fromTime;
        });
      }
    }
    if (createdTo) {
      const toTime = new Date(createdTo).getTime();
      if (!isNaN(toTime)) {
        data = data.filter((log) => {
          const logTime = log.createdAt ? new Date(log.createdAt).getTime() : NaN;
          return !isNaN(logTime) && logTime <= toTime;
        });
      }
    }
    data = data.map((log) => enrichWithCreator(db, log));
    return send(res, 200, {
      data,
      total: data.length,
      operationTypes: AUDIT_OPERATION_TYPES,
      resourceTypes: AUDIT_RESOURCE_TYPES,
      keyFields: {
        clock: CLOCK_KEY_FIELDS,
        retestTask: RETEST_TASK_KEY_FIELDS,
        user: USER_KEY_FIELDS,
        backup: BACKUP_KEY_FIELDS,
        workflow: WORKFLOW_KEY_FIELDS
      },
      filters: {
        operationType,
        resourceType,
        clockId,
        createdBy,
        createdFrom,
        createdTo
      }
    });
  }

  if (req.method === "GET" && pathname === "/workflow/statuses") {
    return send(res, 200, {
      data: {
        statuses: WORKFLOW_STATUSES,
        statusLabels: WORKFLOW_STATUS_LABELS,
        transitions: WORKFLOW_TRANSITIONS,
        operations: WORKFLOW_OPERATIONS,
        operationLabels: {
          [WORKFLOW_OPERATIONS.INITIAL_ADJUST]: "初调",
          [WORKFLOW_OPERATIONS.SUBMIT_RETEST]: "提交复测",
          [WORKFLOW_OPERATIONS.COMPLETE_RETEST]: "完成复测",
          [WORKFLOW_OPERATIONS.REWORK]: "返工调校",
          [WORKFLOW_OPERATIONS.ARCHIVE]: "达标归档"
        }
      }
    });
  }

  const workflowStatusMatch = pathname.match(/^\/clocks\/([^/]+)\/workflow-status$/);
  if (workflowStatusMatch && req.method === "GET") {
    requireAuth(req, db);
    const clock = findClock(db, workflowStatusMatch[1]);
    if (!canAccessClock(clock, currentUser)) {
      const error = new Error("无权限访问该钟表档案");
      error.status = 403;
      error.code = "FORBIDDEN";
      throw error;
    }
    return send(res, 200, { data: buildWorkflowStatusInfo(db, clock.id) });
  }

  const workflowInitialAdjustMatch = pathname.match(/^\/clocks\/([^/]+)\/workflow\/initial-adjust$/);
  if (workflowInitialAdjustMatch && req.method === "POST") {
    requireAuth(req, db);
    const clock = findClock(db, workflowInitialAdjustMatch[1]);
    if (!canAccessClock(clock, currentUser)) {
      const error = new Error("无权限操作该钟表档案");
      error.status = 403;
      error.code = "FORBIDDEN";
      throw error;
    }
    const currentStatus = deriveWorkflowStatus(db, clock.id);
    validateWorkflowTransition(currentStatus, WORKFLOW_OPERATIONS.INITIAL_ADJUST);
    const body = await parseBody(req);
    required(body, ["currentDailyRateSeconds", "direction", "amount"]);
    const adjustment = {
      id: makeId("adjustment"),
      clockId: clock.id,
      currentDailyRateSeconds: Number(body.currentDailyRateSeconds),
      direction: body.direction,
      amount: body.amount,
      note: body.note || "",
      createdAt: new Date().toISOString(),
      workflowOperation: WORKFLOW_OPERATIONS.INITIAL_ADJUST,
      createdBy: currentUser.id
    };
    db.adjustments.push(adjustment);
    createAuditLog(db, {
      createdBy: currentUser.id,
      createdBy: currentUser.id,
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
    return send(res, 201, {
      data: enrichWithCreator(db, adjustment),
      workflowStatus: buildWorkflowStatusInfo(db, clock.id)
    });
  }

  const workflowSubmitRetestMatch = pathname.match(/^\/clocks\/([^/]+)\/workflow\/submit-retest$/);
  if (workflowSubmitRetestMatch && req.method === "POST") {
    requireAuth(req, db);
    const clock = findClock(db, workflowSubmitRetestMatch[1]);
    if (!canAccessClock(clock, currentUser)) {
      const error = new Error("无权限操作该钟表档案");
      error.status = 403;
      error.code = "FORBIDDEN";
      throw error;
    }
    const currentStatus = deriveWorkflowStatus(db, clock.id);
    validateWorkflowTransition(currentStatus, WORKFLOW_OPERATIONS.SUBMIT_RETEST);
    const body = await parseBody(req);
    required(body, ["currentDailyRateSeconds", "direction", "amount"]);
    const adjustment = {
      id: makeId("adjustment"),
      clockId: clock.id,
      currentDailyRateSeconds: Number(body.currentDailyRateSeconds),
      direction: body.direction,
      amount: body.amount,
      note: body.note || "",
      createdAt: new Date().toISOString(),
      workflowOperation: currentStatus === WORKFLOW_STATUSES.RETEST_FAILED
        ? WORKFLOW_OPERATIONS.REWORK
        : WORKFLOW_OPERATIONS.SUBMIT_RETEST,
      createdBy: currentUser.id
    };
    db.adjustments.push(adjustment);
    createAuditLog(db, {
      createdBy: currentUser.id,
      createdBy: currentUser.id,
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
    if (body.plannedRetestAt && body.priority) {
      const task = {
        id: makeId("retestTask"),
        clockId: clock.id,
        adjustmentId: adjustment.id,
        plannedRetestAt: body.plannedRetestAt,
        priority: body.priority,
        status: "pending",
        completedAt: null,
        completedRetestId: null,
        cancelledAt: null,
        cancelledBy: null,
        cancelReason: null,
        note: body.retestTaskNote || "",
        createdAt: new Date().toISOString(),
        createdBy: currentUser.id
      };
      if (!db.retestTasks) db.retestTasks = [];
      db.retestTasks.push(task);
    }
    await writeDb(db);
    return send(res, 201, {
      data: enrichWithCreator(db, adjustment),
      workflowStatus: buildWorkflowStatusInfo(db, clock.id)
    });
  }

  const workflowCompleteRetestMatch = pathname.match(/^\/clocks\/([^/]+)\/workflow\/complete-retest$/);
  if (workflowCompleteRetestMatch && req.method === "POST") {
    requireAuth(req, db);
    const clock = findClock(db, workflowCompleteRetestMatch[1]);
    if (!canAccessClock(clock, currentUser)) {
      const error = new Error("无权限操作该钟表档案");
      error.status = 403;
      error.code = "FORBIDDEN";
      throw error;
    }
    const currentStatus = deriveWorkflowStatus(db, clock.id);
    if (currentStatus !== WORKFLOW_STATUSES.PENDING_RETEST) {
      const error = new Error(
        `当前状态【${WORKFLOW_STATUS_LABELS[currentStatus]}】不允许完成复测，需先进入待复测状态`
      );
      error.status = 400;
      error.code = "INVALID_WORKFLOW_TRANSITION";
      error.currentStatus = currentStatus;
      throw error;
    }
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
      note: body.note || "",
      workflowOperation: WORKFLOW_OPERATIONS.COMPLETE_RETEST,
      createdBy: currentUser.id
    };
    db.retests.push(retest);
    createAuditLog(db, {
      createdBy: currentUser.id,
      createdBy: currentUser.id,
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
    return send(res, 201, {
      data: enrichWithCreator(db, retest),
      clock: clockSummary(db, clock),
      workflowStatus: buildWorkflowStatusInfo(db, clock.id)
    });
  }

  const workflowReworkMatch = pathname.match(/^\/clocks\/([^/]+)\/workflow\/rework$/);
  if (workflowReworkMatch && req.method === "POST") {
    requireAuth(req, db);
    const clock = findClock(db, workflowReworkMatch[1]);
    if (!canAccessClock(clock, currentUser)) {
      const error = new Error("无权限操作该钟表档案");
      error.status = 403;
      error.code = "FORBIDDEN";
      throw error;
    }
    const currentStatus = deriveWorkflowStatus(db, clock.id);
    validateWorkflowTransition(currentStatus, WORKFLOW_OPERATIONS.REWORK);
    const body = await parseBody(req);
    required(body, ["currentDailyRateSeconds", "direction", "amount"]);
    const adjustment = {
      id: makeId("adjustment"),
      clockId: clock.id,
      currentDailyRateSeconds: Number(body.currentDailyRateSeconds),
      direction: body.direction,
      amount: body.amount,
      note: body.note || "",
      createdAt: new Date().toISOString(),
      workflowOperation: WORKFLOW_OPERATIONS.REWORK,
      createdBy: currentUser.id
    };
    db.adjustments.push(adjustment);
    createAuditLog(db, {
      createdBy: currentUser.id,
      createdBy: currentUser.id,
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
    if (body.plannedRetestAt && body.priority) {
      const task = {
        id: makeId("retestTask"),
        clockId: clock.id,
        adjustmentId: adjustment.id,
        plannedRetestAt: body.plannedRetestAt,
        priority: body.priority,
        status: "pending",
        completedAt: null,
        completedRetestId: null,
        cancelledAt: null,
        cancelledBy: null,
        cancelReason: null,
        note: body.retestTaskNote || "",
        createdAt: new Date().toISOString(),
        createdBy: currentUser.id
      };
      if (!db.retestTasks) db.retestTasks = [];
      db.retestTasks.push(task);
    }
    await writeDb(db);
    return send(res, 201, {
      data: enrichWithCreator(db, adjustment),
      workflowStatus: buildWorkflowStatusInfo(db, clock.id)
    });
  }

  const workflowArchiveMatch = pathname.match(/^\/clocks\/([^/]+)\/workflow\/archive$/);
  if (workflowArchiveMatch && req.method === "POST") {
    requireAdmin(req, db);
    const clock = findClock(db, workflowArchiveMatch[1]);
    const currentStatus = deriveWorkflowStatus(db, clock.id);
    validateWorkflowTransition(currentStatus, WORKFLOW_OPERATIONS.ARCHIVE);
    const body = await parseBody(req);
    const beforeSnapshot = extractKeyFields(clock, WORKFLOW_KEY_FIELDS);
    clock.workflowArchived = true;
    clock.workflowArchivedAt = new Date().toISOString();
    clock.workflowArchiveNote = body.note || "";
    clock.updatedAt = new Date().toISOString();
    const afterSnapshot = extractKeyFields(clock, WORKFLOW_KEY_FIELDS);

    createAuditLog(db, {
      operationType: AUDIT_OPERATION_TYPES.WORKFLOW_ARCHIVE,
      resourceType: AUDIT_RESOURCE_TYPES.WORKFLOW,
      resourceId: clock.id,
      clockId: clock.id,
      beforeSnapshot,
      afterSnapshot,
      changedFields: summarizeFieldChanges(beforeSnapshot, afterSnapshot, WORKFLOW_KEY_FIELDS),
      createdBy: currentUser.id
    });

    await writeDb(db);
    return send(res, 200, {
      data: {
        archived: true,
        clockId: clock.id,
        archivedAt: clock.workflowArchivedAt,
        note: clock.workflowArchiveNote
      },
      workflowStatus: buildWorkflowStatusInfo(db, clock.id)
    });
  }

  const healthScoreMatch = pathname.match(/^\/clocks\/([^/]+)\/health-score$/);
  if (healthScoreMatch && req.method === "GET") {
    requireAuth(req, db);
    const clock = findClock(db, healthScoreMatch[1]);
    if (!canAccessClock(clock, currentUser)) {
      const error = new Error("无权限访问该钟表档案");
      error.status = 403;
      error.code = "FORBIDDEN";
      throw error;
    }
    return send(res, 200, { data: calculateHealthScore(db, clock) });
  }

  const adjustmentMatch = pathname.match(/^\/clocks\/([^/]+)\/adjustments$/);
  if (adjustmentMatch && req.method === "POST") {
    requireAuth(req, db);
    const clock = findClock(db, adjustmentMatch[1]);
    if (!canAccessClock(clock, currentUser)) {
      const error = new Error("无权限操作该钟表档案");
      error.status = 403;
      error.code = "FORBIDDEN";
      throw error;
    }
    const body = await parseBody(req);
    required(body, ["currentDailyRateSeconds", "direction", "amount"]);
    const adjustment = {
      id: makeId("adjustment"),
      clockId: clock.id,
      currentDailyRateSeconds: Number(body.currentDailyRateSeconds),
      direction: body.direction,
      amount: body.amount,
      note: body.note || "",
      createdAt: new Date().toISOString(),
      createdBy: currentUser.id
    };
    db.adjustments.push(adjustment);
    createAuditLog(db, {
      createdBy: currentUser.id,
      createdBy: currentUser.id,
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
    return send(res, 201, { data: enrichWithCreator(db, adjustment) });
  }

  const retestMatch = pathname.match(/^\/clocks\/([^/]+)\/retests$/);
  if (retestMatch && req.method === "POST") {
    requireAuth(req, db);
    const clock = findClock(db, retestMatch[1]);
    if (!canAccessClock(clock, currentUser)) {
      const error = new Error("无权限操作该钟表档案");
      error.status = 403;
      error.code = "FORBIDDEN";
      throw error;
    }
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
      note: body.note || "",
      createdBy: currentUser.id
    };
    db.retests.push(retest);
    createAuditLog(db, {
      createdBy: currentUser.id,
      createdBy: currentUser.id,
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
    return send(res, 201, { data: enrichWithCreator(db, retest), clock: clockSummary(db, clock) });
  }

  const latestMatch = pathname.match(/^\/clocks\/([^/]+)\/latest-retest$/);
  if (latestMatch && req.method === "GET") {
    requireAuth(req, db);
    const clock = findClock(db, latestMatch[1]);
    if (!canAccessClock(clock, currentUser)) {
      const error = new Error("无权限访问该钟表档案");
      error.status = 403;
      error.code = "FORBIDDEN";
      throw error;
    }
    return send(res, 200, { data: enrichWithCreator(db, latestRetest(db, latestMatch[1])) });
  }

  const handoverListMatch = pathname.match(/^\/clocks\/([^/]+)\/handovers$/);
  if (handoverListMatch && req.method === "GET") {
    requireAuth(req, db);
    const clock = findClock(db, handoverListMatch[1]);
    if (!canAccessClock(clock, currentUser)) {
      if (currentUser.role === USER_ROLES.TECHNICIAN) {
        const hasHistory = clock.assignedTechnicianId === currentUser.id;
        if (!hasHistory) {
          const error = new Error("普通技师只能查看自己当前负责钟表的交接历史");
          error.status = 403;
          error.code = "FORBIDDEN";
          throw error;
        }
      } else {
        const error = new Error("无权限访问该钟表档案");
        error.status = 403;
        error.code = "FORBIDDEN";
        throw error;
      }
    }
    const data = listResolvedHandovers(db, clock.id);
    return send(res, 200, { data, total: data.length });
  }

  const handoverCreateMatch = pathname.match(/^\/clocks\/([^/]+)\/handovers$/);
  if (handoverCreateMatch && req.method === "POST") {
    requireAuth(req, db);
    const clock = findClock(db, handoverCreateMatch[1]);

    if (currentUser.role !== USER_ROLES.ADMIN) {
      if (clock.assignedTechnicianId !== currentUser.id) {
        const error = new Error("普通技师只能为自己当前负责的钟表发起交接");
        error.status = 403;
        error.code = "FORBIDDEN";
        throw error;
      }
    }
    const body = await parseBody(req);
    required(body, ["handoverNote", "receiver"]);

    let receiverId = body.receiverId || null;
    let receiverName = body.receiver;
    if (!receiverId) {
      const receiverUser = db.users.find((u) => u.name === body.receiver || u.username === body.receiver);
      if (receiverUser) {
        receiverId = receiverUser.id;
        receiverName = receiverUser.name;
      }
    }

    const previousTechnicianId = clock.assignedTechnicianId || null;
    const previousTechnician = previousTechnicianId
      ? db.users.find((u) => u.id === previousTechnicianId)
      : null;

    const handover = {
      id: makeId("handover"),
      clockId: clock.id,
      handoverNote: body.handoverNote,
      nextStepSuggestion: body.nextStepSuggestion || "",
      receiver: receiverName,
      receiverId: receiverId,
      previousTechnicianId: previousTechnicianId,
      previousTechnicianName: previousTechnician ? previousTechnician.name : "",
      createdAt: new Date().toISOString(),
      createdBy: currentUser.id
    };
    db.handovers.push(handover);

    if (receiverId && receiverId !== clock.assignedTechnicianId) {
      clock.assignedTechnicianId = receiverId;
      clock.updatedAt = new Date().toISOString();

      createAuditLog(db, {
        operationType: AUDIT_OPERATION_TYPES.TECHNICIAN_ASSIGN,
        resourceType: AUDIT_RESOURCE_TYPES.CLOCK,
        resourceId: clock.id,
        clockId: clock.id,
        beforeSnapshot: {
          technicianId: previousTechnicianId,
          technicianName: previousTechnician ? previousTechnician.name : "无"
        },
        afterSnapshot: {
          technicianId: receiverId,
          technicianName: receiverName
        },
        changedFields: [
          {
            field: "assignedTechnicianId",
            before: previousTechnicianId,
            after: receiverId
          }
        ],
        createdBy: currentUser.id
      });
    }

    createAuditLog(db, {
      operationType: AUDIT_OPERATION_TYPES.HANDOVER_CREATE,
      resourceType: AUDIT_RESOURCE_TYPES.HANDOVER,
      resourceId: handover.id,
      clockId: clock.id,
      beforeSnapshot: {
        previousTechnicianId: previousTechnicianId,
        previousTechnicianName: previousTechnician ? previousTechnician.name : ""
      },
      afterSnapshot: {
        receiverId: receiverId,
        receiverName: receiverName,
        handoverNote: body.handoverNote,
        nextStepSuggestion: body.nextStepSuggestion || ""
      },
      changedFields: null,
      createdBy: currentUser.id
    });

    await writeDb(db);
    return send(res, 201, { data: enrichWithCreator(db, handover), clock: clockSummary(db, clock) });
  }

  const handoverTimelineMatch = pathname.match(/^\/clocks\/([^/]+)\/handover-timeline$/);
  if (handoverTimelineMatch && req.method === "GET") {
    requireAuth(req, db);
    const clock = findClock(db, handoverTimelineMatch[1]);
    if (!canAccessClock(clock, currentUser)) {
      if (currentUser.role === USER_ROLES.TECHNICIAN) {
        if (clock.assignedTechnicianId !== currentUser.id) {
          const error = new Error("普通技师只能查看自己当前负责钟表的交接历史");
          error.status = 403;
          error.code = "FORBIDDEN";
          throw error;
        }
      } else {
        const error = new Error("无权限访问该钟表档案");
        error.status = 403;
        error.code = "FORBIDDEN";
        throw error;
      }
    }

    const handoverEvents = listResolvedHandovers(db, clock.id)
      .map((h) => {
        const prevNameDisplay = h.previousTechnicianName || "（初始）";
        const receiverNameDisplay = h.receiver || "无";
        return {
          id: h.id,
          type: "handover",
          timestamp: h.createdAt,
          summary: `${prevNameDisplay} → ${receiverNameDisplay}`,
          detail: {
            handoverNote: h.handoverNote,
            nextStepSuggestion: h.nextStepSuggestion,
            receiver: receiverNameDisplay,
            receiverId: h.receiverId,
            receiverUser: h.receiverUser,
            previousTechnicianName: prevNameDisplay,
            previousTechnicianId: h.previousTechnicianId,
            previousTechnicianUser: h.previousTechnicianUser,
            creator: h.creator
          }
        };
      });

    const assignEvents = (db.auditLogs || [])
      .filter((log) => log.clockId === clock.id && log.operationType === AUDIT_OPERATION_TYPES.TECHNICIAN_ASSIGN)
      .map((log) => {
        const creator = db.users.find((u) => u.id === log.createdBy) || null;
        return {
          id: log.id,
          type: "technician_assign",
          timestamp: log.createdAt,
          summary: log.summary,
          detail: {
            before: log.beforeSnapshot,
            after: log.afterSnapshot,
            creator: creator ? { id: creator.id, name: creator.name, role: creator.role } : null
          }
        };
      });

    const timeline = [...handoverEvents, ...assignEvents]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return send(res, 200, {
      data: {
        clock: { id: clock.id, code: clock.code, assignedTechnicianId: clock.assignedTechnicianId },
        timeline,
        total: timeline.length,
        handoverCount: handoverEvents.length,
        assignCount: assignEvents.length
      }
    });
  }

  if (req.method === "GET" && pathname === "/adjustments") {
    requireAuth(req, db);
    const clockId = url.searchParams.get("clockId");
    let data = db.adjustments.filter((item) => !clockId || item.clockId === clockId);
    if (currentUser.role !== USER_ROLES.ADMIN) {
      const accessibleClockIds = new Set(filterClocksByUser(db, currentUser).map((c) => c.id));
      data = data.filter((item) => accessibleClockIds.has(item.clockId));
    }
    data = data.map((item) => enrichWithCreator(db, item));
    return send(res, 200, { data, total: data.length });
  }

  if (req.method === "GET" && pathname === "/retests") {
    requireAuth(req, db);
    const clockId = url.searchParams.get("clockId");
    const qualified = url.searchParams.get("qualified");
    let data = db.retests.filter((item) => {
      const matchClock = !clockId || item.clockId === clockId;
      const matchQualified = qualified === null || item.qualified === (qualified === "true");
      return matchClock && matchQualified;
    });
    if (currentUser.role !== USER_ROLES.ADMIN) {
      const accessibleClockIds = new Set(filterClocksByUser(db, currentUser).map((c) => c.id));
      data = data.filter((item) => accessibleClockIds.has(item.clockId));
    }
    data = data.map((item) => enrichWithCreator(db, item));
    return send(res, 200, { data, total: data.length });
  }

  if (req.method === "GET" && pathname === "/retest-tasks") {
    requireAuth(req, db);
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
    if (currentUser.role !== USER_ROLES.ADMIN) {
      const accessibleClockIds = new Set(filterClocksByUser(db, currentUser).map((c) => c.id));
      data = data.filter((item) => accessibleClockIds.has(item.clockId));
    }
    data = data.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      const pa = priorityOrder[a.priority] ?? 1;
      const pb = priorityOrder[b.priority] ?? 1;
      if (pa !== pb) return pa - pb;
      return new Date(a.plannedRetestAt) - new Date(b.plannedRetestAt);
    });
    data = data.map((task) => enrichWithCanceller(db, enrichWithCreator(db, {
      ...task,
      clock: db.clocks.find((c) => c.id === task.clockId) || null,
      adjustment: db.adjustments.find((a) => a.id === task.adjustmentId) || null,
      overdue: task.status === "pending" && new Date(task.plannedRetestAt) < now
    })));
    return send(res, 200, { data, total: data.length });
  }

  const retestTaskCreateMatch = pathname.match(/^\/clocks\/([^/]+)\/retest-tasks$/);
  if (retestTaskCreateMatch && req.method === "POST") {
    requireAuth(req, db);
    const clock = findClock(db, retestTaskCreateMatch[1]);
    if (!canAccessClock(clock, currentUser)) {
      const error = new Error("无权限操作该钟表档案");
      error.status = 403;
      error.code = "FORBIDDEN";
      throw error;
    }
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
      cancelledAt: null,
      cancelledBy: null,
      cancelReason: null,
      note: body.note || "",
      createdAt: new Date().toISOString(),
      createdBy: currentUser.id
    };
    if (!db.retestTasks) db.retestTasks = [];
    db.retestTasks.push(task);

    createAuditLog(db, {
      operationType: AUDIT_OPERATION_TYPES.RETEST_TASK_CREATE,
      resourceType: AUDIT_RESOURCE_TYPES.RETEST_TASK,
      resourceId: task.id,
      clockId: clock.id,
      beforeSnapshot: null,
      afterSnapshot: extractKeyFields(task, RETEST_TASK_KEY_FIELDS),
      changedFields: null,
      createdBy: currentUser.id
    });

    await writeDb(db);
    return send(res, 201, {
      data: enrichWithCanceller(db, enrichWithCreator(db, {
        ...task,
        clock: clockSummary(db, clock),
        adjustment: db.adjustments.find((a) => a.id === adjustmentId) || null,
        overdue: false
      }))
    });
  }

  const retestTaskListMatch = pathname.match(/^\/clocks\/([^/]+)\/retest-tasks$/);
  if (retestTaskListMatch && req.method === "GET") {
    requireAuth(req, db);
    const clock = findClock(db, retestTaskListMatch[1]);
    if (!canAccessClock(clock, currentUser)) {
      const error = new Error("无权限访问该钟表档案");
      error.status = 403;
      error.code = "FORBIDDEN";
      throw error;
    }
    const now = new Date();
    const data = (db.retestTasks || [])
      .filter((item) => item.clockId === clock.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((task) => enrichWithCanceller(db, enrichWithCreator(db, {
        ...task,
        adjustment: db.adjustments.find((a) => a.id === task.adjustmentId) || null,
        overdue: task.status === "pending" && new Date(task.plannedRetestAt) < now
      })));
    return send(res, 200, { data, total: data.length });
  }

  const retestTaskUpdateMatch = pathname.match(/^\/retest-tasks\/([^/]+)$/);
  if (retestTaskUpdateMatch && req.method === "PUT") {
    requireAuth(req, db);
    const task = findRetestTask(db, retestTaskUpdateMatch[1]);
    if (!canManageRetestTask(db, task, currentUser)) {
      const error = new Error("无权限操作该复测任务");
      error.status = 403;
      error.code = "FORBIDDEN";
      throw error;
    }
    if (task.status === "completed") {
      const error = new Error("已完成的复测任务不能改期");
      error.status = 400;
      error.code = "TASK_ALREADY_COMPLETED";
      throw error;
    }
    if (task.status === "cancelled") {
      const error = new Error("已取消的复测任务不能改期");
      error.status = 400;
      error.code = "TASK_ALREADY_CANCELLED";
      throw error;
    }
    const body = await parseBody(req);
    const validPriorities = ["high", "medium", "low"];
    if (body.priority !== undefined && !validPriorities.includes(body.priority)) {
      const error = new Error(`priority 必须为 ${validPriorities.join("/")}`);
      error.status = 400;
      throw error;
    }
    const beforeSnapshot = extractKeyFields(task, RETEST_TASK_KEY_FIELDS);

    if (body.plannedRetestAt !== undefined) {
      task.plannedRetestAt = body.plannedRetestAt;
    }
    if (body.priority !== undefined) {
      task.priority = body.priority;
    }
    if (body.note !== undefined) {
      task.note = body.note;
    }
    task.updatedAt = new Date().toISOString();

    const afterSnapshot = extractKeyFields(task, RETEST_TASK_KEY_FIELDS);
    const changedFields = summarizeFieldChanges(beforeSnapshot, afterSnapshot, RETEST_TASK_KEY_FIELDS);
    if (changedFields) {
      createAuditLog(db, {
        operationType: AUDIT_OPERATION_TYPES.RETEST_TASK_UPDATE,
        resourceType: AUDIT_RESOURCE_TYPES.RETEST_TASK,
        resourceId: task.id,
        clockId: task.clockId,
        beforeSnapshot,
        afterSnapshot,
        changedFields,
        createdBy: currentUser.id
      });
    }

    await writeDb(db);
    return send(res, 200, {
      data: enrichRetestTask(db, task)
    });
  }

  const retestTaskCancelMatch = pathname.match(/^\/retest-tasks\/([^/]+)\/cancel$/);
  if (retestTaskCancelMatch && req.method === "POST") {
    requireAuth(req, db);
    const task = findRetestTask(db, retestTaskCancelMatch[1]);
    if (!canManageRetestTask(db, task, currentUser)) {
      const error = new Error("无权限操作该复测任务");
      error.status = 403;
      error.code = "FORBIDDEN";
      throw error;
    }
    if (task.status === "completed") {
      const error = new Error("已完成的复测任务不能取消");
      error.status = 400;
      error.code = "TASK_ALREADY_COMPLETED";
      throw error;
    }
    if (task.status === "cancelled") {
      const error = new Error("复测任务已取消");
      error.status = 400;
      error.code = "TASK_ALREADY_CANCELLED";
      throw error;
    }
    const body = await parseBody(req);
    required(body, ["cancelReason"]);
    const beforeSnapshot = extractKeyFields(task, RETEST_TASK_KEY_FIELDS);
    task.status = "cancelled";
    task.cancelledAt = new Date().toISOString();
    task.cancelledBy = currentUser.id;
    task.cancelReason = body.cancelReason;
    const afterSnapshot = {
      ...extractKeyFields(task, RETEST_TASK_KEY_FIELDS),
      cancelReason: task.cancelReason,
      cancelledAt: task.cancelledAt
    };

    createAuditLog(db, {
      operationType: AUDIT_OPERATION_TYPES.RETEST_TASK_CANCEL,
      resourceType: AUDIT_RESOURCE_TYPES.RETEST_TASK,
      resourceId: task.id,
      clockId: task.clockId,
      beforeSnapshot,
      afterSnapshot,
      changedFields: summarizeFieldChanges(beforeSnapshot, afterSnapshot, RETEST_TASK_KEY_FIELDS.concat(["cancelReason", "cancelledAt"])),
      createdBy: currentUser.id
    });

    await writeDb(db);
    return send(res, 200, {
      data: enrichRetestTask(db, task)
    });
  }

  if (req.method === "GET" && pathname === "/handovers") {
    requireAuth(req, db);
    const clockId = url.searchParams.get("clockId");
    let visibleClockIds = clockId ? [clockId] : db.clocks.map((clock) => clock.id);
    if (currentUser.role !== USER_ROLES.ADMIN) {
      const accessibleClockIds = new Set(filterClocksByUser(db, currentUser).map((c) => c.id));
      visibleClockIds = visibleClockIds.filter((id) => accessibleClockIds.has(id));
    }
    const data = visibleClockIds
      .flatMap((id) => listResolvedHandovers(db, id))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return send(res, 200, { data, total: data.length });
  }

  const generateSuggestionMatch = pathname.match(/^\/clocks\/([^/]+)\/suggestions\/generate$/);
  if (generateSuggestionMatch && req.method === "POST") {
    requireAuth(req, db);
    const clock = findClock(db, generateSuggestionMatch[1]);
    if (!canAccessClock(clock, currentUser)) {
      const error = new Error("无权限访问该钟表档案");
      error.status = 403;
      error.code = "FORBIDDEN";
      throw error;
    }
    const pendingSuggestions = findPendingSuggestionsByClockId(db, clock.id);
    const suggestion = generateAdjustmentSuggestion(db, clock);
    const response = { data: suggestion };
    if (pendingSuggestions.length > 0) {
      response.warning = {
        code: "PENDING_SUGGESTIONS_EXIST",
        message: `该钟表存在 ${pendingSuggestions.length} 条未处理的调校建议，仍可继续生成预览`,
        pendingSuggestionCount: pendingSuggestions.length,
        pendingSuggestionIds: pendingSuggestions.map((s) => s.id)
      };
    }
    return send(res, 200, response);
  }

  const saveSuggestionMatch = pathname.match(/^\/clocks\/([^/]+)\/suggestions$/);
  if (saveSuggestionMatch && req.method === "POST") {
    requireAuth(req, db);
    const clock = findClock(db, saveSuggestionMatch[1]);
    if (!canAccessClock(clock, currentUser)) {
      const error = new Error("无权限操作该钟表档案");
      error.status = 403;
      error.code = "FORBIDDEN";
      throw error;
    }
    const body = await parseBody(req);
    const suggestion = generateAdjustmentSuggestion(db, clock);
    const pendingSuggestions = findPendingSuggestionsByClockId(db, clock.id);
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
      status: SUGGESTION_STATUSES.PENDING,
      processedBy: null,
      processedAt: null,
      appliedAdjustmentId: null,
      createdAt: new Date().toISOString(),
      createdBy: currentUser.id
    };
    db.suggestions.push(savedSuggestion);
    createAuditLog(db, {
      operationType: AUDIT_OPERATION_TYPES.SUGGESTION_CREATE,
      resourceType: AUDIT_RESOURCE_TYPES.SUGGESTION,
      resourceId: savedSuggestion.id,
      clockId: clock.id,
      beforeSnapshot: null,
      afterSnapshot: {
        deviationDescription: savedSuggestion.deviationDescription,
        conservativeAmount: savedSuggestion.conservativeAmount,
        status: savedSuggestion.status
      },
      changedFields: null,
      createdBy: currentUser.id
    });
    await writeDb(db);
    const response = { data: enrichSuggestion(db, savedSuggestion) };
    if (pendingSuggestions.length > 0) {
      response.warning = {
        code: "PENDING_SUGGESTIONS_EXIST",
        message: `该钟表已存在 ${pendingSuggestions.length} 条未处理的调校建议`,
        pendingSuggestionCount: pendingSuggestions.length,
        pendingSuggestionIds: pendingSuggestions.map((s) => s.id)
      };
    }
    return send(res, 201, response);
  }

  const listSuggestionsMatch = pathname.match(/^\/clocks\/([^/]+)\/suggestions$/);
  if (listSuggestionsMatch && req.method === "GET") {
    requireAuth(req, db);
    const clock = findClock(db, listSuggestionsMatch[1]);
    if (!canAccessClock(clock, currentUser)) {
      const error = new Error("无权限访问该钟表档案");
      error.status = 403;
      error.code = "FORBIDDEN";
      throw error;
    }
    const data = listSuggestions(db, clock.id).map((s) => enrichSuggestion(db, s));
    return send(res, 200, { data, total: data.length });
  }

  if (req.method === "GET" && pathname === "/suggestions") {
    requireAuth(req, db);
    const clockId = url.searchParams.get("clockId");
    let data = listSuggestions(db, clockId);
    if (currentUser.role !== USER_ROLES.ADMIN) {
      const accessibleClockIds = new Set(filterClocksByUser(db, currentUser).map((c) => c.id));
      data = data.filter((item) => accessibleClockIds.has(item.clockId));
    }
    data = data.map((s) => enrichSuggestion(db, s));
    return send(res, 200, { data, total: data.length, statuses: SUGGESTION_STATUSES, statusLabels: SUGGESTION_STATUS_LABELS });
  }

  const suggestionStatusUpdateMatch = pathname.match(/^\/suggestions\/([^/]+)\/status$/);
  if (suggestionStatusUpdateMatch && req.method === "PATCH") {
    requireAuth(req, db);
    const suggestion = findSuggestion(db, suggestionStatusUpdateMatch[1]);
    const clock = db.clocks.find((c) => c.id === suggestion.clockId) || null;
    if (clock && !canAccessClock(clock, currentUser)) {
      const error = new Error("无权限操作该建议记录");
      error.status = 403;
      error.code = "FORBIDDEN";
      throw error;
    }
    const body = await parseBody(req);
    const validStatuses = Object.values(SUGGESTION_STATUSES);
    if (!body.status || !validStatuses.includes(body.status)) {
      const error = new Error(`状态必须是 ${validStatuses.join("/")}`);
      error.status = 400;
      error.code = "INVALID_STATUS";
      throw error;
    }
    if (body.status === SUGGESTION_STATUSES.APPLIED && !body.appliedAdjustmentId) {
      const error = new Error("标记为已应用时必须关联调校记录");
      error.status = 400;
      error.code = "APPLIED_ADJUSTMENT_REQUIRED";
      throw error;
    }
    if (body.appliedAdjustmentId) {
      const adjustment = db.adjustments.find((a) => a.id === body.appliedAdjustmentId);
      if (!adjustment) {
        const error = new Error("关联的调校记录不存在");
        error.status = 400;
        error.code = "ADJUSTMENT_NOT_FOUND";
        throw error;
      }
      if (adjustment.clockId !== suggestion.clockId) {
        const error = new Error("关联的调校记录不属于同一钟表");
        error.status = 400;
        error.code = "ADJUSTMENT_CLOCK_MISMATCH";
        throw error;
      }
    }
    const beforeSnapshot = {
      status: suggestion.status,
      processedBy: suggestion.processedBy,
      processedAt: suggestion.processedAt,
      appliedAdjustmentId: suggestion.appliedAdjustmentId
    };
    suggestion.status = body.status;
    suggestion.processedBy = currentUser.id;
    suggestion.processedAt = new Date().toISOString();
    suggestion.appliedAdjustmentId = body.status === SUGGESTION_STATUSES.APPLIED ? body.appliedAdjustmentId : null;
    createAuditLog(db, {
      operationType: AUDIT_OPERATION_TYPES.SUGGESTION_STATUS_UPDATE,
      resourceType: AUDIT_RESOURCE_TYPES.SUGGESTION,
      resourceId: suggestion.id,
      clockId: suggestion.clockId,
      beforeSnapshot,
      afterSnapshot: {
        status: suggestion.status,
        processedBy: suggestion.processedBy,
        processedAt: suggestion.processedAt,
        appliedAdjustmentId: suggestion.appliedAdjustmentId
      },
      changedFields: summarizeFieldChanges(beforeSnapshot, {
        status: suggestion.status,
        processedBy: suggestion.processedBy,
        processedAt: suggestion.processedAt,
        appliedAdjustmentId: suggestion.appliedAdjustmentId
      }, ["status", "processedBy", "processedAt", "appliedAdjustmentId"]),
      createdBy: currentUser.id
    });
    await writeDb(db);
    return send(res, 200, { data: enrichSuggestion(db, suggestion) });
  }

  const suggestionDetailMatch = pathname.match(/^\/suggestions\/([^/]+)$/);
  if (suggestionDetailMatch && req.method === "GET") {
    requireAuth(req, db);
    const suggestion = findSuggestion(db, suggestionDetailMatch[1]);
    const clock = db.clocks.find((c) => c.id === suggestion.clockId) || null;
    if (clock && !canAccessClock(clock, currentUser)) {
      const error = new Error("无权限访问该建议记录");
      error.status = 403;
      error.code = "FORBIDDEN";
      throw error;
    }
    return send(res, 200, {
      data: enrichSuggestion(db, { ...suggestion, clock })
    });
  }

  if (req.method === "POST" && pathname === "/backups") {
    requireAdmin(req, db);
    const backup = await createBackup();

    createAuditLog(db, {
      operationType: AUDIT_OPERATION_TYPES.BACKUP_CREATE,
      resourceType: AUDIT_RESOURCE_TYPES.BACKUP,
      resourceId: backup.id,
      clockId: null,
      beforeSnapshot: null,
      afterSnapshot: extractKeyFields(backup, BACKUP_KEY_FIELDS),
      changedFields: null,
      createdBy: currentUser.id
    });
    await writeDb(db);

    return send(res, 201, { data: backup });
  }

  if (req.method === "GET" && pathname === "/backups") {
    requireAdmin(req, db);
    const backups = await listBackups();
    return send(res, 200, {
      data: backups,
      total: backups.length,
      errorCodes: BACKUP_ERROR_CODES
    });
  }

  const validateBackupMatch = pathname.match(/^\/backups\/([^/]+)\/validate$/);
  if (validateBackupMatch && req.method === "GET") {
    requireAdmin(req, db);
    const result = await validateBackup(validateBackupMatch[1]);
    return send(res, 200, { data: result });
  }

  const restoreBackupMatch = pathname.match(/^\/backups\/([^/]+)\/restore$/);
  if (restoreBackupMatch && req.method === "POST") {
    requireAdmin(req, db);
    const backupId = restoreBackupMatch[1];
    const result = await restoreBackup(backupId);

    const restoredDb = await readDb();
    createAuditLog(restoredDb, {
      operationType: AUDIT_OPERATION_TYPES.BACKUP_RESTORE,
      resourceType: AUDIT_RESOURCE_TYPES.BACKUP,
      resourceId: backupId,
      clockId: null,
      beforeSnapshot: {
        id: backupId
      },
      afterSnapshot: {
        id: backupId,
        restoredAt: result.restoredAt,
        counts: result.counts
      },
      changedFields: null,
      createdBy: currentUser.id
    });
    await writeDb(restoredDb);

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

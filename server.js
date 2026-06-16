const http = require("http");
const { readFile, writeFile, mkdir } = require("fs/promises");
const path = require("path");

const PORT = Number(process.env.PORT || 3021);
const DB_FILE = path.join(__dirname, "data", "db.json");

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
  suggestions: []
};

const routes = [
  "GET /health",
  "GET /overview",
  "GET /clocks",
  "POST /clocks",
  "POST /clocks/import/preview",
  "POST /clocks/import",
  "GET /clocks/not-qualified",
  "GET /clocks/:id/history",
  "POST /clocks/:id/adjustments",
  "POST /clocks/:id/retests",
  "GET /clocks/:id/latest-retest",
  "GET /clocks/:id/handovers",
  "POST /clocks/:id/handovers",
  "POST /clocks/:id/suggestions/generate",
  "POST /clocks/:id/suggestions",
  "GET /clocks/:id/suggestions",
  "GET /suggestions",
  "GET /suggestions/:id",
  "GET /adjustments",
  "GET /retests",
  "GET /retest-tasks",
  "POST /clocks/:id/retest-tasks",
  "GET /clocks/:id/retest-tasks",
  "GET /handovers"
];

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
    await writeDb(db);
    return send(res, 201, { data: clockSummary(db, clock) });
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

  const historyMatch = pathname.match(/^\/clocks\/([^/]+)\/history$/);
  if (historyMatch && req.method === "GET") {
    const clock = findClock(db, historyMatch[1]);
    const adjustments = db.adjustments.filter((item) => item.clockId === clock.id);
    const retests = db.retests.filter((item) => item.clockId === clock.id);
    const handovers = listHandovers(db, clock.id);
    const retestTasks = (db.retestTasks || []).filter((item) => item.clockId === clock.id);
    return send(res, 200, { data: { clock, adjustments, retests, handovers, retestTasks, latestRetest: latestRetest(db, clock.id) } });
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
    await writeDb(db);
    return send(res, 201, { data: adjustment });
  }

  const retestMatch = pathname.match(/^\/clocks\/([^/]+)\/retests$/);
  if (retestMatch && req.method === "POST") {
    const clock = findClock(db, retestMatch[1]);
    const body = await parseBody(req);
    required(body, ["dailyRateSeconds", "amplitude"]);
    const adjustmentId = body.adjustmentId || latestAdjustment(db, clock.id)?.id || null;
    const qualified = body.qualified !== undefined
      ? Boolean(body.qualified)
      : Math.abs(Number(body.dailyRateSeconds)) <= Number(clock.targetDailyRateSeconds);

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

  return send(res, 404, { error: "接口不存在", routes });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => send(res, error.status || 500, { error: error.message || "服务器错误" }));
});

server.listen(PORT, () => {
  console.log(`Clock escapement tuning API running at http://127.0.0.1:${PORT}`);
});

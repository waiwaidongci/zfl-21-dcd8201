const { test, before, after, beforeEach, describe } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const crypto = require("node:crypto");

const TEST_PORT = 13021;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const SERVER_PATH = path.join(__dirname, "..", "server.js");

let testDataDir;
let serverProcess;

function request(method, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, BASE_URL);
    const reqOptions = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    };

    const req = http.request(reqOptions, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        let parsed;
        try {
          parsed = body ? JSON.parse(body) : {};
        } catch (e) {
          reject(new Error(`Invalid JSON response: ${body}`));
          return;
        }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });

    req.on("error", reject);

    if (options.body !== undefined) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

async function login(username) {
  const res = await request("POST", "/auth/login", {
    body: { username }
  });
  assert.equal(res.status, 200, `Login failed for ${username}: ${JSON.stringify(res.body)}`);
  return res.body.data.token;
}

async function waitForServer() {
  const startTime = Date.now();
  const timeout = 10000;
  while (Date.now() - startTime < timeout) {
    try {
      const res = await request("GET", "/health");
      if (res.status === 200 && res.body.ok) {
        return;
      }
    } catch (e) {
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Server failed to start within timeout");
}

function createTempDir() {
  const dir = path.join(os.tmpdir(), `backup-test-${crypto.randomBytes(8).toString("hex")}`);
  return dir;
}

async function startServer(dataDir) {
  const env = {
    ...process.env,
    PORT: TEST_PORT.toString(),
    DATA_DIR: dataDir,
    DB_FILE: path.join(dataDir, "db.json"),
    BACKUP_DIR: path.join(dataDir, "backups"),
    CONFIRMATION_TOKEN_SECRET: "test_secret_key_for_backup_token"
  };

  serverProcess = spawn("node", [SERVER_PATH], {
    env,
    stdio: ["pipe", "pipe", "pipe"]
  });

  serverProcess.stdout.on("data", (data) => {
    if (process.env.VERBOSE_TESTS) {
      process.stdout.write(`[server] ${data}`);
    }
  });
  serverProcess.stderr.on("data", (data) => {
    if (process.env.VERBOSE_TESTS) {
      process.stderr.write(`[server err] ${data}`);
    }
  });

  await waitForServer();
}

async function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

async function removeDir(dir) {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (e) {
  }
}

describe("Backup and Restore Flow", () => {
  let adminToken;

  before(async () => {
    testDataDir = createTempDir();
    await fs.mkdir(path.join(testDataDir, "backups"), { recursive: true });
    await startServer(testDataDir);
    adminToken = await login("admin");
  });

  after(async () => {
    await stopServer();
    await removeDir(testDataDir);
  });

  test("should create a backup successfully", async () => {
    const res = await request("POST", "/backups", {
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    assert.equal(res.status, 201);
    assert.ok(res.body.data);
    assert.ok(res.body.data.id);
    assert.ok(res.body.data.createdAt);
    assert.ok(res.body.data.size > 0);
    assert.ok(res.body.data.counts);
    assert.equal(typeof res.body.data.counts.users, "number");
    assert.equal(typeof res.body.data.counts.clocks, "number");
  });

  test("should validate a backup successfully", async () => {
    const createRes = await request("POST", "/backups", {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const backupId = createRes.body.data.id;

    const validateRes = await request("GET", `/backups/${backupId}/validate`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    assert.equal(validateRes.status, 200);
    assert.ok(validateRes.body.data);
    assert.equal(validateRes.body.data.valid, true);
    assert.equal(validateRes.body.data.id, backupId);
    assert.ok(validateRes.body.data.counts);
  });

  test("should preview backup diff and return confirmation token", async () => {
    const createRes = await request("POST", "/backups", {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const backupId = createRes.body.data.id;

    const previewRes = await request("POST", `/backups/${backupId}/preview`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    assert.equal(previewRes.status, 200);
    assert.ok(previewRes.body.data);
    assert.equal(previewRes.body.data.backupId, backupId);
    assert.ok(previewRes.body.data.previewedAt);
    assert.ok(previewRes.body.data.collectionDiffs);
    assert.ok(previewRes.body.data.confirmationToken);
    assert.ok(previewRes.body.data.tokenExpiresAt);

    assert.ok(previewRes.body.data.collectionDiffs.users);
    assert.equal(typeof previewRes.body.data.collectionDiffs.users.currentCount, "number");
    assert.equal(typeof previewRes.body.data.collectionDiffs.users.backupCount, "number");
  });

  test("should reject restore when confirmation token is missing", async () => {
    const createRes = await request("POST", "/backups", {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const backupId = createRes.body.data.id;

    const restoreRes = await request("POST", `/backups/${backupId}/restore`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {}
    });

    assert.equal(restoreRes.status, 400);
    assert.ok(restoreRes.body.error);
    assert.equal(restoreRes.body.code, "CONFIRMATION_TOKEN_REQUIRED");
  });

  test("should restore successfully with valid confirmation token", async () => {
    const clockRes = await request("POST", "/clocks", {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        code: "CLK-TEST-001",
        escapementType: "瑞士杠杆式",
        balanceFrequency: "18000vph",
        note: "测试钟表"
      }
    });
    assert.equal(clockRes.status, 201);
    const clockId = clockRes.body.data.id;

    const createRes = await request("POST", "/backups", {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const backupId = createRes.body.data.id;

    const secondClockRes = await request("POST", "/clocks", {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        code: "CLK-TEST-002",
        escapementType: "英国销轮式",
        balanceFrequency: "16000vph",
        note: "备份后添加的钟表"
      }
    });
    assert.equal(secondClockRes.status, 201);

    const clocksBeforeRes = await request("GET", "/clocks", {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const clocksBeforeCount = clocksBeforeRes.body.data.length;

    const previewRes = await request("POST", `/backups/${backupId}/preview`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const confirmationToken = previewRes.body.data.confirmationToken;

    const restoreRes = await request("POST", `/backups/${backupId}/restore`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { confirmationToken }
    });

    assert.equal(restoreRes.status, 200);
    assert.ok(restoreRes.body.data);
    assert.equal(restoreRes.body.data.restored, true);
    assert.equal(restoreRes.body.data.backupId, backupId);
    assert.equal(restoreRes.body.data.tokenVerified, true);
    assert.ok(restoreRes.body.data.restoredAt);

    const clocksAfterRes = await request("GET", "/clocks", {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const clocksAfterCount = clocksAfterRes.body.data.length;

    assert.ok(clocksAfterCount < clocksBeforeCount, "Restore should reduce clock count");

    const clockExists = clocksAfterRes.body.data.some((c) => c.id === clockId);
    assert.equal(clockExists, true, "Original clock should still exist after restore");

    const secondClockExists = clocksAfterRes.body.data.some((c) => c.code === "CLK-TEST-002");
    assert.equal(secondClockExists, false, "Clock added after backup should not exist after restore");
  });

  test("should reject restore with invalid confirmation token", async () => {
    const createRes = await request("POST", "/backups", {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const backupId = createRes.body.data.id;

    const restoreRes = await request("POST", `/backups/${backupId}/restore`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { confirmationToken: "invalid_token_12345" }
    });

    assert.equal(restoreRes.status, 400);
    assert.ok(restoreRes.body.error);
    assert.equal(restoreRes.body.code, "INVALID_TOKEN");
  });

  test("should return 404 for non-existent backup validation", async () => {
    const res = await request("GET", "/backups/nonexistent_backup/validate", {
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.code, "BACKUP_NOT_FOUND");
  });

  test("should list backups", async () => {
    await request("POST", "/backups", {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    await request("POST", "/backups", {
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    const res = await request("GET", "/backups", {
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.data.length >= 2);
    assert.equal(typeof res.body.total, "number");
  });

  test("should reject backup operations for technician role", async () => {
    const techToken = await login("zhang");

    const createRes = await request("POST", "/backups", {
      headers: { Authorization: `Bearer ${techToken}` }
    });
    assert.equal(createRes.status, 403);
    assert.equal(createRes.body.code, "PERMISSION_DENIED");

    const listRes = await request("GET", "/backups", {
      headers: { Authorization: `Bearer ${techToken}` }
    });
    assert.equal(listRes.status, 403);
  });

  test("preview diff should show modifications correctly", async () => {
    const createRes = await request("POST", "/backups", {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const backupId = createRes.body.data.id;

    const clockRes = await request("POST", "/clocks", {
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        code: "CLK-DIFF-TEST",
        escapementType: "德国工字轮式",
        balanceFrequency: "14400vph"
      }
    });
    assert.equal(clockRes.status, 201);

    const previewRes = await request("POST", `/backups/${backupId}/preview`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    assert.equal(previewRes.status, 200);
    const clocksDiff = previewRes.body.data.collectionDiffs.clocks;
    assert.ok(clocksDiff);
    assert.ok(clocksDiff.countDiff > 0, "Should have more clocks in current than backup");
    assert.ok(clocksDiff.onlyInCurrent.length > 0, "Should have clocks only in current");

    const newClockInDiff = clocksDiff.onlyInCurrent.find((c) => c.code === "CLK-DIFF-TEST");
    assert.ok(newClockInDiff, "Newly added clock should appear in onlyInCurrent");
  });
});

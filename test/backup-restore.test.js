const { test, before, after, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createTestHarness } = require("./helpers/test-harness");

describe("Backup and Restore Flow", () => {
  let harness;
  let adminToken;

  before(async () => {
    harness = await createTestHarness();
    await harness.start();
    adminToken = await harness.loginAsAdmin();
  });

  after(async () => {
    if (harness) {
      await harness.cleanup();
    }
  });

  test("should create a backup successfully", async () => {
    const res = await harness.request("POST", "/backups", {
      headers: harness.authHeaders(adminToken)
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
    const createRes = await harness.request("POST", "/backups", {
      headers: harness.authHeaders(adminToken)
    });
    const backupId = createRes.body.data.id;

    const validateRes = await harness.request("GET", `/backups/${backupId}/validate`, {
      headers: harness.authHeaders(adminToken)
    });

    assert.equal(validateRes.status, 200);
    assert.ok(validateRes.body.data);
    assert.equal(validateRes.body.data.valid, true);
    assert.equal(validateRes.body.data.id, backupId);
    assert.ok(validateRes.body.data.counts);
  });

  test("should preview backup diff and return confirmation token", async () => {
    const createRes = await harness.request("POST", "/backups", {
      headers: harness.authHeaders(adminToken)
    });
    const backupId = createRes.body.data.id;

    const previewRes = await harness.request("POST", `/backups/${backupId}/preview`, {
      headers: harness.authHeaders(adminToken)
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
    const createRes = await harness.request("POST", "/backups", {
      headers: harness.authHeaders(adminToken)
    });
    const backupId = createRes.body.data.id;

    const restoreRes = await harness.request("POST", `/backups/${backupId}/restore`, {
      headers: harness.authHeaders(adminToken),
      body: {}
    });

    assert.equal(restoreRes.status, 400);
    assert.ok(restoreRes.body.error);
    assert.equal(restoreRes.body.code, "CONFIRMATION_TOKEN_REQUIRED");
  });

  test("should restore successfully with valid confirmation token", async () => {
    const clockRes = await harness.request("POST", "/clocks", {
      headers: harness.authHeaders(adminToken),
      body: {
        code: "CLK-TEST-001",
        escapementType: "瑞士杠杆式",
        balanceFrequency: "18000vph",
        note: "测试钟表"
      }
    });
    assert.equal(clockRes.status, 201);
    const clockId = clockRes.body.data.id;

    const createRes = await harness.request("POST", "/backups", {
      headers: harness.authHeaders(adminToken)
    });
    const backupId = createRes.body.data.id;

    const secondClockRes = await harness.request("POST", "/clocks", {
      headers: harness.authHeaders(adminToken),
      body: {
        code: "CLK-TEST-002",
        escapementType: "英国销轮式",
        balanceFrequency: "16000vph",
        note: "备份后添加的钟表"
      }
    });
    assert.equal(secondClockRes.status, 201);

    const clocksBeforeRes = await harness.request("GET", "/clocks", {
      headers: harness.authHeaders(adminToken)
    });
    const clocksBeforeCount = clocksBeforeRes.body.data.length;

    const previewRes = await harness.request("POST", `/backups/${backupId}/preview`, {
      headers: harness.authHeaders(adminToken)
    });
    const confirmationToken = previewRes.body.data.confirmationToken;

    const restoreRes = await harness.request("POST", `/backups/${backupId}/restore`, {
      headers: harness.authHeaders(adminToken),
      body: { confirmationToken }
    });

    assert.equal(restoreRes.status, 200);
    assert.ok(restoreRes.body.data);
    assert.equal(restoreRes.body.data.restored, true);
    assert.equal(restoreRes.body.data.backupId, backupId);
    assert.equal(restoreRes.body.data.tokenVerified, true);
    assert.ok(restoreRes.body.data.restoredAt);

    const clocksAfterRes = await harness.request("GET", "/clocks", {
      headers: harness.authHeaders(adminToken)
    });
    const clocksAfterCount = clocksAfterRes.body.data.length;

    assert.ok(clocksAfterCount < clocksBeforeCount, "Restore should reduce clock count");

    const clockExists = clocksAfterRes.body.data.some((c) => c.id === clockId);
    assert.equal(clockExists, true, "Original clock should still exist after restore");

    const secondClockExists = clocksAfterRes.body.data.some((c) => c.code === "CLK-TEST-002");
    assert.equal(secondClockExists, false, "Clock added after backup should not exist after restore");
  });

  test("should reject restore with invalid confirmation token", async () => {
    const createRes = await harness.request("POST", "/backups", {
      headers: harness.authHeaders(adminToken)
    });
    const backupId = createRes.body.data.id;

    const restoreRes = await harness.request("POST", `/backups/${backupId}/restore`, {
      headers: harness.authHeaders(adminToken),
      body: { confirmationToken: "invalid_token_12345" }
    });

    assert.equal(restoreRes.status, 400);
    assert.ok(restoreRes.body.error);
    assert.equal(restoreRes.body.code, "INVALID_TOKEN");
  });

  test("should return 404 for non-existent backup validation", async () => {
    const res = await harness.request("GET", "/backups/nonexistent_backup/validate", {
      headers: harness.authHeaders(adminToken)
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.code, "BACKUP_NOT_FOUND");
  });

  test("should list backups", async () => {
    await harness.request("POST", "/backups", {
      headers: harness.authHeaders(adminToken)
    });
    await harness.request("POST", "/backups", {
      headers: harness.authHeaders(adminToken)
    });

    const res = await harness.request("GET", "/backups", {
      headers: harness.authHeaders(adminToken)
    });

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.data.length >= 2);
    assert.equal(typeof res.body.total, "number");
  });

  test("should reject backup operations for technician role", async () => {
    const techToken = await harness.loginAsTechnician("zhang");

    const createRes = await harness.request("POST", "/backups", {
      headers: harness.authHeaders(techToken)
    });
    assert.equal(createRes.status, 403);
    assert.equal(createRes.body.code, "PERMISSION_DENIED");

    const listRes = await harness.request("GET", "/backups", {
      headers: harness.authHeaders(techToken)
    });
    assert.equal(listRes.status, 403);
  });

  test("preview diff should show modifications correctly", async () => {
    const createRes = await harness.request("POST", "/backups", {
      headers: harness.authHeaders(adminToken)
    });
    const backupId = createRes.body.data.id;

    const clockRes = await harness.request("POST", "/clocks", {
      headers: harness.authHeaders(adminToken),
      body: {
        code: "CLK-DIFF-TEST",
        escapementType: "德国工字轮式",
        balanceFrequency: "14400vph"
      }
    });
    assert.equal(clockRes.status, 201);

    const previewRes = await harness.request("POST", `/backups/${backupId}/preview`, {
      headers: harness.authHeaders(adminToken)
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

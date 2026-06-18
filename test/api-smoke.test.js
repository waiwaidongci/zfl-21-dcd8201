const { test, before, after, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createTestHarness } = require("./helpers/test-harness");

describe("API Smoke Tests", () => {
  let harness;
  let adminToken;
  let techToken;

  before(async () => {
    harness = await createTestHarness();
    await harness.start();
    adminToken = await harness.loginAsAdmin();
    techToken = await harness.loginAsTechnician("zhang");
  });

  after(async () => {
    if (harness) {
      await harness.cleanup();
    }
  });

  describe("Health & Public Endpoints", () => {
    test("GET /health should return ok without auth", async () => {
      const res = await harness.request("GET", "/health");
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
    });

    test("protected endpoint without token should return 401", async () => {
      const res = await harness.request("GET", "/clocks");
      assert.equal(res.status, 401);
      assert.equal(res.body.code, "TOKEN_MISSING");
    });
  });

  describe("Authentication", () => {
    test("POST /auth/login should login as admin", async () => {
      const res = await harness.request("POST", "/auth/login", {
        body: { username: "admin" }
      });
      assert.equal(res.status, 200);
      assert.ok(res.body.data.token);
      assert.equal(res.body.data.user.role, "admin");
      assert.ok(Array.isArray(res.body.data.permissions));
    });

    test("POST /auth/login should login as technician", async () => {
      const res = await harness.request("POST", "/auth/login", {
        body: { username: "zhang" }
      });
      assert.equal(res.status, 200);
      assert.ok(res.body.data.token);
      assert.equal(res.body.data.user.role, "technician");
    });

    test("GET /auth/me should return current user info", async () => {
      const res = await harness.request("GET", "/auth/me", {
        headers: harness.authHeaders(adminToken)
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.username, "admin");
      assert.equal(res.body.data.role, "admin");
    });

    test("POST /auth/logout should invalidate token", async () => {
      const tempToken = await harness.login("admin");
      const meRes1 = await harness.request("GET", "/auth/me", {
        headers: harness.authHeaders(tempToken)
      });
      assert.equal(meRes1.status, 200);

      const logoutRes = await harness.request("POST", "/auth/logout", {
        headers: harness.authHeaders(tempToken)
      });
      assert.equal(logoutRes.status, 200);

      const meRes2 = await harness.request("GET", "/auth/me", {
        headers: harness.authHeaders(tempToken)
      });
      assert.equal(meRes2.status, 401);
      assert.equal(meRes2.body.code, "TOKEN_INVALID");
    });
  });

  describe("User Management", () => {
    test("GET /users should list users for admin", async () => {
      const res = await harness.request("GET", "/users", {
        headers: harness.authHeaders(adminToken)
      });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.data));
      assert.ok(res.body.data.length >= 3);
    });

    test("POST /users should create a new user", async () => {
      const res = await harness.request("POST", "/users", {
        headers: harness.authHeaders(adminToken),
        body: {
          username: "testuser",
          name: "测试用户",
          role: "technician"
        }
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.data.username, "testuser");
      assert.equal(res.body.data.role, "technician");
    });
  });

  describe("Clock Management", () => {
    test("GET /clocks should list clocks", async () => {
      const res = await harness.request("GET", "/clocks", {
        headers: harness.authHeaders(adminToken)
      });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.data));
    });

    test("POST /clocks should create a clock", async () => {
      const res = await harness.request("POST", "/clocks", {
        headers: harness.authHeaders(adminToken),
        body: {
          code: "CLK-SMOKE-001",
          escapementType: "瑞士杠杆式",
          balanceFrequency: "18000vph",
          targetDailyRateSeconds: 30,
          note: "冒烟测试钟表"
        }
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.data.code, "CLK-SMOKE-001");
      assert.ok(res.body.data.id);
    });

    test("GET /overview should return overview data", async () => {
      const res = await harness.request("GET", "/overview", {
        headers: harness.authHeaders(adminToken)
      });
      assert.equal(res.status, 200);
      assert.ok(res.body.data);
    });
  });

  describe("Adjustments & Retests", () => {
    let testClockId;

    before(async () => {
      const createRes = await harness.request("POST", "/clocks", {
        headers: harness.authHeaders(adminToken),
        body: {
          code: "CLK-SMOKE-ADJ",
          escapementType: "瑞士杠杆式",
          balanceFrequency: "18000vph"
        }
      });
      testClockId = createRes.body.data.id;
    });

    test("POST /clocks/:id/adjustments should create adjustment", async () => {
      const res = await harness.request("POST", `/clocks/${testClockId}/adjustments`, {
        headers: harness.authHeaders(adminToken),
        body: {
          currentDailyRateSeconds: 45,
          direction: "慢针方向",
          amount: "游丝快慢针向慢侧微调0.3格",
          note: "冒烟测试调校"
        }
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.data.clockId, testClockId);
    });

    test("POST /clocks/:id/retests should create retest", async () => {
      const res = await harness.request("POST", `/clocks/${testClockId}/retests`, {
        headers: harness.authHeaders(adminToken),
        body: {
          dailyRateSeconds: 28,
          amplitude: 250,
          note: "冒烟测试复测"
        }
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.data.clockId, testClockId);
    });

    test("GET /adjustments should list adjustments with filter", async () => {
      const res = await harness.request("GET", `/adjustments?clockId=${testClockId}`, {
        headers: harness.authHeaders(adminToken)
      });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.data));
    });
  });

  describe("Handovers", () => {
    test("POST /clocks/:id/handovers should create handover", async () => {
      const res = await harness.request("POST", "/clocks/clock_demo/handovers", {
        headers: harness.authHeaders(techToken),
        body: {
          handoverNote: "冒烟测试交接备注",
          nextStepSuggestion: "冒烟测试下一步建议",
          receiver: "王师傅"
        }
      });
      assert.equal(res.status, 201);
      assert.ok(res.body.data.id);
    });

    test("GET /handovers should list handovers", async () => {
      const res = await harness.request("GET", "/handovers", {
        headers: harness.authHeaders(adminToken)
      });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.data));
    });
  });

  describe("Retest Tasks", () => {
    test("GET /retest-tasks should list tasks", async () => {
      const res = await harness.request("GET", "/retest-tasks", {
        headers: harness.authHeaders(adminToken)
      });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.data));
    });
  });

  describe("Workflow", () => {
    test("GET /workflow/statuses should return status definitions", async () => {
      const res = await harness.request("GET", "/workflow/statuses", {
        headers: harness.authHeaders(adminToken)
      });
      assert.equal(res.status, 200);
      assert.ok(res.body.data);
    });
  });

  describe("Audit Logs", () => {
    test("GET /audit-logs should return audit logs for admin", async () => {
      const res = await harness.request("GET", "/audit-logs", {
        headers: harness.authHeaders(adminToken)
      });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.data));
    });
  });

  describe("Error Handling", () => {
    test("non-existent endpoint should return 404", async () => {
      const res = await harness.request("GET", "/this-endpoint-does-not-exist", {
        headers: harness.authHeaders(adminToken)
      });
      assert.equal(res.status, 404);
      assert.equal(res.body.code, "ENDPOINT_NOT_FOUND");
    });

    test("invalid token should return 401", async () => {
      const res = await harness.request("GET", "/clocks", {
        headers: { Authorization: "Bearer invalid_token_123" }
      });
      assert.equal(res.status, 401);
      assert.equal(res.body.code, "TOKEN_INVALID");
    });
  });

  describe("Data Isolation Verification", () => {
    test("test harness uses isolated data directory", async () => {
      const fs = require("node:fs/promises");
      const dbContent = await fs.readFile(harness.dbFile, "utf-8");
      const db = JSON.parse(dbContent);
      assert.ok(Array.isArray(db.users));
      assert.ok(Array.isArray(db.clocks));
      assert.ok(harness.dataDir.includes("clock-api-test-"));
    });
  });
});

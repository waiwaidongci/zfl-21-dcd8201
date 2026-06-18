const assert = require("node:assert/strict");
const http = require("node:http");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const crypto = require("node:crypto");

const SERVER_PATH = path.join(__dirname, "..", "..", "server.js");
const DEFAULT_BASE_PORT = 13000;

let portCounter = 0;

function nextTestPort() {
  return DEFAULT_BASE_PORT + (++portCounter);
}

function createTempDir(prefix = "clock-api-test") {
  const dir = path.join(os.tmpdir(), `${prefix}-${crypto.randomBytes(8).toString("hex")}`);
  return dir;
}

function createRequestFn(baseUrl) {
  return function request(method, pathname, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(pathname, baseUrl);
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
  };
}

async function waitForServer(requestFn, timeoutMs = 10000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const res = await requestFn("GET", "/health");
      if (res.status === 200 && res.body.ok) {
        return;
      }
    } catch (e) {
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Server failed to start within timeout");
}

function createLogger(tag) {
  return {
    log: (...args) => {
      if (process.env.VERBOSE_TESTS) {
        process.stdout.write(`[${tag}] ${args.join(" ")}\n`);
      }
    },
    err: (...args) => {
      if (process.env.VERBOSE_TESTS) {
        process.stderr.write(`[${tag}] ${args.join(" ")}\n`);
      }
    }
  };
}

async function createTestHarness(options = {}) {
  const testPort = options.port || nextTestPort();
  const testDataDir = options.dataDir || createTempDir();
  const baseUrl = `http://127.0.0.1:${testPort}`;
  const request = createRequestFn(baseUrl);
  const logger = createLogger(`test:${testPort}`);
  let serverProcess = null;

  await fs.mkdir(path.join(testDataDir, "backups"), { recursive: true });

  async function start() {
    if (serverProcess) {
      return;
    }

    const env = {
      ...process.env,
      PORT: testPort.toString(),
      DATA_DIR: testDataDir,
      DB_FILE: path.join(testDataDir, "db.json"),
      BACKUP_DIR: path.join(testDataDir, "backups"),
      CONFIRMATION_TOKEN_SECRET: options.confirmationTokenSecret || "test_secret_key_for_backup_token"
    };

    serverProcess = spawn("node", [SERVER_PATH], {
      env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    serverProcess.stdout.on("data", (data) => {
      logger.log("server stdout:", data.toString().trim());
    });
    serverProcess.stderr.on("data", (data) => {
      logger.err("server stderr:", data.toString().trim());
    });

    serverProcess.on("exit", (code) => {
      logger.log(`server exited with code ${code}`);
      serverProcess = null;
    });

    await waitForServer(request);
  }

  async function stop() {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      const killTimeout = setTimeout(() => {
        if (serverProcess) {
          serverProcess.kill("SIGKILL");
        }
      }, 3000);
      await new Promise((resolve) => {
        const check = () => {
          if (!serverProcess) {
            clearTimeout(killTimeout);
            resolve();
          } else {
            setTimeout(check, 50);
          }
        };
        check();
      });
    }
  }

  async function cleanup() {
    await stop();
    try {
      await fs.rm(testDataDir, { recursive: true, force: true });
    } catch (e) {
      logger.err(`cleanup warning: failed to remove ${testDataDir}:`, e.message);
    }
  }

  async function login(username) {
    const res = await request("POST", "/auth/login", {
      body: { username }
    });
    assert.equal(res.status, 200, `Login failed for ${username}: ${JSON.stringify(res.body)}`);
    return res.body.data.token;
  }

  async function loginAsAdmin() {
    return login("admin");
  }

  async function loginAsTechnician(username = "zhang") {
    return login(username);
  }

  function authHeaders(token) {
    return { Authorization: `Bearer ${token}` };
  }

  return {
    port: testPort,
    baseUrl,
    dataDir: testDataDir,
    dbFile: path.join(testDataDir, "db.json"),
    backupDir: path.join(testDataDir, "backups"),
    request,
    login,
    loginAsAdmin,
    loginAsTechnician,
    authHeaders,
    start,
    stop,
    cleanup
  };
}

module.exports = {
  createTestHarness,
  createTempDir,
  nextTestPort,
  SERVER_PATH
};

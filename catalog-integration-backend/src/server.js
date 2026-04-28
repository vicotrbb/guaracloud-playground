import cors from "cors";
import express from "express";
import pg from "pg";
import Redis from "ioredis";
import { connect as natsConnect, StringCodec } from "nats";

const { Pool } = pg;
const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

const state = {
  postgres: { connected: false, error: null },
  redis: { connected: false, error: null },
  nats: { connected: false, error: null },
};

let pgPool = null;
let redisClient = null;
let natsConnection = null;
const sc = StringCodec();

const PG_TABLE = "catalog_test";
const NATS_SUBJECT = "catalog.test";
const NATS_WORKER_SUBJECT =
  process.env.NATS_WORKER_SUBJECT || "catalog.worker.events";

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

async function initPostgres() {
  const url = process.env.POSTGRES_URL;
  const host = process.env.POSTGRES_HOST;
  const port = process.env.POSTGRES_PORT || "5432";
  const user = process.env.POSTGRES_USER;
  const password = process.env.POSTGRES_PASSWORD;
  const database = process.env.POSTGRES_DATABASE;

  if (!host && !url) {
    state.postgres.error = "POSTGRES_HOST not set";
    console.error("[postgres] POSTGRES_HOST env var not found");
    return;
  }

  try {
    pgPool = new Pool(
      url
        ? { connectionString: url }
        : { host, port: Number(port), user, password, database, max: 5 },
    );

    // Health check
    await pgPool.query("SELECT 1");

    // Ensure test table exists
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS ${PG_TABLE} (
        id SERIAL PRIMARY KEY,
        payload TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    state.postgres.connected = true;
    console.log("[postgres] Connected, table ready:", PG_TABLE);
  } catch (err) {
    state.postgres.error = err.message;
    console.error("[postgres] Connection failed:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Redis
// ---------------------------------------------------------------------------

async function initRedis() {
  const url = process.env.REDIS_URL;
  const host = process.env.REDIS_HOST;
  const port = process.env.REDIS_PORT || "6379";
  const password = process.env.REDIS_PASSWORD;

  if (!host && !url) {
    state.redis.error = "REDIS_HOST not set";
    console.error("[redis] REDIS_HOST env var not found");
    return;
  }

  try {
    redisClient = url
      ? new Redis(url)
      : new Redis({ host, port: Number(port), password: password || undefined, lazyConnect: true });

    await redisClient.connect().catch(() => {}); // lazyConnect no-op if already connected
    await redisClient.ping();

    state.redis.connected = true;
    console.log("[redis] Connected:", url ?? `${host}:${port}`);
  } catch (err) {
    state.redis.error = err.message;
    console.error("[redis] Connection failed:", err.message);
  }
}

// ---------------------------------------------------------------------------
// NATS
// ---------------------------------------------------------------------------

async function initNats() {
  const url = process.env.NATS_URL;
  const host = process.env.NATS_HOST;
  const port = process.env.NATS_PORT || "4222";
  const user = process.env.NATS_USER;
  const password = process.env.NATS_PASSWORD;

  if (!host && !url) {
    state.nats.error = "NATS_HOST not set";
    console.error("[nats] NATS_HOST env var not found");
    return;
  }

  const servers = url ?? `nats://${host}:${port}`;

  try {
    natsConnection = await natsConnect({
      servers,
      user: user || undefined,
      pass: password || undefined,
    });

    state.nats.connected = true;
    console.log("[nats] Connected:", servers);
  } catch (err) {
    state.nats.error = err.message;
    console.error("[nats] Connection failed:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Status / health
// ---------------------------------------------------------------------------

app.get("/", (_req, res) => {
  res.json({
    message: "Catalog Integration Backend",
    services: {
      postgres: state.postgres,
      redis: state.redis,
      nats: state.nats,
    },
  });
});

app.get("/health", (_req, res) => {
  const allConnected =
    state.postgres.connected && state.redis.connected && state.nats.connected;
  res.status(allConnected ? 200 : 503).json({
    status: allConnected ? "healthy" : "degraded",
    services: state,
  });
});

// ---------------------------------------------------------------------------
// Postgres endpoints
// ---------------------------------------------------------------------------

app.post("/postgres/insert", async (req, res) => {
  if (!pgPool) return res.status(503).json({ error: "Postgres not connected" });
  const { payload } = req.body;
  if (!payload) return res.status(400).json({ error: "payload is required" });
  try {
    const result = await pgPool.query(
      `INSERT INTO ${PG_TABLE} (payload) VALUES ($1) RETURNING *`,
      [typeof payload === "string" ? payload : JSON.stringify(payload)],
    );
    console.log(
      `[postgres] insert id=${result.rows[0].id} payload="${result.rows[0].payload}"`,
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(`[postgres] insert failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.get("/postgres/rows", async (_req, res) => {
  if (!pgPool) return res.status(503).json({ error: "Postgres not connected" });
  try {
    const result = await pgPool.query(
      `SELECT * FROM ${PG_TABLE} ORDER BY id DESC LIMIT 20`,
    );
    console.log(`[postgres] list ${result.rows.length} rows`);
    res.json({ rows: result.rows, table: PG_TABLE });
  } catch (err) {
    console.error(`[postgres] list failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.get("/postgres/info", async (_req, res) => {
  if (!pgPool) return res.status(503).json({ error: "Postgres not connected" });
  try {
    const versionRes = await pgPool.query("SELECT version()");
    const countRes = await pgPool.query(
      `SELECT COUNT(*) as count FROM ${PG_TABLE}`,
    );
    res.json({
      version: versionRes.rows[0].version,
      table: PG_TABLE,
      rowCount: Number(countRes.rows[0].count),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Redis endpoints
// ---------------------------------------------------------------------------

app.post("/redis/set", async (req, res) => {
  if (!redisClient) return res.status(503).json({ error: "Redis not connected" });
  const { key, value, ttl } = req.body;
  if (!key || value === undefined) return res.status(400).json({ error: "key and value are required" });
  try {
    const val = typeof value === "string" ? value : JSON.stringify(value);
    if (ttl) {
      await redisClient.setex(key, ttl, val);
    } else {
      await redisClient.set(key, val);
    }
    console.log(`[redis] SET key=${key} ttl=${ttl ?? "none"}`);
    res.status(201).json({ key, value: val, ttl: ttl ?? null });
  } catch (err) {
    console.error(`[redis] SET failed key=${key}: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.get("/redis/get/:key", async (req, res) => {
  if (!redisClient) return res.status(503).json({ error: "Redis not connected" });
  try {
    const value = await redisClient.get(req.params.key);
    if (value === null) {
      console.log(`[redis] GET key=${req.params.key} miss`);
      return res.status(404).json({ error: "Key not found" });
    }
    console.log(`[redis] GET key=${req.params.key} hit`);
    res.json({ key: req.params.key, value });
  } catch (err) {
    console.error(`[redis] GET failed key=${req.params.key}: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.get("/redis/keys", async (_req, res) => {
  if (!redisClient) return res.status(503).json({ error: "Redis not connected" });
  try {
    const keys = await redisClient.keys("catalog:*");
    res.json({ keys });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/redis/info", async (_req, res) => {
  if (!redisClient) return res.status(503).json({ error: "Redis not connected" });
  try {
    const info = await redisClient.info("server");
    const lines = info.split("\r\n").filter((l) => l && !l.startsWith("#"));
    const parsed = Object.fromEntries(
      lines.map((l) => l.split(":")).filter((p) => p.length === 2),
    );
    res.json({ redis_version: parsed.redis_version, uptime_in_seconds: parsed.uptime_in_seconds });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// NATS endpoints
// ---------------------------------------------------------------------------

app.post("/nats/publish", async (req, res) => {
  if (!natsConnection) return res.status(503).json({ error: "NATS not connected" });
  const { subject, message } = req.body;
  if (!subject || !message) return res.status(400).json({ error: "subject and message are required" });
  try {
    const payload = typeof message === "string" ? message : JSON.stringify(message);
    natsConnection.publish(subject ?? NATS_SUBJECT, sc.encode(payload));
    console.log(
      `[nats] publish subject=${subject ?? NATS_SUBJECT} bytes=${payload.length}`,
    );
    res.json({ subject: subject ?? NATS_SUBJECT, message: payload });
  } catch (err) {
    console.error(`[nats] publish failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.post("/worker/notify", async (req, res) => {
  if (!natsConnection) {
    return res.status(503).json({ error: "NATS not connected" });
  }
  const message =
    req.body?.message !== undefined
      ? req.body.message
      : { source: "backend", note: "worker-notify", at: new Date().toISOString() };
  const payload = typeof message === "string" ? message : JSON.stringify(message);
  try {
    natsConnection.publish(NATS_WORKER_SUBJECT, sc.encode(payload));
    console.log(
      `[worker-notify] published subject=${NATS_WORKER_SUBJECT} bytes=${payload.length}`,
    );
    res.json({ subject: NATS_WORKER_SUBJECT, message: payload });
  } catch (err) {
    console.error(`[worker-notify] failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.post("/nats/request", async (req, res) => {
  if (!natsConnection) return res.status(503).json({ error: "NATS not connected" });
  const { subject, message } = req.body;
  if (!subject || !message) return res.status(400).json({ error: "subject and message are required" });
  try {
    const payload = typeof message === "string" ? message : JSON.stringify(message);
    const reply = await natsConnection.request(
      subject ?? NATS_SUBJECT,
      sc.encode(payload),
      { timeout: 2000 },
    );
    res.json({ subject: subject ?? NATS_SUBJECT, reply: sc.decode(reply.data) });
  } catch (err) {
    // Timeout is expected when no subscriber; still confirms publish works
    res.json({ subject: subject ?? NATS_SUBJECT, note: "published (no reply — no subscriber)", error: err.message });
  }
});

app.get("/nats/info", async (_req, res) => {
  if (!natsConnection) return res.status(503).json({ error: "NATS not connected" });
  try {
    const info = natsConnection.info;
    res.json({
      server_id: info?.server_id,
      server_name: info?.server_name,
      version: info?.version,
      max_payload: info?.max_payload,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Combined test endpoint
// ---------------------------------------------------------------------------

app.post("/test/all", async (_req, res) => {
  const results = { postgres: null, redis: null, nats: null };

  if (pgPool) {
    try {
      const ins = await pgPool.query(
        `INSERT INTO ${PG_TABLE} (payload) VALUES ($1) RETURNING *`,
        [`test-all-${Date.now()}`],
      );
      results.postgres = { ok: true, insertedId: ins.rows[0].id, payload: ins.rows[0].payload };
    } catch (err) {
      results.postgres = { ok: false, error: err.message };
    }
  } else {
    results.postgres = { ok: false, error: "not connected" };
  }

  if (redisClient) {
    try {
      const key = `catalog:test-all-${Date.now()}`;
      await redisClient.setex(key, 60, "test-all-value");
      const value = await redisClient.get(key);
      results.redis = { ok: true, key, value };
    } catch (err) {
      results.redis = { ok: false, error: err.message };
    }
  } else {
    results.redis = { ok: false, error: "not connected" };
  }

  if (natsConnection) {
    try {
      const subject = `${NATS_SUBJECT}.test-all`;
      natsConnection.publish(subject, sc.encode(`test-all-${Date.now()}`));
      results.nats = { ok: true, published: subject };
    } catch (err) {
      results.nats = { ok: false, error: err.message };
    }
  } else {
    results.nats = { ok: false, error: "not connected" };
  }

  res.json(results);
});

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const server = app.listen(PORT, () => {
  console.log(`[server] Listening on port ${PORT}`);
  initPostgres();
  initRedis();
  initNats();
});

process.on("SIGTERM", async () => {
  console.log("[server] SIGTERM received, shutting down");
  if (natsConnection) await natsConnection.drain();
  server.close();
});

import express from "express";
import pg from "pg";
import Redis from "ioredis";
import { connect } from "nats";

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

const state = {
  pg: { connected: false, error: null },
  redis: { connected: false, error: null },
  nats: { connected: false, error: null },
};

let pgPool = null;
let redisClient = null;
let nc = null;
let natsSubscription = null;
const receivedMessages = [];

async function initPostgres() {
  const connectionString = process.env.POSTGRES_URL;
  if (!connectionString) {
    state.pg.error = "POSTGRES_URL not set";
    console.error("[postgres] POSTGRES_URL env var not found");
    return;
  }

  try {
    pgPool = new pg.Pool({ connectionString });
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS test_items (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        value TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    state.pg.connected = true;
    console.log("[postgres] Connected and schema ready");
  } catch (err) {
    state.pg.error = err.message;
    console.error("[postgres] Connection failed:", err.message);
  }
}

async function initRedis() {
  const url = process.env.REDIS_URL;
  if (!url) {
    state.redis.error = "REDIS_URL not set";
    console.error("[redis] REDIS_URL env var not found");
    return;
  }

  try {
    redisClient = new Redis(url);
    await redisClient.ping();
    state.redis.connected = true;
    console.log("[redis] Connected");
  } catch (err) {
    state.redis.error = err.message;
    console.error("[redis] Connection failed:", err.message);
  }
}

async function initNats() {
  const url = process.env.NATS_URL;
  if (!url) {
    state.nats.error = "NATS_URL not set";
    console.error("[nats] NATS_URL env var not found");
    return;
  }

  try {
    nc = await connect({ servers: url });
    state.nats.connected = true;
    console.log("[nats] Connected to", nc.getServer());

    natsSubscription = nc.subscribe("catalog-test.>", {
      callback: (err, msg) => {
        if (err) {
          console.error("[nats] Subscription error:", err.message);
          return;
        }
        const data = new TextDecoder().decode(msg.data);
        receivedMessages.push({
          subject: msg.subject,
          data,
          timestamp: new Date().toISOString(),
        });
        if (receivedMessages.length > 100) receivedMessages.shift();
        console.log(`[nats] Received on "${msg.subject}": ${data}`);
      },
    });

    console.log("[nats] Subscribed to catalog-test.>");
  } catch (err) {
    state.nats.error = err.message;
    console.error("[nats] Connection failed:", err.message);
  }
}

app.get("/", (_req, res) => {
  res.json({
    message: "Catalog Integration Backend",
    services: {
      postgres: state.pg,
      redis: state.redis,
      nats: state.nats,
    },
  });
});

app.get("/health", (_req, res) => {
  const allConnected =
    state.pg.connected && state.redis.connected && state.nats.connected;
  res.status(allConnected ? 200 : 503).json({
    status: allConnected ? "healthy" : "degraded",
    services: state,
  });
});

// --- PostgreSQL endpoints ---

app.get("/postgres/items", async (_req, res) => {
  if (!pgPool)
    return res.status(503).json({ error: "PostgreSQL not connected" });
  try {
    const { rows } = await pgPool.query(
      "SELECT * FROM test_items ORDER BY created_at DESC",
    );
    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/postgres/items", async (req, res) => {
  if (!pgPool)
    return res.status(503).json({ error: "PostgreSQL not connected" });
  const { name, value } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  try {
    const { rows } = await pgPool.query(
      "INSERT INTO test_items (name, value) VALUES ($1, $2) RETURNING *",
      [name, value ?? null],
    );
    res.status(201).json({ item: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/postgres/items/:id", async (req, res) => {
  if (!pgPool)
    return res.status(503).json({ error: "PostgreSQL not connected" });
  try {
    const { rowCount } = await pgPool.query(
      "DELETE FROM test_items WHERE id = $1",
      [req.params.id],
    );
    if (rowCount === 0)
      return res.status(404).json({ error: "Item not found" });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Redis endpoints ---

app.get("/redis/get/:key", async (req, res) => {
  if (!redisClient)
    return res.status(503).json({ error: "Redis not connected" });
  try {
    const value = await redisClient.get(req.params.key);
    if (value === null) return res.status(404).json({ error: "Key not found" });
    res.json({ key: req.params.key, value });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/redis/set", async (req, res) => {
  if (!redisClient)
    return res.status(503).json({ error: "Redis not connected" });
  const { key, value, ttl } = req.body;
  if (!key || value === undefined)
    return res.status(400).json({ error: "key and value required" });
  try {
    if (ttl) {
      await redisClient.set(key, value, "EX", Number(ttl));
    } else {
      await redisClient.set(key, value);
    }
    res.json({ key, value, ttl: ttl ?? null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/redis/incr/:key", async (req, res) => {
  if (!redisClient)
    return res.status(503).json({ error: "Redis not connected" });
  try {
    const value = await redisClient.incr(req.params.key);
    res.json({ key: req.params.key, value });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/redis/info", async (_req, res) => {
  if (!redisClient)
    return res.status(503).json({ error: "Redis not connected" });
  try {
    const info = await redisClient.info();
    const dbsize = await redisClient.dbsize();
    res.json({ dbsize, info: info.substring(0, 500) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- NATS endpoints ---

app.post("/nats/publish", async (req, res) => {
  if (!nc) return res.status(503).json({ error: "NATS not connected" });
  const { subject, message } = req.body;
  if (!subject || !message)
    return res.status(400).json({ error: "subject and message required" });
  try {
    nc.publish(subject, new TextEncoder().encode(message));
    res.json({ published: true, subject, message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/nats/messages", (_req, res) => {
  res.json({ messages: receivedMessages });
});

app.post("/nats/request", async (req, res) => {
  if (!nc) return res.status(503).json({ error: "NATS not connected" });
  const { subject, message, timeout = 5000 } = req.body;
  if (!subject || !message)
    return res.status(400).json({ error: "subject and message required" });
  try {
    const response = await nc.request(
      subject,
      new TextEncoder().encode(message),
      { timeout },
    );
    res.json({ reply: new TextDecoder().decode(response.data) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Combined test endpoint ---

app.post("/test/all", async (req, res) => {
  const results = { postgres: null, redis: null, nats: null };

  if (pgPool) {
    try {
      const { rows } = await pgPool.query(
        "INSERT INTO test_items (name, value) VALUES ($1, $2) RETURNING *",
        ["test-all", `combined-test-${Date.now()}`],
      );
      results.postgres = { ok: true, item: rows[0] };
    } catch (err) {
      results.postgres = { ok: false, error: err.message };
    }
  } else {
    results.postgres = { ok: false, error: "not connected" };
  }

  if (redisClient) {
    try {
      const key = `test:all:${Date.now()}`;
      await redisClient.set(key, `value-${Date.now()}`);
      const value = await redisClient.get(key);
      results.redis = { ok: true, key, value };
    } catch (err) {
      results.redis = { ok: false, error: err.message };
    }
  } else {
    results.redis = { ok: false, error: "not connected" };
  }

  if (nc) {
    try {
      nc.publish(
        "catalog-test.all",
        new TextEncoder().encode(`test-${Date.now()}`),
      );
      results.nats = { ok: true, published: true };
    } catch (err) {
      results.nats = { ok: false, error: err.message };
    }
  } else {
    results.nats = { ok: false, error: "not connected" };
  }

  res.json(results);
});

const server = app.listen(PORT, () => {
  console.log(`[server] Listening on port ${PORT}`);
  initPostgres();
  initRedis();
  initNats();
});

process.on("SIGTERM", () => {
  console.log("[server] SIGTERM received, shutting down");
  server.close();
  if (pgPool) pgPool.end();
  if (redisClient) redisClient.quit();
  if (nc) nc.close();
});

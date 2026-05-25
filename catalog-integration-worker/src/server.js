import cors from "cors";
import express from "express";
import pg from "pg";
import { connect as natsConnect, StringCodec } from "nats";

const { Pool } = pg;
const app = express();
const PORT = process.env.PORT || 8080;
const BACKEND_URL = (process.env.BACKEND_URL || "").replace(/\/$/, "");
const NATS_WORKER_SUBJECT =
  process.env.NATS_WORKER_SUBJECT || "catalog.worker.events";

app.use(cors());
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  next();
});
app.use(express.json());

const state = {
  postgres: { connected: false, error: null },
  nats: { connected: false, error: null, subscribed: false, source: null, server: null },
  external: {},
};

let pgPool = null;
let natsConnection = null;
let natsSubscription = null;
const sc = StringCodec();

const TABLE_RUNS = "worker_runs";
const TABLE_TICKS = "cron_ticks";
const NATS_PREFIX_PREFERENCES = [
  "NATS",
  "CATALOG_NATS",
  "TESTE_CATALOG",
  "TESTE_NATS",
  "NATS_SERVICE",
];
const EXTERNAL_APIS = [
  {
    name: "jsonplaceholder",
    endpoint: "https://jsonplaceholder.typicode.com/todos/1",
    select: (data) => ({ id: data.id, title: data.title, completed: data.completed }),
  },
  {
    name: "httpbin",
    endpoint: "https://httpbin.org/uuid",
    select: (data) => ({ uuid: data.uuid }),
  },
  {
    name: "dummyjson",
    endpoint: "https://dummyjson.com/todos/1",
    select: (data) => ({ id: data.id, todo: data.todo, completed: data.completed }),
  },
];

for (const api of EXTERNAL_APIS) {
  state.external[api.name] = {
    status: "unknown",
    endpoint: api.endpoint,
    lastChecked: null,
    latencyMs: null,
    data: null,
    error: null,
  };
}

const RECEIVED_BUFFER_MAX = 50;
const receivedMessages = [];

function pushReceived(entry) {
  receivedMessages.unshift(entry);
  if (receivedMessages.length > RECEIVED_BUFFER_MAX) {
    receivedMessages.length = RECEIVED_BUFFER_MAX;
  }
}

function normalizeNatsServer({ url, host, port }) {
  if (host) {
    return `nats://${host}:${port || "4222"}`;
  }

  if (!url) return null;
  if (url.startsWith("nats://") || url.startsWith("tls://") || url.startsWith("ws://")) {
    return url;
  }

  try {
    const parsed = new URL(url);
    return `nats://${parsed.hostname}:${parsed.port || port || "4222"}`;
  } catch {
    return `nats://${url.replace(/^\/+/, "")}`;
  }
}

function readNatsConfig(prefix) {
  const url = process.env[`${prefix}_URL`];
  const host = process.env[`${prefix}_HOST`];
  const port = process.env[`${prefix}_PORT`] || "4222";
  const user = process.env.NATS_USER || process.env[`${prefix}_USER`];
  const password = process.env.NATS_PASSWORD || process.env[`${prefix}_PASSWORD`];
  const server = normalizeNatsServer({ url, host, port });

  if (!server) return null;
  return { server, user, password, source: prefix };
}

function resolveNatsConfig() {
  for (const prefix of NATS_PREFIX_PREFERENCES) {
    const config = readNatsConfig(prefix);
    if (config) return config;
  }

  const hostPrefixes = Object.keys(process.env)
    .filter((key) => key.endsWith("_HOST"))
    .map((key) => key.slice(0, -5));

  for (const prefix of hostPrefixes) {
    const port = process.env[`${prefix}_PORT`];
    if (port === "4222" || prefix.includes("NATS")) {
      const config = readNatsConfig(prefix);
      if (config) return config;
    }
  }

  return null;
}

async function fetchJsonWithTimeout(endpoint, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, { signal: controller.signal });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function checkExternalApi(api) {
  const start = Date.now();
  try {
    const data = await fetchJsonWithTimeout(api.endpoint);
    const latencyMs = Date.now() - start;
    const selected = api.select(data);
    const previous = state.external[api.name].status;

    state.external[api.name] = {
      status: "ok",
      endpoint: api.endpoint,
      lastChecked: new Date().toISOString(),
      latencyMs,
      data: selected,
      error: null,
    };

    if (previous !== "ok") {
      console.log(`[external] ${api.name}: ${previous} -> ok (${latencyMs}ms)`);
    }
  } catch (err) {
    const previous = state.external[api.name].status;
    state.external[api.name] = {
      ...state.external[api.name],
      status: "unreachable",
      lastChecked: new Date().toISOString(),
      latencyMs: null,
      error: err.message,
    };

    if (previous !== "unreachable") {
      console.error(`[external] ${api.name}: ${previous} -> unreachable (${err.message})`);
    }
  }
}

async function checkExternalApis() {
  await Promise.allSettled(EXTERNAL_APIS.map((api) => checkExternalApi(api)));
  return state.external;
}

function startExternalChecks(intervalMs = 30000) {
  checkExternalApis().then((external) => {
    const statuses = Object.entries(external)
      .map(([name, result]) => `${name}:${result.status}`)
      .join(", ");
    console.log(`[external] Initial status: ${statuses}`);
  });
  setInterval(() => checkExternalApis(), intervalMs);
}

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

    await pgPool.query("SELECT 1");

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_RUNS} (
        id SERIAL PRIMARY KEY,
        source TEXT NOT NULL,
        backend_row_id INTEGER,
        payload TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_TICKS} (
        id SERIAL PRIMARY KEY,
        body JSONB NOT NULL,
        received_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    state.postgres.connected = true;
    console.log(
      `[postgres] Connected, tables ready: ${TABLE_RUNS}, ${TABLE_TICKS}`,
    );
  } catch (err) {
    state.postgres.error = err.message;
    console.error("[postgres] Connection failed:", err.message);
  }
}

// ---------------------------------------------------------------------------
// NATS
// ---------------------------------------------------------------------------

async function initNats() {
  const config = resolveNatsConfig();

  if (!config) {
    state.nats.error = "NATS service env vars not found";
    console.error(
      "[nats] No NATS env vars found. Expected NATS_* or service discovery vars such as TESTE_CATALOG_*",
    );
    return;
  }

  try {
    natsConnection = await natsConnect({
      servers: config.server,
      user: config.user || undefined,
      pass: config.password || undefined,
    });

    state.nats = {
      connected: true,
      error: null,
      subscribed: false,
      source: config.source,
      server: config.server,
    };
    console.log(`[nats] Connected via ${config.source}: ${config.server}`);

    natsSubscription = natsConnection.subscribe(NATS_WORKER_SUBJECT);
    state.nats.subscribed = true;
    console.log("[nats] Subscribed to subject:", NATS_WORKER_SUBJECT);

    (async () => {
      for await (const msg of natsSubscription) {
        const decoded = sc.decode(msg.data);
        const entry = {
          subject: msg.subject,
          message: decoded,
          received_at: new Date().toISOString(),
        };
        pushReceived(entry);
        console.log(
          `[nats] received subject=${msg.subject} bytes=${msg.data.length}`,
        );
      }
    })().catch((err) => {
      console.error("[nats] subscription loop ended:", err.message);
      state.nats.subscribed = false;
    });
  } catch (err) {
    state.nats = {
      connected: false,
      error: err.message,
      subscribed: false,
      source: config.source,
      server: config.server,
    };
    console.error("[nats] Connection failed:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Status / health
// ---------------------------------------------------------------------------

app.get("/", (_req, res) => {
  res.json({
    message: "Catalog Integration Worker",
    backendUrl: BACKEND_URL || null,
    natsSubject: NATS_WORKER_SUBJECT,
    services: {
      postgres: state.postgres,
      nats: state.nats,
    },
    externalApis: state.external,
  });
});

app.get("/health", (_req, res) => {
  const ok = state.postgres.connected && state.nats.connected;
  res.status(ok ? 200 : 503).json({
    status: ok ? "healthy" : "degraded",
    services: state,
  });
});

// ---------------------------------------------------------------------------
// /integrate — calls catalog-integration-backend, then writes a worker_runs row
// ---------------------------------------------------------------------------

app.post("/integrate", async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "Postgres not connected" });
  }
  if (!BACKEND_URL) {
    return res.status(503).json({ error: "BACKEND_URL not configured" });
  }

  const payload =
    typeof req.body?.payload === "string"
      ? req.body.payload
      : `worker-integrate-${Date.now()}`;

  console.log(`[integrate] start payload="${payload}" backend=${BACKEND_URL}`);

  let backendRowId = null;
  try {
    const resp = await fetch(`${BACKEND_URL}/postgres/insert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: `from-worker:${payload}` }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      console.error(
        `[integrate] backend error status=${resp.status} body=${JSON.stringify(data)}`,
      );
      return res.status(502).json({ error: "Backend call failed", details: data });
    }
    backendRowId = data.id ?? null;
    console.log(`[integrate] backend inserted id=${backendRowId}`);
  } catch (err) {
    console.error(`[integrate] backend call failed: ${err.message}`);
    return res.status(502).json({ error: "Backend unreachable", message: err.message });
  }

  try {
    const result = await pgPool.query(
      `INSERT INTO ${TABLE_RUNS} (source, backend_row_id, payload) VALUES ($1, $2, $3) RETURNING *`,
      ["integrate", backendRowId, payload],
    );
    const row = result.rows[0];
    console.log(
      `[integrate] worker row id=${row.id} backend_row_id=${backendRowId}`,
    );
    res.status(201).json({ workerRun: row, backendRowId });
  } catch (err) {
    console.error(`[integrate] worker insert failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// /cron/tick — fixed-body cron HTTP target
// ---------------------------------------------------------------------------

app.post("/cron/tick", async (req, res) => {
  if (!pgPool) {
    return res.status(503).json({ error: "Postgres not connected" });
  }

  const body = req.body && Object.keys(req.body).length > 0 ? req.body : null;
  if (!body) {
    return res.status(400).json({ error: "Empty body" });
  }

  console.log(`[cron] tick received body=${JSON.stringify(body)}`);

  try {
    const result = await pgPool.query(
      `INSERT INTO ${TABLE_TICKS} (body) VALUES ($1) RETURNING *`,
      [body],
    );
    const row = result.rows[0];
    console.log(`[cron] tick stored id=${row.id}`);
    res.status(201).json({ tick: row });
  } catch (err) {
    console.error(`[cron] insert failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Listing endpoints (used by the frontend)
// ---------------------------------------------------------------------------

app.get("/runs", async (_req, res) => {
  if (!pgPool) return res.status(503).json({ error: "Postgres not connected" });
  try {
    const result = await pgPool.query(
      `SELECT * FROM ${TABLE_RUNS} ORDER BY id DESC LIMIT 20`,
    );
    res.json({ rows: result.rows, table: TABLE_RUNS });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/ticks", async (_req, res) => {
  if (!pgPool) return res.status(503).json({ error: "Postgres not connected" });
  try {
    const result = await pgPool.query(
      `SELECT * FROM ${TABLE_TICKS} ORDER BY id DESC LIMIT 20`,
    );
    res.json({ rows: result.rows, table: TABLE_TICKS });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/nats/received", (_req, res) => {
  res.json({
    subject: NATS_WORKER_SUBJECT,
    count: receivedMessages.length,
    messages: receivedMessages,
  });
});

app.get("/external", async (_req, res) => {
  const external = await checkExternalApis();
  res.json({
    service: "catalog-integration-worker",
    externals: external,
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const server = app.listen(PORT, () => {
  console.log(`[server] Listening on port ${PORT}`);
  initPostgres();
  initNats();
  startExternalChecks();
});

process.on("SIGTERM", async () => {
  console.log("[server] SIGTERM received, shutting down");
  if (natsSubscription) {
    try {
      await natsSubscription.drain();
    } catch (err) {
      console.error("[nats] drain failed:", err.message);
    }
  }
  if (natsConnection) {
    try {
      await natsConnection.drain();
    } catch (err) {
      console.error("[nats] connection drain failed:", err.message);
    }
  }
  server.close();
});

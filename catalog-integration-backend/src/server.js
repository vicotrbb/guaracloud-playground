import cors from "cors";
import express from "express";
import amqp from "amqplib";
import { MeiliSearch } from "meilisearch";
import memjs from "memjs";

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

const state = {
  rabbitmq: { connected: false, error: null },
  meilisearch: { connected: false, error: null },
  memcached: { connected: false, error: null },
};

let rabbitmqConnection = null;
let rabbitmqChannel = null;
let meiliClient = null;
let memcachedClient = null;

const MEILI_INDEX = "test-index";
const RABBITMQ_QUEUE = "test-queue";

// ---------------------------------------------------------------------------
// RabbitMQ
// ---------------------------------------------------------------------------

async function initRabbitMQ() {
  const url = process.env.RABBITMQ_URL || process.env.CATALOG_RABBITMQ_URL;
  if (!url) {
    state.rabbitmq.error = "RABBITMQ_URL not set";
    console.error("[rabbitmq] RABBITMQ_URL env var not found");
    return;
  }
  try {
    rabbitmqConnection = await amqp.connect(url);
    rabbitmqChannel = await rabbitmqConnection.createChannel();
    await rabbitmqChannel.assertQueue(RABBITMQ_QUEUE, { durable: true });
    state.rabbitmq.connected = true;
    console.log("[rabbitmq] Connected, queue ready:", RABBITMQ_QUEUE);
  } catch (err) {
    state.rabbitmq.error = err.message;
    console.error("[rabbitmq] Connection failed:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Meilisearch
// ---------------------------------------------------------------------------

async function initMeilisearch() {
  const url =
    process.env.MEILISEARCH_URL || process.env.CATALOG_MEILISEARCH_URL;
  const masterKey =
    process.env.MEILISEARCH_MASTER_KEY ||
    process.env.CATALOG_MEILISEARCH_MASTER_KEY;
  if (!url) {
    state.meilisearch.error = "MEILISEARCH_URL not set";
    console.error("[meilisearch] MEILISEARCH_URL env var not found");
    return;
  }
  try {
    meiliClient = new MeiliSearch({ host: url, apiKey: masterKey });
    await meiliClient.health();
    await meiliClient.createIndex(MEILI_INDEX, { primaryKey: "id" });
    state.meilisearch.connected = true;
    console.log("[meilisearch] Connected, index ready:", MEILI_INDEX);
  } catch (err) {
    state.meilisearch.error = err.message;
    console.error("[meilisearch] Connection failed:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Memcached
// ---------------------------------------------------------------------------

async function initMemcached() {
  const host =
    process.env.MEMCACHED_HOST || process.env.CATALOG_MEMCACHED_HOST;
  const port =
    process.env.MEMCACHED_PORT || process.env.CATALOG_MEMCACHED_PORT || "11211";
  if (!host) {
    state.memcached.error = "MEMCACHED_HOST not set";
    console.error("[memcached] MEMCACHED_HOST env var not found");
    return;
  }
  try {
    memcachedClient = memjs.Client.create(`${host}:${port}`, {
      timeout: 2,
      retries: 1,
    });
    // Test connectivity with a set/get round trip
    await memcachedClient.set("__health__", "ok", { expires: 10 });
    const { value } = await memcachedClient.get("__health__");
    if (!value) throw new Error("Health check round-trip failed");
    state.memcached.connected = true;
    console.log("[memcached] Connected:", `${host}:${port}`);
  } catch (err) {
    state.memcached.error = err.message;
    console.error("[memcached] Connection failed:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Status / health
// ---------------------------------------------------------------------------

app.get("/", (_req, res) => {
  res.json({
    message: "Catalog Integration Backend",
    services: {
      rabbitmq: state.rabbitmq,
      meilisearch: state.meilisearch,
      memcached: state.memcached,
    },
  });
});

app.get("/health", (_req, res) => {
  const allConnected =
    state.rabbitmq.connected &&
    state.meilisearch.connected &&
    state.memcached.connected;
  res.status(allConnected ? 200 : 503).json({
    status: allConnected ? "healthy" : "degraded",
    services: state,
  });
});

// ---------------------------------------------------------------------------
// RabbitMQ endpoints
// ---------------------------------------------------------------------------

app.post("/rabbitmq/publish", async (req, res) => {
  if (!rabbitmqChannel)
    return res.status(503).json({ error: "RabbitMQ not connected" });
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: "message is required" });
  try {
    const sent = rabbitmqChannel.sendToQueue(
      RABBITMQ_QUEUE,
      Buffer.from(JSON.stringify({ message, timestamp: Date.now() })),
      { persistent: true },
    );
    const queueInfo = await rabbitmqChannel.assertQueue(RABBITMQ_QUEUE, {
      durable: true,
    });
    res.json({
      sent,
      queue: RABBITMQ_QUEUE,
      messageCount: queueInfo.messageCount,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/rabbitmq/consume", async (_req, res) => {
  if (!rabbitmqChannel)
    return res.status(503).json({ error: "RabbitMQ not connected" });
  try {
    const msg = await rabbitmqChannel.get(RABBITMQ_QUEUE, { noAck: false });
    if (!msg) return res.json({ message: null, queue: RABBITMQ_QUEUE });
    rabbitmqChannel.ack(msg);
    const content = JSON.parse(msg.content.toString());
    const queueInfo = await rabbitmqChannel.assertQueue(RABBITMQ_QUEUE, {
      durable: true,
    });
    res.json({
      message: content,
      queue: RABBITMQ_QUEUE,
      remaining: queueInfo.messageCount,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/rabbitmq/info", async (_req, res) => {
  if (!rabbitmqChannel)
    return res.status(503).json({ error: "RabbitMQ not connected" });
  try {
    const queueInfo = await rabbitmqChannel.assertQueue(RABBITMQ_QUEUE, {
      durable: true,
    });
    res.json({
      queue: RABBITMQ_QUEUE,
      messageCount: queueInfo.messageCount,
      consumerCount: queueInfo.consumerCount,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Meilisearch endpoints
// ---------------------------------------------------------------------------

app.get("/meilisearch/docs", async (_req, res) => {
  if (!meiliClient)
    return res.status(503).json({ error: "Meilisearch not connected" });
  try {
    const index = meiliClient.index(MEILI_INDEX);
    const result = await index.getDocuments({ limit: 50 });
    res.json({ docs: result.results, total: result.total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/meilisearch/docs", async (req, res) => {
  if (!meiliClient)
    return res.status(503).json({ error: "Meilisearch not connected" });
  const { title, content } = req.body;
  if (!title) return res.status(400).json({ error: "title is required" });
  try {
    const index = meiliClient.index(MEILI_INDEX);
    const doc = { id: Date.now(), title, content: content ?? null };
    const task = await index.addDocuments([doc]);
    res.status(201).json({ doc, taskUid: task.taskUid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/meilisearch/search", async (req, res) => {
  if (!meiliClient)
    return res.status(503).json({ error: "Meilisearch not connected" });
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: "q query param required" });
  try {
    const index = meiliClient.index(MEILI_INDEX);
    const result = await index.search(String(q));
    res.json({ hits: result.hits, processingTimeMs: result.processingTimeMs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/meilisearch/stats", async (_req, res) => {
  if (!meiliClient)
    return res.status(503).json({ error: "Meilisearch not connected" });
  try {
    const index = meiliClient.index(MEILI_INDEX);
    const stats = await index.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Memcached endpoints
// ---------------------------------------------------------------------------

app.post("/memcached/set", async (req, res) => {
  if (!memcachedClient)
    return res.status(503).json({ error: "Memcached not connected" });
  const { key, value, expires } = req.body;
  if (!key || value === undefined)
    return res.status(400).json({ error: "key and value required" });
  try {
    await memcachedClient.set(key, String(value), {
      expires: expires ? Number(expires) : 0,
    });
    res.json({ key, value, expires: expires ?? 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/memcached/get/:key", async (req, res) => {
  if (!memcachedClient)
    return res.status(503).json({ error: "Memcached not connected" });
  try {
    const { value } = await memcachedClient.get(req.params.key);
    if (!value) return res.status(404).json({ error: "Key not found" });
    res.json({ key: req.params.key, value: value.toString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/memcached/delete/:key", async (req, res) => {
  if (!memcachedClient)
    return res.status(503).json({ error: "Memcached not connected" });
  try {
    const deleted = await memcachedClient.delete(req.params.key);
    res.json({ deleted, key: req.params.key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/memcached/stats", async (_req, res) => {
  if (!memcachedClient)
    return res.status(503).json({ error: "Memcached not connected" });
  try {
    const stats = await memcachedClient.stats();
    res.json({ stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Combined test endpoint
// ---------------------------------------------------------------------------

app.post("/test/all", async (_req, res) => {
  const results = { rabbitmq: null, meilisearch: null, memcached: null };

  if (rabbitmqChannel) {
    try {
      const sent = rabbitmqChannel.sendToQueue(
        RABBITMQ_QUEUE,
        Buffer.from(JSON.stringify({ message: "test-all", ts: Date.now() })),
        { persistent: true },
      );
      results.rabbitmq = { ok: true, sent };
    } catch (err) {
      results.rabbitmq = { ok: false, error: err.message };
    }
  } else {
    results.rabbitmq = { ok: false, error: "not connected" };
  }

  if (meiliClient) {
    try {
      const index = meiliClient.index(MEILI_INDEX);
      const doc = {
        id: Date.now(),
        title: "test-all",
        content: `ts-${Date.now()}`,
      };
      const task = await index.addDocuments([doc]);
      results.meilisearch = { ok: true, taskUid: task.taskUid };
    } catch (err) {
      results.meilisearch = { ok: false, error: err.message };
    }
  } else {
    results.meilisearch = { ok: false, error: "not connected" };
  }

  if (memcachedClient) {
    try {
      const key = `test:all:${Date.now()}`;
      const value = `value-${Date.now()}`;
      await memcachedClient.set(key, value, { expires: 60 });
      const { value: got } = await memcachedClient.get(key);
      results.memcached = { ok: true, key, value: got?.toString() };
    } catch (err) {
      results.memcached = { ok: false, error: err.message };
    }
  } else {
    results.memcached = { ok: false, error: "not connected" };
  }

  res.json(results);
});

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const server = app.listen(PORT, () => {
  console.log(`[server] Listening on port ${PORT}`);
  initRabbitMQ();
  initMeilisearch();
  initMemcached();
});

process.on("SIGTERM", () => {
  console.log("[server] SIGTERM received, shutting down");
  server.close();
  if (rabbitmqConnection) rabbitmqConnection.close();
  if (memcachedClient) memcachedClient.close();
});

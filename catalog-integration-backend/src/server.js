import cors from "cors";
import express from "express";
import amqp from "amqplib";
import { MeiliSearch } from "meilisearch";
import * as Minio from "minio";

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

const state = {
  rabbitmq: { connected: false, error: null },
  meilisearch: { connected: false, error: null },
  minio: { connected: false, error: null },
};

let rabbitmqConnection = null;
let rabbitmqChannel = null;
let meiliClient = null;
let minioClient = null;

const MINIO_BUCKET = "test-bucket";
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
// MinIO
// ---------------------------------------------------------------------------

async function initMinio() {
  const endpoint =
    process.env.MINIO_ENDPOINT || process.env.CATALOG_MINIO_ENDPOINT;
  const accessKey =
    process.env.MINIO_ACCESS_KEY || process.env.CATALOG_MINIO_ACCESS_KEY;
  const secretKey =
    process.env.MINIO_SECRET_KEY || process.env.CATALOG_MINIO_SECRET_KEY;

  if (!endpoint) {
    state.minio.error = "MINIO_ENDPOINT not set";
    console.error("[minio] MINIO_ENDPOINT env var not found");
    return;
  }
  try {
    const [host, portStr] = endpoint.split(":");
    const port = portStr ? parseInt(portStr, 10) : 9000;
    minioClient = new Minio.Client({
      endPoint: host,
      port,
      useSSL: false,
      accessKey: accessKey ?? "",
      secretKey: secretKey ?? "",
    });
    const exists = await minioClient.bucketExists(MINIO_BUCKET);
    if (!exists) {
      await minioClient.makeBucket(MINIO_BUCKET);
    }
    state.minio.connected = true;
    console.log("[minio] Connected, bucket ready:", MINIO_BUCKET);
  } catch (err) {
    state.minio.error = err.message;
    console.error("[minio] Connection failed:", err.message);
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
      minio: state.minio,
    },
  });
});

app.get("/health", (_req, res) => {
  const allConnected =
    state.rabbitmq.connected &&
    state.meilisearch.connected &&
    state.minio.connected;
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
// MinIO endpoints
// ---------------------------------------------------------------------------

app.get("/minio/objects", async (_req, res) => {
  if (!minioClient)
    return res.status(503).json({ error: "MinIO not connected" });
  try {
    const objects = [];
    await new Promise((resolve, reject) => {
      const stream = minioClient.listObjects(MINIO_BUCKET, "", false);
      stream.on("data", (obj) => objects.push(obj));
      stream.on("end", resolve);
      stream.on("error", reject);
    });
    res.json({ objects, bucket: MINIO_BUCKET });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/minio/upload", async (req, res) => {
  if (!minioClient)
    return res.status(503).json({ error: "MinIO not connected" });
  const { name, content } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  try {
    const data = content ?? `test-content-${Date.now()}`;
    const buf = Buffer.from(data);
    await minioClient.putObject(MINIO_BUCKET, name, buf, buf.length, {
      "content-type": "text/plain",
    });
    res.status(201).json({ bucket: MINIO_BUCKET, name, size: buf.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/minio/download/:name", async (req, res) => {
  if (!minioClient)
    return res.status(503).json({ error: "MinIO not connected" });
  try {
    const stream = await minioClient.getObject(MINIO_BUCKET, req.params.name);
    const chunks = [];
    await new Promise((resolve, reject) => {
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("end", resolve);
      stream.on("error", reject);
    });
    const content = Buffer.concat(chunks).toString();
    res.json({ name: req.params.name, content });
  } catch (err) {
    if (err.code === "NoSuchKey") return res.status(404).json({ error: "Object not found" });
    res.status(500).json({ error: err.message });
  }
});

app.delete("/minio/objects/:name", async (req, res) => {
  if (!minioClient)
    return res.status(503).json({ error: "MinIO not connected" });
  try {
    await minioClient.removeObject(MINIO_BUCKET, req.params.name);
    res.json({ deleted: true, name: req.params.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/minio/stats", async (_req, res) => {
  if (!minioClient)
    return res.status(503).json({ error: "MinIO not connected" });
  try {
    const objects = [];
    await new Promise((resolve, reject) => {
      const stream = minioClient.listObjects(MINIO_BUCKET, "", false);
      stream.on("data", (obj) => objects.push(obj));
      stream.on("end", resolve);
      stream.on("error", reject);
    });
    const totalSize = objects.reduce((sum, o) => sum + (o.size ?? 0), 0);
    res.json({ bucket: MINIO_BUCKET, objectCount: objects.length, totalSize });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Combined test endpoint
// ---------------------------------------------------------------------------

app.post("/test/all", async (_req, res) => {
  const results = { rabbitmq: null, meilisearch: null, minio: null };

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
      const doc = { id: Date.now(), title: "test-all", content: `ts-${Date.now()}` };
      const task = await index.addDocuments([doc]);
      results.meilisearch = { ok: true, taskUid: task.taskUid };
    } catch (err) {
      results.meilisearch = { ok: false, error: err.message };
    }
  } else {
    results.meilisearch = { ok: false, error: "not connected" };
  }

  if (minioClient) {
    try {
      const name = `test-all-${Date.now()}.txt`;
      const data = Buffer.from(`combined-test-${Date.now()}`);
      await minioClient.putObject(MINIO_BUCKET, name, data, data.length);
      results.minio = { ok: true, name, bucket: MINIO_BUCKET };
    } catch (err) {
      results.minio = { ok: false, error: err.message };
    }
  } else {
    results.minio = { ok: false, error: "not connected" };
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
  initMinio();
});

process.on("SIGTERM", () => {
  console.log("[server] SIGTERM received, shutting down");
  server.close();
  if (rabbitmqConnection) rabbitmqConnection.close();
});

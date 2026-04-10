import cors from "cors";
import express from "express";
import mysql from "mysql2/promise";
import { MongoClient } from "mongodb";
import Redis from "ioredis";

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

const state = {
  mysql: { connected: false, error: null },
  mongodb: { connected: false, error: null },
  valkey: { connected: false, error: null },
};

let mysqlPool = null;
let mongoClient = null;
let mongoDb = null;
let valkeyClient = null;

// ---------------------------------------------------------------------------
// MySQL
// ---------------------------------------------------------------------------

async function initMySQL() {
  const url = process.env.MYSQL_URL || process.env.CATALOG_MYSQL_URL;
  if (!url) {
    state.mysql.error = "MYSQL_URL not set";
    console.error("[mysql] MYSQL_URL env var not found");
    return;
  }
  try {
    mysqlPool = await mysql.createPool(url);
    await mysqlPool.execute(`
      CREATE TABLE IF NOT EXISTS test_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        value TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    state.mysql.connected = true;
    console.log("[mysql] Connected and schema ready");
  } catch (err) {
    state.mysql.error = err.message;
    console.error("[mysql] Connection failed:", err.message);
  }
}

// ---------------------------------------------------------------------------
// MongoDB
// ---------------------------------------------------------------------------

async function initMongoDB() {
  const url =
    process.env.MONGODB_URL || process.env.CATALOG_MONGODB_URL;
  const dbName =
    process.env.MONGODB_DATABASE ||
    process.env.CATALOG_MONGODB_DATABASE ||
    "testdb";
  if (!url) {
    state.mongodb.error = "MONGODB_URL not set";
    console.error("[mongodb] MONGODB_URL env var not found");
    return;
  }
  try {
    mongoClient = new MongoClient(url, { serverSelectionTimeoutMS: 10000 });
    await mongoClient.connect();
    mongoDb = mongoClient.db(dbName);
    // Verify connectivity
    await mongoDb.command({ ping: 1 });
    state.mongodb.connected = true;
    console.log("[mongodb] Connected to db:", dbName);
  } catch (err) {
    state.mongodb.error = err.message;
    console.error("[mongodb] Connection failed:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Valkey (Redis-compatible — uses ioredis)
// ---------------------------------------------------------------------------

async function initValkey() {
  const url = process.env.VALKEY_URL || process.env.CATALOG_VALKEY_URL;
  if (!url) {
    state.valkey.error = "VALKEY_URL not set";
    console.error("[valkey] VALKEY_URL env var not found");
    return;
  }
  try {
    valkeyClient = new Redis(url);
    await valkeyClient.ping();
    state.valkey.connected = true;
    console.log("[valkey] Connected");
  } catch (err) {
    state.valkey.error = err.message;
    console.error("[valkey] Connection failed:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Status / health
// ---------------------------------------------------------------------------

app.get("/", (_req, res) => {
  res.json({
    message: "Catalog Integration Backend",
    services: { mysql: state.mysql, mongodb: state.mongodb, valkey: state.valkey },
  });
});

app.get("/health", (_req, res) => {
  const allConnected =
    state.mysql.connected && state.mongodb.connected && state.valkey.connected;
  res.status(allConnected ? 200 : 503).json({
    status: allConnected ? "healthy" : "degraded",
    services: state,
  });
});

// ---------------------------------------------------------------------------
// MySQL endpoints
// ---------------------------------------------------------------------------

app.get("/mysql/items", async (_req, res) => {
  if (!mysqlPool)
    return res.status(503).json({ error: "MySQL not connected" });
  try {
    const [rows] = await mysqlPool.execute(
      "SELECT * FROM test_items ORDER BY created_at DESC",
    );
    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/mysql/items", async (req, res) => {
  if (!mysqlPool)
    return res.status(503).json({ error: "MySQL not connected" });
  const { name, value } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  try {
    const [result] = await mysqlPool.execute(
      "INSERT INTO test_items (name, value) VALUES (?, ?)",
      [name, value ?? null],
    );
    const [rows] = await mysqlPool.execute(
      "SELECT * FROM test_items WHERE id = ?",
      [result.insertId],
    );
    res.status(201).json({ item: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/mysql/items/:id", async (req, res) => {
  if (!mysqlPool)
    return res.status(503).json({ error: "MySQL not connected" });
  try {
    const [result] = await mysqlPool.execute(
      "DELETE FROM test_items WHERE id = ?",
      [req.params.id],
    );
    if (result.affectedRows === 0)
      return res.status(404).json({ error: "Item not found" });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// MongoDB endpoints
// ---------------------------------------------------------------------------

app.get("/mongodb/docs", async (_req, res) => {
  if (!mongoDb)
    return res.status(503).json({ error: "MongoDB not connected" });
  try {
    const docs = await mongoDb
      .collection("test_docs")
      .find({})
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();
    res.json({ docs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/mongodb/docs", async (req, res) => {
  if (!mongoDb)
    return res.status(503).json({ error: "MongoDB not connected" });
  const { name, data } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  try {
    const doc = { name, data: data ?? null, createdAt: new Date() };
    const result = await mongoDb.collection("test_docs").insertOne(doc);
    res.status(201).json({ doc: { _id: result.insertedId, ...doc } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/mongodb/docs/:id", async (req, res) => {
  if (!mongoDb)
    return res.status(503).json({ error: "MongoDB not connected" });
  try {
    const { ObjectId } = await import("mongodb");
    const result = await mongoDb
      .collection("test_docs")
      .deleteOne({ _id: new ObjectId(req.params.id) });
    if (result.deletedCount === 0)
      return res.status(404).json({ error: "Document not found" });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/mongodb/stats", async (_req, res) => {
  if (!mongoDb)
    return res.status(503).json({ error: "MongoDB not connected" });
  try {
    const count = await mongoDb.collection("test_docs").countDocuments();
    const dbStats = await mongoDb.command({ dbStats: 1 });
    res.json({
      docCount: count,
      collections: dbStats.collections,
      dataSize: dbStats.dataSize,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Valkey endpoints (Redis-compatible)
// ---------------------------------------------------------------------------

app.get("/valkey/get/:key", async (req, res) => {
  if (!valkeyClient)
    return res.status(503).json({ error: "Valkey not connected" });
  try {
    const value = await valkeyClient.get(req.params.key);
    if (value === null) return res.status(404).json({ error: "Key not found" });
    res.json({ key: req.params.key, value });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/valkey/set", async (req, res) => {
  if (!valkeyClient)
    return res.status(503).json({ error: "Valkey not connected" });
  const { key, value, ttl } = req.body;
  if (!key || value === undefined)
    return res.status(400).json({ error: "key and value required" });
  try {
    if (ttl) {
      await valkeyClient.set(key, value, "EX", Number(ttl));
    } else {
      await valkeyClient.set(key, value);
    }
    res.json({ key, value, ttl: ttl ?? null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/valkey/incr/:key", async (req, res) => {
  if (!valkeyClient)
    return res.status(503).json({ error: "Valkey not connected" });
  try {
    const value = await valkeyClient.incr(req.params.key);
    res.json({ key: req.params.key, value });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/valkey/info", async (_req, res) => {
  if (!valkeyClient)
    return res.status(503).json({ error: "Valkey not connected" });
  try {
    const info = await valkeyClient.info();
    const dbsize = await valkeyClient.dbsize();
    res.json({ dbsize, info: info.substring(0, 500) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Combined test endpoint
// ---------------------------------------------------------------------------

app.post("/test/all", async (_req, res) => {
  const results = { mysql: null, mongodb: null, valkey: null };

  if (mysqlPool) {
    try {
      const [result] = await mysqlPool.execute(
        "INSERT INTO test_items (name, value) VALUES (?, ?)",
        ["test-all", `combined-test-${Date.now()}`],
      );
      results.mysql = { ok: true, insertId: result.insertId };
    } catch (err) {
      results.mysql = { ok: false, error: err.message };
    }
  } else {
    results.mysql = { ok: false, error: "not connected" };
  }

  if (mongoDb) {
    try {
      const doc = { name: "test-all", data: `combined-test-${Date.now()}`, createdAt: new Date() };
      const r = await mongoDb.collection("test_docs").insertOne(doc);
      results.mongodb = { ok: true, insertedId: r.insertedId.toString() };
    } catch (err) {
      results.mongodb = { ok: false, error: err.message };
    }
  } else {
    results.mongodb = { ok: false, error: "not connected" };
  }

  if (valkeyClient) {
    try {
      const key = `test:all:${Date.now()}`;
      await valkeyClient.set(key, `value-${Date.now()}`);
      const value = await valkeyClient.get(key);
      results.valkey = { ok: true, key, value };
    } catch (err) {
      results.valkey = { ok: false, error: err.message };
    }
  } else {
    results.valkey = { ok: false, error: "not connected" };
  }

  res.json(results);
});

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const server = app.listen(PORT, () => {
  console.log(`[server] Listening on port ${PORT}`);
  initMySQL();
  initMongoDB();
  initValkey();
});

process.on("SIGTERM", () => {
  console.log("[server] SIGTERM received, shutting down");
  server.close();
  if (mysqlPool) mysqlPool.end();
  if (mongoClient) mongoClient.close();
  if (valkeyClient) valkeyClient.quit();
});

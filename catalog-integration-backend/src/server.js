import cors from "cors";
import express from "express";
import { QdrantClient } from "@qdrant/js-client-rest";
import nodemailer from "nodemailer";

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

const state = {
  qdrant: { connected: false, error: null },
  mailpit: { connected: false, error: null },
};

let qdrantClient = null;
let mailTransporter = null;
let mailpitHost = null;
let mailpitPort = null;
let mailpitWebUrl = null;

const QDRANT_COLLECTION = "test-collection";
const VECTOR_SIZE = 4; // small vector for testing

// ---------------------------------------------------------------------------
// Qdrant
// ---------------------------------------------------------------------------

async function initQdrant() {
  const url = process.env.QDRANT_URL || process.env.CATALOG_QDRANT_URL;
  const apiKey =
    process.env.QDRANT_API_KEY || process.env.CATALOG_QDRANT_API_KEY;
  if (!url) {
    state.qdrant.error = "QDRANT_URL not set";
    console.error("[qdrant] QDRANT_URL env var not found");
    return;
  }
  try {
    qdrantClient = new QdrantClient({ url, apiKey: apiKey ?? undefined });
    // Health check
    await qdrantClient.getCollections();
    // Ensure test collection exists
    const collections = await qdrantClient.getCollections();
    const exists = collections.collections.some(
      (c) => c.name === QDRANT_COLLECTION,
    );
    if (!exists) {
      await qdrantClient.createCollection(QDRANT_COLLECTION, {
        vectors: { size: VECTOR_SIZE, distance: "Cosine" },
      });
    }
    state.qdrant.connected = true;
    console.log("[qdrant] Connected, collection ready:", QDRANT_COLLECTION);
  } catch (err) {
    state.qdrant.error = err.message;
    console.error("[qdrant] Connection failed:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Mailpit (SMTP)
// ---------------------------------------------------------------------------

async function initMailpit() {
  mailpitHost =
    process.env.MAILPIT_SMTP_HOST || process.env.CATALOG_MAILPIT_SMTP_HOST;
  mailpitPort =
    process.env.MAILPIT_SMTP_PORT || process.env.CATALOG_MAILPIT_SMTP_PORT;
  mailpitWebUrl =
    process.env.MAILPIT_WEB_URL || process.env.CATALOG_MAILPIT_WEB_URL;

  if (!mailpitHost) {
    state.mailpit.error = "MAILPIT_SMTP_HOST not set";
    console.error("[mailpit] MAILPIT_SMTP_HOST env var not found");
    return;
  }
  try {
    mailTransporter = nodemailer.createTransport({
      host: mailpitHost,
      port: Number(mailpitPort ?? 1025),
      secure: false,
      ignoreTLS: true,
    });
    await mailTransporter.verify();
    state.mailpit.connected = true;
    console.log(
      "[mailpit] SMTP connected:",
      `${mailpitHost}:${mailpitPort ?? 1025}`,
    );
  } catch (err) {
    state.mailpit.error = err.message;
    console.error("[mailpit] Connection failed:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Status / health
// ---------------------------------------------------------------------------

app.get("/", (_req, res) => {
  res.json({
    message: "Catalog Integration Backend",
    services: {
      qdrant: state.qdrant,
      mailpit: state.mailpit,
    },
  });
});

app.get("/health", (_req, res) => {
  const allConnected = state.qdrant.connected && state.mailpit.connected;
  res.status(allConnected ? 200 : 503).json({
    status: allConnected ? "healthy" : "degraded",
    services: state,
  });
});

// ---------------------------------------------------------------------------
// Qdrant endpoints
// ---------------------------------------------------------------------------

app.get("/qdrant/points", async (_req, res) => {
  if (!qdrantClient)
    return res.status(503).json({ error: "Qdrant not connected" });
  try {
    const result = await qdrantClient.scroll(QDRANT_COLLECTION, {
      limit: 50,
      with_payload: true,
      with_vector: false,
    });
    res.json({ points: result.points, collection: QDRANT_COLLECTION });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/qdrant/points", async (req, res) => {
  if (!qdrantClient)
    return res.status(503).json({ error: "Qdrant not connected" });
  const { payload } = req.body;
  if (!payload) return res.status(400).json({ error: "payload is required" });
  try {
    const id = Date.now();
    // Generate a random vector of size VECTOR_SIZE
    const vector = Array.from(
      { length: VECTOR_SIZE },
      () => Math.random() * 2 - 1,
    );
    await qdrantClient.upsert(QDRANT_COLLECTION, {
      points: [{ id, vector, payload }],
    });
    res.status(201).json({ id, vector, payload, collection: QDRANT_COLLECTION });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/qdrant/search", async (req, res) => {
  if (!qdrantClient)
    return res.status(503).json({ error: "Qdrant not connected" });
  const { vector, limit } = req.body;
  if (!vector || !Array.isArray(vector))
    return res.status(400).json({ error: "vector array required" });
  try {
    const results = await qdrantClient.search(QDRANT_COLLECTION, {
      vector,
      limit: limit ?? 5,
      with_payload: true,
    });
    res.json({ results, collection: QDRANT_COLLECTION });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/qdrant/info", async (_req, res) => {
  if (!qdrantClient)
    return res.status(503).json({ error: "Qdrant not connected" });
  try {
    const info = await qdrantClient.getCollection(QDRANT_COLLECTION);
    res.json({ collection: QDRANT_COLLECTION, info });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Mailpit endpoints
// ---------------------------------------------------------------------------

app.post("/mailpit/send", async (req, res) => {
  if (!mailTransporter)
    return res.status(503).json({ error: "Mailpit not connected" });
  const { to, subject, text, html } = req.body;
  if (!to || !subject)
    return res.status(400).json({ error: "to and subject are required" });
  try {
    const info = await mailTransporter.sendMail({
      from: "test@guaracloud.com",
      to,
      subject,
      text: text ?? subject,
      html: html ?? undefined,
    });
    res.json({
      messageId: info.messageId,
      to,
      subject,
      webUrl: mailpitWebUrl,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/mailpit/messages", async (_req, res) => {
  if (!mailpitWebUrl)
    return res.status(503).json({ error: "Mailpit not connected" });
  try {
    const apiUrl = `${mailpitWebUrl}/api/v1/messages`;
    const resp = await fetch(apiUrl);
    const data = await resp.json();
    res.json({
      total: data.total ?? 0,
      messages: (data.messages ?? []).slice(0, 10).map((m) => ({
        id: m.ID,
        subject: m.Snippet,
        from: m.From,
        to: m.To,
        created: m.Created,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/mailpit/info", async (_req, res) => {
  if (!mailpitWebUrl)
    return res.status(503).json({ error: "Mailpit not connected" });
  try {
    const resp = await fetch(`${mailpitWebUrl}/api/v1/info`);
    const data = await resp.json();
    res.json({ info: data, webUrl: mailpitWebUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Combined test endpoint
// ---------------------------------------------------------------------------

app.post("/test/all", async (_req, res) => {
  const results = { qdrant: null, mailpit: null };

  if (qdrantClient) {
    try {
      const id = Date.now();
      const vector = Array.from(
        { length: VECTOR_SIZE },
        () => Math.random() * 2 - 1,
      );
      await qdrantClient.upsert(QDRANT_COLLECTION, {
        points: [{ id, vector, payload: { source: "test-all", ts: id } }],
      });
      results.qdrant = { ok: true, insertedId: id };
    } catch (err) {
      results.qdrant = { ok: false, error: err.message };
    }
  } else {
    results.qdrant = { ok: false, error: "not connected" };
  }

  if (mailTransporter) {
    try {
      const info = await mailTransporter.sendMail({
        from: "test@guaracloud.com",
        to: "recipient@test.local",
        subject: `Combined test ${Date.now()}`,
        text: "Catalog integration test-all email",
      });
      results.mailpit = { ok: true, messageId: info.messageId };
    } catch (err) {
      results.mailpit = { ok: false, error: err.message };
    }
  } else {
    results.mailpit = { ok: false, error: "not connected" };
  }

  res.json(results);
});

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const server = app.listen(PORT, () => {
  console.log(`[server] Listening on port ${PORT}`);
  initQdrant();
  initMailpit();
});

process.on("SIGTERM", () => {
  console.log("[server] SIGTERM received, shutting down");
  server.close();
});

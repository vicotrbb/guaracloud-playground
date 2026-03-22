const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const port = process.env.PORT || 8080;

const dbPath = process.env.DB_PATH || path.join(__dirname, "contacts.db");
console.log(`Starting Express CRUD Test`);
console.log(`Database path: ${dbPath}`);

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);
console.log("Database initialized");

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/contacts", (req, res) => {
  const contacts = db.prepare("SELECT * FROM contacts ORDER BY id DESC").all();
  console.log(`GET /api/contacts - Returning ${contacts.length} contacts`);
  res.json(contacts);
});

app.post("/api/contacts", (req, res) => {
  const { name, phone } = req.body;
  if (!name || !phone) {
    console.log("POST /api/contacts - Bad request: missing name or phone");
    return res.status(400).json({ error: "name and phone are required" });
  }
  const stmt = db.prepare("INSERT INTO contacts (name, phone) VALUES (?, ?)");
  const result = stmt.run(name, phone);
  const contact = db
    .prepare("SELECT * FROM contacts WHERE id = ?")
    .get(result.lastInsertRowid);
  console.log(
    `POST /api/contacts - Created contact ${contact.id}: ${name} (${phone})`
  );
  res.status(201).json(contact);
});

app.delete("/api/contacts/:id", (req, res) => {
  const { id } = req.params;
  const result = db.prepare("DELETE FROM contacts WHERE id = ?").run(id);
  if (result.changes === 0) {
    console.log(`DELETE /api/contacts/${id} - Not found`);
    return res.status(404).json({ error: "not found" });
  }
  console.log(`DELETE /api/contacts/${id} - Deleted`);
  res.json({ status: "deleted" });
});

app.get("/health", (req, res) => {
  console.log("GET /health - Health check");
  res.json({ status: "ok" });
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

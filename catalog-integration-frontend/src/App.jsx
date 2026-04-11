import React, { useState, useEffect, useCallback } from "react";

const API = import.meta.env.VITE_BACKEND_URL
  ? `${import.meta.env.VITE_BACKEND_URL.replace(/\/$/, "")}`
  : "/api";

function StatusBadge({ connected, error }) {
  if (error) return <span className="status-badge disconnected">{error}</span>;
  if (connected)
    return <span className="status-badge connected">Connected</span>;
  return <span className="status-badge disconnected">Disconnected</span>;
}

export default function App() {
  const [status, setStatus] = useState(null);

  // MySQL
  const [mysqlPayload, setMysqlPayload] = useState("");
  const [mysqlRows, setMysqlRows] = useState([]);
  const [mysqlInfo, setMysqlInfo] = useState(null);

  // Qdrant
  const [qdrantPayload, setQdrantPayload] = useState("");
  const [qdrantPoints, setQdrantPoints] = useState([]);
  const [qdrantInfo, setQdrantInfo] = useState(null);
  const [qdrantSearch, setQdrantSearch] = useState(null);

  // Mailpit
  const [mailTo, setMailTo] = useState("user@test.local");
  const [mailSubject, setMailSubject] = useState("");
  const [mailText, setMailText] = useState("");
  const [mailResult, setMailResult] = useState(null);
  const [mailMessages, setMailMessages] = useState([]);
  const [mailInfo, setMailInfo] = useState(null);

  const [logs, setLogs] = useState([]);

  const addLog = useCallback((msg) => {
    setLogs((prev) => [
      ...prev.slice(-50),
      { time: new Date().toLocaleTimeString(), msg },
    ]);
  }, []);

  const api = useCallback(
    async (path, opts = {}) => {
      try {
        const res = await fetch(`${API}${path}`, {
          headers: { "Content-Type": "application/json" },
          ...opts,
        });
        const data = await res.json();
        return data;
      } catch (err) {
        addLog(`ERROR: ${err.message}`);
        return null;
      }
    },
    [addLog],
  );

  const fetchStatus = useCallback(async () => {
    const data = await api("/");
    if (data) {
      setStatus(data);
      addLog("Status refreshed");
    }
  }, [api, addLog]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const testAll = async () => {
    const data = await api("/test/all", { method: "POST" });
    if (data) {
      addLog(
        `Test all: MySQL=${data.mysql?.ok} Qdrant=${data.qdrant?.ok} Mailpit=${data.mailpit?.ok}`,
      );
    }
  };

  // --- MySQL ---
  const insertMysql = async () => {
    if (!mysqlPayload.trim()) return;
    const data = await api("/mysql/insert", {
      method: "POST",
      body: JSON.stringify({ payload: mysqlPayload }),
    });
    if (data) {
      addLog(`MySQL inserted id=${data.id}`);
      setMysqlPayload("");
      fetchMysqlRows();
    }
  };

  const fetchMysqlRows = async () => {
    const data = await api("/mysql/rows");
    if (data?.rows) {
      setMysqlRows(data.rows);
      addLog(`MySQL: ${data.rows.length} rows`);
    }
  };

  const fetchMysqlInfo = async () => {
    const data = await api("/mysql/info");
    if (data) {
      setMysqlInfo(data);
      addLog(`MySQL version: ${data.version}, rows: ${data.rowCount}`);
    }
  };

  // --- Qdrant ---
  const insertQdrant = async () => {
    if (!qdrantPayload.trim()) return;
    let payload;
    try {
      payload = JSON.parse(qdrantPayload);
    } catch {
      payload = { text: qdrantPayload };
    }
    const data = await api("/qdrant/points", {
      method: "POST",
      body: JSON.stringify({ payload }),
    });
    if (data) {
      addLog(`Qdrant inserted point id=${data.id}`);
      setQdrantPayload("");
      fetchQdrantPoints();
    }
  };

  const fetchQdrantPoints = async () => {
    const data = await api("/qdrant/points");
    if (data?.points) {
      setQdrantPoints(data.points);
      addLog(`Qdrant: ${data.points.length} points`);
    }
  };

  const fetchQdrantInfo = async () => {
    const data = await api("/qdrant/info");
    if (data) {
      setQdrantInfo(data);
      addLog(`Qdrant info: ${data.info?.points_count ?? "?"} points total`);
    }
  };

  const searchQdrant = async () => {
    const vector = Array.from({ length: 4 }, () => Math.random() * 2 - 1);
    const data = await api("/qdrant/search", {
      method: "POST",
      body: JSON.stringify({ vector, limit: 5 }),
    });
    if (data) {
      setQdrantSearch(data);
      addLog(`Qdrant search: ${data.results.length} results`);
    }
  };

  // --- Mailpit ---
  const sendMail = async () => {
    if (!mailTo.trim() || !mailSubject.trim()) return;
    const data = await api("/mailpit/send", {
      method: "POST",
      body: JSON.stringify({
        to: mailTo,
        subject: mailSubject,
        text: mailText || mailSubject,
      }),
    });
    if (data) {
      addLog(`Mailpit sent: "${mailSubject}" → ${mailTo}`);
      setMailSubject("");
      setMailText("");
      setMailResult(data);
      fetchMailMessages();
    }
  };

  const fetchMailMessages = async () => {
    const data = await api("/mailpit/messages");
    if (data?.messages) {
      setMailMessages(data.messages);
      addLog(`Mailpit: ${data.total} messages`);
    }
  };

  const fetchMailInfo = async () => {
    const data = await api("/mailpit/info");
    if (data) {
      setMailInfo(data);
      addLog("Mailpit info fetched");
    }
  };

  if (!status) {
    return (
      <div style={{ textAlign: "center", padding: "4rem" }}>Loading...</div>
    );
  }

  return (
    <div className="container">
      <h1>Catalog Integration Test</h1>
      <p className="subtitle">
        Testing MySQL, Qdrant, and Mailpit catalog services on Guara Cloud
      </p>

      <div className="status-grid">
        <div className="status-card">
          <h3>MySQL</h3>
          <StatusBadge
            connected={status.services?.mysql?.connected}
            error={status.services?.mysql?.error}
          />
        </div>
        <div className="status-card">
          <h3>Qdrant</h3>
          <StatusBadge
            connected={status.services?.qdrant?.connected}
            error={status.services?.qdrant?.error}
          />
        </div>
        <div className="status-card">
          <h3>Mailpit</h3>
          <StatusBadge
            connected={status.services?.mailpit?.connected}
            error={status.services?.mailpit?.error}
          />
        </div>
        <div className="status-card">
          <h3>Backend</h3>
          <StatusBadge connected={true} error={null} />
        </div>
      </div>

      <div className="section">
        <h2>Quick Test</h2>
        <button className="btn btn-primary" onClick={testAll}>
          Test All Services
        </button>
        <button className="btn btn-primary" onClick={fetchStatus}>
          Refresh Status
        </button>
      </div>

      {/* MySQL */}
      <div className="section">
        <h2>MySQL - Relational Database</h2>
        <div className="row">
          <input
            placeholder="Row payload text"
            value={mysqlPayload}
            onChange={(e) => setMysqlPayload(e.target.value)}
            style={{ width: "250px" }}
          />
          <button className="btn btn-success" onClick={insertMysql}>
            Insert Row
          </button>
          <button className="btn btn-primary" onClick={fetchMysqlRows}>
            List Rows
          </button>
          <button className="btn btn-primary" onClick={fetchMysqlInfo}>
            Server Info
          </button>
        </div>
        {mysqlInfo && (
          <pre>{JSON.stringify(mysqlInfo, null, 2)}</pre>
        )}
        {mysqlRows.length > 0 && (
          <pre>{JSON.stringify(mysqlRows.slice(0, 10), null, 2)}</pre>
        )}
      </div>

      {/* Qdrant */}
      <div className="section">
        <h2>Qdrant - Vector Database</h2>
        <div className="row">
          <input
            placeholder='Payload (JSON or text, e.g. {"name":"test"})'
            value={qdrantPayload}
            onChange={(e) => setQdrantPayload(e.target.value)}
            style={{ width: "250px" }}
          />
          <button className="btn btn-success" onClick={insertQdrant}>
            Insert
          </button>
          <button className="btn btn-primary" onClick={fetchQdrantPoints}>
            List Points
          </button>
          <button className="btn btn-primary" onClick={searchQdrant}>
            Random Search
          </button>
          <button className="btn btn-primary" onClick={fetchQdrantInfo}>
            Collection Info
          </button>
        </div>
        {qdrantInfo && (
          <pre>{JSON.stringify(qdrantInfo.info, null, 2)}</pre>
        )}
        {qdrantSearch && (
          <pre>{JSON.stringify(qdrantSearch.results, null, 2)}</pre>
        )}
        {qdrantPoints.length > 0 && (
          <pre>{JSON.stringify(qdrantPoints.slice(0, 5), null, 2)}</pre>
        )}
      </div>

      {/* Mailpit */}
      <div className="section">
        <h2>Mailpit - Email Testing</h2>
        <div className="row">
          <input
            placeholder="To"
            value={mailTo}
            onChange={(e) => setMailTo(e.target.value)}
          />
          <input
            placeholder="Subject"
            value={mailSubject}
            onChange={(e) => setMailSubject(e.target.value)}
          />
          <input
            placeholder="Body (optional)"
            value={mailText}
            onChange={(e) => setMailText(e.target.value)}
          />
          <button className="btn btn-success" onClick={sendMail}>
            Send
          </button>
          <button className="btn btn-primary" onClick={fetchMailMessages}>
            List Messages
          </button>
          <button className="btn btn-primary" onClick={fetchMailInfo}>
            Info
          </button>
        </div>
        {mailInfo && <pre>{JSON.stringify(mailInfo, null, 2)}</pre>}
        {mailResult && <pre>{JSON.stringify(mailResult, null, 2)}</pre>}
        {mailMessages.length > 0 && (
          <pre>{JSON.stringify(mailMessages, null, 2)}</pre>
        )}
      </div>

      <div className="section">
        <h2>Activity Log</h2>
        <pre style={{ maxHeight: "200px" }}>
          {logs.map((l, i) => (
            <div key={i}>
              {l.time} {l.msg}
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}

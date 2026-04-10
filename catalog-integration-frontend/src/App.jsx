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

  // RabbitMQ
  const [rmqMessage, setRmqMessage] = useState("");
  const [rmqInfo, setRmqInfo] = useState(null);
  const [rmqConsumed, setRmqConsumed] = useState(null);

  // Meilisearch
  const [meiliTitle, setMeiliTitle] = useState("");
  const [meiliContent, setMeiliContent] = useState("");
  const [meiliDocs, setMeiliDocs] = useState([]);
  const [meiliQuery, setMeiliQuery] = useState("");
  const [meiliHits, setMeiliHits] = useState(null);
  const [meiliStats, setMeiliStats] = useState(null);

  // Memcached
  const [mcKey, setMcKey] = useState("");
  const [mcValue, setMcValue] = useState("");
  const [mcResult, setMcResult] = useState(null);
  const [mcStats, setMcStats] = useState(null);

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
        `Test all: RabbitMQ=${data.rabbitmq?.ok} Meilisearch=${data.meilisearch?.ok} Memcached=${data.memcached?.ok}`,
      );
    }
  };

  // --- RabbitMQ ---
  const publishRmq = async () => {
    if (!rmqMessage.trim()) return;
    const data = await api("/rabbitmq/publish", {
      method: "POST",
      body: JSON.stringify({ message: rmqMessage }),
    });
    if (data) {
      addLog(`RabbitMQ published: ${rmqMessage} (queue: ${data.messageCount} msgs)`);
      setRmqMessage("");
      fetchRmqInfo();
    }
  };

  const consumeRmq = async () => {
    const data = await api("/rabbitmq/consume");
    if (data) {
      addLog(`RabbitMQ consumed: ${JSON.stringify(data.message)} (remaining: ${data.remaining})`);
      setRmqConsumed(data);
      fetchRmqInfo();
    }
  };

  const fetchRmqInfo = async () => {
    const data = await api("/rabbitmq/info");
    if (data) {
      setRmqInfo(data);
      addLog(`RabbitMQ info: ${data.messageCount} messages in queue`);
    }
  };

  // --- Meilisearch ---
  const addMeiliDoc = async () => {
    if (!meiliTitle.trim()) return;
    const data = await api("/meilisearch/docs", {
      method: "POST",
      body: JSON.stringify({ title: meiliTitle, content: meiliContent || null }),
    });
    if (data) {
      addLog(`Meilisearch indexed: "${meiliTitle}" (task ${data.taskUid})`);
      setMeiliTitle("");
      setMeiliContent("");
      fetchMeiliDocs();
    }
  };

  const fetchMeiliDocs = async () => {
    const data = await api("/meilisearch/docs");
    if (data?.docs) {
      setMeiliDocs(data.docs);
      addLog(`Meilisearch: loaded ${data.docs.length} docs`);
    }
  };

  const searchMeili = async () => {
    if (!meiliQuery.trim()) return;
    const data = await api(`/meilisearch/search?q=${encodeURIComponent(meiliQuery)}`);
    if (data) {
      setMeiliHits(data);
      addLog(`Meilisearch search "${meiliQuery}": ${data.hits.length} hits (${data.processingTimeMs}ms)`);
    }
  };

  const fetchMeiliStats = async () => {
    const data = await api("/meilisearch/stats");
    if (data) {
      setMeiliStats(data);
      addLog(`Meilisearch stats: ${data.numberOfDocuments} documents`);
    }
  };

  // --- Memcached ---
  const setMemcached = async () => {
    if (!mcKey.trim() || !mcValue.trim()) return;
    const data = await api("/memcached/set", {
      method: "POST",
      body: JSON.stringify({ key: mcKey, value: mcValue }),
    });
    if (data) {
      addLog(`Memcached SET ${mcKey} = ${mcValue}`);
      setMcResult(data);
    }
  };

  const getMemcached = async () => {
    if (!mcKey.trim()) return;
    const data = await api(`/memcached/get/${encodeURIComponent(mcKey)}`);
    if (data) {
      addLog(`Memcached GET ${mcKey} = ${data.value ?? "nil"}`);
      setMcResult(data);
    }
  };

  const deleteMemcached = async () => {
    if (!mcKey.trim()) return;
    const data = await api(`/memcached/delete/${encodeURIComponent(mcKey)}`, { method: "DELETE" });
    if (data) {
      addLog(`Memcached DEL ${mcKey}`);
      setMcResult(data);
    }
  };

  const fetchMemcachedStats = async () => {
    const data = await api("/memcached/stats");
    if (data) {
      setMcStats(data);
      addLog("Memcached stats fetched");
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
        Testing RabbitMQ, Meilisearch, and Memcached catalog services on Guara Cloud
      </p>

      <div className="status-grid">
        <div className="status-card">
          <h3>RabbitMQ</h3>
          <StatusBadge
            connected={status.services?.rabbitmq?.connected}
            error={status.services?.rabbitmq?.error}
          />
        </div>
        <div className="status-card">
          <h3>Meilisearch</h3>
          <StatusBadge
            connected={status.services?.meilisearch?.connected}
            error={status.services?.meilisearch?.error}
          />
        </div>
        <div className="status-card">
          <h3>Memcached</h3>
          <StatusBadge
            connected={status.services?.memcached?.connected}
            error={status.services?.memcached?.error}
          />
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

      {/* RabbitMQ */}
      <div className="section">
        <h2>RabbitMQ - Queue</h2>
        <div className="row">
          <input
            placeholder="Message"
            value={rmqMessage}
            onChange={(e) => setRmqMessage(e.target.value)}
          />
          <button className="btn btn-success" onClick={publishRmq}>
            Publish
          </button>
          <button className="btn btn-primary" onClick={consumeRmq}>
            Consume 1
          </button>
          <button className="btn btn-primary" onClick={fetchRmqInfo}>
            Queue Info
          </button>
        </div>
        {rmqInfo && <pre>{JSON.stringify(rmqInfo, null, 2)}</pre>}
        {rmqConsumed && (
          <pre>{JSON.stringify(rmqConsumed, null, 2)}</pre>
        )}
      </div>

      {/* Meilisearch */}
      <div className="section">
        <h2>Meilisearch - Full-text Search</h2>
        <div className="row">
          <input
            placeholder="Title"
            value={meiliTitle}
            onChange={(e) => setMeiliTitle(e.target.value)}
          />
          <input
            placeholder="Content (optional)"
            value={meiliContent}
            onChange={(e) => setMeiliContent(e.target.value)}
          />
          <button className="btn btn-success" onClick={addMeiliDoc}>
            Index Doc
          </button>
          <button className="btn btn-primary" onClick={fetchMeiliDocs}>
            List Docs
          </button>
          <button className="btn btn-primary" onClick={fetchMeiliStats}>
            Stats
          </button>
        </div>
        <div className="row" style={{ marginTop: "0.5rem" }}>
          <input
            placeholder="Search query"
            value={meiliQuery}
            onChange={(e) => setMeiliQuery(e.target.value)}
          />
          <button className="btn btn-primary" onClick={searchMeili}>
            Search
          </button>
        </div>
        {meiliStats && <pre>{JSON.stringify(meiliStats, null, 2)}</pre>}
        {meiliHits && <pre>{JSON.stringify(meiliHits, null, 2)}</pre>}
        {meiliDocs.length > 0 && (
          <pre>{JSON.stringify(meiliDocs, null, 2)}</pre>
        )}
      </div>

      {/* Memcached */}
      <div className="section">
        <h2>Memcached - Cache</h2>
        <div className="row">
          <input
            placeholder="Key"
            value={mcKey}
            onChange={(e) => setMcKey(e.target.value)}
          />
          <input
            placeholder="Value"
            value={mcValue}
            onChange={(e) => setMcValue(e.target.value)}
          />
          <button className="btn btn-success" onClick={setMemcached}>
            SET
          </button>
          <button className="btn btn-primary" onClick={getMemcached}>
            GET
          </button>
          <button className="btn btn-danger" onClick={deleteMemcached}>
            DEL
          </button>
          <button className="btn btn-primary" onClick={fetchMemcachedStats}>
            Stats
          </button>
        </div>
        {mcResult && <pre>{JSON.stringify(mcResult, null, 2)}</pre>}
        {mcStats && <pre>{JSON.stringify(mcStats, null, 2)}</pre>}
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

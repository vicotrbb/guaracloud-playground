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

  // MinIO
  const [minioName, setMinioName] = useState("");
  const [minioContent, setMinioContent] = useState("");
  const [minioObjects, setMinioObjects] = useState([]);
  const [minioDownloaded, setMinioDownloaded] = useState(null);
  const [minioStats, setMinioStats] = useState(null);

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
        `Test all: RabbitMQ=${data.rabbitmq?.ok} Meilisearch=${data.meilisearch?.ok} MinIO=${data.minio?.ok}`,
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

  // --- MinIO ---
  const uploadMinio = async () => {
    if (!minioName.trim()) return;
    const data = await api("/minio/upload", {
      method: "POST",
      body: JSON.stringify({ name: minioName, content: minioContent || null }),
    });
    if (data) {
      addLog(`MinIO uploaded: ${data.name} (${data.size} bytes)`);
      setMinioName("");
      setMinioContent("");
      fetchMinioObjects();
    }
  };

  const fetchMinioObjects = async () => {
    const data = await api("/minio/objects");
    if (data?.objects) {
      setMinioObjects(data.objects);
      addLog(`MinIO: ${data.objects.length} objects in bucket`);
    }
  };

  const downloadMinio = async (name) => {
    const data = await api(`/minio/download/${encodeURIComponent(name)}`);
    if (data) {
      setMinioDownloaded(data);
      addLog(`MinIO downloaded: ${name}`);
    }
  };

  const deleteMinio = async (name) => {
    await api(`/minio/objects/${encodeURIComponent(name)}`, { method: "DELETE" });
    addLog(`MinIO deleted: ${name}`);
    fetchMinioObjects();
    setMinioDownloaded(null);
  };

  const fetchMinioStats = async () => {
    const data = await api("/minio/stats");
    if (data) {
      setMinioStats(data);
      addLog(`MinIO stats: ${data.objectCount} objects, ${data.totalSize} bytes`);
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
        Testing RabbitMQ, Meilisearch, and MinIO catalog services on Guara Cloud
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
          <h3>MinIO</h3>
          <StatusBadge
            connected={status.services?.minio?.connected}
            error={status.services?.minio?.error}
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

      {/* MinIO */}
      <div className="section">
        <h2>MinIO - Object Storage</h2>
        <div className="row">
          <input
            placeholder="Object name"
            value={minioName}
            onChange={(e) => setMinioName(e.target.value)}
          />
          <input
            placeholder="Content (optional)"
            value={minioContent}
            onChange={(e) => setMinioContent(e.target.value)}
          />
          <button className="btn btn-success" onClick={uploadMinio}>
            Upload
          </button>
          <button className="btn btn-primary" onClick={fetchMinioObjects}>
            List Objects
          </button>
          <button className="btn btn-primary" onClick={fetchMinioStats}>
            Stats
          </button>
        </div>
        {minioStats && <pre>{JSON.stringify(minioStats, null, 2)}</pre>}
        {minioDownloaded && (
          <pre>{JSON.stringify(minioDownloaded, null, 2)}</pre>
        )}
        {minioObjects.length > 0 && (
          <div style={{ marginTop: "0.5rem" }}>
            {minioObjects.map((obj) => (
              <span key={obj.name} style={{ marginRight: "0.5rem", marginBottom: "0.5rem", display: "inline-block" }}>
                <button
                  className="btn btn-primary"
                  onClick={() => downloadMinio(obj.name)}
                  style={{ fontSize: "0.7rem" }}
                >
                  Get {obj.name}
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => deleteMinio(obj.name)}
                  style={{ fontSize: "0.7rem" }}
                >
                  Del
                </button>
              </span>
            ))}
          </div>
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

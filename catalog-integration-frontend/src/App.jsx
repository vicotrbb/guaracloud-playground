// catalog-test-3: postgres, redis, nats (build var set)
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

  // Postgres
  const [pgPayload, setPgPayload] = useState("");
  const [pgRows, setPgRows] = useState([]);
  const [pgInfo, setPgInfo] = useState(null);

  // Redis
  const [redisKey, setRedisKey] = useState("catalog:hello");
  const [redisValue, setRedisValue] = useState("");
  const [redisTtl, setRedisTtl] = useState("60");
  const [redisGetKey, setRedisGetKey] = useState("catalog:hello");
  const [redisGetResult, setRedisGetResult] = useState(null);
  const [redisKeys, setRedisKeys] = useState([]);
  const [redisInfo, setRedisInfo] = useState(null);

  // NATS
  const [natsSubject, setNatsSubject] = useState("catalog.test");
  const [natsMessage, setNatsMessage] = useState("");
  const [natsPublishResult, setNatsPublishResult] = useState(null);
  const [natsInfo, setNatsInfo] = useState(null);

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
        `Test all: Postgres=${data.postgres?.ok} Redis=${data.redis?.ok} NATS=${data.nats?.ok}`,
      );
    }
  };

  // --- Postgres ---
  const insertPg = async () => {
    if (!pgPayload.trim()) return;
    const data = await api("/postgres/insert", {
      method: "POST",
      body: JSON.stringify({ payload: pgPayload }),
    });
    if (data?.id) {
      addLog(`Postgres inserted id=${data.id}`);
      setPgPayload("");
      fetchPgRows();
    }
  };

  const fetchPgRows = async () => {
    const data = await api("/postgres/rows");
    if (data?.rows) {
      setPgRows(data.rows);
      addLog(`Postgres: ${data.rows.length} rows`);
    }
  };

  const fetchPgInfo = async () => {
    const data = await api("/postgres/info");
    if (data) {
      setPgInfo(data);
      addLog(`Postgres version: ${data.version?.split(" ")[1]}, rows: ${data.rowCount}`);
    }
  };

  // --- Redis ---
  const redisSet = async () => {
    if (!redisKey.trim() || !redisValue.trim()) return;
    const data = await api("/redis/set", {
      method: "POST",
      body: JSON.stringify({ key: redisKey, value: redisValue, ttl: Number(redisTtl) || undefined }),
    });
    if (data?.key) {
      addLog(`Redis SET ${data.key} (ttl=${data.ttl}s)`);
      setRedisValue("");
    }
  };

  const redisGet = async () => {
    if (!redisGetKey.trim()) return;
    const data = await api(`/redis/get/${encodeURIComponent(redisGetKey)}`);
    if (data) {
      setRedisGetResult(data);
      addLog(`Redis GET ${redisGetKey}: ${data.value ?? data.error}`);
    }
  };

  const fetchRedisKeys = async () => {
    const data = await api("/redis/keys");
    if (data?.keys) {
      setRedisKeys(data.keys);
      addLog(`Redis: ${data.keys.length} catalog:* keys`);
    }
  };

  const fetchRedisInfo = async () => {
    const data = await api("/redis/info");
    if (data) {
      setRedisInfo(data);
      addLog(`Redis version: ${data.redis_version}`);
    }
  };

  // --- NATS ---
  const natsPublish = async () => {
    if (!natsSubject.trim() || !natsMessage.trim()) return;
    const data = await api("/nats/publish", {
      method: "POST",
      body: JSON.stringify({ subject: natsSubject, message: natsMessage }),
    });
    if (data) {
      setNatsPublishResult(data);
      addLog(`NATS published to ${data.subject}`);
      setNatsMessage("");
    }
  };

  const fetchNatsInfo = async () => {
    const data = await api("/nats/info");
    if (data) {
      setNatsInfo(data);
      addLog(`NATS server: ${data.server_name} v${data.version}`);
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
        Testing Postgres, Redis, and NATS catalog services on Guara Cloud
      </p>

      <div className="status-grid">
        <div className="status-card">
          <h3>Postgres</h3>
          <StatusBadge
            connected={status.services?.postgres?.connected}
            error={status.services?.postgres?.error}
          />
        </div>
        <div className="status-card">
          <h3>Redis</h3>
          <StatusBadge
            connected={status.services?.redis?.connected}
            error={status.services?.redis?.error}
          />
        </div>
        <div className="status-card">
          <h3>NATS</h3>
          <StatusBadge
            connected={status.services?.nats?.connected}
            error={status.services?.nats?.error}
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

      {/* Postgres */}
      <div className="section">
        <h2>Postgres - Relational Database</h2>
        <div className="row">
          <input
            placeholder="Row payload text"
            value={pgPayload}
            onChange={(e) => setPgPayload(e.target.value)}
            style={{ width: "250px" }}
          />
          <button className="btn btn-success" onClick={insertPg}>
            Insert Row
          </button>
          <button className="btn btn-primary" onClick={fetchPgRows}>
            List Rows
          </button>
          <button className="btn btn-primary" onClick={fetchPgInfo}>
            Server Info
          </button>
        </div>
        {pgInfo && <pre>{JSON.stringify(pgInfo, null, 2)}</pre>}
        {pgRows.length > 0 && (
          <pre>{JSON.stringify(pgRows.slice(0, 10), null, 2)}</pre>
        )}
      </div>

      {/* Redis */}
      <div className="section">
        <h2>Redis - Key-Value Cache</h2>
        <div className="row">
          <input
            placeholder="Key (e.g. catalog:hello)"
            value={redisKey}
            onChange={(e) => setRedisKey(e.target.value)}
            style={{ width: "160px" }}
          />
          <input
            placeholder="Value"
            value={redisValue}
            onChange={(e) => setRedisValue(e.target.value)}
            style={{ width: "160px" }}
          />
          <input
            placeholder="TTL (s)"
            value={redisTtl}
            onChange={(e) => setRedisTtl(e.target.value)}
            style={{ width: "70px" }}
          />
          <button className="btn btn-success" onClick={redisSet}>
            SET
          </button>
        </div>
        <div className="row">
          <input
            placeholder="Key to GET"
            value={redisGetKey}
            onChange={(e) => setRedisGetKey(e.target.value)}
            style={{ width: "160px" }}
          />
          <button className="btn btn-primary" onClick={redisGet}>
            GET
          </button>
          <button className="btn btn-primary" onClick={fetchRedisKeys}>
            List catalog:* Keys
          </button>
          <button className="btn btn-primary" onClick={fetchRedisInfo}>
            Server Info
          </button>
        </div>
        {redisInfo && <pre>{JSON.stringify(redisInfo, null, 2)}</pre>}
        {redisGetResult && <pre>{JSON.stringify(redisGetResult, null, 2)}</pre>}
        {redisKeys.length > 0 && <pre>{JSON.stringify(redisKeys, null, 2)}</pre>}
      </div>

      {/* NATS */}
      <div className="section">
        <h2>NATS - Messaging</h2>
        <div className="row">
          <input
            placeholder="Subject"
            value={natsSubject}
            onChange={(e) => setNatsSubject(e.target.value)}
            style={{ width: "160px" }}
          />
          <input
            placeholder="Message"
            value={natsMessage}
            onChange={(e) => setNatsMessage(e.target.value)}
            style={{ width: "200px" }}
          />
          <button className="btn btn-success" onClick={natsPublish}>
            Publish
          </button>
          <button className="btn btn-primary" onClick={fetchNatsInfo}>
            Server Info
          </button>
        </div>
        {natsInfo && <pre>{JSON.stringify(natsInfo, null, 2)}</pre>}
        {natsPublishResult && (
          <pre>{JSON.stringify(natsPublishResult, null, 2)}</pre>
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

import React, { useState, useEffect, useCallback } from "react";

const API = "/api";

function StatusBadge({ connected, error }) {
  if (error) return <span className="status-badge disconnected">{error}</span>;
  if (connected)
    return <span className="status-badge connected">Connected</span>;
  return <span className="status-badge disconnected">Disconnected</span>;
}

export default function App() {
  const [status, setStatus] = useState(null);
  const [pgItems, setPgItems] = useState([]);
  const [itemName, setItemName] = useState("");
  const [itemValue, setItemValue] = useState("");
  const [redisKey, setRedisKey] = useState("");
  const [redisValue, setRedisValue] = useState("");
  const [redisResult, setRedisResult] = useState(null);
  const [natsSubject, setNatsSubject] = useState("catalog-test.frontend");
  const [natsMessage, setNatsMessage] = useState("");
  const [natsMessages, setNatsMessages] = useState([]);
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

  const fetchPgItems = useCallback(async () => {
    const data = await api("/postgres/items");
    if (data?.items) {
      setPgItems(data.items);
      addLog(`Loaded ${data.items.length} PostgreSQL items`);
    }
  }, [api, addLog]);

  const fetchNatsMessages = useCallback(async () => {
    const data = await api("/nats/messages");
    if (data?.messages) {
      setNatsMessages(data.messages);
      addLog(`Received ${data.messages.length} NATS messages`);
    }
  }, [api, addLog]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  useEffect(() => {
    if (status?.services?.postgres?.connected) fetchPgItems();
  }, [status?.services?.postgres?.connected, fetchPgItems]);

  const createPgItem = async () => {
    if (!itemName.trim()) return;
    const data = await api("/postgres/items", {
      method: "POST",
      body: JSON.stringify({ name: itemName, value: itemValue || null }),
    });
    if (data?.item) {
      addLog(`Created PostgreSQL item: ${data.item.name}`);
      setItemName("");
      setItemValue("");
      fetchPgItems();
    }
  };

  const deletePgItem = async (id) => {
    await api(`/postgres/items/${id}`, { method: "DELETE" });
    addLog(`Deleted PostgreSQL item ${id}`);
    fetchPgItems();
  };

  const setRedis = async () => {
    if (!redisKey.trim() || !redisValue.trim()) return;
    const data = await api("/redis/set", {
      method: "POST",
      body: JSON.stringify({ key: redisKey, value: redisValue }),
    });
    if (data) {
      addLog(`Redis SET ${redisKey} = ${redisValue}`);
      setRedisResult(data);
    }
  };

  const getRedis = async () => {
    if (!redisKey.trim()) return;
    const data = await api(`/redis/get/${redisKey}`);
    if (data) {
      addLog(`Redis GET ${redisKey} = ${data.value ?? "nil"}`);
      setRedisResult(data);
    }
  };

  const incrRedis = async () => {
    if (!redisKey.trim()) return;
    const data = await api(`/redis/incr/${redisKey}`);
    if (data) {
      addLog(`Redis INCR ${redisKey} = ${data.value}`);
      setRedisResult(data);
    }
  };

  const publishNats = async () => {
    if (!natsSubject.trim() || !natsMessage.trim()) return;
    const data = await api("/nats/publish", {
      method: "POST",
      body: JSON.stringify({ subject: natsSubject, message: natsMessage }),
    });
    if (data?.published) {
      addLog(`NATS PUBLISH to ${natsSubject}: ${natsMessage}`);
      fetchNatsMessages();
    }
  };

  const testAll = async () => {
    const data = await api("/test/all", { method: "POST" });
    if (data) {
      addLog(
        `Test all: PG=${data.postgres?.ok} Redis=${data.redis?.ok} NATS=${data.nats?.ok}`,
      );
      fetchPgItems();
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
        Testing PostgreSQL, Redis, and NATS catalog services on Guara Cloud
      </p>

      <div className="status-grid">
        <div className="status-card">
          <h3>PostgreSQL</h3>
          <StatusBadge
            connected={status.services.postgres.connected}
            error={status.services.postgres.error}
          />
        </div>
        <div className="status-card">
          <h3>Redis</h3>
          <StatusBadge
            connected={status.services.redis.connected}
            error={status.services.redis.error}
          />
        </div>
        <div className="status-card">
          <h3>NATS</h3>
          <StatusBadge
            connected={status.services.nats.connected}
            error={status.services.nats.error}
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

      <div className="section">
        <h2>PostgreSQL - Items ({pgItems.length})</h2>
        <div className="row">
          <input
            placeholder="Name"
            value={itemName}
            onChange={(e) => setItemName(e.target.value)}
          />
          <input
            placeholder="Value (optional)"
            value={itemValue}
            onChange={(e) => setItemValue(e.target.value)}
          />
          <button className="btn btn-success" onClick={createPgItem}>
            Add Item
          </button>
          <button className="btn btn-primary" onClick={fetchPgItems}>
            Refresh
          </button>
        </div>
        {pgItems.length > 0 && <pre>{JSON.stringify(pgItems, null, 2)}</pre>}
        {pgItems.length > 0 && (
          <div style={{ marginTop: "0.5rem" }}>
            {pgItems.map((item) => (
              <button
                key={item.id}
                className="btn btn-danger"
                onClick={() => deletePgItem(item.id)}
                style={{ fontSize: "0.7rem" }}
              >
                Delete #{item.id} ({item.name})
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="section">
        <h2>Redis</h2>
        <div className="row">
          <input
            placeholder="Key"
            value={redisKey}
            onChange={(e) => setRedisKey(e.target.value)}
          />
          <input
            placeholder="Value"
            value={redisValue}
            onChange={(e) => setRedisValue(e.target.value)}
          />
          <button className="btn btn-success" onClick={setRedis}>
            SET
          </button>
          <button className="btn btn-primary" onClick={getRedis}>
            GET
          </button>
          <button className="btn btn-primary" onClick={incrRedis}>
            INCR
          </button>
        </div>
        {redisResult && <pre>{JSON.stringify(redisResult, null, 2)}</pre>}
      </div>

      <div className="section">
        <h2>NATS - Pub/Sub</h2>
        <div className="row">
          <input
            placeholder="Subject"
            value={natsSubject}
            onChange={(e) => setNatsSubject(e.target.value)}
          />
          <input
            placeholder="Message"
            value={natsMessage}
            onChange={(e) => setNatsMessage(e.target.value)}
          />
          <button className="btn btn-success" onClick={publishNats}>
            Publish
          </button>
          <button className="btn btn-primary" onClick={fetchNatsMessages}>
            Refresh Messages
          </button>
        </div>
        {natsMessages.length > 0 && (
          <pre>{JSON.stringify(natsMessages, null, 2)}</pre>
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

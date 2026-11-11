'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, formatAgo, formatDuration } from '../lib/api';
import { WorkerMap } from './WorkerMap';
import { AddWorker } from './AddWorker';
import { WorkerDetail } from './WorkerDetail';

const POLL_MS = 30_000;
// Pings arrive every ~5 min; beyond this an on-duty worker is likely offline.
const STALE_MS = 15 * 60_000;

const statusOf = (worker) => {
  if (!worker.active) return { key: 'inactive', label: 'Deactivated', color: '#9ca3af' };
  if (!worker.on_duty) return { key: 'off', label: 'Off duty', color: '#6b7280' };
  if (!worker.last_seen || Date.now() - Date.parse(worker.last_seen) > STALE_MS) {
    return { key: 'stale', label: 'On duty · no recent signal', color: '#d97706' };
  }
  return { key: 'on', label: 'On duty', color: '#16a34a' };
};

export const Dashboard = ({ onLogout }) => {
  const [workers, setWorkers] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState('');
  const [trail, setTrail] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const [users, m] = await Promise.all([api('/admin/users'), api('/admin/metrics')]);
      setWorkers(users.users);
      setMetrics(m);
      setError('');
    } catch (err) {
      if (err.status === 401 || err.status === 403) onLogout();
      else setError(`Can't reach the server: ${err.message}`);
    }
  }, [onLogout]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // Only on-duty workers appear on the live map; off-duty positions are history, not "where they are".
  const markers = useMemo(
    () =>
      workers
        .filter((w) => w.on_duty && w.last_location)
        .map((w) => ({
          id: w.id,
          lat: w.last_location.lat,
          lng: w.last_location.lng,
          accuracy: w.last_location.accuracy,
          label: `${w.display_name} · ${formatAgo(w.last_seen)}`,
          color: statusOf(w).color,
        })),
    [workers],
  );

  const visibleWorkers = workers.filter((w) =>
    `${w.display_name} ${w.username} ${w.enrollment_code}`.toLowerCase().includes(filter.toLowerCase()),
  );
  const selected = workers.find((w) => w.id === selectedId);

  return (
    <div className="app">
      <header className="topbar">
        <h1>Fleet Tracker</h1>
        <div className="row-end">
          <button className="primary" onClick={() => setShowAdd(true)}>
            + Add worker
          </button>
          <button onClick={onLogout}>Sign out</button>
        </div>
      </header>

      {error && <p className="error banner">{error}</p>}

      <section className="tiles">
        <Tile label="Active workers" value={metrics?.active_workers} />
        <Tile label="On duty now" value={metrics?.on_duty} />
        <Tile label="Location pings today" value={metrics?.pings_today} />
        <Tile
          label="Calls today"
          value={metrics?.calls_today}
          sub={metrics ? `${formatDuration(metrics.call_seconds_today)} talk time · ${metrics.missed_today} missed` : ''}
        />
      </section>

      <main className="layout">
        <section className="card list">
          <input className="search" placeholder="Search workers…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <ul>
            {visibleWorkers.map((w) => {
              const status = statusOf(w);
              return (
                <li key={w.id}>
                  <button className={`worker ${w.id === selectedId ? 'selected' : ''}`} onClick={() => setSelectedId(w.id)}>
                    <span className="dot" style={{ background: status.color }} />
                    <span className="worker-main">
                      <strong>{w.display_name}</strong>
                      <span className="muted small">
                        {status.label} · seen {formatAgo(w.last_seen)}
                      </span>
                    </span>
                    {w.last_location?.battery != null && <span className="muted small">{w.last_location.battery}%</span>}
                  </button>
                </li>
              );
            })}
            {!workers.length && <li className="muted empty">No workers yet. Use “Add worker” to issue a code.</li>}
          </ul>
        </section>

        <section className="card map-card">
          <WorkerMap markers={markers} trail={trail} selectedId={selectedId} onSelect={setSelectedId} />
        </section>

        {selected && (
          <WorkerDetail
            key={selected.id}
            worker={selected}
            onClose={() => setSelectedId(null)}
            onChanged={refresh}
            onTrail={setTrail}
          />
        )}
      </main>

      {showAdd && <AddWorker onClose={() => setShowAdd(false)} onCreated={refresh} />}
    </div>
  );
};

const Tile = ({ label, value, sub }) => (
  <div className="card tile">
    <span className="muted small">{label}</span>
    <strong className="tile-value">{value ?? '—'}</strong>
    {sub && <span className="muted small">{sub}</span>}
  </div>
);

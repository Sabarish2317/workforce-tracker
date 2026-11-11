'use client';

import { useEffect, useState } from 'react';
import { api, formatDuration, formatTime } from '../lib/api';

const DIRECTIONS = {
  outgoing: { label: 'Outgoing', icon: '↗', className: 'dir-out' },
  incoming: { label: 'Incoming', icon: '↙', className: 'dir-in' },
  missed: { label: 'Missed', icon: '✕', className: 'dir-missed' },
};

const sessionLength = ({ started_at: start, ended_at: end }) => {
  const minutes = Math.round(((end ? Date.parse(end) : Date.now()) - Date.parse(start)) / 60000);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
};

export const WorkerDetail = ({ worker, onClose, onChanged, onTrail }) => {
  const [tab, setTab] = useState('calls');
  const [data, setData] = useState({ calls: [], sessions: [], locations: [] });
  const [error, setError] = useState('');
  const [resetPassword, setResetPassword] = useState('');

  useEffect(() => {
    let cancelled = false;
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    Promise.all([
      api(`/admin/users/${worker.id}/calls?limit=100`),
      api(`/admin/users/${worker.id}/sessions?limit=30`),
      api(`/admin/users/${worker.id}/locations?limit=500&since=${encodeURIComponent(since)}`),
    ])
      .then(([calls, sessions, locations]) => {
        if (cancelled) return;
        setData({ calls: calls.calls, sessions: sessions.sessions, locations: locations.locations });
        onTrail(locations.locations.map((p) => [p.lat, p.lng]).reverse());
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
      onTrail(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worker.id, worker.last_seen]);

  const patch = async (body, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setError('');
    try {
      await api(`/admin/users/${worker.id}`, { method: 'PATCH', body });
      onChanged();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  };

  return (
    <aside className="card detail">
      <header className="detail-head">
        <div>
          <h2>{worker.display_name}</h2>
          <p className="muted small">
            Code <span className="code">{worker.enrollment_code}</span> · {worker.username}
          </p>
        </div>
        <button onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <div className="detail-actions">
        {worker.active ? (
          <button
            className="danger"
            onClick={() => patch({ active: false }, `Deactivate ${worker.display_name}? They will be signed out and taken off duty.`)}
          >
            Deactivate
          </button>
        ) : (
          <button onClick={() => patch({ active: true })}>Reactivate</button>
        )}
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await patch({ password: resetPassword })) {
              window.alert('Password reset. Share the new password with the worker in person.');
              setResetPassword('');
            }
          }}
        >
          <input
            placeholder="New password"
            value={resetPassword}
            onChange={(e) => setResetPassword(e.target.value)}
            minLength={8}
            required
            autoComplete="new-password"
          />
          <button>Reset</button>
        </form>
      </div>
      {!worker.consent_at && <p className="warn small">Has not yet acknowledged the monitoring policy in the app.</p>}
      {error && <p className="error">{error}</p>}

      <nav className="tabs">
        {['calls', 'shifts', 'locations'].map((name) => (
          <button key={name} className={tab === name ? 'active' : ''} onClick={() => setTab(name)}>
            {name[0].toUpperCase() + name.slice(1)}
          </button>
        ))}
      </nav>

      <div className="detail-body">
        {tab === 'calls' && (
          <>
            <p className="muted small">From the phone&apos;s call log — calls made or received while on duty.</p>
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Type</th>
                  <th>Contact</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {data.calls.map((c) => {
                  const dir = DIRECTIONS[c.direction] ?? DIRECTIONS.outgoing;
                  return (
                    <tr key={c.id}>
                      <td>{formatTime(c.started_at)}</td>
                      <td className={dir.className}>
                        {dir.icon} {dir.label}
                      </td>
                      <td>
                        {c.contact_name || c.contact_number}
                        {c.contact_name && <div className="muted small">{c.contact_number}</div>}
                      </td>
                      <td>{c.direction === 'missed' ? '—' : formatDuration(c.duration_sec)}</td>
                    </tr>
                  );
                })}
                {!data.calls.length && <EmptyRow cols={4} text="No calls synced yet." />}
              </tbody>
            </table>
          </>
        )}
        {tab === 'shifts' && (
          <table>
            <thead>
              <tr>
                <th>On duty</th>
                <th>Off duty</th>
                <th>Length</th>
              </tr>
            </thead>
            <tbody>
              {data.sessions.map((s) => (
                <tr key={s.id}>
                  <td>{formatTime(s.started_at)}</td>
                  <td>{s.ended_at ? formatTime(s.ended_at) : <span className="pill on">Active</span>}</td>
                  <td>{sessionLength(s)}</td>
                </tr>
              ))}
              {!data.sessions.length && <EmptyRow cols={3} text="No shifts yet." />}
            </tbody>
          </table>
        )}
        {tab === 'locations' && (
          <>
            <p className="muted small">Last 24 hours, shown as a trail on the map.</p>
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Position</th>
                  <th>±m</th>
                  <th>Battery</th>
                </tr>
              </thead>
              <tbody>
                {data.locations.map((p) => (
                  <tr key={p.id}>
                    <td>{formatTime(p.recorded_at)}</td>
                    <td>
                      {p.lat.toFixed(4)}, {p.lng.toFixed(4)}
                    </td>
                    <td>{p.accuracy ? Math.round(p.accuracy) : '—'}</td>
                    <td>{p.battery ?? '—'}%</td>
                  </tr>
                ))}
                {!data.locations.length && <EmptyRow cols={4} text="No pings in the last 24 hours." />}
              </tbody>
            </table>
          </>
        )}
      </div>
    </aside>
  );
};

const EmptyRow = ({ cols, text }) => (
  <tr>
    <td colSpan={cols} className="muted empty">
      {text}
    </td>
  </tr>
);

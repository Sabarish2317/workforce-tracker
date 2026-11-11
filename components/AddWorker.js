'use client';

import { useState } from 'react';
import { api } from '../lib/api';

export const AddWorker = ({ onClose, onCreated }) => {
  const [form, setForm] = useState({ display_name: '', username: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);

  const update = (field) => (event) => setForm({ ...form, [field]: event.target.value });

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api('/admin/users', { method: 'POST', body: form });
      setCreated(result);
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {created ? (
          <>
            <h2>Worker added</h2>
            <p>Give these sign-in details to <strong>{created.user.display_name}</strong> in person:</p>
            <div className="code-box">
              <span className="muted">Enrollment code</span>
              <strong className="code">{created.enrollment_code}</strong>
              <span className="muted">Password</span>
              <strong>{form.password}</strong>
            </div>
            <p className="muted small">
              Before they install the app, make sure they have read and signed the workforce-monitoring policy. The
              password is shown only now.
            </p>
            <button className="primary" onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <form onSubmit={submit}>
            <h2>Add worker</h2>
            <label>
              Full name
              <input value={form.display_name} onChange={update('display_name')} required maxLength={120} />
            </label>
            <label>
              Username <span className="muted small">(for your records)</span>
              <input value={form.username} onChange={update('username')} required pattern="[A-Za-z0-9._\-]{3,64}" />
            </label>
            <label>
              Initial password <span className="muted small">(min 8 characters)</span>
              <input value={form.password} onChange={update('password')} required minLength={8} autoComplete="new-password" />
            </label>
            {error && <p className="error">{error}</p>}
            <div className="row-end">
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                {busy ? 'Creating…' : 'Create & issue code'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

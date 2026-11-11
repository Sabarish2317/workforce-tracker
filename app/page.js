'use client';

import { useEffect, useState } from 'react';
import { getToken, setToken } from '../lib/api';
import { Login } from '../components/Login';
import { Dashboard } from '../components/Dashboard';

export default function Home() {
  const [authed, setAuthed] = useState(null);

  useEffect(() => setAuthed(Boolean(getToken())), []);

  if (authed === null) return null;
  if (!authed) {
    return (
      <Login
        onLogin={(token) => {
          setToken(token);
          setAuthed(true);
        }}
      />
    );
  }
  return (
    <Dashboard
      onLogout={() => {
        setToken(null);
        setAuthed(false);
      }}
    />
  );
}

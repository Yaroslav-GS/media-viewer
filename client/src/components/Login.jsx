import { useState } from 'react';
import { setCsrfToken } from '../lib/api.js';

export default function Login({ onLogin }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || 'Не удалось войти');
      }

      setCsrfToken(data.csrfToken);
      onLogin();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <form className="login-panel" onSubmit={submit}>
        <div className="login-brand">
          <div className="brand-logo brand-logo-large" aria-hidden="true">M</div>
          <div className="login-title">Media Viewer</div>
        </div>
        <label htmlFor="pin">Пинкод</label>
        <input
          id="pin"
          type="password"
          autoFocus
          autoComplete="current-password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={16}
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
          placeholder="Введите пинкод"
        />
        {error && <div className="form-error">{error}</div>}
        <button className="primary-button" disabled={loading || pin.length < 4}>
          {loading ? 'Проверка...' : 'Войти'}
        </button>
      </form>
    </main>
  );
}

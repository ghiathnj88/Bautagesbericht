import { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { apiFetch } from '../api/client';
import { de } from '../i18n/de';

interface User {
  id: string;
  username: string;
  fullName: string;
  role: string;
  active: boolean;
}

export default function AdminPanel() {
  const { user: currentUser, logout } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', fullName: '', role: 'bauleiter' });

  const loadUsers = async () => {
    try {
      const data = await apiFetch<User[]>('/admin/users');
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Laden');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadUsers(); }, []);

  const handleCreate = async () => {
    if (!form.username || !form.password || !form.fullName) {
      setError('Alle Felder ausfüllen');
      return;
    }
    setError('');
    try {
      await apiFetch('/admin/users', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setForm({ username: '', password: '', fullName: '', role: 'bauleiter' });
      setShowForm(false);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Benutzer "${name}" wirklich löschen?`)) return;
    try {
      await apiFetch(`/admin/users/${id}`, { method: 'DELETE' });
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler');
    }
  };

  const handleToggleRole = async (u: User) => {
    const newRole = u.role === 'admin' ? 'bauleiter' : 'admin';
    try {
      await apiFetch(`/admin/users/${u.id}`, {
        method: 'PUT',
        body: JSON.stringify({ role: newRole }),
      });
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler');
    }
  };

  const handleToggleActive = async (u: User) => {
    try {
      await apiFetch(`/admin/users/${u.id}`, {
        method: 'PUT',
        body: JSON.stringify({ active: !u.active }),
      });
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler');
    }
  };

  return (
    <div className="min-h-screen bg-light">
      <header className="bg-primary text-white px-4 py-3 flex items-center justify-between sticky top-0 z-50 shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
            <span className="text-white text-sm font-bold">P</span>
          </div>
          <div>
            <h1 className="text-sm font-bold">{de.app.title} - Admin</h1>
            <p className="text-xs text-white/70">{de.app.company}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-white/70">{currentUser?.fullName}</span>
          <button onClick={logout} className="text-xs text-white/70 hover:text-white transition">{de.auth.logout}</button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-dark">{de.admin.users}</h2>
          <button onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 bg-primary text-white text-sm rounded-lg hover:bg-red-700 transition font-medium">
            {showForm ? 'Abbrechen' : '+ Neuer Benutzer'}
          </button>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>}

        {/* Create form */}
        {showForm && (
          <div className="bg-white rounded-xl shadow-sm p-5 space-y-3">
            <h3 className="text-sm font-semibold text-dark">Neuen Benutzer anlegen</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-mid mb-1">Benutzername</label>
                <input type="text" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })}
                  placeholder="benutzername" className="input-field" />
              </div>
              <div>
                <label className="block text-xs font-medium text-mid mb-1">Passwort</label>
                <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                  placeholder="Passwort" className="input-field" />
              </div>
              <div>
                <label className="block text-xs font-medium text-mid mb-1">Voller Name</label>
                <input type="text" value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })}
                  placeholder="Vor- und Nachname" className="input-field" />
              </div>
              <div>
                <label className="block text-xs font-medium text-mid mb-1">Rolle</label>
                <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}
                  className="input-field bg-white">
                  <option value="bauleiter">Bauleiter</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
            <button onClick={handleCreate}
              className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition font-medium">
              Benutzer anlegen
            </button>
          </div>
        )}

        {/* User list */}
        {loading ? (
          <div className="text-center py-8 text-mid">Laden...</div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs text-mid">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Benutzername</th>
                  <th className="px-4 py-3">Rolle</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-t border-border">
                    <td className="px-4 py-3 font-medium text-dark">{u.fullName}</td>
                    <td className="px-4 py-3 text-mid">{u.username}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => handleToggleRole(u)}
                        className={`text-xs px-2 py-1 rounded-full font-medium ${
                          u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                        } hover:opacity-75 transition`}>
                        {u.role === 'admin' ? 'Admin' : 'Bauleiter'}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => handleToggleActive(u)}
                        className={`text-xs px-2 py-1 rounded-full font-medium ${
                          u.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        } hover:opacity-75 transition`}>
                        {u.active ? 'Aktiv' : 'Gesperrt'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {u.id !== currentUser?.id && (
                        <button onClick={() => handleDelete(u.id, u.fullName)}
                          className="text-xs text-red-500 hover:text-red-700 font-medium">
                          Löschen
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

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

interface Report {
  id: string;
  status: string;
  bvNummer: string | null;
  auftraggeber: string | null;
  datum: string | null;
  ftpReportPath: string | null;
  createdAt: string;
  completedAt: string | null;
  bauleiterName: string | null;
}

type Tab = 'users' | 'reports';

export default function AdminPanel() {
  const { user: currentUser, logout } = useAuth();
  const [tab, setTab] = useState<Tab>('reports');

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
          <a href="/report" className="text-xs text-white/70 hover:text-white transition">Bericht erstellen</a>
          <span className="text-xs text-white/70">{currentUser?.fullName}</span>
          <button onClick={logout} className="text-xs text-white/70 hover:text-white transition">{de.auth.logout}</button>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="max-w-4xl mx-auto px-4 pt-4">
        <div className="flex gap-1 bg-white rounded-lg shadow-sm p-1">
          <button
            onClick={() => setTab('reports')}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition ${
              tab === 'reports' ? 'bg-primary text-white' : 'text-mid hover:bg-gray-50'
            }`}
          >
            Berichte
          </button>
          <button
            onClick={() => setTab('users')}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition ${
              tab === 'users' ? 'bg-primary text-white' : 'text-mid hover:bg-gray-50'
            }`}
          >
            Benutzerverwaltung
          </button>
        </div>
      </div>

      <main className="max-w-4xl mx-auto px-4 py-4">
        {tab === 'reports' ? <ReportsTab /> : <UsersTab currentUserId={currentUser?.id || ''} />}
      </main>
    </div>
  );
}

// ==================== REPORTS TAB ====================

function ReportsTab() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedReport, setSelectedReport] = useState<any>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<Report[]>('/admin/reports');
        setReports(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Fehler beim Laden');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const openPdf = async (reportId: string) => {
    try {
      const data = await apiFetch<{ downloadUrl: string }>(`/admin/reports/${reportId}/pdf`);
      window.open(data.downloadUrl, '_blank');
    } catch {
      alert('Kein PDF vorhanden für diesen Bericht.');
    }
  };

  const viewDetail = async (reportId: string) => {
    try {
      const data = await apiFetch<any>(`/admin/reports/${reportId}`);
      setSelectedReport(data);
    } catch {
      alert('Bericht konnte nicht geladen werden.');
    }
  };

  if (selectedReport) {
    const d = selectedReport.dataJson || selectedReport;
    return (
      <div className="space-y-4">
        <button onClick={() => setSelectedReport(null)}
          className="text-sm text-primary hover:text-red-700 font-medium">
          &larr; Zurück zur Liste
        </button>

        <div className="bg-white rounded-xl shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-dark">
              Bericht {d.bvNummer || selectedReport.bvNummer || '-'}
            </h3>
            {selectedReport.ftpReportPath && (
              <button onClick={() => openPdf(selectedReport.id)}
                className="px-4 py-2 bg-primary text-white text-sm rounded-lg hover:bg-red-700 transition font-medium">
                PDF öffnen
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <DetailRow label="Auftraggeber" value={d.auftraggeber} />
            <DetailRow label="BV-Nummer" value={d.bvNummer} />
            <DetailRow label="Kundennummer" value={d.kundennummer} />
            <DetailRow label="Datum" value={d.datum} />
            <DetailRow label="Lieferanschrift" value={d.lieferanschrift} />
            <DetailRow label="Bauleiter" value={d.bauleiter} />
            <DetailRow label="Arbeitszeit" value={`${d.bauleiterAnfang || ''} - ${d.bauleiterEnde || ''}`} />
            <DetailRow label="Pause" value={d.bauleiterPause} />
          </div>

          {/* Workers */}
          {d.workers && d.workers.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-dark mb-2">Mitarbeiter ({d.workers.length})</h4>
              <div className="space-y-1">
                {d.workers.map((w: any, i: number) => (
                  <p key={i} className="text-sm text-mid">{w.name} ({w.anfang} - {w.ende}, Pause: {w.pause})</p>
                ))}
              </div>
            </div>
          )}

          {/* Tasks */}
          {d.tasks && (
            <div>
              <h4 className="text-sm font-semibold text-dark mb-2">Tätigkeiten</h4>
              <ol className="list-decimal list-inside space-y-1">
                {d.tasks.filter((t: string) => t && t.trim()).map((t: string, i: number) => (
                  <li key={i} className="text-sm text-mid">{t}</li>
                ))}
              </ol>
            </div>
          )}

          {/* Material */}
          {d.materialVerwendet && (
            <div>
              <h4 className="text-sm font-semibold text-dark mb-1">Material</h4>
              <p className="text-sm text-mid whitespace-pre-wrap">{d.materialVerwendet}</p>
            </div>
          )}

          {d.verbrauchsmaterialFahrzeug && (
            <div>
              <h4 className="text-sm font-semibold text-dark mb-1">Verbrauchsmaterial Fahrzeug</h4>
              <p className="text-sm text-mid whitespace-pre-wrap">{d.verbrauchsmaterialFahrzeug}</p>
            </div>
          )}

          {/* Machines */}
          {d.machines && d.machines.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-dark mb-2">Geräte</h4>
              {d.machines.map((m: any, i: number) => (
                <p key={i} className="text-sm text-mid">{m.name} - {m.durationHours}h {m.durationMinutes}min</p>
              ))}
            </div>
          )}

          {d.muellBauschutt && (
            <div>
              <h4 className="text-sm font-semibold text-dark mb-1">Entsorgung</h4>
              <p className="text-sm text-mid">{d.muellBauschutt}</p>
            </div>
          )}

          {/* Weather */}
          {d.weather?.loaded && (
            <div>
              <h4 className="text-sm font-semibold text-dark mb-1">Wetter</h4>
              <p className="text-sm text-mid">{d.weather.temperature}, {d.weather.condition}, Wind: {d.weather.wind}, Luftfeuchtigkeit: {d.weather.humidity}</p>
            </div>
          )}

          {/* Bemerkungen */}
          {d.vorkommnisse && (
            <div>
              <h4 className="text-sm font-semibold text-dark mb-1">Vorkommnisse</h4>
              <p className="text-sm text-mid whitespace-pre-wrap">{d.vorkommnisse}</p>
            </div>
          )}
          {d.wasLiefGut && (
            <div>
              <h4 className="text-sm font-semibold text-dark mb-1">Was lief gut</h4>
              <p className="text-sm text-mid whitespace-pre-wrap">{d.wasLiefGut}</p>
            </div>
          )}
          {d.wasLiefNichtGut && (
            <div>
              <h4 className="text-sm font-semibold text-dark mb-1">Was lief nicht gut</h4>
              <p className="text-sm text-mid whitespace-pre-wrap">{d.wasLiefNichtGut}</p>
            </div>
          )}

          {/* Email */}
          {d.customerEmail && (
            <DetailRow label="Kunden-E-Mail" value={d.customerEmail} />
          )}

          <div className="text-xs text-mid pt-2 border-t border-border">
            Erstellt: {new Date(selectedReport.createdAt).toLocaleString('de-DE')}
            {selectedReport.completedAt && ` | Abgeschlossen: ${new Date(selectedReport.completedAt).toLocaleString('de-DE')}`}
          </div>
        </div>
      </div>
    );
  }

  if (loading) return <div className="text-center py-8 text-mid">Laden...</div>;
  if (error) return <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-dark">Alle Berichte ({reports.length})</h2>
      </div>

      {reports.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-8 text-center text-mid">
          Noch keine Berichte erstellt.
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-mid">
                <th className="px-4 py-3">BV-Nr.</th>
                <th className="px-4 py-3">Auftraggeber</th>
                <th className="px-4 py-3">Datum</th>
                <th className="px-4 py-3">Bauleiter</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {reports.map(r => (
                <tr key={r.id} className="border-t border-border hover:bg-gray-50 transition">
                  <td className="px-4 py-3 font-medium text-dark">{r.bvNummer || '-'}</td>
                  <td className="px-4 py-3 text-mid">{r.auftraggeber || '-'}</td>
                  <td className="px-4 py-3 text-mid">{r.datum || '-'}</td>
                  <td className="px-4 py-3 text-mid">{r.bauleiterName || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                      r.status === 'complete' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {r.status === 'complete' ? 'Fertig' : 'Entwurf'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button onClick={() => viewDetail(r.id)}
                      className="text-xs text-primary hover:text-red-700 font-medium">
                      Details
                    </button>
                    {r.ftpReportPath && (
                      <button onClick={() => openPdf(r.id)}
                        className="text-xs text-green-600 hover:text-green-800 font-medium">
                        PDF
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <span className="text-mid">{label}:</span>{' '}
      <span className="font-medium text-dark">{value}</span>
    </div>
  );
}

// ==================== USERS TAB ====================

function UsersTab({ currentUserId }: { currentUserId: string }) {
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-dark">{de.admin.users}</h2>
        <button onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-primary text-white text-sm rounded-lg hover:bg-red-700 transition font-medium">
          {showForm ? 'Abbrechen' : '+ Neuer Benutzer'}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>}

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
                    {u.id !== currentUserId && (
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
    </div>
  );
}

import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiFetch } from '../api/client';
import { de } from '../i18n/de';

interface Report {
  id: string;
  status: 'draft' | 'complete';
  bvNummer: string | null;
  auftraggeber: string | null;
  datum: string | null;
  ftpReportPath: string | null;
  createdAt: string;
  completedAt: string | null;
}

const COMPLETED_LIMIT = 10;

function formatRelativeDe(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'gerade eben';
  if (diffMin < 60) return `vor ${diffMin} Min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `vor ${diffH} Std`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return 'gestern';
  if (diffD < 7) return `vor ${diffD} Tagen`;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function BauleiterDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch<Report[]>('/reports');
      setReports(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Laden der Berichte');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadReports(); }, [loadReports]);

  const drafts = reports.filter(r => r.status === 'draft');
  const completed = reports.filter(r => r.status === 'complete');
  const completedShown = completed.slice(0, COMPLETED_LIMIT);
  const completedHidden = completed.length - completedShown.length;

  const openPdf = (r: Report) => {
    if (!r.ftpReportPath) {
      alert('Für diesen Bericht ist noch kein PDF vorhanden.');
      return;
    }
    window.open(`/uploads/${r.ftpReportPath}`, '_blank');
  };

  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      await apiFetch(`/reports/${id}`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      await loadReports();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Bericht konnte nicht gelöscht werden');
    } finally {
      setDeleting(false);
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
            <h1 className="text-sm font-bold">{de.app.title}</h1>
            <p className="text-xs text-white/70">{de.app.company}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-white/70">{user?.fullName}</span>
          <button onClick={logout} className="text-xs text-white/70 hover:text-white transition">
            {de.auth.logout}
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Hauptaktionen */}
        <div className="flex gap-2 bg-white rounded-lg shadow-sm p-2">
          <button
            onClick={() => navigate('/ftp')}
            className="flex-1 flex flex-col items-center gap-2 py-8 px-4 rounded-md bg-primary text-white hover:bg-red-700 transition font-medium"
          >
            <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
            </svg>
            <span className="text-base font-semibold">FTP-Server durchsuchen</span>
            <span className="text-xs text-white/80 font-normal">Arbeitsaufträge &amp; frühere Berichte</span>
          </button>

          <button
            onClick={() => navigate('/report')}
            className="flex-1 flex flex-col items-center gap-2 py-8 px-4 rounded-md bg-white text-dark border border-border hover:bg-gray-50 transition font-medium"
          >
            <svg className="w-10 h-10 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <span className="text-base font-semibold">Bautagesbericht erstellen</span>
            <span className="text-xs text-mid font-normal">Neuer Bericht direkt starten</span>
          </button>
        </div>

        {loading && (
          <div className="bg-white rounded-lg shadow-sm p-6 text-center text-mid text-sm">Berichte werden geladen…</div>
        )}
        {error && !loading && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
        )}

        {/* Offene Berichte */}
        {!loading && !error && (
          <section>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-base font-semibold text-dark">Meine offenen Berichte</h2>
              <span className="text-xs text-mid">{drafts.length}</span>
            </div>
            {drafts.length === 0 ? (
              <div className="bg-white rounded-lg shadow-sm p-5 text-sm text-mid text-center">
                Aktuell keine offenen Berichte.
              </div>
            ) : (
              <div className="space-y-2">
                {drafts.map(r => (
                  <div key={r.id} className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-4 flex-wrap">
                    <div className="flex-1 min-w-[200px]">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-medium">Entwurf</span>
                        <span className="text-sm font-medium text-dark">
                          {r.bvNummer || 'Ohne BV-Nr'}
                        </span>
                      </div>
                      <p className="text-sm text-mid truncate">{r.auftraggeber || '—'}</p>
                      <p className="text-xs text-mid mt-1">
                        {r.datum || formatRelativeDe(r.createdAt)} • gestartet {formatRelativeDe(r.createdAt)}
                      </p>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => navigate(`/report?id=${r.id}`)}
                        className="px-3 py-2 bg-primary text-white rounded-md text-xs font-semibold hover:bg-red-700 transition"
                      >
                        Weiterbearbeiten
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(r.id)}
                        className="px-3 py-2 border border-border text-mid rounded-md text-xs font-medium hover:bg-gray-50 transition"
                      >
                        Löschen
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Abgeschlossene Berichte */}
        {!loading && !error && completed.length > 0 && (
          <section>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-base font-semibold text-dark">Letzte abgeschlossene Berichte</h2>
              <span className="text-xs text-mid">{completed.length}</span>
            </div>
            <div className="space-y-2">
              {completedShown.map(r => (
                <div key={r.id} className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-4 flex-wrap">
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono bg-green-100 text-green-700 px-2 py-0.5 rounded font-medium">Fertig</span>
                      <span className="text-sm font-medium text-dark">{r.bvNummer || 'Ohne BV-Nr'}</span>
                    </div>
                    <p className="text-sm text-mid truncate">{r.auftraggeber || '—'}</p>
                    <p className="text-xs text-mid mt-1">
                      {r.datum || '—'} • abgeschlossen {r.completedAt ? formatRelativeDe(r.completedAt) : '—'}
                    </p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => openPdf(r)}
                      disabled={!r.ftpReportPath}
                      className="px-3 py-2 border border-border text-dark rounded-md text-xs font-medium hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
                      title={r.ftpReportPath ? 'PDF in neuem Tab öffnen' : 'Kein PDF verfügbar'}
                    >
                      PDF öffnen
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {completedHidden > 0 && (
              <p className="text-xs text-mid mt-3 text-center">
                {completedHidden} weitere abgeschlossene Berichte sind vom Admin einsehbar.
              </p>
            )}
          </section>
        )}
      </main>

      {/* Lösch-Bestätigung */}
      {confirmDeleteId && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => !deleting && setConfirmDeleteId(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6 space-y-4"
          >
            <h3 className="text-base font-semibold text-dark">Bericht löschen?</h3>
            <p className="text-sm text-mid">
              Der Entwurf wird endgültig entfernt — inklusive aller hochgeladenen Fotos und Unterschriften. Diese Aktion kann nicht rückgängig gemacht werden.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDeleteId(null)}
                disabled={deleting}
                className="px-4 py-2 border border-border text-dark rounded-md text-sm font-medium hover:bg-gray-50 transition disabled:opacity-50"
              >
                Abbrechen
              </button>
              <button
                onClick={() => handleDelete(confirmDeleteId)}
                disabled={deleting}
                className="px-4 py-2 bg-red-600 text-white rounded-md text-sm font-semibold hover:bg-red-700 transition disabled:opacity-50"
              >
                {deleting ? 'Wird gelöscht…' : 'Endgültig löschen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

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

type Tab = 'users' | 'reports' | 'projects';

export default function AdminPanel() {
  const { user: currentUser, logout } = useAuth();
  const [tab, setTab] = useState<Tab>('projects');
  const [bvFilter, setBvFilter] = useState<string>('');
  const [selectedProjectBv, setSelectedProjectBv] = useState<string | null>(null);

  const goToReportsForBv = (bv: string) => {
    setBvFilter(bv);
    setTab('reports');
    setSelectedProjectBv(null);
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
          <a href="/report" className="text-xs text-white/70 hover:text-white transition">Bericht erstellen</a>
          <span className="text-xs text-white/70">{currentUser?.fullName}</span>
          <button onClick={logout} className="text-xs text-white/70 hover:text-white transition">{de.auth.logout}</button>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="max-w-4xl mx-auto px-4 pt-4">
        <div className="flex gap-1 bg-white rounded-lg shadow-sm p-1">
          <button
            onClick={() => setTab('projects')}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition ${
              tab === 'projects' ? 'bg-primary text-white' : 'text-mid hover:bg-gray-50'
            }`}
          >
            Projekte
          </button>
          <button
            onClick={() => { setTab('reports'); setBvFilter(''); }}
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

      <main className="max-w-6xl mx-auto px-4 py-4">
        {tab === 'projects' && selectedProjectBv ? (
          <ProjectDetailView
            bvNummer={selectedProjectBv}
            onBack={() => setSelectedProjectBv(null)}
            onShowReports={(bv: string) => goToReportsForBv(bv)}
          />
        ) : (
          <>
            {tab === 'projects' && <ProjectsTab onSelectProject={(bv: string) => setSelectedProjectBv(bv)} />}
            {tab === 'reports' && <ReportsTab bvFilter={bvFilter} onClearFilter={() => setBvFilter('')} />}
            {tab === 'users' && <UsersTab currentUserId={currentUser?.id || ''} />}
          </>
        )}
      </main>
    </div>
  );
}

// ==================== REPORTS TAB ====================

function ReportsTab({ bvFilter, onClearFilter }: { bvFilter: string; onClearFilter: () => void }) {
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

  const visibleReports = bvFilter
    ? reports.filter((r) => (r.bvNummer || '').trim() === bvFilter)
    : reports;

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
                {d.tasks
                  .flatMap((t: string) => (t || '').split('\n'))
                  .map((l: string) => l.trim())
                  .filter((l: string) => l.length > 0)
                  .map((l: string, i: number) => (
                    <li key={i} className="text-sm text-mid">{l}</li>
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
        <h2 className="text-lg font-semibold text-dark">
          {bvFilter ? `Berichte zu BV ${bvFilter} (${visibleReports.length})` : `Alle Berichte (${reports.length})`}
        </h2>
        {bvFilter && (
          <button
            onClick={onClearFilter}
            className="text-xs text-primary hover:text-red-700 font-medium"
          >
            Filter aufheben
          </button>
        )}
      </div>

      {visibleReports.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-8 text-center text-mid">
          {bvFilter ? 'Keine Berichte für diese BV-Nummer.' : 'Noch keine Berichte erstellt.'}
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
              {visibleReports.map(r => (
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

// ==================== PROJECTS TAB ====================

interface ProjectRow {
  bvNummer: string;
  auftraggeber: string;
  projektbezeichnung: string;
  sollstundenMinuten: number;
  istMinuten: number;
  reportCount: number;
  letztesDatum: string;
  letzterStatus: string;
}

function formatHHMM(minutes: number): string {
  if (!minutes || minutes < 0) return '0:00';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function deltaClass(soll: number, ist: number): string {
  if (!soll) return 'text-mid';
  if (ist > soll) return 'text-red-600 font-semibold';
  if (ist > soll * 0.8) return 'text-amber-600 font-semibold';
  return 'text-green-700';
}

function ProjectsTab({ onSelectProject }: { onSelectProject: (bv: string) => void }) {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<ProjectRow[]>('/admin/projects');
        setProjects(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Fehler beim Laden');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="text-center py-8 text-mid">Laden...</div>;
  if (error) return <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-dark">
        Projekte ({projects.length})
      </h2>

      {projects.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-8 text-center text-mid">
          Noch keine Projekte vorhanden.
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-mid">
                <th className="px-3 py-3">BV-Nr.</th>
                <th className="px-3 py-3">Projekt / Auftraggeber</th>
                <th className="px-3 py-3 text-right">Soll</th>
                <th className="px-3 py-3 text-right">Ist</th>
                <th className="px-3 py-3 text-right">Δ</th>
                <th className="px-3 py-3 text-right">BTBs</th>
                <th className="px-3 py-3">Letztes Datum</th>
                <th className="px-3 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const delta = p.sollstundenMinuten - p.istMinuten;
                return (
                  <tr
                    key={p.bvNummer}
                    onClick={() => onSelectProject(p.bvNummer)}
                    className="border-t border-border hover:bg-gray-50 transition cursor-pointer"
                    title="Berichte zu diesem Projekt anzeigen"
                  >
                    <td className="px-3 py-3 font-medium text-dark whitespace-nowrap">{p.bvNummer}</td>
                    <td className="px-3 py-3">
                      {p.projektbezeichnung && (
                        <div className="text-dark">{p.projektbezeichnung}</div>
                      )}
                      {p.auftraggeber && (
                        <div className="text-xs text-mid">{p.auftraggeber}</div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right text-mid font-mono">
                      {p.sollstundenMinuten ? formatHHMM(p.sollstundenMinuten) : '–'}
                    </td>
                    <td className="px-3 py-3 text-right text-dark font-mono">
                      {formatHHMM(p.istMinuten)}
                    </td>
                    <td className={`px-3 py-3 text-right font-mono ${deltaClass(p.sollstundenMinuten, p.istMinuten)}`}>
                      {p.sollstundenMinuten ? (delta < 0 ? '-' : '') + formatHHMM(Math.abs(delta)) : '–'}
                    </td>
                    <td className="px-3 py-3 text-right text-mid">{p.reportCount}</td>
                    <td className="px-3 py-3 text-mid whitespace-nowrap">{p.letztesDatum || '-'}</td>
                    <td className="px-3 py-3">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                        p.letzterStatus === 'complete' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {p.letzterStatus === 'complete' ? 'Fertig' : 'Entwurf'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ==================== PROJECT DETAIL VIEW ====================

interface DetailReport {
  id: string;
  datum: string;
  completedAt: string | null;
  gesamtMinuten: number;
  azubiMinuten: number;
  machineMinuten: number;
  machineBreakdown: { name: string; minutes: number }[];
  tasksLines: string[];
  materialVerwendet: string;
  verbrauchsmaterialFahrzeug: string;
  entsorgungKg: number;
  entsorgungBreakdown: { material: string; mengeKg: number }[];
  bemerkungen: string;
}

interface ProjectDetail {
  bvNummer: string;
  projektbezeichnung: string;
  auftraggeber: string;
  sollstundenMinuten: number;
  reports: DetailReport[];
  sums: {
    gesamtMinuten: number;
    azubiMinuten: number;
    machineMinuten: number;
    entsorgungKg: number;
  };
  sollMinuten: number;
  nochMinuten: number;
}

function formatKg(n: number): string {
  if (!n) return '0';
  // Eine Nachkommastelle wenn nötig, sonst ganze Zahl.
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

const EXPAND_THRESHOLD = 200;

// Kollabiert lange Texte (>200 Zeichen) und blendet einen "Mehr anzeigen"-Link ein.
function ExpandableText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return <span className="text-mid italic">–</span>;
  if (text.length <= EXPAND_THRESHOLD) return <>{text}</>;
  if (expanded) {
    return (
      <>
        {text}
        <button
          onClick={() => setExpanded(false)}
          className="ml-1 text-primary hover:underline text-[10px] font-medium whitespace-nowrap"
        >
          weniger anzeigen
        </button>
      </>
    );
  }
  return (
    <>
      {text.slice(0, EXPAND_THRESHOLD).trimEnd()}…{' '}
      <button
        onClick={() => setExpanded(true)}
        className="text-primary hover:underline text-[10px] font-medium whitespace-nowrap"
      >
        Mehr anzeigen
      </button>
    </>
  );
}

// Wie ExpandableText, aber für Bullet-Listen (ausgeführte Arbeiten). Kumuliert
// die Zeichen aller Bullets — sobald 200 überschritten ist, wird der Rest
// abgeschnitten und "Mehr anzeigen" eingeblendet.
function ExpandableBulletList({ lines }: { lines: string[] }) {
  const [expanded, setExpanded] = useState(false);
  if (lines.length === 0) return <span className="text-mid italic">–</span>;
  const totalChars = lines.reduce((sum, l) => sum + l.length, 0);

  if (totalChars <= EXPAND_THRESHOLD || expanded) {
    return (
      <>
        <ul className="list-none space-y-0.5 whitespace-pre-wrap break-words">
          {lines.map((t, i) => <li key={i}>- {t}</li>)}
        </ul>
        {expanded && (
          <button
            onClick={() => setExpanded(false)}
            className="mt-1 text-primary hover:underline text-[10px] font-medium"
          >
            weniger anzeigen
          </button>
        )}
      </>
    );
  }

  // Zeichen-Budget kumulativ vergeben.
  let budget = EXPAND_THRESHOLD;
  const visible: string[] = [];
  for (const line of lines) {
    if (budget <= 0) break;
    if (line.length <= budget) {
      visible.push(line);
      budget -= line.length;
    } else {
      visible.push(line.slice(0, budget).trimEnd() + '…');
      budget = 0;
    }
  }

  return (
    <>
      <ul className="list-none space-y-0.5 whitespace-pre-wrap break-words">
        {visible.map((t, i) => <li key={i}>- {t}</li>)}
      </ul>
      <button
        onClick={() => setExpanded(true)}
        className="mt-1 text-primary hover:underline text-[10px] font-medium"
      >
        Mehr anzeigen
      </button>
    </>
  );
}

function ProjectDetailView({
  bvNummer, onBack, onShowReports,
}: {
  bvNummer: string;
  onBack: () => void;
  onShowReports: (bv: string) => void;
}) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    apiFetch<ProjectDetail>(`/admin/projects/${encodeURIComponent(bvNummer)}`)
      .then(setDetail)
      .catch(err => setError(err instanceof Error ? err.message : 'Fehler beim Laden'))
      .finally(() => setLoading(false));
  }, [bvNummer]);

  if (loading) return <div className="text-center py-8 text-mid">Laden…</div>;
  if (error) return <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>;
  if (!detail) return null;

  const noch = detail.nochMinuten;
  const nochClass = noch < 0
    ? 'text-red-700 font-semibold'
    : noch === 0 ? 'text-amber-700 font-semibold'
    : 'text-green-700 font-semibold';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={onBack} className="text-sm text-primary hover:text-red-700 font-medium">
          ← Zurück zur Projekt-Übersicht
        </button>
        <button onClick={() => onShowReports(bvNummer)} className="ml-auto text-xs text-primary hover:underline">
          Einzelne Berichte ansehen →
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-5 space-y-1">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-mono bg-primary/10 text-primary px-2 py-1 rounded">{detail.bvNummer}</span>
          <h2 className="text-lg font-semibold text-dark">
            {detail.projektbezeichnung || 'Ohne Projektbezeichnung'}
          </h2>
        </div>
        {detail.auftraggeber && <p className="text-sm text-mid">{detail.auftraggeber}</p>}
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-xs min-w-[1100px]">
          <thead>
            <tr className="bg-gray-50 text-left text-xs text-mid uppercase tracking-wide">
              <th className="px-3 py-2 align-bottom">Datum</th>
              <th className="px-3 py-2 align-bottom text-right">Gesamtstd</th>
              <th className="px-3 py-2 align-bottom text-right">Geräte-Std</th>
              <th className="px-3 py-2 align-bottom">Ausgeführte Arbeiten</th>
              <th className="px-3 py-2 align-bottom text-right">Entsorgung (kg)</th>
              <th className="px-3 py-2 align-bottom">Material</th>
              <th className="px-3 py-2 align-bottom">Bemerkungen</th>
              <th className="px-3 py-2 align-bottom text-right">Azubistd</th>
            </tr>
          </thead>
          <tbody>
            {detail.reports.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-mid italic">
                  Noch keine abgeschlossenen Berichte für dieses Projekt.
                </td>
              </tr>
            ) : detail.reports.map((r) => (
              <tr key={r.id} className="border-t border-border align-top">
                <td className="px-3 py-3 text-mid whitespace-nowrap font-medium">{r.datum || '–'}</td>
                <td className="px-3 py-3 text-right font-mono text-dark whitespace-nowrap">
                  {formatHHMM(r.gesamtMinuten)}
                </td>
                <td className="px-3 py-3 text-right font-mono whitespace-nowrap">
                  <div className="text-dark">{formatHHMM(r.machineMinuten)}</div>
                  {r.machineBreakdown.length > 0 && (
                    <div className="text-[10px] text-mid font-normal mt-0.5 leading-tight space-y-0.5">
                      {r.machineBreakdown.map((m, i) => (
                        <div key={i}>{m.name} {formatHHMM(m.minutes)}</div>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-3 py-3 text-mid max-w-[260px]">
                  <ExpandableBulletList lines={r.tasksLines} />
                </td>
                <td className="px-3 py-3 text-right font-mono whitespace-nowrap">
                  <div className="text-dark">{formatKg(r.entsorgungKg)} kg</div>
                  {r.entsorgungBreakdown.length > 0 && (
                    <div className="text-[10px] text-mid font-normal mt-0.5 leading-tight text-left">
                      {r.entsorgungBreakdown.map(e => `${e.material} ${formatKg(e.mengeKg)}kg`).join(', ')}
                    </div>
                  )}
                </td>
                <td className="px-3 py-3 text-mid whitespace-pre-wrap break-words max-w-[200px]">
                  {r.materialVerwendet || <span className="italic">–</span>}
                </td>
                <td className="px-3 py-3 text-mid whitespace-pre-wrap break-words max-w-[280px]">
                  <ExpandableText text={r.bemerkungen} />
                </td>
                <td className="px-3 py-3 text-right font-mono text-dark whitespace-nowrap">
                  {r.azubiMinuten ? formatHHMM(r.azubiMinuten) : '0:00'}
                </td>
              </tr>
            ))}
          </tbody>
          {detail.reports.length > 0 && (
            <tfoot className="border-t-2 border-border">
              <tr className="bg-gray-50 font-semibold">
                <td className="px-3 py-3 text-dark">Gesamt</td>
                <td className="px-3 py-3 text-right font-mono text-dark">{formatHHMM(detail.sums.gesamtMinuten)}</td>
                <td className="px-3 py-3 text-right font-mono text-dark">{formatHHMM(detail.sums.machineMinuten)}</td>
                <td className="px-3 py-3"></td>
                <td className="px-3 py-3 text-right font-mono text-dark">{formatKg(detail.sums.entsorgungKg)} kg</td>
                <td className="px-3 py-3"></td>
                <td className="px-3 py-3"></td>
                <td className="px-3 py-3 text-right font-mono text-dark">{formatHHMM(detail.sums.azubiMinuten)}</td>
              </tr>
              <tr className="bg-gray-50">
                <td className="px-3 py-2 text-mid">Gesamt Baustelle (Soll)</td>
                <td className="px-3 py-2 text-right font-mono text-dark">
                  {detail.sollMinuten ? formatHHMM(detail.sollMinuten) : '–'}
                </td>
                <td colSpan={6}></td>
              </tr>
              <tr className="bg-gray-50">
                <td className="px-3 py-2 text-mid">
                  {noch < 0 ? 'Überschritten' : 'Noch verfügbar'}
                </td>
                <td className={`px-3 py-2 text-right font-mono ${nochClass}`}>
                  {detail.sollMinuten
                    ? (noch < 0 ? '−' : '') + formatHHMM(Math.abs(noch))
                    : '–'}
                </td>
                <td colSpan={6}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ==================== USERS TAB ====================

const MIN_PASSWORD_LENGTH = 8;

function PasswordInput({
  value, onChange, placeholder, autoComplete,
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  autoComplete?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete || 'new-password'}
        className="input-field pr-10"
      />
      <button
        type="button"
        onClick={() => setVisible(v => !v)}
        tabIndex={-1}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-mid hover:text-dark transition"
        title={visible ? 'Passwort verbergen' : 'Passwort anzeigen'}
        aria-label={visible ? 'Passwort verbergen' : 'Passwort anzeigen'}
      >
        {visible ? (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.243 4.243L9.88 9.88" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        )}
      </button>
    </div>
  );
}

interface UserForm {
  username: string;
  password: string;
  passwordConfirm: string;
  fullName: string;
  role: string;
}

function emptyForm(): UserForm {
  return { username: '', password: '', passwordConfirm: '', fullName: '', role: 'bauleiter' };
}

function UsersTab({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [editingUser, setEditingUser] = useState<User | null>(null);

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
    if (!form.username.trim() || !form.password || !form.fullName.trim()) {
      setError('Bitte Benutzername, Passwort und Namen ausfüllen.');
      return;
    }
    if (form.password.length < MIN_PASSWORD_LENGTH) {
      setError(`Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`);
      return;
    }
    if (form.password !== form.passwordConfirm) {
      setError('Die beiden Passwörter stimmen nicht überein.');
      return;
    }
    setError('');
    try {
      await apiFetch('/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          username: form.username.trim(),
          password: form.password,
          fullName: form.fullName.trim(),
          role: form.role,
        }),
      });
      setForm(emptyForm());
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-mid mb-1">Benutzername</label>
              <input type="text" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })}
                placeholder="benutzername" autoComplete="off" className="input-field" />
            </div>
            <div>
              <label className="block text-xs font-medium text-mid mb-1">Voller Name</label>
              <input type="text" value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })}
                placeholder="Vor- und Nachname" className="input-field" />
            </div>
            <div>
              <label className="block text-xs font-medium text-mid mb-1">Passwort (mind. {MIN_PASSWORD_LENGTH} Zeichen)</label>
              <PasswordInput value={form.password} onChange={v => setForm({ ...form, password: v })} placeholder="Passwort" />
            </div>
            <div>
              <label className="block text-xs font-medium text-mid mb-1">Passwort wiederholen</label>
              <PasswordInput value={form.passwordConfirm} onChange={v => setForm({ ...form, passwordConfirm: v })} placeholder="Passwort erneut eingeben" />
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
          {form.password && form.passwordConfirm && form.password !== form.passwordConfirm && (
            <p className="text-xs text-red-600">Die beiden Passwörter stimmen nicht überein.</p>
          )}
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
                  <td className="px-4 py-3 text-right space-x-3">
                    <button onClick={() => setEditingUser(u)}
                      className="text-xs text-primary hover:text-red-700 font-medium">
                      Bearbeiten
                    </button>
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

      {editingUser && (
        <EditUserDialog
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSaved={async () => {
            setEditingUser(null);
            await loadUsers();
          }}
        />
      )}
    </div>
  );
}

// ==================== EDIT USER DIALOG ====================

function EditUserDialog({
  user, onClose, onSaved,
}: {
  user: User;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [username, setUsername] = useState(user.username);
  const [fullName, setFullName] = useState(user.fullName);
  const [role, setRole] = useState(user.role);
  const [active, setActive] = useState(user.active);
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!username.trim() || !fullName.trim()) {
      setError('Benutzername und Name dürfen nicht leer sein.');
      return;
    }
    if (password) {
      if (password.length < MIN_PASSWORD_LENGTH) {
        setError(`Das neue Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`);
        return;
      }
      if (password !== passwordConfirm) {
        setError('Die beiden Passwörter stimmen nicht überein.');
        return;
      }
    }
    setError('');
    setSaving(true);
    try {
      const payload: Record<string, any> = {
        username: username.trim(),
        fullName: fullName.trim(),
        role,
        active,
      };
      if (password) payload.password = password;
      await apiFetch(`/admin/users/${user.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={() => !saving && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-dark">Benutzer bearbeiten</h3>
          <button onClick={onClose} disabled={saving}
            className="text-mid hover:text-dark text-2xl leading-none px-2">
            ×
          </button>
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-md p-2">{error}</p>}

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-mid mb-1">Benutzername</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)}
              autoComplete="off" className="input-field" />
          </div>
          <div>
            <label className="block text-xs font-medium text-mid mb-1">Voller Name</label>
            <input type="text" value={fullName} onChange={e => setFullName(e.target.value)}
              className="input-field" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-mid mb-1">Rolle</label>
              <select value={role} onChange={e => setRole(e.target.value)}
                className="input-field bg-white">
                <option value="bauleiter">Bauleiter</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-mid mb-1">Status</label>
              <select value={active ? 'active' : 'inactive'} onChange={e => setActive(e.target.value === 'active')}
                className="input-field bg-white">
                <option value="active">Aktiv</option>
                <option value="inactive">Gesperrt</option>
              </select>
            </div>
          </div>

          <div className="border-t border-border pt-3">
            <p className="text-xs text-mid mb-2">
              Passwort zurücksetzen (optional — leer lassen für unverändert):
            </p>
            <div className="space-y-2">
              <PasswordInput value={password} onChange={setPassword}
                placeholder={`Neues Passwort (mind. ${MIN_PASSWORD_LENGTH} Zeichen)`} />
              <PasswordInput value={passwordConfirm} onChange={setPasswordConfirm}
                placeholder="Neues Passwort wiederholen" />
              {password && passwordConfirm && password !== passwordConfirm && (
                <p className="text-xs text-red-600">Die beiden Passwörter stimmen nicht überein.</p>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-3 justify-end pt-2">
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 border border-border text-dark rounded-md text-sm font-medium hover:bg-gray-50 transition disabled:opacity-50">
            Abbrechen
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 bg-primary text-white rounded-md text-sm font-semibold hover:bg-red-700 transition disabled:opacity-50">
            {saving ? 'Speichert…' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  );
}

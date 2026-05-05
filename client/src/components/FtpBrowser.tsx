import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiFetch, getAccessToken } from '../api/client';
import { de } from '../i18n/de';

type FtpEntry = { name: string; type: 'dir' | 'file'; size: number };

function todayYyMmDd(): string {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// "2026-04-28" (input[type=date]) → "26-04-28" (Patzig-Format)
function isoToYyMmDd(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[1].slice(-2)}-${m[2]}-${m[3]}`;
}

// "26-04-28" → "2026-04-28" (für input[type=date]-Default)
function yyMmDdToIso(yy: string): string {
  const m = yy.match(/^(\d{2})-(\d{2})-(\d{2})$/);
  if (!m) {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
  }
  return `20${m[1]}-${m[2]}-${m[3]}`;
}

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

function isPdf(name: string) { return name.toLowerCase().endsWith('.pdf'); }
function isImage(name: string) {
  const lower = name.toLowerCase();
  return IMAGE_EXTS.some((e) => lower.endsWith(e));
}
function isArbeitsauftrag(name: string) {
  return name.toLowerCase().startsWith('arbeitsauftrag') && isPdf(name);
}
// Patzig-Projektordner haben das Schema "<Projektnr>_<Name>_<Ort>_…",
// z.B. "87922_HSW_Klauss_Stuttgart". Wir nehmen 4–6-stellige Projektnummern an.
const PROJECT_DIR_RE = /^(\d{4,6})_(.+)$/;

export default function FtpBrowser() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [path, setPath] = useState('/');
  const [entries, setEntries] = useState<FtpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadDir = useCallback(async (p: string | null) => {
    setLoading(true);
    setError('');
    try {
      const url = p === null
        ? '/reports/ftp-browse?all=1'
        : `/reports/ftp-browse?all=1&path=${encodeURIComponent(p)}`;
      const res = await apiFetch<{ path: string; entries: FtpEntry[] }>(url);
      setPath(res.path);
      setEntries(res.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'FTP-Fehler');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auf den FTP-Home des angemeldeten Users landen — dort liegen direkt die
  // Projekt-Ordner (siehe Patzig-Verzeichnisstruktur, ftp-seed/README.md).
  useEffect(() => { loadDir(null); }, [loadDir]);

  const inMonteur = path.endsWith('/Monteur');
  // Hochladen nur in Monteur-Bereiche erlauben (Datums-Ordner liegen darunter).
  const canUpload = path.includes('/Monteur');
  // Manuelle Unterordner nur **innerhalb** eines Datums-Ordners (oder tiefer)
  // anlegen — verhindert ungewollte Ordner direkt unter Monteur/.
  const inDateFolderArea = /\/Monteur\/\d{2}-\d{2}-\d{2}(\/|$)/.test(path);

  // Upload-State
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ uploaded: number; failed: { name: string; error: string }[] } | null>(null);
  const [dateDialogOpen, setDateDialogOpen] = useState(false);
  const [datePick, setDatePick] = useState(yyMmDdToIso(todayYyMmDd()));
  const [pendingTargetDir, setPendingTargetDir] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Neuer-Ordner-State
  const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderError, setNewFolderError] = useState('');

  // Bild-Modal-State (Lightbox mit Pfeil-Navigation durch alle Bilder im Ordner)
  const [imageModal, setImageModal] = useState<{ images: FtpEntry[]; index: number } | null>(null);

  const openImageModal = (clickedName: string) => {
    const images = entries.filter(e => e.type === 'file' && isImage(e.name));
    const index = images.findIndex(e => e.name === clickedName);
    if (index === -1) return;
    setImageModal({ images, index });
  };

  // Verschieben + Löschen — pro Datei direkt am Eintrag, kein Mehrfach-Auswahl-Modus.
  // Wurzel des Datums-Ordners (z.B. ".../Monteur/26-04-28") aus dem aktuellen
  // Pfad herausziehen — Quelle für die Liste der Ziel-Unterordner.
  const dateFolderRoot = (path.match(/^(.*\/Monteur\/\d{2}-\d{2}-\d{2})/) || [])[1] || null;
  const [moveFile, setMoveFile] = useState<string | null>(null); // Dateiname, der verschoben werden soll
  const [moveTargets, setMoveTargets] = useState<{ label: string; targetDir: string }[]>([]);
  const [moveTargetsLoading, setMoveTargetsLoading] = useState(false);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState('');
  const [deleteFile, setDeleteFile] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const openMoveDialog = async (filename: string) => {
    if (!dateFolderRoot) return;
    setMoveError('');
    setMoveTargetsLoading(true);
    setMoveFile(filename);
    try {
      const res = await apiFetch<{ path: string; entries: FtpEntry[] }>(
        `/reports/ftp-browse?all=1&path=${encodeURIComponent(dateFolderRoot)}`
      );
      const subfolders = res.entries
        .filter(e => e.type === 'dir')
        .map(e => ({ label: e.name, targetDir: `${dateFolderRoot}/${e.name}` }));
      const targets: { label: string; targetDir: string }[] = [];
      // Datums-Ordner selbst nur, wenn wir tiefer drin sind.
      if (path !== dateFolderRoot) {
        targets.push({ label: '↑ Tagesordner (oberste Ebene)', targetDir: dateFolderRoot });
      }
      // Aktuellen Ordner aus der Liste herausnehmen — Verschieben in sich selbst sinnlos.
      for (const t of subfolders) {
        if (t.targetDir !== path) targets.push(t);
      }
      setMoveTargets(targets);
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : 'Konnte Ordner nicht laden');
    } finally {
      setMoveTargetsLoading(false);
    }
  };

  const handleMoveToTarget = async (targetDir: string) => {
    if (!moveFile) return;
    setMoving(true);
    setMoveError('');
    try {
      const sourcePaths = [`${path}/${moveFile}`];
      const res = await apiFetch<{ moved: { name: string; newPath: string }[]; failed: { name: string; error: string }[] }>(
        '/reports/ftp-move',
        { method: 'POST', body: JSON.stringify({ sourcePaths, targetDir }) }
      );
      if (res.failed.length > 0) {
        setMoveError(res.failed.map(f => `${f.name}: ${f.error}`).join('; '));
      } else {
        setMoveFile(null);
      }
      await loadDir(path);
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : 'Verschieben fehlgeschlagen');
    } finally {
      setMoving(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteFile) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await apiFetch<{ ok: true }>('/reports/ftp-delete', {
        method: 'POST',
        body: JSON.stringify({ path: `${path}/${deleteFile}` }),
      });
      setDeleteFile(null);
      await loadDir(path);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen');
    } finally {
      setDeleting(false);
    }
  };

  const handleCreateFolder = async () => {
    const trimmed = newFolderName.trim().replace(/\s+/g, ' ');
    if (!trimmed) {
      setNewFolderError('Bitte einen Namen eingeben');
      return;
    }
    if (trimmed.length > 80) {
      setNewFolderError('Name zu lang (max. 80 Zeichen)');
      return;
    }
    if (trimmed.startsWith('.') || /[\\/]/.test(trimmed) || !/^[A-Za-zÄÖÜäöüß0-9 _\-()]+$/.test(trimmed)) {
      setNewFolderError('Nur Buchstaben, Zahlen, Leerzeichen und _ - ( ) erlaubt');
      return;
    }
    setNewFolderError('');
    setCreatingFolder(true);
    try {
      await apiFetch<{ ok: true; path: string }>('/reports/ftp-mkdir', {
        method: 'POST',
        body: JSON.stringify({ parentPath: path, dirName: trimmed }),
      });
      setNewFolderDialogOpen(false);
      setNewFolderName('');
      await loadDir(path);
    } catch (err) {
      setNewFolderError(err instanceof Error ? err.message : 'Anlegen fehlgeschlagen');
    } finally {
      setCreatingFolder(false);
    }
  };

  const triggerFilePicker = (targetDir: string) => {
    setPendingTargetDir(targetDir);
    setUploadStatus(null);
    // gibt React Zeit, das pendingTargetDir zu setzen, bevor click() feuert
    setTimeout(() => fileInputRef.current?.click(), 0);
  };

  const handleUploadClick = () => {
    if (inMonteur) {
      // In Monteur direkt: Datum erst wählen, damit ein YY-MM-DD-Unterordner
      // angelegt werden kann. Default: heute.
      setDatePick(yyMmDdToIso(todayYyMmDd()));
      setDateDialogOpen(true);
    } else {
      // In einem Unterordner unter Monteur: Pfad ist klar, direkt File-Picker.
      triggerFilePicker(path);
    }
  };

  const handleDateConfirm = () => {
    const yymmdd = isoToYyMmDd(datePick);
    setDateDialogOpen(false);
    triggerFilePicker(`${path}/${yymmdd}`);
  };

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const targetDir = pendingTargetDir;
    setPendingTargetDir(null);
    if (!targetDir) return;
    setUploading(true);
    setUploadStatus(null);
    try {
      const fd = new FormData();
      Array.from(files).forEach(f => fd.append('files', f));
      fd.append('remoteDir', targetDir);
      const res = await apiFetch<{ uploaded: string[]; failed: { name: string; error: string }[] }>(
        '/reports/ftp-upload-files',
        { method: 'POST', body: fd }
      );
      setUploadStatus({ uploaded: res.uploaded.length, failed: res.failed });
      // Nach Upload Liste neu laden — wenn der Ziel-Ordner der aktuelle ist,
      // werden die neuen Dateien sichtbar; sonst zumindest der frische
      // Datums-Ordner falls wir aus Monteur uploaded haben.
      await loadDir(path);
    } catch (err) {
      setUploadStatus({ uploaded: 0, failed: [{ name: '*', error: err instanceof Error ? err.message : 'Upload fehlgeschlagen' }] });
    } finally {
      setUploading(false);
      // Input zurücksetzen, damit der Bauleiter dieselbe Datei erneut wählen könnte
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const joinPath = (base: string, name: string) =>
    base === '/' ? `/${name}` : `${base}/${name}`;

  const handleDir = (name: string) => loadDir(joinPath(path, name));

  const goUp = () => {
    if (path === '/') return;
    const parts = path.split('/').filter(Boolean);
    parts.pop();
    loadDir(parts.length === 0 ? '/' : '/' + parts.join('/'));
  };

  const openFile = (name: string) => {
    // Stream the file via the authenticated API and open the resulting blob in
    // a new tab. We fetch with the Authorization header, then create an object
    // URL and open it.
    (async () => {
      const token = getAccessToken();
      const fullPath = joinPath(path, name);
      try {
        const res = await fetch(`/api/reports/ftp-download?path=${encodeURIComponent(fullPath)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          credentials: 'include',
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Download fehlgeschlagen' }));
          alert(err.error || 'Download fehlgeschlagen');
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        // Clean up the blob URL after a minute to free memory
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Download fehlgeschlagen');
      }
    })();
  };

  const startReportFromAuftrag = (name: string) => {
    const fullPath = joinPath(path, name);
    navigate(`/report?auftrag=${encodeURIComponent(fullPath)}`);
  };

  return (
    <div className="min-h-screen bg-light">
      <header className="bg-primary text-white px-4 py-3 flex items-center justify-between sticky top-0 z-50 shadow-md">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-md transition"
            title="Zum Hauptmenü"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
            </svg>
            <span className="text-xs font-medium">Hauptmenü</span>
          </button>
          <div className="hidden sm:block">
            <h1 className="text-sm font-bold">{de.app.title} &ndash; FTP</h1>
            <p className="text-xs text-white/70">{de.app.company}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-white/70 hidden sm:inline">{user?.fullName}</span>
          <button onClick={logout} className="text-xs text-white/70 hover:text-white transition">
            {de.auth.logout}
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-4">
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-gray-50 flex items-center gap-3 text-sm overflow-x-auto">
            <button
              onClick={goUp}
              disabled={path === '/'}
              className="px-3 py-1 rounded border border-border text-dark disabled:text-mid disabled:bg-gray-100 disabled:cursor-not-allowed hover:bg-white flex-shrink-0"
            >
              ← Zurück
            </button>
            {/* Breadcrumb: jeder Pfad-Abschnitt ist klickbar und springt direkt
                auf diese Ebene. Der letzte Abschnitt (= aktueller Ordner) wird
                hervorgehoben dargestellt und ist nicht klickbar. */}
            <nav className="flex items-center gap-1 text-xs flex-wrap min-w-0" aria-label="Verzeichnis-Pfad">
              <button
                onClick={() => loadDir('/')}
                className="text-primary hover:underline font-medium"
                disabled={path === '/'}
              >
                /
              </button>
              {path.split('/').filter(Boolean).map((seg, idx, arr) => {
                const subPath = '/' + arr.slice(0, idx + 1).join('/');
                const isLast = idx === arr.length - 1;
                return (
                  <span key={subPath} className="flex items-center gap-1">
                    <span className="text-mid">›</span>
                    {isLast ? (
                      <span className="text-dark font-semibold px-1">{seg}</span>
                    ) : (
                      <button
                        onClick={() => loadDir(subPath)}
                        className="text-primary hover:underline"
                        title={subPath}
                      >
                        {seg}
                      </button>
                    )}
                  </span>
                );
              })}
            </nav>
            <div className="ml-auto flex items-center gap-2 flex-shrink-0">
              {inDateFolderArea && (
                <button
                  onClick={() => { setNewFolderName(''); setNewFolderError(''); setNewFolderDialogOpen(true); }}
                  disabled={uploading || creatingFolder}
                  className="px-3 py-1.5 border border-border text-dark text-xs rounded-md font-semibold hover:bg-white transition disabled:opacity-50"
                  title="Unterordner anlegen (z.B. Dachseite, Eingang)"
                >
                  + Neuer Ordner
                </button>
              )}
              {canUpload && (
                <button
                  onClick={handleUploadClick}
                  disabled={uploading}
                  className="px-3 py-1.5 bg-primary text-white text-xs rounded-md font-semibold hover:bg-red-700 transition disabled:opacity-50"
                  title={inMonteur ? 'Bilder/Videos in einen Datums-Ordner hochladen' : 'Bilder/Videos in diesen Ordner hochladen'}
                >
                  {uploading ? 'Lädt hoch…' : '+ Bilder/Videos'}
                </button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              onChange={(e) => handleFilesSelected(e.target.files)}
              className="hidden"
            />
          </div>

          {uploading && (
            <div className="px-4 py-2 bg-blue-50 text-blue-700 text-xs border-b border-border">
              Dateien werden hochgeladen — bitte warten…
            </div>
          )}
          {uploadStatus && !uploading && (
            <div className={`px-4 py-2 text-xs border-b border-border ${uploadStatus.failed.length === 0 ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
              {uploadStatus.uploaded > 0 && <span>{uploadStatus.uploaded} Datei(en) hochgeladen. </span>}
              {uploadStatus.failed.length > 0 && (
                <span>
                  {uploadStatus.failed.length} fehlgeschlagen: {uploadStatus.failed.map(f => `${f.name} (${f.error})`).join('; ')}
                </span>
              )}
              <button
                onClick={() => setUploadStatus(null)}
                className="ml-2 underline hover:no-underline"
              >
                schließen
              </button>
            </div>
          )}

          {loading && <div className="p-8 text-center text-mid text-sm">Wird geladen&hellip;</div>}
          {error && !loading && <div className="p-4 text-red-600 text-sm">{error}</div>}
          {!loading && !error && entries.length === 0 && (
            <div className="p-8 text-center text-mid text-sm">Dieses Verzeichnis ist leer</div>
          )}

          {!loading && !error && entries.map((entry) => (
            <div
              key={entry.name}
              className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-b-0 hover:bg-gray-50"
            >
              {entry.type === 'dir' ? (
                (() => {
                  const projMatch = entry.name.match(PROJECT_DIR_RE);
                  return (
                    <button
                      onClick={() => handleDir(entry.name)}
                      className="flex items-center gap-3 flex-1 text-left min-w-0"
                    >
                      <svg className="w-5 h-5 text-primary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                      </svg>
                      {projMatch ? (
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-mono bg-primary/10 text-primary px-2 py-0.5 rounded flex-shrink-0">
                            {projMatch[1]}
                          </span>
                          <span className="text-sm text-dark font-medium truncate">{projMatch[2]}</span>
                        </span>
                      ) : (
                        <span className="text-sm text-dark font-medium truncate">{entry.name}</span>
                      )}
                    </button>
                  );
                })()
              ) : (
                <>
                  <button
                    onClick={() => isImage(entry.name) ? openImageModal(entry.name) : openFile(entry.name)}
                    className="flex items-center gap-3 flex-1 text-left"
                    title={isImage(entry.name) ? 'Bild in Vorschau öffnen' : isPdf(entry.name) ? 'In neuem Tab öffnen' : 'Herunterladen'}
                  >
                    {isPdf(entry.name) ? (
                      <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                      </svg>
                    ) : isImage(entry.name) ? (
                      <svg className="w-5 h-5 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5 text-mid flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                      </svg>
                    )}
                    <span className="text-sm text-dark truncate">{entry.name}</span>
                    <span className="text-xs text-mid ml-auto flex-shrink-0">{(entry.size / 1024).toFixed(0)} KB</span>
                  </button>
                  {(isArbeitsauftrag(entry.name) || (inMonteur && isPdf(entry.name))) && (
                    <button
                      onClick={() => startReportFromAuftrag(entry.name)}
                      className="text-xs bg-primary text-white px-3 py-1.5 rounded-md hover:bg-red-700 transition font-medium whitespace-nowrap"
                      title="Neuen Bautagesbericht zu diesem Auftrag erstellen"
                    >
                      + BTB erstellen
                    </button>
                  )}
                  {dateFolderRoot && (
                    <>
                      <button
                        onClick={() => openMoveDialog(entry.name)}
                        className="text-xs border border-border text-dark px-3 py-1.5 rounded-md hover:bg-white transition font-medium whitespace-nowrap flex-shrink-0"
                        title="Diese Datei in einen anderen Ordner verschieben"
                      >
                        Verschieben
                      </button>
                      <button
                        onClick={() => { setDeleteFile(entry.name); setDeleteError(''); }}
                        className="text-xs border border-red-300 text-red-600 px-3 py-1.5 rounded-md hover:bg-red-50 transition font-medium whitespace-nowrap flex-shrink-0"
                        title="Diese Datei löschen"
                      >
                        Löschen
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </main>

      {moveFile !== null && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => !moving && setMoveFile(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6 space-y-4 max-h-[80vh] overflow-y-auto"
          >
            <div>
              <h3 className="text-base font-semibold text-dark">Wohin verschieben?</h3>
              <p className="text-xs text-mid mt-1 truncate">Datei: {moveFile}</p>
            </div>
            {moveError && <p className="text-sm text-red-600 bg-red-50 rounded-md p-2">{moveError}</p>}
            {moveTargetsLoading ? (
              <p className="text-sm text-mid">Lade Ordner…</p>
            ) : moveTargets.length === 0 ? (
              <p className="text-sm text-mid">
                Keine Ziel-Ordner verfügbar. Lege zuerst über „+ Neuer Ordner" einen Unterordner im Tagesordner an.
              </p>
            ) : (
              <ul className="space-y-1">
                {moveTargets.map(t => (
                  <li key={t.targetDir}>
                    <button
                      onClick={() => handleMoveToTarget(t.targetDir)}
                      disabled={moving}
                      className="w-full text-left px-3 py-2 rounded-md hover:bg-gray-100 transition disabled:opacity-50 flex items-center gap-2"
                    >
                      <svg className="w-4 h-4 text-primary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                      </svg>
                      <span className="text-sm text-dark">{t.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end pt-2">
              <button
                onClick={() => setMoveFile(null)}
                disabled={moving}
                className="px-4 py-2 border border-border text-dark rounded-md text-sm font-medium hover:bg-gray-50 transition disabled:opacity-50"
              >
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteFile !== null && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => !deleting && setDeleteFile(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6 space-y-4"
          >
            <h3 className="text-base font-semibold text-dark">Datei löschen?</h3>
            <p className="text-sm text-mid">
              <span className="font-mono break-all">{deleteFile}</span> wird endgültig vom FTP entfernt. Diese Aktion kann nicht rückgängig gemacht werden.
            </p>
            {deleteError && <p className="text-sm text-red-600 bg-red-50 rounded-md p-2">{deleteError}</p>}
            <div className="flex gap-3 justify-end pt-2">
              <button
                onClick={() => setDeleteFile(null)}
                disabled={deleting}
                className="px-4 py-2 border border-border text-dark rounded-md text-sm font-medium hover:bg-gray-50 transition disabled:opacity-50"
              >
                Abbrechen
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deleting}
                className="px-4 py-2 bg-red-600 text-white rounded-md text-sm font-semibold hover:bg-red-700 transition disabled:opacity-50"
              >
                {deleting ? 'Wird gelöscht…' : 'Endgültig löschen'}
              </button>
            </div>
          </div>
        </div>
      )}

      {dateDialogOpen && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setDateDialogOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6 space-y-4"
          >
            <h3 className="text-base font-semibold text-dark">Datum wählen</h3>
            <p className="text-xs text-mid">
              Die Bilder/Videos werden in einen Unterordner mit diesem Datum (Format <code>YY-MM-DD</code>) abgelegt. Falls der Ordner noch nicht existiert, wird er automatisch angelegt.
            </p>
            <div>
              <label className="block text-xs font-medium text-mid mb-1">Datum</label>
              <input
                type="date"
                value={datePick}
                onChange={(e) => setDatePick(e.target.value)}
                className="input-field"
              />
              <p className="text-xs text-mid mt-2">
                Ziel-Ordner: <span className="font-mono text-dark">{path}/{isoToYyMmDd(datePick)}</span>
              </p>
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <button
                onClick={() => setDateDialogOpen(false)}
                className="px-4 py-2 border border-border text-dark rounded-md text-sm font-medium hover:bg-gray-50 transition"
              >
                Abbrechen
              </button>
              <button
                onClick={handleDateConfirm}
                className="px-4 py-2 bg-primary text-white rounded-md text-sm font-semibold hover:bg-red-700 transition"
              >
                Weiter zur Datei-Auswahl
              </button>
            </div>
          </div>
        </div>
      )}

      {imageModal && (
        <ImageLightbox
          images={imageModal.images}
          initialIndex={imageModal.index}
          basePath={path}
          onClose={() => setImageModal(null)}
        />
      )}

      {newFolderDialogOpen && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => !creatingFolder && setNewFolderDialogOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6 space-y-4"
          >
            <h3 className="text-base font-semibold text-dark">Unterordner anlegen</h3>
            <div>
              <label className="block text-xs font-medium text-mid mb-1">Ordnername</label>
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateFolder(); }}
                placeholder="z.B. Dachseite"
                autoFocus
                className="input-field"
              />
              {newFolderError && (
                <p className="text-xs text-red-600 mt-1">{newFolderError}</p>
              )}
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <button
                onClick={() => setNewFolderDialogOpen(false)}
                disabled={creatingFolder}
                className="px-4 py-2 border border-border text-dark rounded-md text-sm font-medium hover:bg-gray-50 transition disabled:opacity-50"
              >
                Abbrechen
              </button>
              <button
                onClick={handleCreateFolder}
                disabled={creatingFolder}
                className="px-4 py-2 bg-primary text-white rounded-md text-sm font-semibold hover:bg-red-700 transition disabled:opacity-50"
              >
                {creatingFolder ? 'Wird angelegt…' : 'Anlegen'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Image-Lightbox: Bilder im aktuellen Ordner durchblättern.
// Bild wird via authentifiziertem Stream als Blob geladen, mit Pfeil-Buttons +
// Tastatur (←/→/Esc) navigiert. Blob-URLs werden beim Wechsel & beim Schließen
// freigegeben — es bleibt immer nur das aktuelle Bild im Speicher.
// ============================================================================
function ImageLightbox({
  images,
  initialIndex,
  basePath,
  onClose,
}: {
  images: FtpEntry[];
  initialIndex: number;
  basePath: string;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const current = images[index];
  const hasPrev = index > 0;
  const hasNext = index < images.length - 1;

  // Blob laden bei Index-Wechsel; alte URL beim Cleanup revoken.
  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    let createdUrl: string | null = null;
    setLoading(true);
    setError('');
    setBlobUrl(null);

    (async () => {
      try {
        const token = getAccessToken();
        const fullPath = basePath === '/' ? `/${current.name}` : `${basePath}/${current.name}`;
        const res = await fetch(`/api/reports/ftp-download?path=${encodeURIComponent(fullPath)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          credentials: 'include',
        });
        if (cancelled) return;
        if (!res.ok) {
          setError('Bild konnte nicht geladen werden');
          setLoading(false);
          return;
        }
        const blob = await res.blob();
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Fehler');
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [current, basePath]);

  const goPrev = useCallback(() => { setIndex(i => Math.max(0, i - 1)); }, []);
  const goNext = useCallback(() => { setIndex(i => Math.min(images.length - 1, i + 1)); }, [images.length]);

  // Tastatur-Steuerung: Esc schließt, ← / → blättern.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goPrev, goNext, onClose]);

  if (!current) return null;

  return (
    <div
      className="fixed inset-0 bg-black/90 flex flex-col z-50"
      onClick={onClose}
    >
      {/* Top-Leiste: Dateiname + Position + Schließen */}
      <div
        className="flex items-center justify-between px-4 py-3 text-white text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-medium truncate">{current.name}</span>
          <span className="text-white/60 text-xs flex-shrink-0">{index + 1} von {images.length}</span>
        </div>
        <button
          onClick={onClose}
          className="text-white/70 hover:text-white text-3xl leading-none px-2"
          aria-label="Schließen"
          title="Schließen (Esc)"
        >
          ×
        </button>
      </div>

      {/* Bild-Bereich mit seitlichen Pfeilen */}
      <div className="flex-1 flex items-center justify-center relative" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={goPrev}
          disabled={!hasPrev}
          aria-label="Vorheriges Bild"
          title="Vorheriges Bild (Pfeil links)"
          className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed text-white flex items-center justify-center text-2xl transition"
        >
          ‹
        </button>

        {loading && <div className="text-white/70 text-sm">Bild wird geladen…</div>}
        {error && !loading && <div className="text-red-400 text-sm">{error}</div>}
        {blobUrl && !loading && (
          <img
            src={blobUrl}
            alt={current.name}
            className="max-w-[90vw] max-h-[80vh] object-contain"
          />
        )}

        <button
          onClick={goNext}
          disabled={!hasNext}
          aria-label="Nächstes Bild"
          title="Nächstes Bild (Pfeil rechts)"
          className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed text-white flex items-center justify-center text-2xl transition"
        >
          ›
        </button>
      </div>
    </div>
  );
}

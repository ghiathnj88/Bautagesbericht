import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api/client';

type FtpEntry = { name: string; type: 'dir' | 'file'; size: number };

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (remotePath: string, fileName: string) => void;
}

export default function FtpPdfPicker({ open, onClose, onSelect }: Props) {
  const [path, setPath] = useState('/');
  const [entries, setEntries] = useState<FtpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadDir = useCallback(async (p: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<{ path: string; entries: FtpEntry[] }>(
        `/reports/ftp-browse?path=${encodeURIComponent(p)}`
      );
      setEntries(res.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'FTP-Fehler');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setPath('/');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    loadDir(path);
  }, [open, path, loadDir]);

  const joinPath = (base: string, name: string) =>
    base === '/' ? `/${name}` : `${base}/${name}`;

  const handleEntry = (entry: FtpEntry) => {
    if (entry.type === 'dir') {
      setPath(joinPath(path, entry.name));
    } else {
      const full = joinPath(path, entry.name);
      onSelect(full, entry.name);
      onClose();
    }
  };

  const goUp = () => {
    if (path === '/') return;
    const parts = path.split('/').filter(Boolean);
    parts.pop();
    setPath(parts.length === 0 ? '/' : '/' + parts.join('/'));
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-lg w-full max-w-lg max-h-[80vh] flex flex-col shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="font-semibold text-dark">Arbeitsauftrag vom FTP wählen</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            className="text-mid hover:text-dark text-2xl leading-none px-2"
          >
            ×
          </button>
        </div>

        <div className="px-4 py-2 border-b border-border bg-gray-50 flex items-center gap-2 text-sm">
          <button
            type="button"
            onClick={goUp}
            disabled={path === '/'}
            className="px-2 py-1 rounded border border-border text-dark disabled:text-mid disabled:bg-gray-100 disabled:cursor-not-allowed hover:bg-white"
          >
            ← Zurück
          </button>
          <span className="text-mid truncate flex-1" title={path}>
            {path}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="p-6 text-center text-mid text-sm">Wird geladen...</div>
          )}
          {error && !loading && (
            <div className="p-4 text-red-600 text-sm">{error}</div>
          )}
          {!loading && !error && entries.length === 0 && (
            <div className="p-6 text-center text-mid text-sm">
              Keine Ordner oder PDFs in diesem Verzeichnis
            </div>
          )}
          {!loading &&
            !error &&
            entries.map((entry) => (
              <button
                type="button"
                key={entry.name}
                onClick={() => handleEntry(entry)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 border-b border-border text-left"
              >
                {entry.type === 'dir' ? (
                  <svg
                    className="w-5 h-5 text-primary flex-shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
                    />
                  </svg>
                ) : (
                  <svg
                    className="w-5 h-5 text-red-500 flex-shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                    />
                  </svg>
                )}
                <span className="flex-1 text-sm text-dark truncate">{entry.name}</span>
                {entry.type === 'file' && (
                  <span className="text-xs text-mid flex-shrink-0">
                    {(entry.size / 1024).toFixed(0)} KB
                  </span>
                )}
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}

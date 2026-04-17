import { useState, useRef, useCallback, useEffect, useLayoutEffect, TextareaHTMLAttributes } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import SignatureCanvas from 'react-signature-canvas';
import { useAuth } from '../auth/AuthContext';
import { apiFetch } from '../api/client';
import { de } from '../i18n/de';
import { ReportData, createEmptyReport, MachineItem, WorkerEntry, EntsorgungItem } from '../types/report';
import Section from './Section';
import VoiceButton from './VoiceButton';
import FtpPdfPicker from './FtpPdfPicker';

const STORAGE_KEY = 'bautagesbericht_draft';

type AutoTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string };
function AutoTextarea({ value, className, ...rest }: AutoTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, [value]);
  return <textarea ref={ref} value={value} className={className} {...rest} />;
}
const MAX_PHOTOS = 5;
const MIN_PHOTOS = 5;

/**
 * Creates onLive/onFinal props for VoiceButton.
 * - onLive: shows live interim text (baseText + spoken text)
 * - onFinal: commits the finalized text, so next recording appends
 * - For "replace" fields (names): baseText is empty
 * - For "append" fields (textareas): baseText is current content
 */
function voiceProps(
  setValue: (val: string) => void,
  currentValue: string,
  mode: 'append' | 'replace' = 'append'
) {
  const base = mode === 'append' && currentValue ? currentValue + ' ' : '';
  return {
    onLive: (text: string) => setValue(base + text),
    onFinal: (text: string) => setValue(base + text),
  };
}

function loadDraft(): ReportData {
  // Bautag = heute. Auch wenn ein Draft aus einer früheren Sitzung wiederhergestellt
  // wird, soll das Datum auf den aktuellen Tag gesetzt werden, sonst landen Berichte
  // mit veraltetem Datum im Dateinamen und in der DB.
  const today = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const draft = { ...createEmptyReport(), ...JSON.parse(raw), datum: today };
      // Leere Task-Slots aus altem Draft zusammenfalten (legacy: ['','','',''])
      if (Array.isArray(draft.tasks) && draft.tasks.every((t: string) => !t || !t.trim())) {
        draft.tasks = [''];
      }
      return draft;
    }
  } catch { /* ignore */ }
  return createEmptyReport();
}

export default function ReportForm() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<ReportData>(loadDraft);
  const [reportId, setReportId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [arbeitsauftragName, setArbeitsauftragName] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [ftpPickerOpen, setFtpPickerOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const sigBauleiterRef = useRef<SignatureCanvas>(null);
  const sigCustomerRef = useRef<SignatureCanvas>(null);

  const update = useCallback((partial: Partial<ReportData>) => {
    setData(prev => ({ ...prev, ...partial }));
  }, []);

  // Auto-save
  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
    }, 500);
    return () => clearTimeout(t);
  }, [data]);

  // === Workers ===
  const addWorker = () => {
    update({ workers: [...data.workers, { name: '', anfang: '07:00', ende: '16:00', pause: '12:00-12:30' }] });
  };
  const removeWorker = (i: number) => {
    update({ workers: data.workers.filter((_, idx) => idx !== i) });
  };
  const updateWorker = (i: number, field: keyof WorkerEntry, val: string) => {
    const w = [...data.workers];
    w[i] = { ...w[i], [field]: val };
    update({ workers: w });
  };

  // === Tasks ===
  const addTask = () => update({ tasks: [...data.tasks, ''] });
  const removeTask = (i: number) => {
    if (data.tasks.length <= 1) return;
    update({ tasks: data.tasks.filter((_, idx) => idx !== i) });
  };
  const updateTask = (i: number, val: string) => {
    const tasks = [...data.tasks];
    tasks[i] = val;
    update({ tasks });
  };

  // === Machines ===
  const addMachine = () => {
    update({ machines: [...data.machines, { name: '', durationHours: 0, durationMinutes: 0 }] });
  };
  const removeMachine = (i: number) => {
    update({ machines: data.machines.filter((_, idx) => idx !== i) });
  };
  const updateMachine = (i: number, field: keyof MachineItem, val: string | number) => {
    const m = [...data.machines];
    m[i] = { ...m[i], [field]: val };
    update({ machines: m });
  };

  // === Entsorgung ===
  const addEntsorgung = () => {
    update({ entsorgung: [...data.entsorgung, { material: '', menge: '' }] });
  };
  const removeEntsorgung = (i: number) => {
    update({ entsorgung: data.entsorgung.filter((_, idx) => idx !== i) });
  };
  const updateEntsorgung = (i: number, field: keyof EntsorgungItem, val: string) => {
    const e = [...data.entsorgung];
    e[i] = { ...e[i], [field]: val };
    update({ entsorgung: e });
  };

  // === Arbeitsauftrag vom FTP-Server laden + Extraction ===
  const handleFtpPdfSelect = useCallback(async (remotePath: string, fileName: string) => {
    setExtracting(true);
    setError('');
    try {
      const result = await apiFetch<{ extracted: Record<string, string>; fileName: string }>(
        '/reports/extract-pdf-ftp',
        {
          method: 'POST',
          body: JSON.stringify({ remotePath }),
        }
      );

      // Decide where the finished Bautagesbericht should later be written on FTP.
      // Convention (professional project layout):
      //   .../Arbeitsauftrag <NN>/
      //     ├── Arbeitsauftrag/   ← PDF des Auftrags liegt hier
      //     ├── Bilder/
      //     └── Bautagesbericht/  ← fertiger Bericht soll hierhin
      // If the picked PDF's parent folder is literally named "Arbeitsauftrag",
      // redirect the save target to the sibling folder "Bautagesbericht".
      // Otherwise fall back to the same folder (old behavior).
      const parentDir = remotePath.substring(0, remotePath.lastIndexOf('/')) || '/';
      const segments = parentDir.split('/');
      const lastSegment = segments[segments.length - 1];
      const ftpSourcePath = lastSegment === 'Arbeitsauftrag'
        ? segments.slice(0, -1).join('/') + '/Bautagesbericht'
        : parentDir;

      const e = result.extracted;
      const updates: Partial<ReportData> = { ftpSourcePath };
      if (e.auftraggeber) updates.auftraggeber = e.auftraggeber;
      if (e.lieferanschrift) updates.lieferanschrift = e.lieferanschrift;
      if (e.bvNummer) updates.bvNummer = e.bvNummer;
      if (e.kundennummer) updates.kundennummer = e.kundennummer;
      update(updates);

      setArbeitsauftragName(fileName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PDF konnte nicht vom FTP geladen werden');
    } finally {
      setExtracting(false);
    }
  }, [update]);

  // If navigated here from the FTP browser with ?auftrag=<path>, auto-import
  // that PDF once on mount. Then clear the query so a refresh doesn't re-trigger.
  useEffect(() => {
    const auftragPath = searchParams.get('auftrag');
    if (!auftragPath) return;
    const fileName = auftragPath.substring(auftragPath.lastIndexOf('/') + 1) || auftragPath;
    handleFtpPdfSelect(auftragPath, fileName);
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams, handleFtpPdfSelect]);

  // === Photo upload ===
  const handlePhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const remaining = MAX_PHOTOS - data.photoPaths.length;
    if (remaining <= 0) { setError('Maximale Anzahl von Fotos erreicht.'); return; }

    let rid = reportId;
    if (!rid) {
      try {
        const result = await apiFetch<{ id: string }>('/reports', {
          method: 'POST',
          body: JSON.stringify({ ...data, status: 'draft' }),
        });
        rid = result.id;
        setReportId(rid);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Fehler beim Erstellen');
        return;
      }
    }

    setUploading(true);
    try {
      const formData = new FormData();
      Array.from(files).slice(0, remaining).forEach(f => formData.append('photos', f));
      const result = await apiFetch<{ photos: { id: string; filePath: string }[] }>(`/reports/${rid}/photos`, {
        method: 'POST',
        body: formData,
      });
      update({ photoPaths: [...data.photoPaths, ...result.photos.map(p => p.filePath)] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload fehlgeschlagen');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
      if (cameraRef.current) cameraRef.current.value = '';
    }
  };

  const removePhoto = (id: string) => {
    update({ photoPaths: data.photoPaths.filter(p => p !== id) });
  };

  // === Weather ===
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherLocation, setWeatherLocation] = useState('');

  const loadWeather = async () => {
    const address = weatherLocation.trim();
    if (!address) {
      setError('Bitte Adresse, Stadt oder PLZ für die Wetterabfrage eingeben.');
      return;
    }

    setWeatherLoading(true);
    try {
      // Geocode address via OpenStreetMap Nominatim
      const geoResp = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`,
        { headers: { 'Accept-Language': 'de' } }
      );
      const geoData = await geoResp.json();
      if (!geoData || geoData.length === 0) {
        setError('Adresse konnte nicht gefunden werden. Bitte prüfen Sie die Baustellenadresse.');
        return;
      }

      const { lat, lon } = geoData[0];

      // Fetch weather from Open-Meteo
      const resp = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto`
      );
      const json = await resp.json();
      const c = json.current;
      const codes: Record<number, string> = {
        0: 'Klar', 1: 'Überwiegend klar', 2: 'Teilweise bewölkt', 3: 'Bewölkt',
        45: 'Nebel', 48: 'Reifnebel', 51: 'Leichter Nieselregen', 53: 'Nieselregen',
        61: 'Leichter Regen', 63: 'Regen', 65: 'Starker Regen',
        71: 'Leichter Schneefall', 73: 'Schneefall', 80: 'Regenschauer', 95: 'Gewitter',
      };
      update({
        weather: {
          temperature: `${Math.round(c.temperature_2m)}°C`,
          condition: codes[c.weather_code] || `Code ${c.weather_code}`,
          wind: `${Math.round(c.wind_speed_10m)} km/h`,
          humidity: `${c.relative_humidity_2m}%`,
          loaded: true,
        },
      });
    } catch {
      setError('Wetterdaten konnten nicht geladen werden.');
    } finally {
      setWeatherLoading(false);
    }
  };

  // === Signatures ===
  const saveSigBauleiter = () => {
    if (sigBauleiterRef.current && !sigBauleiterRef.current.isEmpty()) {
      update({ signatureBauleiter: sigBauleiterRef.current.toDataURL('image/png') });
    }
  };
  const saveSigCustomer = () => {
    if (sigCustomerRef.current && !sigCustomerRef.current.isEmpty()) {
      update({ signatureCustomer: sigCustomerRef.current.toDataURL('image/png') });
    }
  };
  const clearSigBauleiter = () => { sigBauleiterRef.current?.clear(); update({ signatureBauleiter: '' }); };
  const clearSigCustomer = () => { sigCustomerRef.current?.clear(); update({ signatureCustomer: '' }); };

  // === Validation ===
  const validate = (): string[] => {
    const errs: string[] = [];
    if (!data.auftraggeber.trim()) errs.push('Auftraggeber ist ein Pflichtfeld');
    if (!data.lieferanschrift.trim()) errs.push('Lieferanschrift ist ein Pflichtfeld');
    if (!data.bvNummer.trim()) errs.push('BV Nummer ist ein Pflichtfeld');
    if (!data.datum.trim()) errs.push('Datum ist ein Pflichtfeld');
    if (!data.bauleiter.trim()) errs.push('Bauleiter ist ein Pflichtfeld');
    if (!data.bauleiterAnfang || !data.bauleiterEnde) errs.push('Bauleiter Arbeitszeiten sind Pflicht');
    if (!data.bauleiterAlleine) {
      if (data.workers.length === 0) errs.push('Mindestens ein Mitarbeiter erforderlich (oder Häkchen "alleine auf der Baustelle" setzen)');
      for (let i = 0; i < data.workers.length; i++) {
        const w = data.workers[i];
        if (!w.name.trim()) errs.push(`Mitarbeiter ${i + 1}: Name fehlt`);
        if (!w.anfang || !w.ende) errs.push(`Mitarbeiter ${i + 1}: Zeiten fehlen`);
      }
    }
    const taskLines = data.tasks.flatMap(t => t.split('\n')).map(l => l.trim()).filter(l => l.length > 0);
    if (taskLines.length === 0) {
      errs.push('Mindestens eine Tätigkeit muss eingetragen werden');
    }
    if (!data.materialVerwendet.trim()) errs.push('Verwendetes Material ist ein Pflichtfeld');
    if (!data.verbrauchsmaterialFahrzeug.trim()) errs.push('Verbrauchsmaterial vom Fahrzeug ist ein Pflichtfeld');
    if (data.photoPaths.length < MIN_PHOTOS) errs.push(`Mindestens ${MIN_PHOTOS} Fotos erforderlich (${data.photoPaths.length}/${MIN_PHOTOS})`);
    if (!data.signatureBauleiter) errs.push('Bauleiter-Unterschrift erforderlich');
    if (!data.customerEmail.trim()) errs.push('E-Mail-Adresse des Kunden ist ein Pflichtfeld');
    if (data.customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.customerEmail)) {
      errs.push('Ungültige E-Mail-Adresse');
    }
    return errs;
  };

  // === Submit ===
  const handleSubmit = async () => {
    const errs = validate();
    if (errs.length > 0) {
      setValidationErrors(errs);
      setError('');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setValidationErrors([]);
    setSubmitting(true);
    setError('');
    try {
      if (reportId) {
        await apiFetch(`/reports/${reportId}`, {
          method: 'PUT',
          body: JSON.stringify({ ...data, status: 'complete' }),
        });
      } else {
        const result = await apiFetch<{ id: string }>('/reports', {
          method: 'POST',
          body: JSON.stringify({ ...data, status: 'complete' }),
        });
        setReportId(result.id);
      }
      setSubmitted(true);
      localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Absenden');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePreview = async () => {
    setError('');
    try {
      let rid = reportId;
      if (!rid) {
        const result = await apiFetch<{ id: string }>('/reports', {
          method: 'POST',
          body: JSON.stringify({ ...data, status: 'draft' }),
        });
        rid = result.id;
        setReportId(rid);
      } else {
        await apiFetch(`/reports/${rid}`, { method: 'PUT', body: JSON.stringify(data) });
      }
      const pdf = await apiFetch<{ downloadUrl: string }>(`/reports/${rid}/pdf`, { method: 'POST' });
      window.open(pdf.downloadUrl, '_blank');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vorschau fehlgeschlagen');
    }
  };

  const resetForm = () => {
    setData(createEmptyReport());
    setReportId(null);
    setSubmitted(false);
    setError('');
    setValidationErrors([]);
    setArbeitsauftragName('');
    localStorage.removeItem(STORAGE_KEY);
  };

  // === Helper: required label ===
  const req = (label: string) => <>{label} <span className="text-primary">*</span></>;

  // === Success Screen ===
  if (submitted) {
    return (
      <div className="min-h-screen bg-light flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-sm p-8 text-center max-w-sm w-full space-y-4">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-dark">Bericht eingereicht!</h2>
          <p className="text-sm text-mid">Der Bautagesbericht wurde erfolgreich gespeichert und wird verarbeitet.</p>
          <button onClick={resetForm} className="px-6 py-2.5 bg-primary text-white rounded-lg font-medium hover:bg-red-700 transition">
            Neuen Bericht erstellen
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-light">
      {/* Header */}
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
            <h1 className="text-sm font-bold">{de.app.title}</h1>
            <p className="text-xs text-white/70">{de.app.company}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-white/70 hidden sm:inline">{user?.fullName}</span>
          <button onClick={logout} className="text-xs text-white/70 hover:text-white transition">{de.auth.logout}</button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">

        {/* Validation errors */}
        {validationErrors.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-1">
            <p className="text-sm font-semibold text-red-700">Bitte korrigieren:</p>
            {validationErrors.map((e, i) => <p key={i} className="text-sm text-red-600">- {e}</p>)}
          </div>
        )}

        {/* ==================== PROJEKTDATEN ==================== */}
        <Section title={de.sections.projektdaten}>
          {arbeitsauftragName ? (
            <div className="flex items-center justify-between border border-green-300 bg-green-50 rounded-lg px-4 py-3">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm text-dark">{arbeitsauftragName}</span>
              </div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setFtpPickerOpen(true)} className="text-xs text-primary hover:underline">Anderen wählen</button>
                <button type="button" onClick={() => setArbeitsauftragName('')} className="text-xs text-red-500 hover:underline">Entfernen</button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setFtpPickerOpen(true)}
              disabled={extracting}
              className="w-full border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary transition disabled:opacity-60 disabled:cursor-wait"
            >
              <svg className="w-8 h-8 text-mid mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
              </svg>
              <p className="text-sm text-mid">{extracting ? 'PDF wird vom FTP geladen...' : 'Arbeitsauftrag vom FTP-Server wählen'}</p>
            </button>
          )}
          <FtpPdfPicker
            open={ftpPickerOpen}
            onClose={() => setFtpPickerOpen(false)}
            onSelect={handleFtpPdfSelect}
          />

          <div>
            <label className="block text-sm font-medium text-dark mb-1">{req('Auftraggeber')}</label>
            <input type="text" value={data.auftraggeber} onChange={e => update({ auftraggeber: e.target.value })}
              placeholder="Name des Auftraggebers" className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-dark mb-1">{req('Lieferanschrift / Baustellenadresse')}</label>
            <input type="text" value={data.lieferanschrift} onChange={e => update({ lieferanschrift: e.target.value })}
              placeholder="Bitte tragen Sie die Adresse ein" className="input-field" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-dark mb-1">{req('BV Nummer')}</label>
              <input type="text" value={data.bvNummer} onChange={e => update({ bvNummer: e.target.value })}
                placeholder="Projektnummer" className="input-field" />
            </div>
            <div>
              <label className="block text-sm font-medium text-dark mb-1">Kundennummer</label>
              <input type="text" value={data.kundennummer} onChange={e => update({ kundennummer: e.target.value })}
                placeholder="Kd-Nr." className="input-field" />
            </div>
            <div>
              <label className="block text-sm font-medium text-dark mb-1">{req('Datum')}</label>
              <input type="date" value={data.datum.split('.').reverse().join('-')}
                onChange={e => { const [y, m, d] = e.target.value.split('-'); update({ datum: `${d}.${m}.${y}` }); }}
                className="input-field" />
            </div>
          </div>
        </Section>

        {/* ==================== PERSONAL ==================== */}
        <Section title={de.sections.personal}>
          {/* Bauleiter */}
          <div>
            <label className="block text-sm font-medium text-dark mb-1">{req('Bauleiter')}</label>
            <div className="relative">
              <input type="text" value={data.bauleiter} onChange={e => update({ bauleiter: e.target.value })}
                placeholder="Name des Bauleiters" className="input-field pr-10" />
              <VoiceButton {...voiceProps(v => update({ bauleiter: v }), data.bauleiter, 'replace')} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-mid mb-1">{req('Anfang')}</label>
              <input type="time" value={data.bauleiterAnfang} onChange={e => update({ bauleiterAnfang: e.target.value })}
                className="input-field" />
            </div>
            <div>
              <label className="block text-xs font-medium text-mid mb-1">{req('Ende')}</label>
              <input type="time" value={data.bauleiterEnde} onChange={e => update({ bauleiterEnde: e.target.value })}
                className="input-field" />
            </div>
            <div>
              <label className="block text-xs font-medium text-mid mb-1">Pause</label>
              <input type="text" value={data.bauleiterPause} onChange={e => update({ bauleiterPause: e.target.value })}
                placeholder="12:00-12:30" className="input-field" />
            </div>
          </div>

          {/* Mitarbeiter */}
          <div className="border-t border-border pt-4 mt-2">
            <label className="flex items-start gap-2 mb-3 cursor-pointer">
              <input
                type="checkbox"
                checked={data.bauleiterAlleine}
                onChange={e => update({ bauleiterAlleine: e.target.checked, workers: e.target.checked ? [] : data.workers })}
                className="mt-0.5 w-4 h-4 accent-primary"
              />
              <span className="text-sm text-dark">Ich arbeite alleine auf der Baustelle (keine weiteren Mitarbeiter)</span>
            </label>

            {!data.bauleiterAlleine && (
              <>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-dark">{req(`Mitarbeiter (${data.workers.length})`)}</label>
                  <button type="button" onClick={addWorker}
                    className="text-sm text-primary hover:text-red-700 font-medium transition">
                    + Mitarbeiter hinzufügen
                  </button>
                </div>

                {data.workers.map((w, i) => (
                  <div key={i} className="border border-border rounded-lg p-3 mb-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-primary">Mitarbeiter {i + 1}</span>
                      <button type="button" onClick={() => removeWorker(i)} className="text-xs text-red-500 hover:underline">Entfernen</button>
                    </div>
                    <div className="relative">
                      <input type="text" value={w.name} onChange={e => updateWorker(i, 'name', e.target.value)}
                        placeholder="Name" className="input-field pr-10" />
                      <VoiceButton {...voiceProps(v => updateWorker(i, 'name', v), w.name, 'replace')} />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-xs text-mid mb-1">Anfang</label>
                        <input type="time" value={w.anfang} onChange={e => updateWorker(i, 'anfang', e.target.value)} className="input-field text-xs" />
                      </div>
                      <div>
                        <label className="block text-xs text-mid mb-1">Ende</label>
                        <input type="time" value={w.ende} onChange={e => updateWorker(i, 'ende', e.target.value)} className="input-field text-xs" />
                      </div>
                      <div>
                        <label className="block text-xs text-mid mb-1">Pause</label>
                        <input type="text" value={w.pause} onChange={e => updateWorker(i, 'pause', e.target.value)}
                          placeholder="12:00-12:30" className="input-field text-xs" />
                      </div>
                    </div>
                  </div>
                ))}

                {data.workers.length === 0 && (
                  <p className="text-sm text-mid italic">Noch keine Mitarbeiter hinzugefügt.</p>
                )}
              </>
            )}
          </div>
        </Section>

        {/* ==================== AUSGEFÜHRTE ARBEITEN ==================== */}
        <Section title={de.sections.arbeiten}>
          <p className="text-sm text-mid">
            Bitte tragen Sie Ihre ausgeführte Arbeit hier ein. <span className="text-primary">*</span>
            <span className="block text-xs text-mid italic mt-1">Empfehlung: Verfassen Sie nach Möglichkeit mindestens vier ausgeführte Arbeiten.</span>
          </p>
          {data.tasks.map((task, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="relative flex-1">
                <AutoTextarea value={task} onChange={e => updateTask(i, e.target.value)}
                  placeholder="Tätigkeiten Beschreibung"
                  rows={4} className="input-field pr-10 resize-y overflow-hidden" />
                <VoiceButton {...voiceProps(v => updateTask(i, v), data.tasks[i])} />
              </div>
              <button type="button" onClick={() => removeTask(i)}
                disabled={data.tasks.length <= 1}
                className="text-red-400 hover:text-red-600 disabled:opacity-20 transition px-1 text-lg mt-2">&times;</button>
            </div>
          ))}
          <button type="button" onClick={addTask}
            className="text-sm text-primary hover:text-red-700 font-medium transition">
            + Weitere Tätigkeit
          </button>
        </Section>

        {/* ==================== MATERIAL ==================== */}
        <Section title={de.sections.material}>
          <div>
            <label className="block text-sm font-medium text-dark mb-1">{req('Verwendetes Material')}</label>
            <div className="relative">
              <AutoTextarea value={data.materialVerwendet} onChange={e => update({ materialVerwendet: e.target.value })}
                placeholder="Welches Material wurde heute verwendet?" rows={3} className="input-field pr-10 resize-y overflow-hidden" />
              <VoiceButton {...voiceProps(v => update({ materialVerwendet: v }), data.materialVerwendet)} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-dark mb-1">{req('Verbrauchsmaterial vom Fahrzeug')}</label>
            <div className="relative">
              <AutoTextarea value={data.verbrauchsmaterialFahrzeug} onChange={e => update({ verbrauchsmaterialFahrzeug: e.target.value })}
                placeholder="Welches Verbrauchsmaterial aus dem Fahrzeug?" rows={3} className="input-field pr-10 resize-y overflow-hidden" />
              <VoiceButton {...voiceProps(v => update({ verbrauchsmaterialFahrzeug: v }), data.verbrauchsmaterialFahrzeug)} />
            </div>
          </div>
        </Section>

        {/* ==================== GERÄTE & ENTSORGUNG ==================== */}
        <Section title={de.sections.geraeteEntsorgung}>
          <p className="text-sm text-mid">Bühnen, Kräne oder andere Maschinen (optional)</p>

          {data.machines.map((m, i) => (
            <div key={i} className="border border-border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-primary">Maschine {i + 1}</span>
                <button type="button" onClick={() => removeMachine(i)} className="text-xs text-red-500 hover:underline">Entfernen</button>
              </div>
              <input type="text" value={m.name} onChange={e => updateMachine(i, 'name', e.target.value)}
                placeholder="Maschinenbezeichnung" className="input-field" />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-mid mb-1">Stunden</label>
                  <input type="number" value={m.durationHours || ''} onChange={e => updateMachine(i, 'durationHours', parseInt(e.target.value) || 0)}
                    min="0" className="input-field" />
                </div>
                <div>
                  <label className="block text-xs text-mid mb-1">Minuten</label>
                  <input type="number" value={m.durationMinutes || ''} onChange={e => updateMachine(i, 'durationMinutes', parseInt(e.target.value) || 0)}
                    min="0" max="59" className="input-field" />
                </div>
              </div>
            </div>
          ))}

          <button type="button" onClick={addMachine}
            className="text-sm text-primary hover:text-red-700 font-medium transition">
            + Maschine hinzufügen
          </button>

          <div className="border-t border-border pt-4 mt-2">
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-medium text-dark">Entsorgung ({data.entsorgung.length})</label>
              <button type="button" onClick={addEntsorgung}
                className="text-sm text-primary hover:text-red-700 font-medium transition">
                + Entsorgung hinzufügen
              </button>
            </div>

            {data.entsorgung.map((e, i) => (
              <div key={i} className="border border-border rounded-lg p-3 mb-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-primary">Entsorgung {i + 1}</span>
                  <button type="button" onClick={() => removeEntsorgung(i)} className="text-xs text-red-500 hover:underline">Entfernen</button>
                </div>
                <div className="relative">
                  <input type="text" value={e.material} onChange={ev => updateEntsorgung(i, 'material', ev.target.value)}
                    placeholder="Material (z.B. Bauschutt, Mineralwolle, Asbest)" className="input-field pr-10" />
                  <VoiceButton {...voiceProps(v => updateEntsorgung(i, 'material', v), e.material, 'replace')} />
                </div>
                <div>
                  <input type="text" value={e.menge} onChange={ev => updateEntsorgung(i, 'menge', ev.target.value)}
                    placeholder="Menge (z.B. 200 kg, 3 Container)" className="input-field" />
                </div>
              </div>
            ))}

            {data.entsorgung.length === 0 && (
              <p className="text-sm text-mid italic">Keine Entsorgung eingetragen (optional).</p>
            )}
          </div>
        </Section>

        {/* ==================== FOTOS ==================== */}
        {/* ==================== WETTER ==================== */}
        <Section title={de.sections.wetter}>
          <div>
            <label className="block text-sm font-medium text-dark mb-1">Standort für Wetterabfrage</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={weatherLocation}
                onChange={e => setWeatherLocation(e.target.value)}
                placeholder="Bitte tragen Sie die Adresse ein"
                className="input-field flex-1"
              />
              <button type="button" onClick={loadWeather} disabled={weatherLoading}
                className="px-4 py-2 bg-primary text-white text-sm rounded-lg hover:bg-red-700 transition font-medium disabled:opacity-50 whitespace-nowrap">
                {weatherLoading ? 'Lädt...' : 'Wetter laden'}
              </button>
            </div>
          </div>
          {data.weather.loaded && (
            <div className="grid grid-cols-2 gap-3 text-sm bg-gray-50 rounded-lg p-3">
              <div><span className="text-mid">Temperatur:</span> <span className="font-medium">{data.weather.temperature}</span></div>
              <div><span className="text-mid">Bedingung:</span> <span className="font-medium">{data.weather.condition}</span></div>
              <div><span className="text-mid">Wind:</span> <span className="font-medium">{data.weather.wind}</span></div>
              <div><span className="text-mid">Luftfeuchtigkeit:</span> <span className="font-medium">{data.weather.humidity}</span></div>
            </div>
          )}
        </Section>

        {/* ==================== BEMERKUNGEN ==================== */}
        <Section title={de.sections.bemerkungen}>
          <p className="text-xs text-mid mb-1">Alle Felder optional</p>
          <div>
            <label className="block text-sm font-medium text-dark mb-1">Besondere Vorkommnisse</label>
            <div className="relative">
              <AutoTextarea value={data.vorkommnisse} onChange={e => update({ vorkommnisse: e.target.value })}
                placeholder="Gab es besondere Vorkommnisse?" rows={2} className="input-field pr-10 resize-y overflow-hidden" />
              <VoiceButton {...voiceProps(v => update({ vorkommnisse: v }), data.vorkommnisse)} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-dark mb-1">Was lief heute besonders gut?</label>
            <div className="relative">
              <AutoTextarea value={data.wasLiefGut} onChange={e => update({ wasLiefGut: e.target.value })}
                placeholder="Positive Punkte" rows={2} className="input-field pr-10 resize-y overflow-hidden" />
              <VoiceButton {...voiceProps(v => update({ wasLiefGut: v }), data.wasLiefGut)} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-dark mb-1">Was lief heute nicht gut?</label>
            <div className="relative">
              <AutoTextarea value={data.wasLiefNichtGut} onChange={e => update({ wasLiefNichtGut: e.target.value })}
                placeholder="Verbesserungspunkte" rows={2} className="input-field pr-10 resize-y overflow-hidden" />
              <VoiceButton {...voiceProps(v => update({ wasLiefNichtGut: v }), data.wasLiefNichtGut)} />
            </div>
          </div>
        </Section>

        {/* ==================== FOTOS ==================== */}
        <Section title={de.sections.fotos}>
          <p className="text-sm text-mid">Mindestens {MIN_PHOTOS} Fotos hochladen <span className="text-primary">*</span></p>

          <input ref={fileRef} type="file" accept="image/*" multiple onChange={e => handlePhotos(e.target.files)} className="hidden" />
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={e => handlePhotos(e.target.files)} className="hidden" />

          <div onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary transition">
            <svg className="w-10 h-10 text-mid mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
            </svg>
            <p className="text-sm text-mid">{uploading ? 'Wird hochgeladen...' : 'Fotos hier ablegen oder klicken'}</p>
          </div>

          <button type="button" onClick={() => cameraRef.current?.click()}
            className="w-full py-2.5 border border-border rounded-lg text-sm text-dark font-medium hover:bg-gray-50 transition flex items-center justify-center gap-2">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
            </svg>
            Foto aufnehmen
          </button>

          <p className="text-xs text-mid">{data.photoPaths.length} / {MIN_PHOTOS} Fotos (min.)</p>

          {data.photoPaths.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {data.photoPaths.map((fp, idx) => (
                <div key={idx} className="relative aspect-square bg-gray-100 rounded-lg overflow-hidden">
                  <img src={`/uploads/${fp}`} alt="Foto" className="w-full h-full object-cover" />
                  <button type="button" onClick={() => removePhoto(fp)}
                    className="absolute top-1 right-1 w-6 h-6 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600">
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* ==================== UNTERSCHRIFTEN ==================== */}
        <Section title={de.sections.unterschriften}>
          <div className="grid grid-cols-2 gap-4">
            {/* Bauleiter */}
            <div>
              <p className="text-sm font-medium text-dark mb-2">{req('Bauleiter')}</p>
              <div className="border-2 border-border rounded-lg overflow-hidden bg-white" style={{ touchAction: 'none' }}>
                <SignatureCanvas ref={sigBauleiterRef} canvasProps={{ style: { width: '100%', height: '112px' } }} onEnd={saveSigBauleiter} />
              </div>
              <button type="button" onClick={clearSigBauleiter}
                className="mt-2 px-3 py-1.5 border border-red-300 text-red-600 text-xs rounded-lg hover:bg-red-50 transition font-medium">
                Löschen
              </button>
            </div>
            {/* Kunde */}
            <div>
              <p className="text-sm font-medium text-dark mb-2">Kunde</p>
              <div className="border-2 border-border rounded-lg overflow-hidden bg-white" style={{ touchAction: 'none' }}>
                <SignatureCanvas ref={sigCustomerRef} canvasProps={{ style: { width: '100%', height: '112px' } }} onEnd={saveSigCustomer} />
              </div>
              <button type="button" onClick={clearSigCustomer}
                className="mt-2 px-3 py-1.5 border border-red-300 text-red-600 text-xs rounded-lg hover:bg-red-50 transition font-medium">
                Löschen
              </button>
            </div>
          </div>
        </Section>

        {/* ==================== VERSAND ==================== */}
        <Section title={de.sections.versand}>
          <div>
            <label className="block text-sm font-medium text-dark mb-1">{req('E-Mail-Adresse des Kunden')}</label>
            <input type="email" value={data.customerEmail} onChange={e => update({ customerEmail: e.target.value })}
              placeholder="kunde@beispiel.de" className="input-field" />
          </div>
        </Section>

        {/* ==================== ACTIONS ==================== */}
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</p>}

        <div className="flex gap-3 pb-8">
          <button type="button" onClick={handlePreview}
            className="flex-1 py-3 border border-border rounded-lg text-sm font-semibold text-dark hover:bg-gray-50 transition">
            Vorschau erstellen
          </button>
          <button type="button" onClick={handleSubmit} disabled={submitting}
            className="flex-1 py-3 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-red-700 transition disabled:opacity-50">
            {submitting ? 'Wird gesendet...' : 'Bericht senden'}
          </button>
        </div>
      </main>
    </div>
  );
}

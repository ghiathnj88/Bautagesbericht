export interface WorkerEntry {
  name: string;
  anfang: string;  // HH:MM
  ende: string;    // HH:MM
  pause: string;   // z.B. "12:00-12:30"
}

export interface MachineItem {
  name: string;
  durationHours: number;
  durationMinutes: number;
}

export interface WeatherData {
  temperature: string;
  condition: string;
  wind: string;
  humidity: string;
  loaded: boolean;
}

export interface ReportData {
  // Projektdaten (aus PDF extrahiert)
  auftraggeber: string;
  lieferanschrift: string;
  bvNummer: string;
  kundennummer: string;
  datum: string;

  // Personal
  bauleiter: string;
  bauleiterAnfang: string;
  bauleiterEnde: string;
  bauleiterPause: string;
  workers: WorkerEntry[];

  // Ausgeführte Arbeiten (min 4)
  tasks: string[];

  // Material (Pflicht)
  materialVerwendet: string;
  verbrauchsmaterialFahrzeug: string;

  // Geräte & Entsorgung (optional)
  machines: MachineItem[];
  muellBauschutt: string;

  // Fotos (min 5) - file paths relative to /uploads/
  photoPaths: string[];

  // Wetter
  weather: WeatherData;

  // Bemerkungen (optional)
  vorkommnisse: string;
  wasLiefGut: string;
  wasLiefNichtGut: string;

  // Unterschriften
  signatureBauleiter: string;
  signatureCustomer: string;

  // Versand (Pflicht)
  customerEmail: string;

  // Arbeitsauftrag PDF
  arbeitsauftragPath: string;
}

export function createEmptyReport(): ReportData {
  return {
    auftraggeber: '',
    lieferanschrift: '',
    bvNummer: '',
    kundennummer: '',
    datum: new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    bauleiter: '',
    bauleiterAnfang: '07:00',
    bauleiterEnde: '16:00',
    bauleiterPause: '12:00-12:30',
    workers: [],
    tasks: ['', '', '', ''],
    materialVerwendet: '',
    verbrauchsmaterialFahrzeug: '',
    machines: [],
    muellBauschutt: '',
    photoPaths: [],
    weather: { temperature: '', condition: '', wind: '', humidity: '', loaded: false },
    vorkommnisse: '',
    wasLiefGut: '',
    wasLiefNichtGut: '',
    signatureBauleiter: '',
    signatureCustomer: '',
    customerEmail: '',
    arbeitsauftragPath: '',
  };
}

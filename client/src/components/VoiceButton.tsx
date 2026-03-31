import { useState, useRef } from 'react';

interface VoiceButtonProps {
  /** Called with live text while speaking (interim + final combined) */
  onLive: (text: string) => void;
  /** Called with confirmed text when a sentence is finalized or recording stops */
  onFinal: (text: string) => void;
}

export default function VoiceButton({ onLive, onFinal }: VoiceButtonProps) {
  const [recording, setRecording] = useState(false);
  const recognitionRef = useRef<any>(null);
  const finalizedRef = useRef('');

  const start = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Spracheingabe wird von diesem Browser nicht unterstützt.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'de-DE';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognitionRef.current = recognition;
    finalizedRef.current = '';

    recognition.onresult = (event: any) => {
      let finalized = '';
      let interim = '';

      for (let i = 0; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalized += transcript + ' ';
        } else {
          interim += transcript;
        }
      }

      finalizedRef.current = finalized.trim();

      // Show live text in field (finalized + what's being spoken right now)
      const liveText = (finalized + interim).trim();
      if (liveText) onLive(liveText);
    };

    recognition.onerror = () => {
      if (finalizedRef.current) onFinal(finalizedRef.current);
      setRecording(false);
    };

    recognition.onend = () => {
      if (finalizedRef.current) onFinal(finalizedRef.current);
      setRecording(false);
    };

    recognition.start();
    setRecording(true);
  };

  const stop = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    // onend handler will call onFinal
  };

  return (
    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
      {recording && (
        <button
          type="button"
          onClick={stop}
          className="rounded-full p-1 text-red-500 hover:bg-red-50 transition"
          title="Stoppen"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        </button>
      )}

      <button
        type="button"
        onClick={recording ? stop : start}
        className={`rounded-full p-1.5 transition ${
          recording
            ? 'bg-red-500 text-white shadow-md animate-pulse'
            : 'text-green-600 hover:bg-green-50'
        }`}
        title={recording ? 'Aufnahme läuft...' : 'Aufnehmen'}
      >
        <svg className="w-4 h-4" fill={recording ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
        </svg>
      </button>
    </div>
  );
}

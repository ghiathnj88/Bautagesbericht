# FTP-Seed — lokales Test-Verzeichnis

Spiegelt die echte Verzeichnisstruktur des Patzig-FTP wider (siehe
`docs/SESSION_2026-04-13.md` und Kunden-Skizze vom 27.04.2026).

Wird beim `docker compose up` als Home des FTP-Users (`ftpuser`)
in den `ftp`-Service gemountet. Anwendung verbindet sich über den
Service-Namen `ftp` (Port 21) im Docker-Compose-Netzwerk.

## Erwartete Struktur pro Projekt

```
<Projektnr>_<Name>_<Ort>_<Beschreibung>/
  CompanyBase/        — Kunden-Stammdaten (leer für Tests)
  Kalkulationen/      — leer für Tests
  Monteur/
    Arbeitsauftrag_*.pdf
    BTB/              — fertige Bautagesberichte (von der App geschrieben)
    <YY-MM-DD>/       — Fotos vom Tag (von der App geschrieben)
```

## Test-Daten ergänzen

Lokal echte Test-PDFs einlegen (nicht eingecheckt):

```
ftp-seed/87922_HSW_Klauss_Stuttgart/Monteur/Arbeitsauftrag_200003563.pdf
```

Die `.gitkeep`-Dateien sorgen dafür, dass die leeren Strukturordner
unter Versionskontrolle bleiben.

# Design: Tätigkeitsfeld als fortlaufendes Textfeld

**Datum:** 2026-04-17
**Betroffener Bereich:** Bautagesbericht-Formular, Sektion "Ausgeführte Arbeiten"

## Hintergrund

Das Tätigkeitsfeld im Bautagesbericht bestand bisher aus vier Pflicht-Einzeilern (`<input type="text">`). Diese Struktur ist unflexibel: Bauleiter müssen ihre Arbeit künstlich in vier Punkte unterteilen, auch wenn eine Tätigkeit längere Beschreibung benötigt oder bereits mehrere untergliederte Schritte enthält.

## Ziel

- Ein einzelnes, mehrzeiliges Textfeld mit Sprachaufnahme ersetzt die vier Einzeiler.
- Optional können weitere Textfelder hinzugefügt werden, um mehrere Tätigkeitsgruppen getrennt zu erfassen.
- Bestehende Datenstruktur (`tasks: string[]`) bleibt unverändert — Rückwärtskompatibilität mit vorhandenen Berichten.

## UI-Verhalten

### Ausgangszustand
- Ein einzelnes `<textarea>` (4 Zeilen hoch, vertikal mit Maus vergrößerbar via `resize-y`).
- Mikrofon-Button oben rechts im Feld (wie bei anderen Textareas im Formular).
- Entfernen-Button (`×`) erscheint erst, wenn mehr als ein Textfeld vorhanden ist.
- Button *"+ Weitere Tätigkeit"* unterhalb.

### Mit mehreren Textfeldern
- Jedes weitere Feld verhält sich identisch (resize, Mikrofon, Entfernen).
- Nummerierung links neben dem Feld entfällt — die Gruppierung ist visuell klar.

### Hinweistext
> *"Tragen Sie die Tätigkeiten ein — mindestens 4 Zeilen insgesamt. Mit weiteren Textfeldern können Sie Tätigkeiten gruppieren."*

## Validierung

Zwei Regeln ersetzen die bisherige "mindestens 4 ausgefüllte Felder"-Prüfung:

1. **Nicht leer:** Mindestens ein Textfeld muss Inhalt enthalten.
2. **Mindestens 4 Zeilen insgesamt:** Die Summe aller nicht-leeren Zeilen über alle Textareas muss ≥ 4 sein.

**Fehlermeldung bei Verletzung:**
- Leer: *"Mindestens eine Tätigkeit muss eingetragen werden"*
- Zu wenig Zeilen: *"Mindestens 4 Tätigkeitszeilen erforderlich (aktuell: X/4)"*

## PDF-Rendering

Die Tätigkeiten erscheinen im generierten PDF als **eine fortlaufende nummerierte Liste** (bestehender `<ol>`-Stil bleibt).

**Verarbeitungsregel:**
- Alle Textfelder werden in Reihenfolge durchlaufen.
- Jedes Feld wird an Zeilenumbrüchen (`\n`) gesplittet.
- Leere Zeilen werden ausgefiltert.
- Jede verbleibende Zeile wird zu einem eigenen `<li>`-Eintrag.

**Beispiel:**

Textfeld 1:
```
Dachziegel abgedeckt
Lattung erneuert
```

Textfeld 2:
```
Neue Ziegel verlegt
Firstbalken abgedichtet
```

Ergebnis im PDF:
```
1. Dachziegel abgedeckt
2. Lattung erneuert
3. Neue Ziegel verlegt
4. Firstbalken abgedichtet
```

## Datenmodell

Unverändert: `tasks: string[]`

- Initialwert ändert sich von `['', '', '', '']` → `['']`.
- Bestehende Berichte in der Datenbank (Felder mit je einer Zeile) werden durch den neuen PDF-Renderer identisch dargestellt, da Einzeiler ohne `\n` als eine Zeile behandelt werden.
- Keine Datenbankmigration erforderlich.

## Betroffene Dateien

| Datei | Änderung |
|-------|----------|
| [client/src/components/ReportForm.tsx](../../../client/src/components/ReportForm.tsx) | Initialzustand, Render-Logik, Validierung |
| [server/src/services/pdf.service.ts](../../../server/src/services/pdf.service.ts) | `tasksHtml` splittet Einträge an `\n` |

Keine Änderungen an:
- Datenbankschema
- API-Routen
- Typdefinitionen (`tasks: string[]` bleibt)

## Out of Scope

- Rich-Text-Editor oder Markdown-Unterstützung im Tätigkeitsfeld.
- Nachträgliche Migration bestehender Berichte (nicht nötig — Datenstruktur identisch).
- Änderungen am Voice-Input-Verhalten (wird unverändert übernommen).

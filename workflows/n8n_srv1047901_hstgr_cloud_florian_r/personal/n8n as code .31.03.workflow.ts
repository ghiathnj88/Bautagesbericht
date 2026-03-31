import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : n8n as code .31.03
// Nodes   : 6  |  Connections: 3
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// BrancheOrtFormular                 formTrigger
// AiAgent                            agent                      [AI]
// OpenaiModel                        lmChatOpenAi               [creds]
// WebScrapingTool                    httpRequestTool
// TabelleErstellen                   code
// TabelleAnzeigen                    form
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// BrancheOrtFormular
//    → AiAgent
//      → TabelleErstellen
//        → TabelleAnzeigen
//
// AI CONNECTIONS
// OpenaiModel.uses({ ai_languageModel: AiAgent })
// WebScrapingTool.uses({ ai_tool: [WebScrapingTool] })
// </workflow-map>

// =====================================================================
// METADATA DU WORKFLOW
// =====================================================================

@workflow({
    id: 'nqDQwQPcLBC0MYhj1IclQ',
    name: 'n8n as code .31.03',
    active: false,
    settings: {
        executionOrder: 'v1',
        binaryMode: 'separate',
        availableInMCP: false,
        callerPolicy: 'workflowsFromSameOwner',
    },
})
export class N8nAsCode3103Workflow {
    // =====================================================================
    // CONFIGURATION DES NOEUDS
    // =====================================================================

    @node({
        name: 'Branche & Ort Formular',
        type: 'n8n-nodes-base.formTrigger',
        version: 2.5,
        position: [-400, -16],
    })
    BrancheOrtFormular = {
        formFields: {
            values: [
                {
                    fieldLabel: 'Branche',
                    placeholder: 'z.B. IT, Marketing, Handwerk...',
                    requiredField: true,
                },
                {
                    fieldLabel: 'Ort',
                    placeholder: 'z.B. Mainz, Frankfurt, Berlin...',
                    requiredField: true,
                },
            ],
        },
        options: {
            formTitle: 'Unternehmenssuche',
            formDescription: 'Gib Branche und Ort ein, um passende Unternehmen zu finden.',
        },
    };

    @node({
        name: 'AI Agent',
        type: '@n8n/n8n-nodes-langchain.agent',
        version: 2,
        position: [112, -144],
    })
    AiAgent = {
        promptType: 'define',
        text: '=Suche nach Unternehmen der Branche "{{ $json.Branche }}" in "{{ $json.Ort }}".',
        options: {
            systemMessage:
                'Du bist ein KI-Agent spezialisiert auf Web-Scraping und Lead-Recherche. Du erhältst eine Branche und einen Ort und findest passende Unternehmen.\n\nWICHTIG - Nutze NUR diese Quellen (Google und LinkedIn blockieren automatische Requests!):\n1. Gelbe Seiten: https://www.gelbeseiten.de/Suche/{branche}/{ort}\n2. Das Örtliche: https://www.dasoertliche.de/Themen/{branche}/{ort}\n3. GoYellow: https://www.goyellow.de/suche/{branche}/{ort}\n4. Branchenbuch: https://www.branchenbuch.com/{ort}/{branche}\n5. Wer liefert was: https://www.wlw.de/de/suche?q={branche}&r={ort}\n\nVorgehen:\n- Scrape MEHRERE dieser Quellen und MEHRERE Seiten pro Quelle (Seite 1, 2, 3...)\n- Für jedes Unternehmen extrahiere: Firmenname, Webseite, Adresse, Telefonnummer, E-Mail (falls vorhanden), Kurzbeschreibung\n- Finde MINDESTENS 30 Unternehmen\n- Wenn eine Quelle nicht funktioniert, versuche die nächste\n\nWICHTIG: Du MUSST dein Ergebnis als reines JSON-Array zurückgeben, OHNE Markdown, OHNE ```json Tags. NUR das reine JSON-Array:\n[{"nr": 1, "firmenname": "...", "webseite": "...", "adresse": "...", "telefon": "...", "email": "...", "beschreibung": "..."}]',
        },
    };

    @node({
        name: 'OpenAI Model',
        type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
        version: 1.2,
        position: [112, 112],
        credentials: { openAiApi: { id: 'xxx', name: 'OpenAI' } },
    })
    OpenaiModel = {
        model: {
            __rl: true,
            mode: 'list',
            value: 'gpt-4o-mini',
        },
        options: {},
    };

    @node({
        name: 'Web Scraping Tool',
        type: 'n8n-nodes-base.httpRequestTool',
        version: 4.2,
        position: [256, 112],
    })
    WebScrapingTool = {
        toolDescription:
            'Ruft den Inhalt einer Webseite ab. Nutze Gelbe Seiten, Das Örtliche, GoYellow oder Branchenbuch. NICHT Google oder LinkedIn verwenden (diese blockieren). Gibt den HTML-Inhalt zurück.',
        url: '={{ $fromAI("url", "Die URL die gescrapt werden soll, z.B. https://www.gelbeseiten.de/Suche/IT/Mainz", "string") }}',
        sendHeaders: true,
        headerParameters: {
            parameters: [
                {
                    name: 'User-Agent',
                    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                },
                {
                    name: 'Accept',
                    value: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                },
                {
                    name: 'Accept-Language',
                    value: 'de-DE,de;q=0.9,en;q=0.5',
                },
            ],
        },
        options: {
            response: {
                response: {
                    responseFormat: 'text',
                },
            },
        },
    };

    @node({
        name: 'Tabelle erstellen',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [400, -144],
    })
    TabelleErstellen = {
        jsCode: "// Agent-Output parsen und als HTML-Tabelle formatieren\nconst agentOutput = $input.first().json.output || $input.first().json.text || '';\n\nlet unternehmen = [];\ntry {\n  // Versuche JSON aus dem Agent-Output zu extrahieren\n  const jsonMatch = agentOutput.match(/\\[[\\s\\S]*\\]/);\n  if (jsonMatch) {\n    unternehmen = JSON.parse(jsonMatch[0]);\n  }\n} catch (e) {\n  // Fallback: Output als Text zurückgeben\n  return [{ json: { html: '<p>Fehler beim Parsen: ' + agentOutput + '</p>', count: 0 } }];\n}\n\nlet html = `\n<style>\n  table { border-collapse: collapse; width: 100%; font-family: Arial, sans-serif; font-size: 14px; }\n  th { background-color: #2563eb; color: white; padding: 12px 8px; text-align: left; }\n  td { padding: 10px 8px; border-bottom: 1px solid #e5e7eb; }\n  tr:nth-child(even) { background-color: #f9fafb; }\n  tr:hover { background-color: #eff6ff; }\n  a { color: #2563eb; text-decoration: none; }\n  h2 { font-family: Arial, sans-serif; color: #1e3a5f; }\n</style>\n<h2>Ergebnisse: ${unternehmen.length} Unternehmen gefunden</h2>\n<table>\n  <tr>\n    <th>Nr.</th>\n    <th>Firmenname</th>\n    <th>Webseite</th>\n    <th>Adresse</th>\n    <th>Telefon</th>\n    <th>E-Mail</th>\n    <th>Beschreibung</th>\n  </tr>`;\n\nunternehmen.forEach((u, i) => {\n  const webseite = u.webseite ? `<a href=\"${u.webseite}\" target=\"_blank\">${u.webseite}</a>` : '-';\n  const email = u.email ? `<a href=\"mailto:${u.email}\">${u.email}</a>` : '-';\n  html += `\n  <tr>\n    <td>${i + 1}</td>\n    <td><strong>${u.firmenname || '-'}</strong></td>\n    <td>${webseite}</td>\n    <td>${u.adresse || '-'}</td>\n    <td>${u.telefon || '-'}</td>\n    <td>${email}</td>\n    <td>${u.beschreibung || '-'}</td>\n  </tr>`;\n});\n\nhtml += '</table>';\n\nreturn [{ json: { html, count: unternehmen.length } }];",
    };

    @node({
        name: 'Tabelle anzeigen',
        type: 'n8n-nodes-base.form',
        version: 1,
        position: [656, -144],
    })
    TabelleAnzeigen = {
        operation: 'completion',
        respondWith: 'text',
        completionTitle: 'Ergebnisse der Unternehmenssuche',
        completionMessage: '={{ $json.html }}',
        options: {},
    };

    // =====================================================================
    // ROUTAGE ET CONNEXIONS
    // =====================================================================

    @links()
    defineRouting() {
        this.BrancheOrtFormular.out(0).to(this.AiAgent.in(0));
        this.AiAgent.out(0).to(this.TabelleErstellen.in(0));
        this.TabelleErstellen.out(0).to(this.TabelleAnzeigen.in(0));

        this.AiAgent.uses({
            ai_languageModel: this.OpenaiModel.output,
            ai_tool: [this.WebScrapingTool.output],
        });
    }
}

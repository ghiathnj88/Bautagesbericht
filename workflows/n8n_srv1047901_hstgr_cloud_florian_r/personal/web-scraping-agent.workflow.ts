import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : Web Scraping AI Agent
// Nodes   : 5  |  Connections: 1
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// ChatTrigger                      chatTrigger
// ScrapingAgent                    agent                      [AI]
// OpenaiModel                      lmChatOpenAi               [creds] [ai_languageModel]
// Memory                           memoryBufferWindow         [ai_memory]
// WebFetchTool                     httpRequestTool            [ai_tool]
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// ChatTrigger
//   → ScrapingAgent
//
// AI CONNECTIONS
// ScrapingAgent.uses({ ai_languageModel: OpenaiModel, ai_memory: Memory, ai_tool: [WebFetchTool] })
// </workflow-map>

@workflow({ name: 'Web Scraping AI Agent', active: false })
export class WebScrapingAgentWorkflow {
  @node({
    name: 'Chat Trigger',
    type: '@n8n/n8n-nodes-langchain.chatTrigger',
    version: 1.1,
    position: [0, 0],
  })
  ChatTrigger = {
    options: {},
  };

  @node({
    name: 'Scraping Agent',
    type: '@n8n/n8n-nodes-langchain.agent',
    version: 2,
    position: [200, 0],
  })
  ScrapingAgent = {
    promptType: 'define',
    text: '={{ $json.chatInput }}',
    options: {
      systemMessage: `Du bist ein Web-Scraping-Assistent. Deine Aufgabe ist es, Webseiten abzurufen und die gewünschten Informationen daraus zu extrahieren.

Wenn der Benutzer dir eine URL gibt:
1. Rufe die Webseite über das HTTP-Tool ab
2. Analysiere den HTML-Inhalt
3. Extrahiere die gewünschten Informationen
4. Gib die Ergebnisse strukturiert zurück

Wenn keine URL angegeben wird, frage nach der URL und was extrahiert werden soll.

Antworte immer auf Deutsch, es sei denn der Benutzer schreibt auf Englisch.`,
    },
  };

  @node({
    name: 'OpenAI Model',
    type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
    version: 1.2,
    position: [200, 200],
    credentials: { openAiApi: { id: 'xxx', name: 'OpenAI' } },
  })
  OpenaiModel = {
    model: { __rl: true, mode: 'list', value: 'gpt-4o-mini' },
    options: {},
  };

  @node({
    name: 'Memory',
    type: '@n8n/n8n-nodes-langchain.memoryBufferWindow',
    version: 1.3,
    position: [350, 200],
  })
  Memory = {
    sessionIdType: 'customKey',
    sessionKey: '={{ $execution.id }}',
    contextWindowLength: 10,
  };

  @node({
    name: 'Web Fetch Tool',
    type: 'n8n-nodes-base.httpRequestTool',
    version: 4.2,
    position: [500, 200],
  })
  WebFetchTool = {
    method: 'GET',
    url: '={{ $fromAI("url", "The URL to scrape", "string") }}',
    toolDescription: 'Ruft den Inhalt einer Webseite ab. Gib die vollständige URL an (z.B. https://example.com). Gibt den HTML-Inhalt der Seite zurück.',
    options: {
      response: {
        response: {
          fullResponse: false,
          responseFormat: 'text',
        },
      },
    },
  };

  @links()
  defineRouting() {
    this.ChatTrigger.out(0).to(this.ScrapingAgent.in(0));

    this.ScrapingAgent.uses({
      ai_languageModel: this.OpenaiModel.output,
      ai_memory: this.Memory.output,
      ai_tool: [this.WebFetchTool.output],
    });
  }
}

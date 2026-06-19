# VIKI VISION UEACT

**AI-powered emergency dispatch decision support system.**

VIKI VISION UEACT is an Electron desktop application that analyses surveillance and incident images using AI vision models, converts the visual information into a structured JFP (Jaro Flash Protocol) stream, and produces an auditable dispatch recommendation for emergency services operators.

Developed by **Eco Tech Victoria Ltd**.

---

## Key features

| Feature | Description |
|---|---|
| **9 AI providers** | Anthropic, Groq, Gemini, OpenRouter, Jan, Ollama, LM Studio, LocalAI, Custom |
| **JFP v5.2 pipeline** | 6-stage processing: INPUT → FACTS → QUALITY → CORRECT → DECIDE → OUTPUT |
| **4 dispatch modules** | TACTICAL, MEDICAL, POLICE, FIRE — activated by AI decision |
| **Operator review loop** | Human-in-the-loop: confirm, correct, or escalate every case |
| **Audit trail** | Tamper-visible case log stored in localStorage, exportable as JSON |
| **Local model support** | Auto-detects running Ollama / LM Studio / Jan / LocalAI server |
| **Offline capable** | All logic runs client-side — no server required with local providers |

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  VIKI VISION UEACT  (Electron 28 + React 18 + Vite 5)             │
│                                                                    │
│  ┌──────────────┐    ┌───────────────────────────────────────────┐ │
│  │              │    │  JFP PIPELINE v5.2                        │ │
│  │  DROP FRAME  │───▶│                                           │ │
│  │  (image)     │    │  01:INPUT → 02:FACTS → 03:QUALITY         │ │
│  │              │    │  → 04:CORRECT → 05:DECIDE → 06:OUTPUT     │ │
│  └──────────────┘    └─────────────────┬─────────────────────────┘ │
│                                        │                           │
│  ┌─────────────────────────────────────▼─────────────────────────┐ │
│  │  AI PROVIDER  (one selected per run)                          │ │
│  │  Anthropic · Groq · Gemini · OpenRouter                       │ │
│  │  Ollama · Jan · LM Studio · LocalAI · Custom                  │ │
│  └─────────────────────────────────────┬─────────────────────────┘ │
│                                        │ JFP stream                │
│  ┌─────────────────────────────────────▼─────────────────────────┐ │
│  │  DECISION ENGINE                                              │ │
│  │  parseJfp() → modulesForStatus() → buildOperatorGuidance()   │ │
│  └─────────────────────────────────────┬─────────────────────────┘ │
│                                        │                           │
│  ┌──────────────┐    ┌─────────────────▼─────────────────────────┐ │
│  │  DISPATCH    │    │  OPERATOR REVIEW                          │ │
│  │  MODULES     │    │  • Confirm system suggestion              │ │
│  │  ⚔ TACTICAL  │    │  • Override with final status             │ │
│  │  ✚ MEDICAL   │    │  • Select support package                 │ │
│  │  ◈ POLICE    │    │  • Add reason codes                       │ │
│  │  ▲ FIRE      │    │  • Add operator notes                     │ │
│  └──────────────┘    └───────────────────────────────────────────┘ │
│                                                                    │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  AUDIT STORE  (localStorage, max 50 cases, exportable JSON)   │ │
│  └────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

---

## JFP Protocol — pipeline stages

| Stage | Code | Description |
|---|---|---|
| **INPUT** | 01 | Image loaded, provider selected, request prepared |
| **FACTS** | 02 | AI identifies objects (atoms), relations, roles |
| **QUALITY** | 03 | Uncertainty and scene quality assessed |
| **CORRECT** | 04 | Conservative rule corrections applied (if any) |
| **DECIDE** | 05 | Final dispatch status determined |
| **OUTPUT** | 06 | JFP stream complete, operator review presented |

---

## Dispatch status codes

| Status | Color | Meaning |
|---|---|---|
| `DISPATCH_FIRE` | Orange | Fire service required |
| `DISPATCH_MEDICAL` | Green | Medical emergency |
| `DISPATCH_POLICE` | Blue | Police response |
| `DISPATCH_TACTICAL` | Red | Armed/tactical response (auto-upgraded from POLICE when weapons + HIGH threat + NEW/ACTIVE incident) |
| `NO_DISPATCH` | Gray | No emergency detected |
| `HUMAN_REVIEW_REQUIRED` | Yellow | Insufficient data — human operator must decide |

---

## AI providers

| Provider | Type | Model | Notes |
|---|---|---|---|
| Anthropic | Cloud | claude-haiku-4-5-20251001 | API key required |
| Groq | Cloud | llama-4-scout-17b | API key required |
| Gemini | Cloud | gemini-2.0-flash | API key required |
| OpenRouter | Cloud | openrouter/free | API key required |
| Jan | Local | Auto-detect | Runs at `localhost:1337` |
| Ollama | Local | llama3.2-vision | Runs at `localhost:11434` |
| LM Studio | Local | Auto-detect | Runs at `localhost:1234` |
| LocalAI | Local | Auto-detect | Runs at `localhost:8080` |
| Custom | Local | Auto-detect | Configurable URL |

Local providers support **Auto Detect** — VIKI queries the running server and picks a vision-capable model automatically.

---

## Quick start

**Requirements:** Node.js 18+, npm.

```bash
git clone https://github.com/etechvictoria-ui/viki-vision-ueact.git
cd viki-vision-ueact
npm install
npm run electron:dev
```

The Electron window opens automatically. Vite dev server starts on port 5173.

---

## Development

```bash
# Start Vite dev server only (browser mode — no Electron)
npm run dev

# Start full Electron + Vite dev environment
npm run electron:dev

# Run tests
npm test

# Watch mode
npm run test:watch
```

---

## Build

```bash
# Build distributable Electron app (Linux AppImage / deb by default)
npm run electron:build
```

Output is placed in the `out/` directory. Targets are configured in `package.json` under `build`.

---

## How to use

1. **Select a provider** — click one of the 9 provider buttons at the top.
2. **Enter API key** (cloud providers) or configure the local server URL.
3. **Test connection** — click `TEST CONNECTION` to verify the model is reachable.
4. **Load a frame** — drag-and-drop an image onto the drop zone, or click to browse.
5. **Execute** — click `⚡ EXECUTE [PROVIDER]`. The JFP stream appears in real time.
6. **Review** — the Operator Review panel appears with VIKI's suggestion (highlighted in amber).
7. **Confirm or correct** — set the final status, select support services, add reason codes and notes.
8. **Export** — click `EXPORT JSON` in the Audit Store to download all cases.

---

## Operator review fields

| Field | Description |
|---|---|
| **System suggestion** | VIKI's recommended dispatch status (amber highlight) |
| **Support package** | Additional services recommended alongside primary dispatch |
| **Operator final status** | Human override — takes precedence over system suggestion |
| **Reason codes** | Why the decision was corrected (for model feedback) |
| **Notes** | Free-text operator notes |

---

## Audit log format

Each case stored in `localStorage` (key: `viki_ueact_audit_cases`) is a JSON object:

```json
{
  "case_id": "CASE_1718000000000_A3B2C1",
  "created_at": "2026-06-01T12:00:00.000Z",
  "provider_id": "groq",
  "provider_name": "Groq",
  "model_id": "meta-llama/llama-4-scout-17b-16e-instruct",
  "jfp_version": "5.2_PRODUCTION",
  "image_hash": "IMG_3F4A2B1C",
  "suggested_status": "STATUS:DISPATCH_POLICE",
  "final_output": ["F:VERSION:5.2_PRODUCTION;", "F:OBJECT:human;...", "STATUS:DISPATCH_POLICE;"],
  "decision_trace": "F:DECISION_TRACE:T02→T04→D02;",
  "uncertainty": "F:UNCERTAINTY:LOW;",
  "summary": { "atoms": 2, "relations": 1, "roles": 1, "corrections": 0, "threat": "HIGH", "incident": "NEW" },
  "guidance": { "suggestedStatus": "STATUS:DISPATCH_POLICE", "supportPackage": ["POLICE", "TACTICAL"] },
  "review": {
    "outcome": "confirmed",
    "operator_status": "STATUS:DISPATCH_POLICE",
    "support_package": ["POLICE"],
    "reason_codes": [],
    "notes": "",
    "reviewed_at": "2026-06-01T12:01:00.000Z"
  }
}
```

The audit store holds up to 50 cases (FIFO). Export at any time via the `EXPORT JSON` button.

---

## Tests

```bash
npm test
```

```
src/lib/__tests__/jfp-core.test.js

  Constants                     12 passed
  storageKey()                   3 passed
  simpleHash()                   4 passed
  isLocalProvider()              5 passed
  getProvider()                  4 passed
  createCaseId()                 3 passed
  stripCodeFences()              4 passed
  statusColor()                  7 passed
  lineColor()                   12 passed
  buildSystemPrompt()            6 passed
  parseJfp()                    21 passed
  modulesForStatus()            10 passed
  buildOperatorGuidance()        8 passed
  Audit case management          6 passed

  109 passed
```

Tests cover all pure JFP logic: parsing, status determination, POLICE→TACTICAL upgrade, audit case management, and all helper functions.

---

## Project structure

```
src/
├── App.jsx                  Main React component — UI, state, API calls
├── main.jsx                 React root entry point
└── lib/
    ├── jfp-core.js          Pure JFP logic (constants, parser, decision engine)
    └── __tests__/
        └── jfp-core.test.js 109 unit tests

electron/
├── main.cjs                 Electron main process — BrowserWindow setup
├── dev-runner.cjs           Dev launcher — finds free port, starts Vite + Electron
└── dev-launcher.cjs         Dev launcher variant for CI/scripted environments

public/
└── logo.png                 Application icon

index.html                   Vite entry point
vite.config.js               Vite + Vitest config
package.json                 Dependencies and scripts
```

---

## License

MIT

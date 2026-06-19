import { useEffect, useRef, useState } from "react";
import {
  JFP_VERSION, FINAL_STATUS, STAGES, MODULES, PROVIDERS, REASON_CODES, SUPPORT_OPTIONS,
  storageKey, getProvider, createCaseId, simpleHash, isLocalProvider,
  buildSystemPrompt, parseJfp, modulesForStatus, buildOperatorGuidance,
  statusColor, lineColor, loadAuditCases, upsertAuditCase,
} from "./lib/jfp-core.js";

// ─── API helpers (fetch-dependent) ───────────────────────────────────────────

async function safeJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`HTTP_${response.status}: ${text.slice(0, 180)}`);
  }
}

function localHeaders(apiKey) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
    headers["x-api-key"] = apiKey;
  }
  return headers;
}

async function detectLocalProvider(provider, apiKey, customUrl) {
  const baseUrl = customUrl || localStorage.getItem(storageKey("url", provider.id)) || provider.defaultUrl;
  const headers = localHeaders(apiKey);
  const candidates = [`${baseUrl}/models`, `${baseUrl.replace(/\/v1$/, "")}/v1/models`];

  let lastError = null;
  for (const url of candidates) {
    try {
      const response = await fetch(url, { headers });
      const data = await safeJson(response);
      if (response.status === 401) throw new Error("AUTH REQUIRED");
      if (data.error) throw new Error(data.error.message || "Local endpoint error");
      const models = Array.isArray(data.data) ? data.data : [];
      const picked = models.find((model) => /vision|vl|llava|pixtral|gemma|qwen/i.test(model.id)) || models[0];
      if (!picked) throw new Error("NO MODELS");
      return { url: baseUrl, model: picked.id };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("DETECTION FAILED");
}

async function testProviderConnection(provider, apiKey, customUrl) {
  if (isLocalProvider(provider)) {
    const detected = await detectLocalProvider(provider, apiKey, customUrl);
    return { status: "CONNECTED", detail: `MODEL DETECTED: ${detected.model}`, url: detected.url, model: detected.model };
  }

  if (!apiKey.trim()) {
    throw new Error("AUTH REQUIRED");
  }

  if (provider.apiType === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: 8,
        messages: [{ role: "user", content: [{ type: "text", text: "PING" }] }],
      }),
    });
    if (response.status === 401) throw new Error("AUTH REQUIRED");
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return { status: "CONNECTED", detail: `MODEL READY: ${provider.model}` };
  }

  if (provider.apiType === "groq" || provider.apiType === "openrouter") {
    const url = provider.apiType === "groq" ? "https://api.groq.com/openai/v1/models" : "https://openrouter.ai/api/v1/models";
    const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    const data = await safeJson(response);
    if (response.status === 401) throw new Error("AUTH REQUIRED");
    if (data.error) throw new Error(data.error.message || `HTTP_${response.status}`);
    const models = Array.isArray(data.data) ? data.data.map((item) => item.id) : [];
    if (provider.apiType === "groq" && models.length > 0 && !models.includes(provider.model)) {
      throw new Error(`MODEL UNAVAILABLE: ${provider.model}`);
    }
    return { status: "CONNECTED", detail: `MODEL READY: ${provider.model}` };
  }

  if (provider.apiType === "gemini") {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (response.status === 401 || response.status === 403) throw new Error("AUTH REQUIRED");
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return { status: "CONNECTED", detail: `MODEL READY: ${provider.model}` };
  }

  throw new Error("Unsupported provider");
}

async function callAPI(provider, apiKey, base64Image, mime, customUrl, detectedModel) {
  const system = buildSystemPrompt();

  if (provider.apiType === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: 1600,
        system,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mime, data: base64Image } },
            { type: "text", text: "ANALYZE IMAGE. OUTPUT ONLY JFP v5.2 fields." },
          ],
        }],
      }),
    });
    const data = await safeJson(response);
    if (data.error) throw new Error(data.error.message);
    return data.content?.[0]?.text || "";
  }

  if (provider.apiType === "groq") {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: 1600,
        messages: [
          { role: "system", content: system },
          { role: "user", content: [{ type: "image_url", image_url: { url: `data:${mime};base64,${base64Image}` } }, { type: "text", text: "ANALYZE IMAGE. OUTPUT ONLY JFP v5.2 fields." }] },
        ],
      }),
    });
    const data = await safeJson(response);
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    return data.choices?.[0]?.message?.content || "";
  }

  if (provider.apiType === "gemini") {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${provider.model}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ inline_data: { mime_type: mime, data: base64Image } }, { text: "ANALYZE IMAGE. OUTPUT ONLY JFP v5.2 fields." }] }],
        generationConfig: { maxOutputTokens: 1200 },
      }),
    });
    const data = await safeJson(response);
    if (data.error) throw new Error(data.error.message);
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  if (provider.apiType === "openrouter") {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: 1600,
        messages: [
          { role: "system", content: system },
          { role: "user", content: [{ type: "image_url", image_url: { url: `data:${mime};base64,${base64Image}` } }, { type: "text", text: "ANALYZE IMAGE. OUTPUT ONLY JFP v5.2 fields." }] },
        ],
      }),
    });
    const data = await safeJson(response);
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    return data.choices?.[0]?.message?.content || "";
  }

  const localModel = detectedModel || provider.model;
  const baseUrl = customUrl || localStorage.getItem(storageKey("url", provider.id)) || provider.defaultUrl;
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: localHeaders(apiKey),
    body: JSON.stringify({
      model: localModel,
      max_tokens: 1600,
      messages: [
        { role: "system", content: system },
        { role: "user", content: [{ type: "image_url", image_url: { url: `data:${mime};base64,${base64Image}` } }, { type: "text", text: "ANALYZE IMAGE. OUTPUT ONLY JFP v5.2 fields." }] },
      ],
    }),
  });
  const data = await safeJson(response);
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.choices?.[0]?.message?.content || "";
}

// ─── Image helper (Canvas API) ────────────────────────────────────────────────

async function resizeImage(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const max = 768;
      let { width, height } = img;
      if (width > height && width > max) {
        height = Math.round((height * max) / width);
        width = max;
      } else if (height > max) {
        width = Math.round((width * max) / height);
        height = max;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.88).split(",")[1]);
    };
    img.onerror = () => resolve(dataUrl.split(",")[1]);
    img.src = dataUrl;
  });
}

// ─── React components ─────────────────────────────────────────────────────────

function TLine({ text, color = "#4fc3f7" }) {
  return <div style={{ fontFamily: "'Courier New',monospace", fontSize: "13px", color, lineHeight: "1.65", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{text}</div>;
}

function Stage({ stage, active, done }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", flex: 1 }}>
      <div style={{
        width: "46px",
        height: "46px",
        borderRadius: "4px",
        border: `2px solid ${done || active ? "#4fc3f7" : "#1e3a4a"}`,
        background: done ? "#0a2535" : active ? "#071c28" : "#050f15",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "13px",
        fontFamily: "'Courier New',monospace",
        color: done || active ? "#4fc3f7" : "#1e3a4a",
        position: "relative",
        boxShadow: active ? "0 0 10px #4fc3f755" : "none",
      }}>
        {done ? "✓" : stage.short}
      </div>
      <div style={{ fontSize: "8px", fontFamily: "'Courier New',monospace", color: done || active ? "#4fc3f7" : "#1e3a4a", textAlign: "center", letterSpacing: "1px" }}>{stage.id}</div>
    </div>
  );
}

function ModuleCard({ module, active, lines }) {
  return (
    <div style={{ border: `1px solid ${active ? module.color : "#0a2535"}`, borderRadius: "5px", padding: "9px", background: active ? `${module.color}11` : "#050f15", boxShadow: active ? `0 0 16px ${module.glow}` : "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span style={{ fontSize: "15px", filter: active ? "none" : "grayscale(1) opacity(0.2)" }}>{module.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "'Courier New',monospace", fontSize: "11px", fontWeight: "bold", color: active ? module.color : "#1e3a4a", letterSpacing: "2px" }}>{module.id}</div>
          <div style={{ fontFamily: "'Courier New',monospace", fontSize: "8px", color: active ? `${module.color}99` : "#0a2535" }}>{module.desc}</div>
        </div>
      </div>
      {active && lines.length > 0 && (
        <div style={{ marginTop: "7px", background: "#030a10", borderRadius: "3px", padding: "6px" }}>
          {lines.map((line, index) => <TLine key={`${module.id}_${index}`} text={line} color={module.color} />)}
        </div>
      )}
    </div>
  );
}

function ReasonChip({ code, active, onToggle }) {
  return (
    <button
      onClick={() => onToggle(code)}
      style={{
        padding: "6px 8px",
        borderRadius: "999px",
        border: `1px solid ${active ? "#facc15" : "#1e3a4a"}`,
        background: active ? "#facc1522" : "#030a10",
        color: active ? "#facc15" : "#1e3a4a",
        cursor: "pointer",
        fontFamily: "'Courier New',monospace",
        fontSize: "10px",
        letterSpacing: "1px",
      }}
    >
      {code}
    </button>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [providerId, setProviderId] = useState(() => localStorage.getItem(storageKey("provider")) || "groq");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [localUrl, setLocalUrl] = useState("");
  const [detectedModel, setDetectedModel] = useState("");
  const [connectionStatus, setConnectionStatus] = useState(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [running, setRunning] = useState(false);
  const [image, setImage] = useState(null);
  const [imageBase64, setImageBase64] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [jfpOutput, setJfpOutput] = useState([]);
  const [finalStatus, setFinalStatus] = useState(FINAL_STATUS.NONE);
  const [metrics, setMetrics] = useState(null);
  const [stageIdx, setStageIdx] = useState(-1);
  const [done, setDone] = useState([]);
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(null);
  const [liveElapsed, setLiveElapsed] = useState(0);
  const [activeModules, setActiveModules] = useState([]);
  const [moduleLines, setModuleLines] = useState({});
  const [caseSummary, setCaseSummary] = useState(null);
  const [currentCase, setCurrentCase] = useState(null);
  const [auditCases, setAuditCases] = useState(() => loadAuditCases());
  const [operatorStatus, setOperatorStatus] = useState("");
  const [operatorSupport, setOperatorSupport] = useState([]);
  const [selectedReasons, setSelectedReasons] = useState([]);
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewSaved, setReviewSaved] = useState(false);

  const provider = getProvider(providerId);
  const termRef = useRef(null);
  const fileRef = useRef(null);
  const startRef = useRef(0);

  useEffect(() => {
    localStorage.setItem(storageKey("provider"), providerId);
    setApiKey(localStorage.getItem(storageKey("key", providerId)) || "");
    setLocalUrl(localStorage.getItem(storageKey("url", providerId)) || getProvider(providerId).defaultUrl || "");
    setDetectedModel(localStorage.getItem(storageKey("model", providerId)) || "");
    setConnectionStatus(null);
  }, [providerId]);

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => {
      setLiveElapsed(Date.now() - startRef.current);
    }, 100);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (currentCase?.suggested_status) {
      setOperatorStatus(currentCase.suggested_status);
      setOperatorSupport(currentCase.guidance?.supportPackage || []);
      setSelectedReasons([]);
      setReviewNotes("");
      setReviewSaved(false);
    }
  }, [currentCase?.case_id, currentCase?.suggested_status]);

  function push(lines) {
    setJfpOutput((current) => {
      const next = [...current, ...(Array.isArray(lines) ? lines : [lines])];
      setTimeout(() => {
        if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
      }, 10);
      return next;
    });
  }

  function toggleReason(code) {
    setSelectedReasons((current) => (
      current.includes(code) ? current.filter((item) => item !== code) : [...current, code]
    ));
  }

  function toggleSupport(service) {
    setOperatorSupport((current) => (
      current.includes(service) ? current.filter((item) => item !== service) : [...current, service]
    ));
  }

  function exportAudit() {
    const blob = new Blob([JSON.stringify(auditCases, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "viki_ueact_audit.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function submitReview(reviewOutcome, forcedStatus = null) {
    if (!currentCase) return;

    const nextOperatorStatus = forcedStatus || operatorStatus || currentCase.suggested_status;
    const nextSupportPackage = [...operatorSupport];

    const updatedCase = {
      ...currentCase,
      review: {
        outcome: reviewOutcome,
        operator_status: nextOperatorStatus,
        support_package: nextSupportPackage,
        reason_codes: selectedReasons,
        notes: reviewNotes.trim(),
        reviewed_at: new Date().toISOString(),
      },
      correction_candidate: selectedReasons.length > 0 ? {
        created: true,
        source_case_id: currentCase.case_id,
        suggested_effect: selectedReasons.join("+"),
      } : { created: false },
    };

    setCurrentCase(updatedCase);
    setAuditCases(upsertAuditCase(updatedCase));
    setFinalStatus(nextOperatorStatus);
    setReviewSaved(true);
  }

  async function handleFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const dataUrl = event.target.result;
      setImage(dataUrl);
      setImageBase64(await resizeImage(dataUrl));
      setError(null);
      setJfpOutput([]);
      setFinalStatus(FINAL_STATUS.NONE);
      setMetrics(null);
      setCaseSummary(null);
      setCurrentCase(null);
      setActiveModules([]);
      setModuleLines({});
      setStageIdx(-1);
      setDone([]);
      setElapsed(null);
      setLiveElapsed(0);
      setReviewSaved(false);
    };
    reader.readAsDataURL(file);
  }

  async function handleDetectLocal() {
    setTestingConnection(true);
    setConnectionStatus(null);
    try {
      const detected = await detectLocalProvider(provider, apiKey.trim(), localUrl.trim() || provider.defaultUrl);
      setDetectedModel(detected.model);
      setLocalUrl(detected.url);
      localStorage.setItem(storageKey("url", provider.id), detected.url);
      localStorage.setItem(storageKey("model", provider.id), detected.model);
      setConnectionStatus({ tone: "#22c55e", text: `CONNECTED — MODEL DETECTED: ${detected.model}` });
    } catch (connectionError) {
      setConnectionStatus({ tone: "#ef4444", text: `FAILED — ${connectionError.message}` });
    } finally {
      setTestingConnection(false);
    }
  }

  async function handleTestConnection() {
    setTestingConnection(true);
    setConnectionStatus(null);
    try {
      const result = await testProviderConnection(provider, apiKey.trim(), localUrl.trim() || provider.defaultUrl);
      if (result.url) {
        setLocalUrl(result.url);
        localStorage.setItem(storageKey("url", provider.id), result.url);
      }
      if (result.model) {
        setDetectedModel(result.model);
        localStorage.setItem(storageKey("model", provider.id), result.model);
      }
      setConnectionStatus({ tone: "#22c55e", text: `${result.status} — ${result.detail}` });
    } catch (connectionError) {
      setConnectionStatus({ tone: "#ef4444", text: `FAILED — ${connectionError.message}` });
    } finally {
      setTestingConnection(false);
    }
  }

  async function run() {
    if (!imageBase64 || running) return;
    if (!provider.builtIn && !apiKey.trim()) {
      setError(`MISSING: Enter ${provider.name} API key`);
      return;
    }

    const activeUrl = localUrl.trim() || provider.defaultUrl || "";
    localStorage.setItem(storageKey("key", provider.id), apiKey);
    if (activeUrl) localStorage.setItem(storageKey("url", provider.id), activeUrl);

    setRunning(true);
    setError(null);
    setElapsed(null);
    setLiveElapsed(0);
    setJfpOutput([]);
    setDone([]);
    setStageIdx(0);
    setCurrentCase(null);
    setReviewSaved(false);
    startRef.current = Date.now();

    try {
      push([
        `=== VIKI_VISION_UEACT JFP ${JFP_VERSION} ===`,
        `F:PROVIDER:${provider.name.toUpperCase()};`,
        `F:MODEL:${(detectedModel || provider.model).toUpperCase()};`,
        "F:ENGINE:UEACT_DECISION_LAYER;",
        "F:MODE:FINAL_STATUS_ONLY;",
        "",
      ]);

      setDone([0]);
      setStageIdx(1);

      const rawOutput = await callAPI(provider, apiKey.trim(), imageBase64, "image/jpeg", activeUrl, detectedModel);
      const parsed = parseJfp(rawOutput);

      push(["--- FACT_LAYER ---", ...parsed.lines.filter((line) => line.startsWith("F:OBJECT:") || line.startsWith("F:RELATION:") || line.startsWith("F:ROLE:"))]);

      setDone([0, 1]);
      setStageIdx(2);
      push(["", "--- QUALITY_LAYER ---", ...parsed.lines.filter((line) => line.startsWith("F:UNCERTAINTY:") || line.startsWith("F:UNCERTAINTY_REASON:") || line.startsWith("F:SCENE_QUALITY:") || line.startsWith("F:ATOM_ERROR:"))]);

      setDone([0, 1, 2]);
      setStageIdx(3);
      push(["", "--- CORRECTION_LAYER ---", ...(parsed.corrections.length > 0 ? parsed.corrections : ["F:RULE_HIT:NONE;"])]);

      setDone([0, 1, 2, 3]);
      setStageIdx(4);
      push(["", "--- DECISION_LAYER ---", ...parsed.lines.filter((line) => line.startsWith("F:SCENE:") || line.startsWith("F:THREAT_LEVEL:") || line.startsWith("F:FIRE_DETECTED:") || line.startsWith("F:MEDICAL_EMERGENCY:") || line.startsWith("F:WEAPONS_DETECTED:") || line.startsWith("F:INCIDENT_CONTEXT:") || line.startsWith("F:DECISION_TRACE:") || line.startsWith("STATUS:"))]);

      setDone([0, 1, 2, 3, 4]);
      setStageIdx(5);

      const ms = Date.now() - startRef.current;
      const modules = modulesForStatus(parsed.status, parsed.scene);
      const summary = {
        atoms: parsed.metrics.atoms,
        relations: parsed.metrics.relations,
        roles: parsed.metrics.roles,
        corrections: parsed.metrics.corrections,
        uncertainty: parsed.metrics.highUncertainty ? "HIGH" : "LOW/MEDIUM",
        threat: parsed.scene.threatLevel,
        incident: parsed.scene.incidentContext,
      };

      setFinalStatus(parsed.status);
      setActiveModules(modules);
      setModuleLines({
        TACTICAL: parsed.status === FINAL_STATUS.TACTICAL || parsed.status === FINAL_STATUS.POLICE || parsed.status === FINAL_STATUS.REVIEW ? [`F:STATUS:${parsed.status.replace("STATUS:", "")};`, `F:THREAT_LEVEL:${parsed.scene.threatLevel};`] : [],
        POLICE: parsed.status === FINAL_STATUS.POLICE || parsed.status === FINAL_STATUS.TACTICAL || parsed.scene.weaponsDetected === "YES" ? [`F:WEAPONS_DETECTED:${parsed.scene.weaponsDetected};`, `F:INCIDENT_CONTEXT:${parsed.scene.incidentContext};`] : [],
        MEDICAL: parsed.status === FINAL_STATUS.MEDICAL || parsed.scene.medicalEmergency === "YES" ? [`F:MEDICAL_EMERGENCY:${parsed.scene.medicalEmergency};`, `F:STATUS:${parsed.status.replace("STATUS:", "")};`] : [],
        FIRE: parsed.status === FINAL_STATUS.FIRE || parsed.scene.fireDetected === "YES" ? [`F:FIRE_DETECTED:${parsed.scene.fireDetected};`, `F:INCIDENT_CONTEXT:${parsed.scene.incidentContext};`] : [],
      });
      setMetrics({ ...summary, elapsed: ms });
      setCaseSummary(summary);
      setElapsed(ms);

      const auditCase = {
        case_id: createCaseId(),
        created_at: new Date().toISOString(),
        provider_id: provider.id,
        provider_name: provider.name,
        model_id: detectedModel || provider.model,
        jfp_version: JFP_VERSION,
        engine_version: "UEACT_MVP_1",
        input_type: "image",
        image_hash: simpleHash(imageBase64),
        suggested_status: parsed.status,
        raw_output: rawOutput,
        final_output: parsed.lines,
        decision_trace: parsed.lines.find((line) => line.startsWith("F:DECISION_TRACE:")) || "F:DECISION_TRACE:UNAVAILABLE;",
        uncertainty: parsed.lines.find((line) => line.startsWith("F:UNCERTAINTY:")) || "F:UNCERTAINTY:LOW;",
        uncertainty_reason: parsed.lines.find((line) => line.startsWith("F:UNCERTAINTY_REASON:")) || "",
        scene_quality: parsed.lines.find((line) => line.startsWith("F:SCENE_QUALITY:")) || "F:SCENE_QUALITY:ACCEPTABLE;",
        atom_errors: parsed.lines.filter((line) => line.startsWith("F:ATOM_ERROR:")),
        summary,
        guidance: buildOperatorGuidance(parsed.scene, parsed.status),
        review: {
          outcome: "pending",
          operator_status: parsed.status,
          support_package: buildOperatorGuidance(parsed.scene, parsed.status).supportPackage,
          reason_codes: [],
          notes: "",
          reviewed_at: null,
        },
      };

      setCurrentCase(auditCase);
      setAuditCases(upsertAuditCase(auditCase));

      push(["", "--- OUTPUT_COMPLETE ---", `F:ELAPSED:${ms}ms;`, "END_JFP;"]);
      setDone([0, 1, 2, 3, 4, 5]);
    } catch (runError) {
      setError(`⚡ ERROR: ${runError.message}`);
      setFinalStatus(FINAL_STATUS.REVIEW);
      const failureLines = [
        "F:UNCERTAINTY:HIGH;",
        "F:UNCERTAINTY_REASON:MODEL_OUTPUT_INVALID;",
        "F:SCENE_QUALITY:INVALID;",
        "F:DECISION_TRACE:TECHNICAL_FAILURE;",
        `${FINAL_STATUS.REVIEW};`,
      ];
      push(failureLines);

      const failedGuidance = buildOperatorGuidance({ fireDetected: "NO", medicalEmergency: "NO", weaponsDetected: "NO", threatLevel: "LOW", incidentContext: "UNKNOWN" }, FINAL_STATUS.REVIEW);
      const failedCase = {
        case_id: createCaseId(),
        created_at: new Date().toISOString(),
        provider_id: provider.id,
        provider_name: provider.name,
        model_id: detectedModel || provider.model,
        jfp_version: JFP_VERSION,
        engine_version: "UEACT_MVP_1",
        input_type: "image",
        image_hash: imageBase64 ? simpleHash(imageBase64) : "UNAVAILABLE",
        suggested_status: FINAL_STATUS.REVIEW,
        raw_output: "",
        final_output: failureLines,
        decision_trace: "F:DECISION_TRACE:TECHNICAL_FAILURE;",
        uncertainty: "F:UNCERTAINTY:HIGH;",
        uncertainty_reason: "F:UNCERTAINTY_REASON:MODEL_OUTPUT_INVALID;",
        scene_quality: "F:SCENE_QUALITY:INVALID;",
        atom_errors: [],
        summary: { atoms: 0, relations: 0, roles: 0, corrections: 0, uncertainty: "HIGH", threat: "LOW", incident: "UNKNOWN" },
        guidance: failedGuidance,
        review: {
          outcome: "pending",
          operator_status: FINAL_STATUS.REVIEW,
          support_package: failedGuidance.supportPackage,
          reason_codes: [],
          notes: "",
          reviewed_at: null,
        },
      };
      setCurrentCase(failedCase);
      setAuditCases(upsertAuditCase(failedCase));
    } finally {
      setRunning(false);
      if (!elapsed) setElapsed(Date.now() - startRef.current);
    }
  }

  return (
    <div style={{ height: "100vh", overflowY: "auto", background: "#030a10", color: "#4fc3f7", fontFamily: "'Courier New',monospace", padding: "18px" }}>
      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.2}}
        ::-webkit-scrollbar{width:8px;height:8px}
        ::-webkit-scrollbar-track{background:#030a10}
        ::-webkit-scrollbar-thumb{background:#1e3a4a;border-radius:8px}
        ::-webkit-scrollbar-thumb:hover{background:#2a5870}
      `}</style>

      <div style={{ textAlign: "center", marginBottom: "10px" }}>
        <div style={{ fontSize: "10px", letterSpacing: "5px", color: "#1e3a4a" }}>ECO TECH VICTORIA LTD — UEACT BUILD</div>
        <div style={{ fontSize: "28px", fontWeight: "bold", letterSpacing: "8px", color: "#4fc3f7", textShadow: "0 0 25px #4fc3f755" }}>
          VIKI<span style={{ color: "#ef4444" }}>_</span>VISION
          <span style={{ fontSize: "13px", letterSpacing: "3px", color: "#facc15", marginLeft: "10px" }}>UEACT</span>
          <span style={{ fontSize: "11px", color: "#94a3b8", marginLeft: "8px" }}>JFP {JFP_VERSION}</span>
        </div>
        <div style={{ height: "1px", background: "linear-gradient(90deg,transparent,#4fc3f7,transparent)", margin: "8px auto", maxWidth: "500px" }} />
      </div>

      <div style={{ maxWidth: "1480px", margin: "0 auto 14px" }}>
        <div style={{ background: "#050f15", border: "1px solid #0a2535", borderRadius: "6px", padding: "10px" }}>
          <div style={{ fontSize: "10px", letterSpacing: "3px", color: "#1e3a4a", marginBottom: "9px" }}>SELECT PROVIDER</div>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "8px" }}>
            {PROVIDERS.map((item) => (
              <button
                key={item.id}
                onClick={() => setProviderId(item.id)}
                style={{
                  padding: "6px 12px",
                  borderRadius: "4px",
                  cursor: "pointer",
                  border: `1px solid ${providerId === item.id ? item.color : "#1e3a4a"}`,
                  background: providerId === item.id ? `${item.color}22` : "#030a10",
                  color: providerId === item.id ? item.color : "#1e3a4a",
                  fontFamily: "'Courier New',monospace",
                  fontSize: "12px",
                  fontWeight: "bold",
                  letterSpacing: "1px",
                }}
              >
                {item.name} <span style={{ fontSize: "10px", opacity: 0.6 }}>{item.label}</span>
              </button>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: isLocalProvider(provider) ? "1fr 1fr auto auto auto" : "1fr auto auto", gap: "8px", alignItems: "center" }}>
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={provider.builtIn ? `${provider.name} token (optional)` : `${provider.name} API key`}
              style={{ padding: "10px 12px", background: "#030a10", border: `1px solid ${apiKey ? provider.color : "#1e3a4a"}`, borderRadius: "4px", color: provider.color, fontFamily: "'Courier New',monospace", fontSize: "12px", outline: "none" }}
            />
            {isLocalProvider(provider) && (
              <input
                value={localUrl}
                onChange={(event) => setLocalUrl(event.target.value)}
                placeholder={provider.defaultUrl}
                style={{ padding: "10px 12px", background: "#030a10", border: "1px solid #1e3a4a", borderRadius: "4px", color: "#7dd3f0", fontFamily: "'Courier New',monospace", fontSize: "12px", outline: "none" }}
              />
            )}
            <button onClick={() => setShowKey((current) => !current)} style={{ padding: "10px 12px", background: "#030a10", border: "1px solid #1e3a4a", borderRadius: "4px", color: "#1e3a4a", cursor: "pointer", fontFamily: "'Courier New',monospace", fontSize: "11px" }}>
              {showKey ? "HIDE" : "SHOW"}
            </button>
            {isLocalProvider(provider) && (
              <button onClick={handleDetectLocal} disabled={testingConnection} style={{ padding: "10px 12px", background: "#030a10", border: `1px solid ${provider.color}`, borderRadius: "4px", color: provider.color, cursor: "pointer", fontFamily: "'Courier New',monospace", fontSize: "11px" }}>
                {testingConnection ? "DETECT..." : "AUTO DETECT"}
              </button>
            )}
            <button onClick={handleTestConnection} disabled={testingConnection} style={{ padding: "10px 12px", background: "#030a10", border: `1px solid ${provider.color}`, borderRadius: "4px", color: provider.color, cursor: "pointer", fontFamily: "'Courier New',monospace", fontSize: "11px" }}>
              {testingConnection ? "TEST..." : "TEST CONNECTION"}
            </button>
          </div>

          {connectionStatus && (
            <div style={{ marginTop: "10px", fontSize: "11px", color: connectionStatus.tone }}>
              {connectionStatus.text}
              {detectedModel && isLocalProvider(provider) ? ` · MODEL: ${detectedModel}` : ""}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(560px, 0.95fr) minmax(760px, 1.25fr)", gap: "14px", maxWidth: "1480px", margin: "0 auto" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => { event.preventDefault(); setDragOver(false); handleFile(event.dataTransfer.files[0]); }}
            style={{ border: `2px dashed ${dragOver ? "#4fc3f7" : image ? "#1e6a8a" : "#1e3a4a"}`, borderRadius: "6px", padding: "12px", textAlign: "center", cursor: "pointer", background: dragOver ? "#071c28" : "#050f15", minHeight: "140px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}
          >
            {image ? (
              <>
                <img src={image} alt="frame" style={{ maxHeight: "110px", maxWidth: "100%", objectFit: "contain", borderRadius: "4px", marginBottom: "5px" }} />
                <div style={{ fontSize: "10px", color: "#1e6a8a", letterSpacing: "2px" }}>FRAME LOADED — CLICK TO CHANGE</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: "26px", opacity: 0.15, marginBottom: "6px" }}>◎</div>
                <div style={{ fontSize: "13px", color: "#1e3a4a", letterSpacing: "2px" }}>DROP FRAME HERE</div>
                <div style={{ fontSize: "10px", color: "#0a2535", marginTop: "4px" }}>OR CLICK TO SELECT</div>
              </>
            )}
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(event) => handleFile(event.target.files[0])} />
          </div>

          <div style={{ background: "#050f15", border: "1px solid #0a2535", borderRadius: "6px", padding: "10px" }}>
            <div style={{ fontSize: "10px", letterSpacing: "3px", color: "#1e3a4a", marginBottom: "10px" }}>PIPELINE — JFP {JFP_VERSION}</div>
            <div style={{ display: "flex", gap: "4px", marginBottom: "10px" }}>
              {STAGES.map((stage, index) => <Stage key={stage.id} stage={stage} active={stageIdx === index} done={done.includes(index)} />)}
            </div>
            <button
              onClick={run}
              disabled={!imageBase64 || running}
              style={{
                width: "100%",
                padding: "14px",
                background: running ? "#071c28" : imageBase64 ? provider.color : "#050f15",
                border: `1px solid ${imageBase64 ? provider.color : "#1e3a4a"}`,
                borderRadius: "4px",
                color: running ? provider.color : imageBase64 ? "#030a10" : "#1e3a4a",
                fontFamily: "'Courier New',monospace",
                fontSize: "14px",
                fontWeight: "bold",
                letterSpacing: "3px",
                cursor: imageBase64 && !running ? "pointer" : "not-allowed",
              }}
            >
              {running ? `⚡ ${provider.name.toUpperCase()} PROCESSING... ${liveElapsed}ms` : imageBase64 ? `⚡ EXECUTE [${provider.name.toUpperCase()}]` : "— LOAD FRAME —"}
            </button>
            {error && <div style={{ marginTop: "8px", fontSize: "10px", color: "#ef4444", wordBreak: "break-word" }}>{error}</div>}
          </div>

          <div style={{ background: `${statusColor(finalStatus)}11`, border: `1px solid ${statusColor(finalStatus)}`, borderRadius: "6px", padding: "10px" }}>
            <div style={{ fontSize: "10px", letterSpacing: "3px", color: `${statusColor(finalStatus)}cc`, marginBottom: "6px" }}>FINAL STATUS</div>
            <div style={{ fontSize: "20px", fontWeight: "bold", color: statusColor(finalStatus), letterSpacing: "2px" }}>{finalStatus.replace("STATUS:", "")}</div>
            {caseSummary && (
              <div style={{ fontSize: "11px", color: "#cbd5e1", marginTop: "6px", lineHeight: "1.7" }}>
                THREAT {caseSummary.threat} · INCIDENT {caseSummary.incident} · ATOMS {caseSummary.atoms} · CORRECTIONS {caseSummary.corrections}
              </div>
            )}
          </div>

          {metrics && (
            <div style={{ background: "#050f15", border: "1px solid #0a2535", borderRadius: "6px", padding: "10px" }}>
              <div style={{ fontSize: "10px", letterSpacing: "3px", color: "#1e3a4a", marginBottom: "8px" }}>UEACT METRICS</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "4px" }}>
                {[
                  ["ATOMS", metrics.atoms, "#22c55e"],
                  ["RELATIONS", metrics.relations, "#818cf8"],
                  ["ROLES", metrics.roles, "#fb923c"],
                  ["CORRECTIONS", metrics.corrections, "#e879f9"],
                  ["UNCERTAINTY", metrics.uncertainty, "#facc15"],
                  ["ELAPSED", `${metrics.elapsed}ms`, "#facc15"],
                ].map(([label, value, color]) => (
                  <div key={label} style={{ background: "#030a10", borderRadius: "3px", padding: "6px" }}>
                    <div style={{ fontSize: "8px", color: "#1e3a4a", letterSpacing: "1px" }}>{label}</div>
                    <div style={{ fontSize: "15px", color, fontWeight: "bold" }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {currentCase && (
            <div style={{ background: "#050f15", border: "1px solid #0a2535", borderRadius: "6px", padding: "10px" }}>
              <div style={{ fontSize: "10px", letterSpacing: "3px", color: "#1e3a4a", marginBottom: "8px" }}>OPERATOR REVIEW</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
                <div style={{ background: "#030a10", borderRadius: "4px", padding: "8px" }}>
                  <div style={{ fontSize: "8px", color: "#1e3a4a", marginBottom: "4px" }}>SYSTEM SUGGESTION</div>
                  <div style={{ fontSize: "12px", color: statusColor(currentCase.suggested_status), fontWeight: "bold" }}>{currentCase.suggested_status.replace("STATUS:", "")}</div>
                  <div style={{ fontSize: "10px", color: "#94a3b8", marginTop: "5px", lineHeight: "1.6" }}>{currentCase.decision_trace}</div>
                  {currentCase.guidance?.supportPackage?.length > 0 && (
                    <div style={{ marginTop: "8px" }}>
                      <div style={{ fontSize: "8px", color: "#f59e0b", marginBottom: "4px", letterSpacing: "2px" }}>VIKI SUPPORT PACKAGE</div>
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                        {currentCase.guidance.supportPackage.map((item) => (
                          <span
                            key={item}
                            style={{
                              padding: "4px 8px",
                              borderRadius: "999px",
                              border: "1px solid #f59e0b",
                              background: "#f59e0b14",
                              color: "#fbbf24",
                              fontSize: "10px",
                              letterSpacing: "1px",
                            }}
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ background: "#030a10", borderRadius: "4px", padding: "8px" }}>
                  <div style={{ fontSize: "8px", color: "#1e3a4a", marginBottom: "4px" }}>AUDIT</div>
                  <div style={{ fontSize: "10px", color: "#94a3b8" }}>CASE {currentCase.case_id}</div>
                  <div style={{ fontSize: "10px", color: "#94a3b8" }}>{currentCase.image_hash}</div>
                  <div style={{ fontSize: "10px", color: "#94a3b8" }}>{currentCase.provider_name} · {currentCase.model_id}</div>
                </div>
              </div>

              <div style={{ marginBottom: "8px" }}>
                <div style={{ fontSize: "8px", color: "#1e3a4a", marginBottom: "5px", letterSpacing: "2px" }}>OPERATOR FINAL STATUS</div>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {Object.values(FINAL_STATUS).map((status) => (
                    <button
                      key={status}
                      onClick={() => setOperatorStatus(status)}
                      title={currentCase.suggested_status === status ? "VIKI suggested status" : ""}
                      style={{
                        padding: "6px 10px",
                        borderRadius: "4px",
                        border: `1px solid ${operatorStatus === status ? statusColor(status) : currentCase.suggested_status === status ? "#f59e0b" : "#1e3a4a"}`,
                        background: operatorStatus === status ? `${statusColor(status)}22` : currentCase.suggested_status === status ? "#f59e0b14" : "#030a10",
                        color: operatorStatus === status ? statusColor(status) : currentCase.suggested_status === status ? "#fbbf24" : "#1e3a4a",
                        cursor: "pointer",
                        fontFamily: "'Courier New',monospace",
                        fontSize: "10px",
                        boxShadow: currentCase.suggested_status === status ? "0 0 0 1px #f59e0b22 inset" : "none",
                      }}
                    >
                      {status.replace("STATUS:", "")}
                      {currentCase.suggested_status === status ? " *" : ""}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: "10px", color: "#fbbf24", marginTop: "6px" }}>
                  BURSZTYNOWE PODSWIETLENIE = SUGESTIA VIKI DLA OPERATORA
                </div>
              </div>

              <div style={{ marginBottom: "8px" }}>
                <div style={{ fontSize: "8px", color: "#1e3a4a", marginBottom: "5px", letterSpacing: "2px" }}>SUPPORT PACKAGE</div>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {SUPPORT_OPTIONS.map((service) => {
                    const suggested = currentCase.guidance?.supportPackage?.includes(service);
                    const active = operatorSupport.includes(service);
                    return (
                      <button
                        key={service}
                        onClick={() => toggleSupport(service)}
                        title={suggested ? "VIKI suggested support response" : ""}
                        style={{
                          padding: "8px 10px",
                          borderRadius: "999px",
                          border: `1px solid ${active ? "#22c55e" : suggested ? "#f59e0b" : "#1e3a4a"}`,
                          background: active ? "#22c55e22" : suggested ? "#f59e0b14" : "#030a10",
                          color: active ? "#22c55e" : suggested ? "#fbbf24" : "#1e3a4a",
                          cursor: "pointer",
                          fontFamily: "'Courier New',monospace",
                          fontSize: "10px",
                          letterSpacing: "1px",
                          boxShadow: suggested ? "0 0 0 1px #f59e0b22 inset" : "none",
                        }}
                      >
                        {service}{suggested ? " *" : ""}
                      </button>
                    );
                  })}
                </div>
                <div style={{ fontSize: "10px", color: "#94a3b8", marginTop: "6px", lineHeight: "1.5" }}>
                  Primary status wskazuje odpowiedz prowadzaca. Support Package pozwala zaznaczyc wiele sluzb jednoczesnie.
                </div>
              </div>

              <div style={{ marginBottom: "8px" }}>
                <div style={{ fontSize: "8px", color: "#1e3a4a", marginBottom: "5px", letterSpacing: "2px" }}>REASON CODES</div>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {REASON_CODES.map((code) => <ReasonChip key={code} code={code} active={selectedReasons.includes(code)} onToggle={toggleReason} />)}
                </div>
              </div>

              <textarea
                value={reviewNotes}
                onChange={(event) => setReviewNotes(event.target.value)}
                placeholder="Operator notes (optional)"
                style={{ width: "100%", minHeight: "110px", resize: "vertical", padding: "10px", background: "#030a10", border: "1px solid #1e3a4a", borderRadius: "4px", color: "#7dd3f0", fontFamily: "'Courier New',monospace", fontSize: "12px", outline: "none", boxSizing: "border-box" }}
              />

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "8px" }}>
                <button onClick={() => submitReview("confirmed")} style={{ padding: "10px 12px", background: "#030a10", border: "1px solid #22c55e", borderRadius: "4px", color: "#22c55e", cursor: "pointer", fontFamily: "'Courier New',monospace", fontSize: "11px" }}>
                  CONFIRM
                </button>
                <button onClick={() => submitReview("corrected")} style={{ padding: "10px 12px", background: "#030a10", border: "1px solid #facc15", borderRadius: "4px", color: "#facc15", cursor: "pointer", fontFamily: "'Courier New',monospace", fontSize: "11px" }}>
                  SAVE CORRECTION
                </button>
                <button onClick={() => { setOperatorStatus(FINAL_STATUS.REVIEW); submitReview("needs_followup", FINAL_STATUS.REVIEW); }} style={{ padding: "10px 12px", background: "#030a10", border: "1px solid #f97316", borderRadius: "4px", color: "#f97316", cursor: "pointer", fontFamily: "'Courier New',monospace", fontSize: "11px" }}>
                  FORCE HUMAN REVIEW
                </button>
              </div>

              {reviewSaved && (
                <div style={{ marginTop: "8px", fontSize: "11px", color: "#22c55e" }}>
                  REVIEW SAVED — AUDIT UPDATED
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ background: "#050f15", border: "1px solid #0a2535", borderRadius: "6px", padding: "12px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <div style={{ fontSize: "10px", letterSpacing: "3px", color: "#1e3a4a" }}>JFP OUTPUT STREAM</div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "10px", color: "#94a3b8" }}>v{JFP_VERSION}</span>
              <span style={{ fontSize: "10px", color: provider.color }}>{provider.name}</span>
              <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: provider.color, boxShadow: `0 0 4px ${provider.color}` }} />
            </div>
          </div>
          <div
            ref={termRef}
            style={{
              flex: 1,
              background: "#030a10",
              backgroundImage: "url('/logo.png')",
              backgroundRepeat: "no-repeat",
              backgroundPosition: "center",
              backgroundSize: "90%",
              borderRadius: "4px",
              padding: "10px",
              overflowY: "scroll",
              minHeight: "760px",
              maxHeight: "980px",
              border: "1px solid #0a2535",
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(3, 10, 16, 0.8)",
                backdropFilter: "blur(1px)",
                pointerEvents: "none",
                zIndex: 0,
              }}
            />
            <div style={{ position: "relative", zIndex: 1 }}>
              {jfpOutput.length === 0
                ? <div style={{ color: "#1e3a4a", fontSize: "11px" }}><span style={{ animation: "pulse 1s infinite", display: "inline-block" }}>█</span> AWAITING FRAME...</div>
                : jfpOutput.map((line, index) => <TLine key={`${index}_${line}`} text={line} color={lineColor(line, provider.color)} />)}
            </div>
          </div>
          <div style={{ marginTop: "8px", padding: "8px 12px", background: "#030a10", border: "1px solid #0a2535", borderRadius: "4px", display: "flex", justifyContent: "space-between", fontSize: "10px", letterSpacing: "1px", color: "#1e3a4a", flexWrap: "wrap", gap: "4px" }}>
            <span>STAGE: {stageIdx >= 0 && stageIdx < STAGES.length ? STAGES[stageIdx].id : "IDLE"}</span>
            <span>STATUS: <span style={{ color: statusColor(finalStatus) }}>{finalStatus.replace("STATUS:", "")}</span></span>
            <span>MODEL: {detectedModel || provider.model}</span>
            <span style={{ color: running ? provider.color : "#94a3b8" }}>{running ? `⚡ ${liveElapsed}ms` : elapsed ? `● ${elapsed}ms` : "○ STANDBY"}</span>
          </div>

          <div style={{ marginTop: "10px", background: "#030a10", border: "1px solid #0a2535", borderRadius: "4px", padding: "10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <div style={{ fontSize: "10px", letterSpacing: "3px", color: "#1e3a4a" }}>AUDIT STORE</div>
              <button onClick={exportAudit} style={{ padding: "8px 10px", background: "#030a10", border: "1px solid #1e3a4a", borderRadius: "4px", color: "#7dd3f0", cursor: "pointer", fontFamily: "'Courier New',monospace", fontSize: "10px" }}>
                EXPORT JSON
              </button>
            </div>
            <div style={{ maxHeight: "280px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
              {auditCases.length === 0 ? (
                <div style={{ fontSize: "11px", color: "#1e3a4a" }}>NO AUDIT CASES SAVED</div>
              ) : auditCases.map((entry) => (
                <div key={entry.case_id} style={{ background: "#050f15", border: "1px solid #0a2535", borderRadius: "4px", padding: "8px" }}>
                  <div style={{ fontSize: "10px", color: "#7dd3f0" }}>{entry.case_id}</div>
                  <div style={{ fontSize: "10px", color: statusColor(entry.review?.operator_status || entry.suggested_status), marginTop: "2px", lineHeight: "1.5" }}>
                    SYSTEM {entry.suggested_status.replace("STATUS:", "")} · OPERATOR {(entry.review?.operator_status || entry.suggested_status).replace("STATUS:", "")}
                  </div>
                  <div style={{ fontSize: "10px", color: "#fbbf24", marginTop: "2px", lineHeight: "1.5" }}>
                    SUPPORT {(entry.review?.support_package || []).join(" + ") || "NONE"}
                  </div>
                  <div style={{ fontSize: "10px", color: "#94a3b8", marginTop: "2px", lineHeight: "1.5" }}>
                    {entry.provider_name} · {entry.model_id} · REVIEW {(entry.review?.outcome || "pending").toUpperCase()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ textAlign: "center", marginTop: "10px", fontSize: "7px", letterSpacing: "3px", color: "#0a2535" }}>
        VIKI VISION UEACT © 2026 — JFP {JFP_VERSION} — FINAL STATUS ONLY
      </div>
    </div>
  );
}

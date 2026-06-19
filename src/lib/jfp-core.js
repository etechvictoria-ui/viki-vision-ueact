// Pure JFP logic — no React, no DOM, no fetch. Imported by App.jsx and tests.

export const APP_ID = "viki_ueact";
export const JFP_VERSION = "5.2_PRODUCTION";
export const MAX_ATOMS = 12;
export const CONF = { drop: 0.35, warn: 0.5, accept: 0.5 };

export const FINAL_STATUS = {
  FIRE: "STATUS:DISPATCH_FIRE",
  POLICE: "STATUS:DISPATCH_POLICE",
  MEDICAL: "STATUS:DISPATCH_MEDICAL",
  TACTICAL: "STATUS:DISPATCH_TACTICAL",
  NONE: "STATUS:NO_DISPATCH",
  REVIEW: "STATUS:HUMAN_REVIEW_REQUIRED",
};

export const STAGES = [
  { id: "INPUT", short: "01" },
  { id: "FACTS", short: "02" },
  { id: "QUALITY", short: "03" },
  { id: "CORRECT", short: "04" },
  { id: "DECIDE", short: "05" },
  { id: "OUTPUT", short: "06" },
];

export const MODULES = [
  { id: "TACTICAL", color: "#ef4444", glow: "#ef444466", icon: "⚔", desc: "Threat Review" },
  { id: "MEDICAL", color: "#22c55e", glow: "#22c55e66", icon: "✚", desc: "Medical Review" },
  { id: "POLICE", color: "#3b82f6", glow: "#3b82f666", icon: "◈", desc: "Police Review" },
  { id: "FIRE", color: "#f97316", glow: "#f9731666", icon: "▲", desc: "Fire Review" },
];

export const PROVIDERS = [
  { id: "anthropic", apiType: "anthropic", name: "Anthropic", model: "claude-haiku-4-5-20251001", label: "Haiku 4.5", color: "#a78bfa", builtIn: false, url: "https://console.anthropic.com" },
  { id: "groq", apiType: "groq", name: "Groq", model: "meta-llama/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout", color: "#facc15", builtIn: false, url: "https://console.groq.com" },
  { id: "gemini", apiType: "gemini", name: "Gemini", model: "gemini-2.0-flash", label: "Gemini 2.0 Flash", color: "#4ade80", builtIn: false, url: "https://aistudio.google.com/apikey" },
  { id: "openrouter", apiType: "openrouter", name: "OpenRouter", model: "openrouter/free", label: "Free Router", color: "#fb923c", builtIn: false, url: "https://openrouter.ai/keys" },
  { id: "jan", apiType: "local", name: "Jan", model: "local-model", label: "Local AI", color: "#60a5fa", builtIn: true, defaultUrl: "http://localhost:1337/v1" },
  { id: "ollama", apiType: "local", name: "Ollama", model: "llama3.2-vision", label: "Local Llama", color: "#fbbf24", builtIn: true, defaultUrl: "http://localhost:11434/v1" },
  { id: "lmstudio", apiType: "local", name: "LM Studio", model: "local-model", label: "Local Server", color: "#818cf8", builtIn: true, defaultUrl: "http://localhost:1234/v1" },
  { id: "localai", apiType: "local", name: "LocalAI", model: "local-model", label: "Local API", color: "#34d399", builtIn: true, defaultUrl: "http://localhost:8080/v1" },
  { id: "custom", apiType: "local", name: "Custom", model: "local-model", label: "Custom Endpoint", color: "#94a3b8", builtIn: true, defaultUrl: "http://localhost:8000/v1" },
];

export const REASON_CODES = [
  "FALSE_POSITIVE_WEAPON",
  "FALSE_POSITIVE_FIRE",
  "FALSE_POSITIVE_MEDICAL",
  "MISSING_OBJECT",
  "ROLE_WRONG",
  "THREAT_OVERSTATED",
  "THREAT_UNDERSTATED",
  "INCIDENT_ALREADY_ACTIVE",
  "LOW_VISIBILITY",
  "MODEL_OUTPUT_INVALID",
];

export const SUPPORT_OPTIONS = ["TACTICAL", "POLICE", "MEDICAL", "FIRE"];

export function storageKey(suffix, providerId = "") {
  return `${APP_ID}_${suffix}${providerId ? `_${providerId}` : ""}`;
}

export const AUDIT_STORE_KEY = storageKey("audit_cases");

export function getProvider(providerId) {
  return PROVIDERS.find((provider) => provider.id === providerId) || PROVIDERS[0];
}

export function createCaseId() {
  return `CASE_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export function simpleHash(input) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return `IMG_${Math.abs(hash).toString(16).toUpperCase()}`;
}

export function isLocalProvider(provider) {
  return provider.apiType === "local";
}

export function buildSystemPrompt() {
  return [
    "=== JFP_PROTOCOL_SPEC v5.2_PRODUCTION ===",
    "F:MODE:vision_to_status_with_auditability;",
    "F:RULE:NO_NATURAL_LANGUAGE;",
    "F:RULE:FINAL_STATUS_ONLY;",
    "",
    "=== FACT_LAYER ===",
    "Emit zero prose. Emit only JFP fields.",
    `Emit max ${MAX_ATOMS} objects.`,
    "Object format:",
    "F:OBJECT:<type>;F:ID:<Axx>;F:RAW_CONF:<0-1>;F:CALIBRATED_CONF:<0-1>;F:POS:X:<0-1>:Y:<0-1>;F:SOURCE:MODEL;",
    "Allowed objects: human;vehicle;fire;smoke;weapon;tool_knife;tool_sharp;tool_blunt;obstacle;animal;unknown",
    "Relation format:",
    "F:RELATION:<Axx>→<Ayy>:<type>;F:CONF:<0-1>;F:SOURCE:MODEL;",
    "Role format:",
    "F:ROLE:<Axx>:<role>;F:CONF:<0-1>;F:SOURCE:MODEL;",
    "",
    "=== SCENE_LAYER ===",
    "F:SCENE:TYPE:<interior|exterior|unknown>;",
    "F:SCENE:CONTEXT:<context>;",
    "F:THREAT_LEVEL:<LOW|MEDIUM|HIGH>;",
    "F:FIRE_DETECTED:<YES|NO>;",
    "F:MEDICAL_EMERGENCY:<YES|NO>;",
    "F:WEAPONS_DETECTED:<YES|NO>;",
    "F:INCIDENT_CONTEXT:<NEW|ACTIVE|REPORTED|DUPLICATE|UNKNOWN>;",
    "F:SOURCE:DERIVED;",
    "",
    "=== QUALITY_LAYER ===",
    "If visibility or quality is degraded emit:",
    "F:UNCERTAINTY:<LOW|MEDIUM|HIGH>;",
    "F:UNCERTAINTY_REASON:<VISIBILITY_LOW|SMOKE_HEAVY|LOW_CONTRAST|ROLE_CONFLICT|ATOM_INCOMPLETE|MODEL_OUTPUT_INVALID|CONTEXT_MISMATCH|INSUFFICIENT_FACTS|CONFLICTING_ATOMS>;",
    "F:SCENE_QUALITY:<ACCEPTABLE|DEGRADED|INVALID>;",
    "If any atom is incomplete emit F:ATOM_ERROR:INCOMPLETE;",
    "",
    "=== CORRECTION_LAYER ===",
    "Only emit correction fields if a conservative downgrade is justified:",
    "F:RULE_HIT:<Rxx>;",
    "F:RULE_EFFECT:<EFFECT_CODE>;",
    "F:CORRECTION:<FIELD>:<FROM>-><TO>;",
    "F:CORRECTION_REASON:<REASON_CODE>;",
    "F:CORRECTION_SOURCE:RULE;",
    "",
    "=== DECISION_LAYER ===",
    "Emit exactly one final status:",
    "STATUS:DISPATCH_FIRE;",
    "STATUS:DISPATCH_POLICE;",
    "STATUS:DISPATCH_MEDICAL;",
    "STATUS:DISPATCH_TACTICAL;",
    "STATUS:NO_DISPATCH;",
    "STATUS:HUMAN_REVIEW_REQUIRED;",
    "Emit F:DECISION_TRACE:<TRACE_CODE_CHAIN>;",
    "",
    "If you are uncertain prefer STATUS:HUMAN_REVIEW_REQUIRED.",
    "If there are no reliable objects emit F:OBJECT:unknown with low confidence.",
    "END_JFP;",
  ].join("\n");
}

export function stripCodeFences(text) {
  return text
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/```/g, "")
    .trim();
}

export function parseJfp(rawOutput) {
  const cleaned = stripCodeFences(rawOutput);
  const lines = cleaned.split("\n").map((line) => line.trim()).filter(Boolean);

  const objectLines = lines.filter((line) => line.includes("F:OBJECT:"));
  const relationLines = lines.filter((line) => line.includes("F:RELATION:"));
  const roleLines = lines.filter((line) => line.includes("F:ROLE:"));
  const correctionLines = lines.filter((line) => line.includes("F:CORRECTION:") || line.includes("F:RULE_HIT:") || line.includes("F:RULE_EFFECT:"));
  const qualityLines = lines.filter((line) => /F:UNCERTAINTY:|F:UNCERTAINTY_REASON:|F:ATOM_ERROR:|F:SCENE_QUALITY:|F:SCENE_QUALITY_REASON:/.test(line));
  const sceneLines = lines.filter((line) => /F:SCENE:TYPE:|F:SCENE:CONTEXT:|F:THREAT_LEVEL:|F:FIRE_DETECTED:|F:MEDICAL_EMERGENCY:|F:WEAPONS_DETECTED:|F:INCIDENT_CONTEXT:/.test(line));
  const decisionLines = lines.filter((line) => line.startsWith("STATUS:") || line.includes("F:DECISION_TRACE:"));

  const rawStatus = decisionLines.find((line) => line.startsWith("STATUS:")) || FINAL_STATUS.REVIEW;
  const status = rawStatus.replace(/;$/, "");
  const decisionTrace = decisionLines.find((line) => line.includes("F:DECISION_TRACE:")) || "F:DECISION_TRACE:MODEL_OUTPUT_INVALID;";
  const uncertainty = qualityLines.find((line) => line.startsWith("F:UNCERTAINTY:")) || "F:UNCERTAINTY:HIGH;";
  const uncertaintyReason = qualityLines.find((line) => line.startsWith("F:UNCERTAINTY_REASON:")) || "F:UNCERTAINTY_REASON:INSUFFICIENT_FACTS;";
  const sceneQuality = qualityLines.find((line) => line.startsWith("F:SCENE_QUALITY:")) || "F:SCENE_QUALITY:ACCEPTABLE;";

  const scene = {
    threatLevel: (cleaned.match(/F:THREAT_LEVEL:(LOW|MEDIUM|HIGH);/) || [])[1] || "LOW",
    fireDetected: (cleaned.match(/F:FIRE_DETECTED:(YES|NO);/) || [])[1] || "NO",
    medicalEmergency: (cleaned.match(/F:MEDICAL_EMERGENCY:(YES|NO);/) || [])[1] || "NO",
    weaponsDetected: (cleaned.match(/F:WEAPONS_DETECTED:(YES|NO);/) || [])[1] || "NO",
    incidentContext: (cleaned.match(/F:INCIDENT_CONTEXT:(NEW|ACTIVE|REPORTED|DUPLICATE|UNKNOWN);/) || [])[1] || "UNKNOWN",
  };

  const atoms = objectLines.map((line) => {
    const objectType = (line.match(/F:OBJECT:([^;]+);/) || [])[1] || "unknown";
    const rawConf = parseFloat((line.match(/F:RAW_CONF:([0-9.]+)/) || [])[1] || (line.match(/F:CONF:([0-9.]+)/) || [])[1] || "0");
    const calibratedConf = parseFloat((line.match(/F:CALIBRATED_CONF:([0-9.]+)/) || [])[1] || rawConf || "0");
    return { raw: line, objectType, rawConf, calibratedConf };
  });

  const atomErrors = qualityLines.filter((line) => line.startsWith("F:ATOM_ERROR:"));
  const needsFallbackUnknown = atoms.length === 0;

  if (needsFallbackUnknown) {
    atoms.push({
      raw: "F:OBJECT:unknown;F:ID:A00;F:RAW_CONF:0.10;F:CALIBRATED_CONF:0.10;F:POS:X:0.50:Y:0.50;F:SOURCE:MODEL;",
      objectType: "unknown",
      rawConf: 0.1,
      calibratedConf: 0.1,
    });
  }

  let normalizedStatus = atomErrors.length > 0 || needsFallbackUnknown ? FINAL_STATUS.REVIEW : status;
  const normalizedQuality = needsFallbackUnknown ? [...qualityLines, "F:ATOM_ERROR:INCOMPLETE;"] : qualityLines;
  const normalizedUncertainty = atomErrors.length > 0 || needsFallbackUnknown ? "F:UNCERTAINTY:HIGH;" : uncertainty;
  const normalizedReason = atomErrors.length > 0 || needsFallbackUnknown ? "F:UNCERTAINTY_REASON:INSUFFICIENT_FACTS;" : uncertaintyReason;

  if (
    normalizedStatus === FINAL_STATUS.POLICE &&
    scene.weaponsDetected === "YES" &&
    scene.threatLevel === "HIGH" &&
    (scene.incidentContext === "NEW" || scene.incidentContext === "ACTIVE")
  ) {
    normalizedStatus = FINAL_STATUS.TACTICAL;
  }

  const finalLines = [
    `F:VERSION:${JFP_VERSION};`,
    ...atoms.map((atom) => atom.raw),
    ...relationLines,
    ...roleLines,
    ...sceneLines,
    normalizedUncertainty,
    normalizedReason,
    sceneQuality,
    ...normalizedQuality.filter((line) => !line.startsWith("F:UNCERTAINTY:") && !line.startsWith("F:UNCERTAINTY_REASON:") && !line.startsWith("F:SCENE_QUALITY:")),
    ...correctionLines,
    decisionTrace,
    `${normalizedStatus};`,
  ];

  return {
    lines: finalLines,
    atoms,
    relations: relationLines,
    roles: roleLines,
    corrections: correctionLines,
    scene,
    metrics: {
      atoms: atoms.length,
      relations: relationLines.length,
      roles: roleLines.length,
      corrections: correctionLines.length,
      highUncertainty: normalizedUncertainty.includes("HIGH"),
    },
    status: normalizedStatus,
  };
}

export function modulesForStatus(status, scene) {
  if (status === FINAL_STATUS.FIRE) return ["FIRE"];
  if (status === FINAL_STATUS.MEDICAL) return ["MEDICAL"];
  if (status === FINAL_STATUS.TACTICAL) return ["TACTICAL", "POLICE", "MEDICAL"];
  if (status === FINAL_STATUS.POLICE) return ["POLICE", "TACTICAL"];
  if (status === FINAL_STATUS.REVIEW) {
    const modules = [];
    if (scene.fireDetected === "YES") modules.push("FIRE");
    if (scene.medicalEmergency === "YES") modules.push("MEDICAL");
    if (scene.weaponsDetected === "YES") modules.push("POLICE", "TACTICAL");
    return modules.length > 0 ? Array.from(new Set(modules)) : ["TACTICAL"];
  }
  return [];
}

export function buildOperatorGuidance(scene, status) {
  const support = [];

  if (status === FINAL_STATUS.FIRE) support.push("FIRE");
  if (status === FINAL_STATUS.MEDICAL) support.push("MEDICAL");
  if (status === FINAL_STATUS.POLICE) support.push("POLICE");
  if (status === FINAL_STATUS.TACTICAL) {
    support.push("TACTICAL");
    support.push("POLICE");
    support.push("MEDICAL");
  }

  if (scene.weaponsDetected === "YES" && scene.threatLevel === "HIGH") {
    if (scene.incidentContext === "ACTIVE" || scene.incidentContext === "NEW") {
      support.push("TACTICAL");
      support.push("POLICE");
      if (scene.incidentContext !== "DUPLICATE") support.push("MEDICAL");
    }
  }

  if (scene.medicalEmergency === "YES") support.push("MEDICAL");
  if (scene.fireDetected === "YES") support.push("FIRE");

  if (status === FINAL_STATUS.REVIEW && support.length === 0) {
    support.push("HUMAN_REVIEW");
  }

  return {
    suggestedStatus: status,
    supportPackage: Array.from(new Set(support)),
  };
}

export function statusColor(status) {
  if (status === FINAL_STATUS.FIRE) return "#f97316";
  if (status === FINAL_STATUS.MEDICAL) return "#22c55e";
  if (status === FINAL_STATUS.POLICE) return "#3b82f6";
  if (status === FINAL_STATUS.TACTICAL) return "#ef4444";
  if (status === FINAL_STATUS.REVIEW) return "#facc15";
  return "#94a3b8";
}

export function lineColor(line, providerColor) {
  if (line.startsWith("STATUS:")) return statusColor(line.replace(/;$/, ""));
  if (line.startsWith("F:UNCERTAINTY:") || line.startsWith("F:UNCERTAINTY_REASON:") || line.startsWith("F:ATOM_ERROR:")) return "#facc15";
  if (line.startsWith("F:CORRECTION:") || line.startsWith("F:RULE_HIT:") || line.startsWith("F:RULE_EFFECT:")) return "#e879f9";
  if (line.startsWith("F:RELATION:")) return "#818cf8";
  if (line.startsWith("F:ROLE:")) return "#fb923c";
  if (line.startsWith("F:OBJECT:")) return "#4fc3f7";
  if (line.startsWith("F:SCENE:") || line.startsWith("F:THREAT_LEVEL:") || line.startsWith("F:FIRE_DETECTED:") || line.startsWith("F:MEDICAL_EMERGENCY:") || line.startsWith("F:WEAPONS_DETECTED:") || line.startsWith("F:INCIDENT_CONTEXT:")) return "#22d3ee";
  if (line.startsWith("F:VERSION:") || line.startsWith("F:PROVIDER:") || line.startsWith("F:MODEL:")) return providerColor;
  if (line.startsWith("F:DECISION_TRACE:")) return "#7dd3f0";
  if (line.startsWith("⚠")) return "#ef4444";
  if (line.startsWith("---") || line.startsWith("===")) return "#1e6a8a";
  return "#4fc3f7";
}

export function loadAuditCases() {
  try {
    const raw = localStorage.getItem(AUDIT_STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveAuditCases(cases) {
  localStorage.setItem(AUDIT_STORE_KEY, JSON.stringify(cases.slice(0, 50)));
}

export function upsertAuditCase(nextCase) {
  const current = loadAuditCases();
  const withoutCurrent = current.filter((entry) => entry.case_id !== nextCase.case_id);
  saveAuditCases([nextCase, ...withoutCurrent]);
  return [nextCase, ...withoutCurrent].slice(0, 50);
}

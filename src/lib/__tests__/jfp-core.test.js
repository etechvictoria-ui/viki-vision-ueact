import { describe, it, expect, beforeEach } from 'vitest';
import {
  APP_ID, JFP_VERSION, MAX_ATOMS, FINAL_STATUS, STAGES, MODULES, PROVIDERS,
  REASON_CODES, SUPPORT_OPTIONS, AUDIT_STORE_KEY,
  storageKey, getProvider, createCaseId, simpleHash, isLocalProvider,
  buildSystemPrompt, stripCodeFences, parseJfp, modulesForStatus, buildOperatorGuidance,
  statusColor, lineColor, loadAuditCases, saveAuditCases, upsertAuditCase,
} from '../jfp-core.js';

// ─── Constants ────────────────────────────────────────────────────────────────

describe('Constants', () => {
  it('APP_ID is viki_ueact', () => {
    expect(APP_ID).toBe('viki_ueact');
  });

  it('JFP_VERSION is 5.2_PRODUCTION', () => {
    expect(JFP_VERSION).toBe('5.2_PRODUCTION');
  });

  it('MAX_ATOMS is 12', () => {
    expect(MAX_ATOMS).toBe(12);
  });

  it('FINAL_STATUS has 6 entries', () => {
    expect(Object.keys(FINAL_STATUS)).toHaveLength(6);
  });

  it('FINAL_STATUS values use STATUS: prefix', () => {
    for (const val of Object.values(FINAL_STATUS)) {
      expect(val).toMatch(/^STATUS:/);
    }
  });

  it('STAGES has 6 elements', () => {
    expect(STAGES).toHaveLength(6);
  });

  it('STAGES short codes are 01–06', () => {
    expect(STAGES.map(s => s.short)).toEqual(['01', '02', '03', '04', '05', '06']);
  });

  it('MODULES has 4 elements', () => {
    expect(MODULES).toHaveLength(4);
  });

  it('MODULES ids are TACTICAL, MEDICAL, POLICE, FIRE', () => {
    expect(MODULES.map(m => m.id)).toEqual(['TACTICAL', 'MEDICAL', 'POLICE', 'FIRE']);
  });

  it('PROVIDERS has 9 entries', () => {
    expect(PROVIDERS).toHaveLength(9);
  });

  it('REASON_CODES has 10 entries', () => {
    expect(REASON_CODES).toHaveLength(10);
  });

  it('SUPPORT_OPTIONS has 4 entries', () => {
    expect(SUPPORT_OPTIONS).toHaveLength(4);
  });

  it('AUDIT_STORE_KEY starts with viki_ueact', () => {
    expect(AUDIT_STORE_KEY).toMatch(/^viki_ueact_/);
  });
});

// ─── storageKey() ─────────────────────────────────────────────────────────────

describe('storageKey()', () => {
  it('returns APP_ID_suffix without providerId', () => {
    expect(storageKey('foo')).toBe('viki_ueact_foo');
  });

  it('appends providerId when provided', () => {
    expect(storageKey('key', 'groq')).toBe('viki_ueact_key_groq');
  });

  it('omits trailing underscore when no providerId', () => {
    expect(storageKey('provider')).not.toContain('provider_');
  });
});

// ─── simpleHash() ─────────────────────────────────────────────────────────────

describe('simpleHash()', () => {
  it('always starts with IMG_', () => {
    expect(simpleHash('hello')).toMatch(/^IMG_/);
  });

  it('is deterministic', () => {
    expect(simpleHash('test-input')).toBe(simpleHash('test-input'));
  });

  it('different inputs produce different hashes', () => {
    expect(simpleHash('abc')).not.toBe(simpleHash('xyz'));
  });

  it('handles empty string without error', () => {
    expect(() => simpleHash('')).not.toThrow();
    expect(simpleHash('')).toBe('IMG_0');
  });
});

// ─── isLocalProvider() ────────────────────────────────────────────────────────

describe('isLocalProvider()', () => {
  it('returns true for local apiType', () => {
    expect(isLocalProvider({ apiType: 'local' })).toBe(true);
  });

  it('returns false for anthropic apiType', () => {
    expect(isLocalProvider({ apiType: 'anthropic' })).toBe(false);
  });

  it('returns false for groq apiType', () => {
    expect(isLocalProvider({ apiType: 'groq' })).toBe(false);
  });

  it('ollama provider is local', () => {
    const ollama = PROVIDERS.find(p => p.id === 'ollama');
    expect(isLocalProvider(ollama)).toBe(true);
  });

  it('anthropic provider is not local', () => {
    const anthropic = PROVIDERS.find(p => p.id === 'anthropic');
    expect(isLocalProvider(anthropic)).toBe(false);
  });
});

// ─── getProvider() ────────────────────────────────────────────────────────────

describe('getProvider()', () => {
  it('returns the correct provider by id', () => {
    const p = getProvider('groq');
    expect(p.id).toBe('groq');
    expect(p.name).toBe('Groq');
  });

  it('returns first provider as fallback for unknown id', () => {
    const p = getProvider('nonexistent');
    expect(p).toBe(PROVIDERS[0]);
  });

  it('returns anthropic provider correctly', () => {
    const p = getProvider('anthropic');
    expect(p.apiType).toBe('anthropic');
  });

  it('returns ollama provider correctly', () => {
    const p = getProvider('ollama');
    expect(p.apiType).toBe('local');
    expect(p.defaultUrl).toContain('11434');
  });
});

// ─── createCaseId() ───────────────────────────────────────────────────────────

describe('createCaseId()', () => {
  it('starts with CASE_', () => {
    expect(createCaseId()).toMatch(/^CASE_/);
  });

  it('produces unique ids', () => {
    const ids = new Set(Array.from({ length: 20 }, () => createCaseId()));
    expect(ids.size).toBeGreaterThanOrEqual(19);
  });

  it('contains uppercase characters after prefix', () => {
    const id = createCaseId();
    const suffix = id.split('_').slice(2).join('_');
    expect(suffix).toBe(suffix.toUpperCase());
  });
});

// ─── stripCodeFences() ────────────────────────────────────────────────────────

describe('stripCodeFences()', () => {
  it('removes backtick fences with language tag', () => {
    const input = '```jfp\nF:OBJECT:human;\n```';
    expect(stripCodeFences(input)).toBe('F:OBJECT:human;');
  });

  it('removes plain backtick fences', () => {
    const input = '```\nF:OBJECT:human;\n```';
    expect(stripCodeFences(input)).toBe('F:OBJECT:human;');
  });

  it('trims whitespace', () => {
    expect(stripCodeFences('  hello  ')).toBe('hello');
  });

  it('leaves plain text unchanged', () => {
    expect(stripCodeFences('F:OBJECT:human;')).toBe('F:OBJECT:human;');
  });
});

// ─── statusColor() ────────────────────────────────────────────────────────────

describe('statusColor()', () => {
  it('FIRE returns orange', () => {
    expect(statusColor(FINAL_STATUS.FIRE)).toBe('#f97316');
  });

  it('MEDICAL returns green', () => {
    expect(statusColor(FINAL_STATUS.MEDICAL)).toBe('#22c55e');
  });

  it('POLICE returns blue', () => {
    expect(statusColor(FINAL_STATUS.POLICE)).toBe('#3b82f6');
  });

  it('TACTICAL returns red', () => {
    expect(statusColor(FINAL_STATUS.TACTICAL)).toBe('#ef4444');
  });

  it('REVIEW returns yellow', () => {
    expect(statusColor(FINAL_STATUS.REVIEW)).toBe('#facc15');
  });

  it('NONE returns gray', () => {
    expect(statusColor(FINAL_STATUS.NONE)).toBe('#94a3b8');
  });

  it('unknown status returns gray', () => {
    expect(statusColor('STATUS:UNKNOWN')).toBe('#94a3b8');
  });
});

// ─── lineColor() ─────────────────────────────────────────────────────────────

describe('lineColor()', () => {
  const color = '#facc15';

  it('STATUS: lines get dispatch color', () => {
    expect(lineColor('STATUS:DISPATCH_FIRE;', color)).toBe('#f97316');
  });

  it('F:UNCERTAINTY: lines get yellow', () => {
    expect(lineColor('F:UNCERTAINTY:HIGH;', color)).toBe('#facc15');
  });

  it('F:ATOM_ERROR: lines get yellow', () => {
    expect(lineColor('F:ATOM_ERROR:INCOMPLETE;', color)).toBe('#facc15');
  });

  it('F:CORRECTION: lines get purple', () => {
    expect(lineColor('F:CORRECTION:STATUS:POLICE->TACTICAL;', color)).toBe('#e879f9');
  });

  it('F:RULE_HIT: lines get purple', () => {
    expect(lineColor('F:RULE_HIT:R01;', color)).toBe('#e879f9');
  });

  it('F:RELATION: lines get indigo', () => {
    expect(lineColor('F:RELATION:A01→A02:holding;', color)).toBe('#818cf8');
  });

  it('F:ROLE: lines get orange', () => {
    expect(lineColor('F:ROLE:A01:suspect;', color)).toBe('#fb923c');
  });

  it('F:OBJECT: lines get cyan', () => {
    expect(lineColor('F:OBJECT:human;', color)).toBe('#4fc3f7');
  });

  it('F:THREAT_LEVEL: lines get cyan scene color', () => {
    expect(lineColor('F:THREAT_LEVEL:HIGH;', color)).toBe('#22d3ee');
  });

  it('F:VERSION: uses provider color', () => {
    expect(lineColor('F:VERSION:5.2;', color)).toBe(color);
  });

  it('F:DECISION_TRACE: uses light blue', () => {
    expect(lineColor('F:DECISION_TRACE:T01;', color)).toBe('#7dd3f0');
  });

  it('--- separators use dark blue', () => {
    expect(lineColor('--- FACT_LAYER ---', color)).toBe('#1e6a8a');
  });
});

// ─── buildSystemPrompt() ─────────────────────────────────────────────────────

describe('buildSystemPrompt()', () => {
  let prompt;
  beforeEach(() => { prompt = buildSystemPrompt(); });

  it('returns a non-empty string', () => {
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(100);
  });

  it('contains JFP_PROTOCOL_SPEC header', () => {
    expect(prompt).toContain('JFP_PROTOCOL_SPEC');
  });

  it('contains all 6 dispatch status options', () => {
    expect(prompt).toContain('STATUS:DISPATCH_FIRE');
    expect(prompt).toContain('STATUS:DISPATCH_POLICE');
    expect(prompt).toContain('STATUS:DISPATCH_MEDICAL');
    expect(prompt).toContain('STATUS:DISPATCH_TACTICAL');
    expect(prompt).toContain('STATUS:NO_DISPATCH');
    expect(prompt).toContain('STATUS:HUMAN_REVIEW_REQUIRED');
  });

  it('contains MAX_ATOMS limit', () => {
    expect(prompt).toContain(`max ${MAX_ATOMS} objects`);
  });

  it('ends with END_JFP', () => {
    expect(prompt.trimEnd()).toContain('END_JFP;');
  });

  it('requires NO_NATURAL_LANGUAGE rule', () => {
    expect(prompt).toContain('F:RULE:NO_NATURAL_LANGUAGE');
  });
});

// ─── parseJfp() ──────────────────────────────────────────────────────────────

const FIRE_JFP = `
F:OBJECT:fire;F:ID:A01;F:RAW_CONF:0.95;F:CALIBRATED_CONF:0.92;F:POS:X:0.50:Y:0.40;F:SOURCE:MODEL;
F:OBJECT:smoke;F:ID:A02;F:RAW_CONF:0.88;F:CALIBRATED_CONF:0.85;F:POS:X:0.60:Y:0.30;F:SOURCE:MODEL;
F:SCENE:TYPE:exterior;
F:THREAT_LEVEL:HIGH;
F:FIRE_DETECTED:YES;
F:MEDICAL_EMERGENCY:NO;
F:WEAPONS_DETECTED:NO;
F:INCIDENT_CONTEXT:NEW;
F:UNCERTAINTY:LOW;
F:UNCERTAINTY_REASON:VISIBILITY_LOW;
F:SCENE_QUALITY:ACCEPTABLE;
F:DECISION_TRACE:T01→T05→D01;
STATUS:DISPATCH_FIRE;
`.trim();

const POLICE_HIGH_WEAPON_NEW = `
F:OBJECT:human;F:ID:A01;F:RAW_CONF:0.90;F:CALIBRATED_CONF:0.88;F:POS:X:0.50:Y:0.50;F:SOURCE:MODEL;
F:OBJECT:weapon;F:ID:A02;F:RAW_CONF:0.85;F:CALIBRATED_CONF:0.82;F:POS:X:0.55:Y:0.55;F:SOURCE:MODEL;
F:RELATION:A01→A02:holding;F:CONF:0.80;F:SOURCE:MODEL;
F:ROLE:A01:suspect;F:CONF:0.75;F:SOURCE:MODEL;
F:SCENE:TYPE:exterior;
F:THREAT_LEVEL:HIGH;
F:FIRE_DETECTED:NO;
F:MEDICAL_EMERGENCY:NO;
F:WEAPONS_DETECTED:YES;
F:INCIDENT_CONTEXT:NEW;
F:UNCERTAINTY:LOW;
F:UNCERTAINTY_REASON:ROLE_CONFLICT;
F:SCENE_QUALITY:ACCEPTABLE;
F:DECISION_TRACE:T02→T04→D02;
STATUS:DISPATCH_POLICE;
`.trim();

const MEDICAL_JFP = `
F:OBJECT:human;F:ID:A01;F:RAW_CONF:0.92;F:CALIBRATED_CONF:0.90;F:POS:X:0.50:Y:0.50;F:SOURCE:MODEL;
F:ROLE:A01:victim;F:CONF:0.80;F:SOURCE:MODEL;
F:THREAT_LEVEL:MEDIUM;
F:FIRE_DETECTED:NO;
F:MEDICAL_EMERGENCY:YES;
F:WEAPONS_DETECTED:NO;
F:INCIDENT_CONTEXT:NEW;
F:UNCERTAINTY:LOW;
F:UNCERTAINTY_REASON:INSUFFICIENT_FACTS;
F:SCENE_QUALITY:ACCEPTABLE;
F:DECISION_TRACE:T03→D03;
STATUS:DISPATCH_MEDICAL;
`.trim();

describe('parseJfp()', () => {
  describe('empty / blank input', () => {
    it('returns HUMAN_REVIEW_REQUIRED for empty string', () => {
      const result = parseJfp('');
      expect(result.status).toBe(FINAL_STATUS.REVIEW);
    });

    it('inserts fallback unknown atom when no atoms found', () => {
      const result = parseJfp('');
      expect(result.atoms).toHaveLength(1);
      expect(result.atoms[0].objectType).toBe('unknown');
    });

    it('marks high uncertainty when no atoms', () => {
      const result = parseJfp('');
      expect(result.metrics.highUncertainty).toBe(true);
    });
  });

  describe('FIRE dispatch', () => {
    it('parses STATUS:DISPATCH_FIRE correctly', () => {
      const result = parseJfp(FIRE_JFP);
      expect(result.status).toBe(FINAL_STATUS.FIRE);
    });

    it('parses 2 atoms from fire scene', () => {
      const result = parseJfp(FIRE_JFP);
      expect(result.atoms).toHaveLength(2);
      expect(result.atoms[0].objectType).toBe('fire');
      expect(result.atoms[1].objectType).toBe('smoke');
    });

    it('parses fire detection flag', () => {
      const result = parseJfp(FIRE_JFP);
      expect(result.scene.fireDetected).toBe('YES');
    });

    it('parses threat level', () => {
      const result = parseJfp(FIRE_JFP);
      expect(result.scene.threatLevel).toBe('HIGH');
    });

    it('reports correct atom count in metrics', () => {
      const result = parseJfp(FIRE_JFP);
      expect(result.metrics.atoms).toBe(2);
    });

    it('uncertainty is LOW (not high)', () => {
      const result = parseJfp(FIRE_JFP);
      expect(result.metrics.highUncertainty).toBe(false);
    });
  });

  describe('MEDICAL dispatch', () => {
    it('parses STATUS:DISPATCH_MEDICAL', () => {
      const result = parseJfp(MEDICAL_JFP);
      expect(result.status).toBe(FINAL_STATUS.MEDICAL);
    });

    it('parses medical emergency flag', () => {
      const result = parseJfp(MEDICAL_JFP);
      expect(result.scene.medicalEmergency).toBe('YES');
    });

    it('parses role lines', () => {
      const result = parseJfp(MEDICAL_JFP);
      expect(result.roles).toHaveLength(1);
      expect(result.roles[0]).toContain('F:ROLE:');
    });
  });

  describe('POLICE → TACTICAL auto-upgrade', () => {
    it('upgrades POLICE to TACTICAL when weapons + HIGH + NEW', () => {
      const result = parseJfp(POLICE_HIGH_WEAPON_NEW);
      expect(result.status).toBe(FINAL_STATUS.TACTICAL);
    });

    it('detects weapon and relation in scene with upgrade', () => {
      const result = parseJfp(POLICE_HIGH_WEAPON_NEW);
      expect(result.scene.weaponsDetected).toBe('YES');
      expect(result.relations).toHaveLength(1);
    });
  });

  describe('POLICE without upgrade conditions', () => {
    const POLICE_LOW = `
F:OBJECT:human;F:ID:A01;F:RAW_CONF:0.80;F:CALIBRATED_CONF:0.78;F:POS:X:0.50:Y:0.50;F:SOURCE:MODEL;
F:THREAT_LEVEL:LOW;
F:FIRE_DETECTED:NO;
F:MEDICAL_EMERGENCY:NO;
F:WEAPONS_DETECTED:NO;
F:INCIDENT_CONTEXT:REPORTED;
F:UNCERTAINTY:LOW;
F:UNCERTAINTY_REASON:ROLE_CONFLICT;
F:SCENE_QUALITY:ACCEPTABLE;
F:DECISION_TRACE:T02→D02;
STATUS:DISPATCH_POLICE;
`.trim();

    it('keeps POLICE when threat is LOW', () => {
      const result = parseJfp(POLICE_LOW);
      expect(result.status).toBe(FINAL_STATUS.POLICE);
    });
  });

  describe('code fence stripping', () => {
    it('parses JFP wrapped in code fences', () => {
      const wrapped = '```jfp\n' + FIRE_JFP + '\n```';
      const result = parseJfp(wrapped);
      expect(result.status).toBe(FINAL_STATUS.FIRE);
    });
  });

  describe('ATOM_ERROR → REVIEW upgrade', () => {
    const WITH_ATOM_ERROR = `
F:OBJECT:human;F:ID:A01;F:RAW_CONF:0.90;F:CALIBRATED_CONF:0.88;F:POS:X:0.50:Y:0.50;F:SOURCE:MODEL;
F:THREAT_LEVEL:HIGH;
F:FIRE_DETECTED:NO;
F:MEDICAL_EMERGENCY:NO;
F:WEAPONS_DETECTED:YES;
F:INCIDENT_CONTEXT:NEW;
F:UNCERTAINTY:HIGH;
F:UNCERTAINTY_REASON:ATOM_INCOMPLETE;
F:ATOM_ERROR:INCOMPLETE;
F:SCENE_QUALITY:DEGRADED;
F:DECISION_TRACE:T02→D05;
STATUS:DISPATCH_POLICE;
`.trim();

    it('forces REVIEW when atom errors present', () => {
      const result = parseJfp(WITH_ATOM_ERROR);
      expect(result.status).toBe(FINAL_STATUS.REVIEW);
    });

    it('marks high uncertainty with atom errors', () => {
      const result = parseJfp(WITH_ATOM_ERROR);
      expect(result.metrics.highUncertainty).toBe(true);
    });
  });

  describe('corrections layer', () => {
    const WITH_CORRECTIONS = `
F:OBJECT:human;F:ID:A01;F:RAW_CONF:0.80;F:CALIBRATED_CONF:0.78;F:POS:X:0.50:Y:0.50;F:SOURCE:MODEL;
F:THREAT_LEVEL:LOW;
F:FIRE_DETECTED:NO;
F:MEDICAL_EMERGENCY:NO;
F:WEAPONS_DETECTED:NO;
F:INCIDENT_CONTEXT:REPORTED;
F:UNCERTAINTY:LOW;
F:UNCERTAINTY_REASON:ROLE_CONFLICT;
F:SCENE_QUALITY:ACCEPTABLE;
F:RULE_HIT:R01;
F:RULE_EFFECT:DOWNGRADE_THREAT;
F:CORRECTION:THREAT_LEVEL:HIGH->LOW;
F:CORRECTION_REASON:ROLE_WRONG;
F:CORRECTION_SOURCE:RULE;
F:DECISION_TRACE:T02→D02;
STATUS:DISPATCH_POLICE;
`.trim();

    it('captures correction lines', () => {
      const result = parseJfp(WITH_CORRECTIONS);
      expect(result.corrections.length).toBeGreaterThan(0);
    });

    it('reports correction count in metrics', () => {
      const result = parseJfp(WITH_CORRECTIONS);
      expect(result.metrics.corrections).toBeGreaterThan(0);
    });
  });

  describe('output structure', () => {
    it('finalLines includes version header', () => {
      const result = parseJfp(FIRE_JFP);
      expect(result.lines[0]).toBe(`F:VERSION:${JFP_VERSION};`);
    });

    it('finalLines ends with status line', () => {
      const result = parseJfp(FIRE_JFP);
      const last = result.lines[result.lines.length - 1];
      expect(last).toMatch(/^STATUS:/);
    });

    it('atom calibratedConf is a number', () => {
      const result = parseJfp(FIRE_JFP);
      for (const atom of result.atoms) {
        expect(typeof atom.calibratedConf).toBe('number');
      }
    });
  });
});

// ─── modulesForStatus() ──────────────────────────────────────────────────────

describe('modulesForStatus()', () => {
  const emptyScene = { fireDetected: 'NO', medicalEmergency: 'NO', weaponsDetected: 'NO' };

  it('FIRE → [FIRE]', () => {
    expect(modulesForStatus(FINAL_STATUS.FIRE, emptyScene)).toEqual(['FIRE']);
  });

  it('MEDICAL → [MEDICAL]', () => {
    expect(modulesForStatus(FINAL_STATUS.MEDICAL, emptyScene)).toEqual(['MEDICAL']);
  });

  it('TACTICAL → [TACTICAL, POLICE, MEDICAL]', () => {
    expect(modulesForStatus(FINAL_STATUS.TACTICAL, emptyScene)).toEqual(['TACTICAL', 'POLICE', 'MEDICAL']);
  });

  it('POLICE → [POLICE, TACTICAL]', () => {
    expect(modulesForStatus(FINAL_STATUS.POLICE, emptyScene)).toEqual(['POLICE', 'TACTICAL']);
  });

  it('NONE → []', () => {
    expect(modulesForStatus(FINAL_STATUS.NONE, emptyScene)).toEqual([]);
  });

  it('REVIEW with no scene flags → [TACTICAL] fallback', () => {
    expect(modulesForStatus(FINAL_STATUS.REVIEW, emptyScene)).toEqual(['TACTICAL']);
  });

  it('REVIEW with fire → includes FIRE', () => {
    const scene = { ...emptyScene, fireDetected: 'YES' };
    expect(modulesForStatus(FINAL_STATUS.REVIEW, scene)).toContain('FIRE');
  });

  it('REVIEW with medical → includes MEDICAL', () => {
    const scene = { ...emptyScene, medicalEmergency: 'YES' };
    expect(modulesForStatus(FINAL_STATUS.REVIEW, scene)).toContain('MEDICAL');
  });

  it('REVIEW with weapons → includes POLICE and TACTICAL', () => {
    const scene = { ...emptyScene, weaponsDetected: 'YES' };
    const modules = modulesForStatus(FINAL_STATUS.REVIEW, scene);
    expect(modules).toContain('POLICE');
    expect(modules).toContain('TACTICAL');
  });

  it('REVIEW with multiple flags deduplicates', () => {
    const scene = { fireDetected: 'YES', medicalEmergency: 'YES', weaponsDetected: 'YES' };
    const modules = modulesForStatus(FINAL_STATUS.REVIEW, scene);
    expect(modules.length).toBe(new Set(modules).size);
  });
});

// ─── buildOperatorGuidance() ─────────────────────────────────────────────────

describe('buildOperatorGuidance()', () => {
  const emptyScene = { weaponsDetected: 'NO', threatLevel: 'LOW', medicalEmergency: 'NO', fireDetected: 'NO', incidentContext: 'UNKNOWN' };

  it('returns suggestedStatus matching input status', () => {
    const guidance = buildOperatorGuidance(emptyScene, FINAL_STATUS.FIRE);
    expect(guidance.suggestedStatus).toBe(FINAL_STATUS.FIRE);
  });

  it('FIRE status → FIRE in support package', () => {
    const guidance = buildOperatorGuidance(emptyScene, FINAL_STATUS.FIRE);
    expect(guidance.supportPackage).toContain('FIRE');
  });

  it('MEDICAL status → MEDICAL in support package', () => {
    const guidance = buildOperatorGuidance(emptyScene, FINAL_STATUS.MEDICAL);
    expect(guidance.supportPackage).toContain('MEDICAL');
  });

  it('TACTICAL status → TACTICAL + POLICE + MEDICAL in support', () => {
    const guidance = buildOperatorGuidance(emptyScene, FINAL_STATUS.TACTICAL);
    expect(guidance.supportPackage).toContain('TACTICAL');
    expect(guidance.supportPackage).toContain('POLICE');
    expect(guidance.supportPackage).toContain('MEDICAL');
  });

  it('REVIEW with no scene flags → HUMAN_REVIEW in support', () => {
    const guidance = buildOperatorGuidance(emptyScene, FINAL_STATUS.REVIEW);
    expect(guidance.supportPackage).toContain('HUMAN_REVIEW');
  });

  it('weapons + HIGH + NEW → TACTICAL and POLICE in support', () => {
    const scene = { weaponsDetected: 'YES', threatLevel: 'HIGH', medicalEmergency: 'NO', fireDetected: 'NO', incidentContext: 'NEW' };
    const guidance = buildOperatorGuidance(scene, FINAL_STATUS.NONE);
    expect(guidance.supportPackage).toContain('TACTICAL');
    expect(guidance.supportPackage).toContain('POLICE');
  });

  it('fire scene adds FIRE to support package', () => {
    const scene = { ...emptyScene, fireDetected: 'YES' };
    const guidance = buildOperatorGuidance(scene, FINAL_STATUS.NONE);
    expect(guidance.supportPackage).toContain('FIRE');
  });

  it('support package has no duplicates', () => {
    const scene = { weaponsDetected: 'YES', threatLevel: 'HIGH', medicalEmergency: 'YES', fireDetected: 'YES', incidentContext: 'ACTIVE' };
    const guidance = buildOperatorGuidance(scene, FINAL_STATUS.TACTICAL);
    expect(guidance.supportPackage.length).toBe(new Set(guidance.supportPackage).size);
  });
});

// ─── Audit case management ───────────────────────────────────────────────────

describe('Audit case management', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loadAuditCases returns empty array when nothing stored', () => {
    expect(loadAuditCases()).toEqual([]);
  });

  it('saveAuditCases stores cases that can be retrieved', () => {
    const cases = [{ case_id: 'CASE_001' }];
    saveAuditCases(cases);
    expect(loadAuditCases()).toEqual(cases);
  });

  it('saveAuditCases caps at 50 entries', () => {
    const cases = Array.from({ length: 60 }, (_, i) => ({ case_id: `CASE_${i}` }));
    saveAuditCases(cases);
    expect(loadAuditCases()).toHaveLength(50);
  });

  it('upsertAuditCase adds new case at head', () => {
    const first = { case_id: 'CASE_A' };
    const second = { case_id: 'CASE_B' };
    upsertAuditCase(first);
    const result = upsertAuditCase(second);
    expect(result[0].case_id).toBe('CASE_B');
    expect(result[1].case_id).toBe('CASE_A');
  });

  it('upsertAuditCase replaces existing case by case_id', () => {
    const original = { case_id: 'CASE_X', status: 'pending' };
    const updated = { case_id: 'CASE_X', status: 'confirmed' };
    upsertAuditCase(original);
    upsertAuditCase(updated);
    const all = loadAuditCases();
    expect(all.filter(c => c.case_id === 'CASE_X')).toHaveLength(1);
    expect(all.find(c => c.case_id === 'CASE_X').status).toBe('confirmed');
  });

  it('loadAuditCases returns empty array on corrupted data', () => {
    localStorage.setItem(AUDIT_STORE_KEY, 'not-valid-json{{');
    expect(loadAuditCases()).toEqual([]);
  });

  it('loadAuditCases returns empty array when stored value is not an array', () => {
    localStorage.setItem(AUDIT_STORE_KEY, JSON.stringify({ not: 'array' }));
    expect(loadAuditCases()).toEqual([]);
  });
});

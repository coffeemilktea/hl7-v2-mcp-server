/**
 * deidentify_message: remove or pseudonymise the HIPAA Safe Harbor identifiers
 * (45 CFR 164.514(b)(2)) that HL7 v2.5.1 carries in known fields.
 *
 * Identifiers are replaced with keyed pseudonyms (HMAC-SHA256), so the same
 * value maps to the same pseudonym within a call (and across calls that share a
 * seed). Dates keep only the year by default. Original values are never echoed.
 */
import { createHmac, randomBytes } from "crypto";
import { z } from "zod";
import * as core from "hl7v2-core";
import { ok, fail, READ_ONLY_NON_IDEMPOTENT } from "../result.js";
import { message, out } from "../schemas.js";

// Field rules by Safe Harbor category. id = pseudonymise (component 1 of CX/EI,
// whole value of ST); name = replace with REDACTED; address = keep only state,
// country and address type; remove = clear; uid = new DICOM UID (2.25 form);
// text = free text, redacted when redactFreeText is on.
const RULES = {
  PID: { 2: "id", 3: "id", 4: "id", 5: "name", 6: "name", 9: "name", 11: "address", 12: "remove", 13: "remove", 14: "remove", 18: "id", 19: "remove", 20: "remove", 21: "id", 23: "remove" },
  PD1: { 10: "id" },
  NK1: { 2: "name", 4: "address", 5: "remove", 6: "remove", 12: "id", 13: "remove", 26: "name", 30: "name", 31: "remove", 32: "address", 33: "id", 37: "remove", 38: "remove" },
  GT1: { 2: "id", 3: "name", 4: "name", 5: "address", 6: "remove", 7: "remove", 12: "remove", 16: "name", 17: "address", 18: "remove", 19: "id", 21: "remove", 29: "id", 42: "name", 45: "name", 46: "remove", 51: "remove", 56: "remove" },
  IN1: { 10: "id", 11: "remove", 16: "name", 19: "address", 36: "id", 44: "address", 49: "id", 52: "remove" },
  IN2: { 1: "id", 2: "remove", 6: "remove", 7: "name", 8: "remove", 9: "name", 10: "remove", 26: "id", 40: "name", 49: "name", 50: "remove", 52: "name", 53: "remove", 61: "id", 63: "remove", 64: "remove" },
  MRG: { 1: "id", 2: "id", 3: "id", 4: "id", 5: "id", 6: "id", 7: "name" },
  PV1: { 5: "id", 19: "id", 50: "id" },
  PV2: { 12: "text" },
  ORC: { 2: "id", 3: "id", 4: "id" },
  OBR: { 2: "id", 3: "id", 18: "id", 19: "id", 20: "id", 21: "id" },
  IPC: { 1: "id", 2: "id", 3: "uid", 4: "id" },
  SCH: { 1: "id", 2: "id", 4: "id" },
  TXA: { 12: "id", 13: "id", 14: "id", 15: "id" },
  ZDS: { 1: "uid" },
  NTE: { 3: "text" },
};
const TEXT_TYPES = new Set(["TX", "FT", "ST"]);
const BINARY_TYPES = new Set(["ED", "RP"]);

function pseudonymizer(seed) {
  const key = seed ?? randomBytes(32).toString("hex");
  const h = (s) => createHmac("sha256", key).update(s).digest();
  return {
    id: (v) => `ANON${BigInt("0x" + h("id|" + v).subarray(0, 8).toString("hex")).toString(36).toUpperCase().padStart(10, "0").slice(0, 10)}`,
    uid: (v) => `2.25.${BigInt("0x" + h("uid|" + v).subarray(0, 16).toString("hex")).toString()}`,
  };
}

function transformDate(v, mode, shiftDays) {
  const m = /^(\d{4})(\d{2})?(\d{2})?(.*)$/.exec(v);
  if (!m) return "";
  if (mode === "year") return m[1];
  if (mode === "shift" && m[3]) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    d.setUTCDate(d.getUTCDate() + shiftDays);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${m[4]}`;
  }
  return m[1];
}

export function deidentify(opts) {
  const { message: msg, dateMode = "year", dateShiftDays, seed, redactFreeText = true, redactProviders = false, dropZSegments = true, keep = [] } = opts;
  if (dateMode === "shift" && !Number.isInteger(dateShiftDays)) throw new Error("dateMode 'shift' needs an integer dateShiftDays.");
  const ctx = core.dissect(msg);
  if (!ctx.lines.length || !ctx.lines[0].startsWith("MSH")) throw new Error("Message must begin with an MSH segment.");
  const { fieldSep, compSep, repSep, subSep } = ctx;
  const ps = pseudonymizer(seed);
  const keepPaths = keep.map((k) => core.parsePath(k)).filter(Boolean);
  const changes = new Map();
  const warnings = [];
  const mark = (loc, action) => changes.set(loc, action);
  const enc = (s) => core.escape(s, ctx);
  const dec = (s) => core.unescape(s, ctx);
  const refYear = +(core.comp(core.fielder(ctx.lines[0], fieldSep)(7), 1, compSep).slice(0, 4) || new Date().getFullYear());

  const counts = {};
  const out = [];
  for (const line of ctx.lines) {
    const name = line.slice(0, 3);
    counts[name] = (counts[name] ?? 0) + 1;
    const occ = counts[name];
    const tagOf = (seq) => `${name}${occ > 1 ? `[${occ}]` : ""}-${seq}`;
    if (name.startsWith("Z") && !RULES[name]) {
      if (dropZSegments) {
        mark(`${name}${occ > 1 ? `[${occ}]` : ""}`, "segment removed (local Z-segment, content unknown)");
        continue;
      }
      warnings.push(`${name} is a local Z-segment and was copied unchanged; review it for identifiers.`);
      out.push(line);
      continue;
    }
    const isMsh = name === "MSH";
    const parts = line.split(fieldSep);
    // parts index → standard field seq
    const seqOf = (i) => (isMsh ? i + 1 : i);
    const obxType = name === "OBX" ? (parts[2] ?? "").trim().toUpperCase() : null;
    for (let i = 1; i < parts.length; i++) {
      const seq = seqOf(i);
      if (isMsh && seq <= 2) continue;
      const raw = parts[i];
      if (raw === "") continue;
      if (keepPaths.some((p) => p.segment === name && (p.field === undefined || p.field === seq) && (p.occurrence ?? 1) === occ)) continue;
      const def = core.getField(name, seq);
      let type = def?.type ?? null;
      if (type === "varies" && name === "OBX" && seq === 5) type = obxType || null;
      let action = RULES[name]?.[seq] ?? null;
      if (!action && type === "XPN") action = "name";
      if (!action && type === "XAD") action = "address";
      if (!action && type === "XTN") action = "remove";
      if (!action && type === "XCN" && redactProviders) action = "provider";
      if (name === "OBX" && seq === 5 && type && TEXT_TYPES.has(type)) action = "text";
      if (name === "OBX" && seq === 5 && type && BINARY_TYPES.has(type)) action = "remove-binary";
      const loc = tagOf(seq);

      const reps = raw.split(repSep).map((r) => r.split(compSep).map((c) => c.split(subSep)));
      let changed = false;
      const setRep = (rep, comps) => {
        changed = true;
        return comps;
      };
      let newReps = reps;
      switch (action) {
        case "remove":
          newReps = [[[""]]];
          changed = true;
          break;
        case "remove-binary":
          newReps = [[[""]]];
          changed = true;
          warnings.push(`${loc}: embedded ${type} content removed (may contain images or documents with identifiers).`);
          break;
        case "text":
          if (redactFreeText) {
            newReps = [[["[REDACTED]"]]];
            changed = true;
          } else warnings.push(`${loc}: free text kept (redactFreeText is off). Free text often names the patient, family or dates; review it.`);
          break;
        case "name":
          newReps = reps.map((r) => setRep(r, [["REDACTED"]]));
          break;
        case "address":
          newReps = reps.map((r) => setRep(r, [[""], [""], [""], r[3] ?? [""], [""], r[5] ?? [""], r[6] ?? [""]]));
          break;
        case "id":
          if (type === "CX" || type === "EI" || type === "EIP" || type === "CE" || type === "CWE" || reps.some((r) => r.length > 1)) {
            newReps = reps.map((r) => {
              const v = dec(r[0].join(subSep));
              if (!v) return r;
              const auth = type === "CX" ? (r[3] ?? [""]).join(subSep) : (r[1] ?? [""]).join(subSep);
              return setRep(r, [[enc(ps.id(`${auth}|${v}`))], ...r.slice(1)]);
            });
          } else {
            newReps = reps.map((r) => setRep(r, [[enc(ps.id(dec(r.map((c) => c.join(subSep)).join(compSep))))]]));
          }
          break;
        case "uid":
          newReps = reps.map((r) => {
            const v = dec(r[0].join(subSep));
            return v ? setRep(r, [[ps.uid(v)], ...r.slice(1)]) : r;
          });
          break;
        case "provider":
          newReps = reps.map((r) => setRep(r, [[r[0]?.[0] ? enc(ps.id(dec(r[0].join(subSep)))) : ""], ["REDACTED"]]));
          break;
        default:
          break;
      }
      // Dates anywhere in the (remaining) field, driven by the v2.5.1 data types.
      if (dateMode !== "keep" && type && !["remove", "remove-binary", "name"].includes(action)) {
        let dchanged = false;
        newReps = newReps.map((r) => walkDates(r, type, (v) => {
          const nv = transformDate(v, dateMode, dateShiftDays);
          if (nv !== v) dchanged = true;
          return nv;
        }));
        if (dchanged) {
          changed = true;
          if (!action) action = dateMode === "year" ? "date reduced to year" : `date shifted ${dateShiftDays} days`;
          else action += dateMode === "year" ? " + dates reduced to year" : " + dates shifted";
        }
      }
      if (name === "PID" && seq === 7) {
        const by = +(core.comp(raw, 1, compSep).slice(0, 4) || 0);
        if (by && refYear - by > 89) {
          newReps = [[[""]]];
          changed = true;
          action = "removed (age over 89; Safe Harbor aggregates ages 90+)";
        }
      }
      if (changed) {
        parts[i] = newReps.map((r) => r.map((c) => c.join(subSep)).join(compSep)).join(repSep);
        mark(loc, action);
      }
    }
    out.push(core.buildSegment(name, isMsh ? [fieldSep, ...parts.slice(1)] : parts.slice(1), ctx));
  }

  warnings.push(
    "Safe Harbor also requires that the releasing party has no actual knowledge that the remaining data could identify the person. Review local fields, free text and any coded values that are unique to the patient."
  );
  return {
    message: out.join("\r"),
    method: {
      standard: "HIPAA Safe Harbor, 45 CFR 164.514(b)(2), applied to HL7 v2.5.1 field definitions",
      dates: dateMode === "year" ? "all dates reduced to year" : dateMode === "shift" ? `all dates shifted by ${dateShiftDays} days (NOT Safe Harbor; dates must be reduced to year for Safe Harbor)` : "dates kept (NOT Safe Harbor)",
      pseudonyms: seed ? "HMAC-SHA256 with the supplied seed (repeatable across calls with the same seed)" : "HMAC-SHA256 with a random per-call key (not reversible, not repeatable)",
      freeText: redactFreeText ? "redacted" : "kept",
      providers: redactProviders ? "redacted" : "kept (provider names are not Safe Harbor identifiers of the patient)",
      zSegments: dropZSegments ? "removed (except ZDS, whose UID is remapped)" : "kept unchanged",
    },
    changes: [...changes].map(([location, action]) => ({ location, action })),
    counts: { fieldsChanged: changes.size },
    warnings: [...new Set(warnings)],
  };
}

/** Apply fn to every DT/DTM leaf of one repetition, following the data type tree. */
function walkDates(rep, type, fn) {
  if (type === "DT" || type === "DTM") return rep.map((c, i) => (i === 0 ? c.map((s, j) => (j === 0 && s ? fn(s) : s)) : c));
  const dt = core.getDatatype(type);
  if (!dt?.components?.length) return rep;
  return rep.map((subs, ci) => {
    const ct = dt.components[ci]?.type;
    if (!ct) return subs;
    if (ct === "DT" || ct === "DTM") return subs.map((s, si) => (si === 0 && s ? fn(s) : s));
    const sdt = core.getDatatype(ct);
    if (!sdt?.components?.length) return subs;
    return subs.map((s, si) => {
      const st = sdt.components[si]?.type;
      return (st === "DT" || st === "DTM") && s ? fn(s) : s;
    });
  });
}

export function register(server) {
  server.registerTool(
    "deidentify_message",
    {
      title: "De-identify an HL7 v2 message",
      description:
        "Remove or pseudonymise the HIPAA Safe Harbor identifiers an HL7 v2.5.1 message carries: names, addresses (state/country kept), phone numbers, SSN/licence numbers, MRNs, account/visit/order/accession numbers (keyed pseudonyms, consistent within the message), DICOM UIDs (new 2.25 UIDs), dates (year only by default) and ages over 89. Free text and embedded data are redacted and local Z-segments dropped by default. Returns the new message and a list of changed locations, never the original values.",
      inputSchema: {
        message,
        dateMode: z.enum(["year", "shift", "keep"]).default("year").describe("year = keep only the year (Safe Harbor, default); shift = move every date by dateShiftDays (not Safe Harbor); keep = leave dates."),
        dateShiftDays: z.coerce.number().int().optional().describe("Days to shift dates when dateMode is 'shift' (negative moves earlier)."),
        seed: z.string().min(8).optional().describe("Secret used to key the pseudonyms. Supply the same seed to get the same pseudonyms across messages; omit for a random per-call key."),
        redactFreeText: z.coerce.boolean().default(true).describe("Redact OBX-5 text values (TX/FT/ST), NTE-3 and PV2-12. Default true."),
        redactProviders: z.coerce.boolean().default(false).describe("Also redact provider names (XCN fields). Default false."),
        dropZSegments: z.coerce.boolean().default(true).describe("Remove local Z-segments whose content is unknown (ZDS is kept with its UID remapped). Default true."),
        keep: z.array(z.string()).default([]).describe("Fields to leave untouched, e.g. ['PID-8','OBR-4']."),
      },
      outputSchema: out({
        message: z.string(),
        method: z.record(z.string(), z.string()),
        changes: z.array(z.object({ location: z.string(), action: z.string() })),
        counts: z.object({ fieldsChanged: z.number() }),
        warnings: z.array(z.string()),
      }),
      annotations: { title: "De-identify an HL7 v2 message", ...READ_ONLY_NON_IDEMPOTENT },
    },
    async (input) => {
      try {
        return ok(deidentify(input));
      } catch (err) {
        return fail(`Cannot de-identify: ${err.message}`);
      }
    }
  );
}

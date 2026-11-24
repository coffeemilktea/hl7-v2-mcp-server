/**
 * HL7 v2.5.1 message validation, in layers:
 *  1. MSH and message-type checks (any message)
 *  2. segment sequence against the v2.5.1 abstract message syntax (structure.js)
 *  3. message-specific profiles with semantic checks (profiles/*)
 *  4. generic field checks: optionality, repetition, length, formats, tables (fields.js)
 */
import { comp, getEvent, getSegment, structures } from "hl7v2-core";
import { makeReport, checkTableCode, E } from "./report.js";
import { model, firstOf } from "./common.js";
import { checkStructure } from "./structure.js";
import { checkFields } from "./fields.js";
import { validateORM, validateOMI } from "./profiles/orders.js";
import { validateORU } from "./profiles/results.js";
import { validateADT_A01, validateADT_A03, validateADT_A04, validateADT_A08, validateADT_A31, validateADT_A40 } from "./profiles/adt.js";
import { validateSIU_S12 } from "./profiles/scheduling.js";

export const PROFILES = {
  "ADT^A01": { label: "Admit/Visit Notification", fn: validateADT_A01 },
  "ADT^A03": { label: "Discharge/End Visit", fn: validateADT_A03 },
  "ADT^A04": { label: "Register a Patient", fn: validateADT_A04 },
  "ADT^A08": { label: "Update Patient Information", fn: validateADT_A08 },
  "ADT^A31": { label: "Update Person Information", fn: validateADT_A31 },
  "ADT^A40": { label: "Merge Patient — Patient Identifier List", fn: validateADT_A40 },
  "OMI^O23": { label: "Imaging Order", fn: validateOMI },
  "ORM^O01": { label: "Order Message", fn: validateORM },
  "ORU^R01": { label: "Unsolicited Observation Result", fn: validateORU },
  "SIU^S12": { label: "Notification of New Appointment Booking", fn: validateSIU_S12 },
};

export function validateMessage(message) {
  const r = makeReport();
  const ctx = model(message);
  const { lines, compSep } = ctx;
  const segNames = lines.map((l) => l.substring(0, 3));
  const done = (info) => finish(r, { segNames, ...info });

  if (lines.length === 0) {
    r.err("message", "Message is empty.", E.SEQUENCE);
    return done({});
  }
  if (/^(FHS|BHS)/.test(lines[0])) {
    r.err("MSH", "This is a batch (FHS/BHS envelope). Validate each MSH message in the batch separately.", E.SEQUENCE);
    return done({});
  }
  if (!lines[0].startsWith("MSH") || lines[0].length < 8) {
    r.err("MSH", "The message must start with an MSH segment: MSH, the field separator and the four encoding characters (e.g. MSH|^~\\&|).", E.SEQUENCE);
    return done({});
  }

  // ── segment names ──
  const badNames = segNames.filter((n) => !/^[A-Z][A-Z0-9]{2}$/.test(n));
  if (badNames.length) r.err("message", `Malformed segment name(s): ${[...new Set(badNames)].join(", ")}. Segment names are three uppercase alphanumeric characters.`, E.SEQUENCE);
  const unknown = [...new Set(segNames.filter((n) => /^[A-Y][A-Z0-9]{2}$/.test(n) && !getSegment(n)))];
  if (unknown.length) r.warn("message", `Segment(s) not defined in v2.5.1: ${unknown.join(", ")}. Local segments must start with Z.`);

  // ── MSH ──
  const msh = ctx.segs[0];
  const m = msh.f;
  const encoding = m(2);
  if (encoding.length < 4) {
    r.err("MSH-2", `Encoding characters '${encoding}' must be four characters in v2.5.1: component, repetition, escape, subcomponent (normally ^~\\&).`, E.DATATYPE);
  } else if (encoding.length > 4) {
    r.warn("MSH-2", `MSH-2 has ${encoding.length} characters. v2.5.1 defines four; a fifth (truncation character) was introduced in v2.7.`);
  }
  if (new Set([ctx.fieldSep, ...encoding.slice(0, 4)]).size !== 1 + Math.min(4, encoding.length)) {
    r.err("MSH-2", "The field separator and encoding characters are not all distinct.", E.DATATYPE);
  } else if (/[A-Za-z0-9 ]/.test(ctx.fieldSep + encoding.slice(0, 4))) {
    r.warn("MSH-2", "Delimiters should not be letters, digits or spaces; such characters also occur in data.");
  }
  if (!m(3)) r.note("MSH-3", "Sending Application is empty. It is optional, but routing and audit usually depend on it.");
  if (!m(5)) r.note("MSH-5", "Receiving Application is empty. It is optional, but routing usually depends on it.");

  const msgCode = comp(m(9), 1, compSep).toUpperCase();
  const trigger = comp(m(9), 2, compSep).toUpperCase();
  const declared = comp(m(9), 3, compSep).toUpperCase();
  const typeKey = trigger ? `${msgCode}^${trigger}` : msgCode;
  const isAck = msgCode === "ACK";
  const ev = trigger && !isAck ? getEvent(typeKey) : null;
  if (m(9)) {
    if (!msgCode) r.err("MSH-9.1", "Message Code (MSG.1) is required.", E.REQUIRED);
    else checkTableCode(r, "MSH-9.1", "0076", msgCode, { code: E.MSG_TYPE });
    if (!trigger) {
      if (!isAck) r.err("MSH-9.2", "Trigger Event (MSG.2) is required: MSH-9 is Message Code^Trigger Event^Message Structure.", E.REQUIRED);
    } else if (checkTableCode(r, "MSH-9.2", "0003", trigger, { code: E.EVENT }) && !isAck && !ev && !r.has("MSH-9.1")) {
      r.err("MSH-9.2", `${typeKey} is not a message type/trigger event combination defined in v2.5.1.`, E.EVENT);
    }
    if (!declared) {
      r.warn("MSH-9.3", `Message Structure (MSG.3) is empty${ev ? `; for ${typeKey} it is ${ev.structure}` : isAck ? "; for an acknowledgment it is ACK" : ""}. Receivers use it to choose a parser.`);
    } else if (ev && ev.structure !== declared) {
      r.err("MSH-9.3", `Message Structure '${declared}' does not match ${typeKey}, which uses ${ev.structure} in v2.5.1.`, E.MSG_TYPE);
    } else if (isAck && declared !== "ACK") {
      r.err("MSH-9.3", `A general acknowledgment uses message structure ACK, not '${declared}'.`, E.MSG_TYPE);
    } else {
      checkTableCode(r, "MSH-9.3", "0354", declared, { code: E.MSG_TYPE });
    }
  }
  if (m(10).length > 20) r.err("MSH-10", `Message Control ID is ${m(10).length} characters; the v2.5.1 maximum is 20 (MSA-2 must echo it).`, E.DATATYPE);
  checkTableCode(r, "MSH-11.1", "0103", comp(m(11), 1, compSep), { code: E.PROC_ID });
  const version = comp(m(12), 1, compSep);
  if (version && version !== "2.5.1") {
    r.warn("MSH-12", `Version ID is '${version}'. This validator applies v2.5.1 definitions; segments, data types and tables differ in other versions. A v2.5.1-only receiver rejects it (AR, ERR-3 code 203).`);
  }

  const evn = firstOf(ctx, "EVN");
  const evnType = evn ? evn.f(1).toUpperCase() : "";
  if (evnType && trigger && evnType !== trigger) r.err("EVN-1", `EVN-1 is '${evnType}' but MSH-9.2 is '${trigger}'. When both are sent they must agree.`);

  // ── segment sequence ──
  const structs = structures();
  const structureId = structs[declared] && (!ev || ev.structure === declared) ? declared : ev?.structure ?? (isAck ? "ACK" : null);
  if (structureId && structs[structureId]) checkStructure(ctx, r, structs[structureId]);
  else if (msgCode) r.note("structure", `No v2.5.1 message structure is known for '${m(9)}', so segment order was not checked.`);

  // ── profile, then generic field checks ──
  const profile = PROFILES[typeKey] ?? null;
  if (profile) profile.fn(ctx, r);
  checkFields(ctx, r);
  if (r.zoneless.length) {
    r.note("timestamps", `${r.zoneless.length} time value(s) have no UTC offset (${r.zoneless.slice(0, 5).join(", ")}${r.zoneless.length > 5 ? ", ..." : ""}). That is allowed; the receiver assumes the sender's local time.`);
  }
  return done({ typeKey, structure: structureId, version, profile });
}

/** Most issues returned per severity; `counts` always has the totals. */
export const MAX_ISSUES = 200;

function finish(r, { typeKey, structure, version, profile, segNames }) {
  const counts = { errors: r.errors.length, warnings: r.warnings.length, info: r.info.length };
  const truncated = Object.values(counts).some((n) => n > MAX_ISSUES);
  return {
    valid: r.errors.length === 0,
    messageType: typeKey || null,
    messageStructure: structure || null,
    version: version || null,
    profileApplied: profile ? `${typeKey} — ${profile.label}` : "base and structure checks only",
    counts,
    ...(truncated ? { truncated: `Only the first ${MAX_ISSUES} issues of each severity are listed; counts has the totals.` } : {}),
    errors: r.errors.slice(0, MAX_ISSUES),
    warnings: r.warnings.slice(0, MAX_ISSUES),
    info: r.info.slice(0, MAX_ISSUES),
    segmentCount: segNames.length,
    segmentsFound: segNames.slice(0, MAX_ISSUES),
  };
}

/**
 * HL7 v2.5.1 message validation: base MSH/structural checks for any message,
 * plus deep profiles for the message types listed in PROFILES.
 */
import { dissect, fielder, comp, getEvent, getSegment } from "hl7v2-core";
import { makeReport, checkTs, checkTableCode } from "./report.js";
import { firstSeg } from "./common.js";
import { validateORM } from "./profiles/orders.js";
import { validateORU } from "./profiles/results.js";
import { validateADT_A08, validateADT_A31, validateADT_A40 } from "./profiles/adt.js";

export const PROFILES = {
  "ADT^A08": { label: "Update Patient Information", fn: validateADT_A08 },
  "ADT^A31": { label: "Update Person Information", fn: validateADT_A31 },
  "ADT^A40": { label: "Merge Patient — Patient Identifier List", fn: validateADT_A40 },
  "ORM^O01": { label: "Order Message", fn: validateORM },
  "ORU^R01": { label: "Unsolicited Observation Result", fn: validateORU },
};

export function validateMessage(message) {
  const r = makeReport();
  const ctx = dissect(message);
  const { lines, fieldSep, compSep } = ctx;

  if (lines.length === 0) {
    r.err("message", "Message is empty.");
    return finish(r, { typeKey: null, structure: null, version: null, profile: null, segNames: [] });
  }

  const segNames = lines.map((l) => l.substring(0, 3));

  // ── base structural checks ──
  if (!lines[0].startsWith("MSH")) r.err("MSH", "The first segment must be MSH.");

  const badNames = segNames.filter((n) => !/^[A-Z][A-Z0-9]{2}$/.test(n));
  if (badNames.length) {
    r.err("segments", `Malformed segment name(s): ${[...new Set(badNames)].join(", ")}. Segment names are three uppercase alphanumeric characters.`);
  }
  const unknown = [...new Set(segNames.filter((n) => /^[A-Y][A-Z0-9]{2}$/.test(n) && !getSegment(n)))];
  if (unknown.length) r.warn("segments", `Segment(s) not defined in v2.5.1: ${unknown.join(", ")}. Local segments should start with Z.`);

  const m = fielder(lines[0], fieldSep);
  const encoding = m(2);
  if (encoding.length < 4) {
    r.err("MSH-2", `Encoding characters '${encoding}' should be exactly four: component, repetition, escape, subcomponent (default ^~\\&).`);
  } else if (new Set([fieldSep, ...encoding.slice(0, 4)]).size !== 5) {
    r.err("MSH-2", "Field separator and encoding characters are not all distinct.");
  }

  if (!m(3)) r.warn("MSH-3", "Sending Application is empty. Optional in the standard, but routing and audit both depend on it.");
  if (!m(5)) r.warn("MSH-5", "Receiving Application is empty.");
  if (!m(7)) r.err("MSH-7", "Date/Time of Message is required.");
  else checkTs("MSH-7", comp(m(7), 1, compSep), r);

  const msgType = m(9);
  const msgCode = comp(msgType, 1, compSep).toUpperCase();
  const trigger = comp(msgType, 2, compSep).toUpperCase();
  const structure = comp(msgType, 3, compSep).toUpperCase();
  const typeKey = trigger ? `${msgCode}^${trigger}` : msgCode;

  if (!msgType) r.err("MSH-9", "Message Type is required.");
  else {
    checkTableCode(r, "MSH-9.1", "0076", msgCode);
    if (!trigger && msgCode !== "ACK") r.warn("MSH-9.2", "No trigger event in MSH-9.2. v2.5.1 expects Message Code^Trigger Event^Message Structure.");
    if (trigger) checkTableCode(r, "MSH-9.2", "0003", trigger);
  }
  const ev = trigger ? getEvent(typeKey) : null;
  if (!structure && msgCode !== "ACK") {
    r.note("MSH-9.3", `No Message Structure ID in MSH-9.3.${ev ? ` For ${typeKey} it is ${ev.structure}.` : ""} Populating it lets the receiver pick the right parser without inferring it from the trigger.`);
  } else if (structure && ev && ev.structure !== structure) {
    r.err("MSH-9.3", `Message Structure '${structure}' does not match ${typeKey}, which uses ${ev.structure} in v2.5.1.`);
  } else if (structure && msgCode !== "ACK") {
    checkTableCode(r, "MSH-9.3", "0354", structure);
  }

  if (!m(10)) r.err("MSH-10", "Message Control ID is required — acknowledgements echo it in MSA-2.");
  else if (m(10).length > 20) r.err("MSH-10", `Message Control ID is ${m(10).length} characters; the v2.5.1 maximum is 20.`);

  const procId = comp(m(11), 1, compSep);
  if (!procId) r.err("MSH-11", "Processing ID is required.");
  else checkTableCode(r, "MSH-11", "0103", procId);

  const version = comp(m(12), 1, compSep);
  if (!version) r.err("MSH-12", "Version ID is required.");
  else if (version !== "2.5.1") {
    r.warn("MSH-12", `Version ID is '${version}'. This validator applies v2.5.1 rules; segment and data-type definitions differ in other versions.`);
  }

  if (m(15)) checkTableCode(r, "MSH-15", "0155", m(15));
  if (m(16)) checkTableCode(r, "MSH-16", "0155", m(16));

  if (msgCode === "ADT") {
    const evnLine = firstSeg(ctx, "EVN");
    if (evnLine) {
      const evnType = fielder(evnLine, fieldSep)(1).toUpperCase();
      if (evnType && trigger && evnType !== trigger) {
        r.err("EVN-1", `EVN-1 is '${evnType}' but MSH-9.2 is '${trigger}'. When both are sent they must agree.`);
      }
    }
  }

  if (msgCode === "ACK" || msgCode === "ORR") {
    const msaLine = firstSeg(ctx, "MSA");
    if (!msaLine) r.err("MSA", `${msgCode} requires an MSA segment.`);
    else {
      const a = fielder(msaLine, fieldSep);
      if (!a(1)) r.err("MSA-1", "Acknowledgment Code is required.");
      else checkTableCode(r, "MSA-1", "0008", a(1));
      if (!a(2)) r.err("MSA-2", "Message Control ID is required — it must echo MSH-10 of the message being acknowledged.");
      if (a(3)) r.note("MSA-3", "MSA-3 Text Message is retained for backward compatibility only in v2.5.1; send error detail in ERR instead.");
      if (a(5)) r.err("MSA-5", "MSA-5 is withdrawn (W) in v2.5.1 and must not be populated.");
    }
  }

  // ── message-specific profile ──
  const profile = PROFILES[typeKey] ?? null;
  if (profile) profile.fn(ctx, r);
  else if (msgCode) {
    r.note("profile", `No deep profile for '${typeKey}'. Base structural checks were applied. Deep profiles exist for: ${Object.keys(PROFILES).join(", ")}.`);
  }

  ["MSH", "EVN", "MSA", "MRG", "SCH"].forEach((s) => {
    const count = segNames.filter((n) => n === s).length;
    if (count > 1 && !(s === "MRG" && typeKey === "ADT^A40") && !(s === "SCH" && typeKey === "SIU^S12")) {
      r.warn("structure", `Segment ${s} appears ${count} times; it should appear once.`);
    }
  });

  return finish(r, { typeKey, structure, version, profile, segNames });
}

function finish(r, { typeKey, structure, version, profile, segNames }) {
  return {
    valid: r.errors.length === 0,
    messageType: typeKey || null,
    messageStructure: structure || null,
    version: version || null,
    profileApplied: profile ? `${typeKey} — ${profile.label}` : "base checks only",
    counts: { errors: r.errors.length, warnings: r.warnings.length, info: r.info.length },
    errors: r.errors,
    warnings: r.warnings,
    info: r.info,
    segmentsFound: segNames,
  };
}

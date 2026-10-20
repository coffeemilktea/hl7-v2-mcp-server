/**
 * SIU^S12 Notification of New Appointment Booking (SIU_S12):
 * MSH SCH [{TQ1}] [{NTE}] [{PATIENT}] {RESOURCES: RGS [{SERVICE: AIS}] [{GENERAL_RESOURCE: AIG}]
 *   [{LOCATION_RESOURCE: AIL}] [{PERSONNEL_RESOURCE: AIP}]}
 */
import { fielder, comp } from "hl7v2-core";
import { checkTs, checkTableCode } from "../report.js";
import { checkPid, firstSeg, segLines, hasSeg } from "../common.js";

export function validateSIU_S12(ctx, r) {
  const { lines, fieldSep, compSep } = ctx;
  const schLines = segLines(ctx, "SCH");
  if (schLines.length === 0) {
    r.err("SCH", "SCH is required in SIU^S12 — it carries the appointment being booked.");
  } else {
    if (schLines.length > 1) r.err("SCH", `${schLines.length} SCH segments; SIU_S12 carries exactly one.`);
    if (lines[1] !== schLines[0]) r.err("SCH", "SCH must immediately follow MSH in SIU_S12.");
    const s = fielder(schLines[0], fieldSep);
    if (!comp(s(1), 1, compSep) && !comp(s(2), 1, compSep)) {
      r.err("SCH-1/2", "Neither Placer Appointment ID (SCH-1) nor Filler Appointment ID (SCH-2) is present. Both are conditional in v2.5.1, but at least one must identify the appointment or later S13–S15 messages cannot refer to it.");
    }
    if (!comp(s(6), 1, compSep)) r.err("SCH-6", "Event Reason is required in v2.5.1.");
    if (!s(16)) r.err("SCH-16", "Filler Contact Person is required in v2.5.1.");
    if (!s(20)) r.err("SCH-20", "Entered By Person is required in v2.5.1.");
    if (s(11)) {
      r.note("SCH-11", "SCH-11 Appointment Timing Quantity (TQ) is retained for backward compatibility only (B) in v2.5.1; send the appointment start, duration and repeat pattern in TQ1.");
      const start = comp(s(11), 4, compSep);
      if (start) checkTs("SCH-11.4", comp(start, 1, ctx.subSep), r);
    }
    if (s(25)) checkTableCode(r, "SCH-25", "0278", comp(s(25), 1, compSep), { severity: "warning" });
    if (s(8)) checkTableCode(r, "SCH-8", "0277", comp(s(8), 1, compSep), { severity: "warning" });
    if (!s(11) && !hasSeg(ctx, "TQ1")) {
      r.warn("SCH-11/TQ1", "No appointment timing: neither TQ1 nor SCH-11 is present, so the receiver cannot place the booking on a schedule. AIS-4/AIL-6/AIP-6 may still give per-resource start times.");
    }
  }

  segLines(ctx, "TQ1").forEach((line, i) => {
    const t = fielder(line, fieldSep);
    const tag = `TQ1[${i + 1}]`;
    if (t(7)) checkTs(`${tag}-7`, comp(t(7), 1, compSep), r);
    if (t(8)) checkTs(`${tag}-8`, comp(t(8), 1, compSep), r);
  });

  const pidLine = firstSeg(ctx, "PID");
  if (pidLine) checkPid(pidLine, ctx, r);
  else r.note("PID", "No PID segment. The PATIENT group is optional in SIU_S12 (a booking can reserve resources only), but patient appointments need it.");

  // RESOURCES groups start at RGS; AIS/AIG/AIL/AIP must follow an RGS.
  const rgsCount = segLines(ctx, "RGS").length;
  if (rgsCount === 0) r.err("RGS", "At least one RGS (resource group) is required in SIU_S12.");
  let inGroup = false;
  const counters = { AIS: 0, AIG: 0, AIL: 0, AIP: 0, RGS: 0 };
  lines.forEach((line) => {
    const name = line.slice(0, 3);
    if (!(name in counters)) return;
    counters[name]++;
    const f = fielder(line, fieldSep);
    const tag = `${name}[${counters[name]}]`;
    if (name === "RGS") {
      inGroup = true;
      if (!f(1)) r.err(`${tag}-1`, "Set ID - RGS is required.");
      if (f(2)) checkTableCode(r, `${tag}-2`, "0206", f(2));
      return;
    }
    if (!inGroup) r.err(tag, `${name} appears before any RGS. Every resource segment belongs to a RESOURCES group that starts with RGS.`);
    if (!f(1)) r.err(`${tag}-1`, `Set ID - ${name} is required.`);
    if (f(2)) checkTableCode(r, `${tag}-2`, "0206", f(2));
    if (name === "AIS") {
      if (!comp(f(3), 1, compSep)) r.err(`${tag}-3`, "Universal Service Identifier is required in AIS — it names the service being booked.");
      if (f(4)) checkTs(`${tag}-4`, comp(f(4), 1, compSep), r);
    } else if (name === "AIG") {
      if (!comp(f(3), 1, compSep)) r.warn(`${tag}-3`, "No Resource ID in AIG; the general resource being booked is not identified.");
      if (f(8)) checkTs(`${tag}-8`, comp(f(8), 1, compSep), r);
    } else if (name === "AIL") {
      if (!f(3)) r.warn(`${tag}-3`, "No Location Resource ID; the location being booked is not identified.");
      if (f(6)) checkTs(`${tag}-6`, comp(f(6), 1, compSep), r);
    } else if (name === "AIP") {
      if (!f(3)) r.warn(`${tag}-3`, "No Personnel Resource ID; the person being booked is not identified.");
      if (f(6)) checkTs(`${tag}-6`, comp(f(6), 1, compSep), r);
    }
  });
  if (rgsCount && !counters.AIS && !counters.AIG && !counters.AIL && !counters.AIP) {
    r.warn("RGS", "RESOURCES group(s) carry no AIS, AIG, AIL or AIP, so the booking names no service, resource, location or person.");
  }
  if (hasSeg(ctx, "MRG")) r.err("MRG", "MRG has no place in SIU^S12.");
}

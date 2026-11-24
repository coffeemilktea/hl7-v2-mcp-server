/**
 * SIU^S12 Notification of New Appointment Booking (SIU_S12):
 * MSH [{SFT}] SCH [{TQ1}] [{NTE}] [{PATIENT}] {RESOURCES: RGS [{AIS [{NTE}]}] [{AIG [{NTE}]}] [{AIL [{NTE}]}] [{AIP [{NTE}]}]}
 * Structure, required fields and formats are generic; these are the semantic checks.
 */
import { comp } from "hl7v2-core";
import { checkTableCode } from "../report.js";
import { checkPid, firstOf, segsOf, at } from "../common.js";

export function validateSIU_S12(ctx, r) {
  const { compSep } = ctx;
  const sch = firstOf(ctx, "SCH");
  if (sch) {
    if (!comp(sch.f(1), 1, compSep) && !comp(sch.f(2), 1, compSep)) {
      r.err(at(sch, 1), "Neither Placer Appointment ID (SCH-1) nor Filler Appointment ID (SCH-2) is present. Both are conditional, but one must identify the appointment or later S13–S15 messages cannot refer to it.", "101");
    }
    checkTableCode(r, at(sch, 8, { comp: 1 }), "0277", comp(sch.f(8), 1, compSep), { severity: "warning" });
    checkTableCode(r, at(sch, 25, { comp: 1 }), "0278", comp(sch.f(25), 1, compSep), { severity: "warning" });
    if (!sch.f(11) && !firstOf(ctx, "TQ1")) {
      r.warn("TQ1", "No appointment timing: neither TQ1 nor SCH-11 is present. AIS-4/AIL-6/AIP-6 may still give per-resource start times.");
    }
  }
  const pid = firstOf(ctx, "PID");
  if (pid) checkPid(ctx, r, pid);
  else r.note("PID", "No PID segment. The PATIENT group is optional in SIU_S12 (a booking can reserve resources only), but patient appointments need it.");

  const resources = ["AIS", "AIG", "AIL", "AIP"].flatMap((n) => segsOf(ctx, n));
  if (segsOf(ctx, "RGS").length && !resources.length) {
    r.warn("RGS", "The RESOURCES group(s) carry no AIS, AIG, AIL or AIP, so the booking names no service, resource, location or person.");
  }
  for (const s of resources) {
    if (s.name !== "AIS" && !comp(s.f(3), 1, compSep)) r.warn(at(s, 3), `No resource identifier in ${s.name}-3; the ${s.name === "AIG" ? "resource" : s.name === "AIL" ? "location" : "person"} being booked is not identified.`);
  }
}

/**
 * ADT profiles: A01, A03, A04, A08, A31, A40. Segment order, required
 * segments and fields are checked generically; these are the semantic checks.
 */
import { comp, reps } from "hl7v2-core";
import { checkPid, checkPv1, firstOf, segsOf, at } from "../common.js";
import { checkTableCode } from "../report.js";

/** PID + PV1 checks shared by the visit-level events. Returns the PV1 seg (or undefined). */
function visitCore(ctx, r) {
  const pid = firstOf(ctx, "PID");
  if (pid) checkPid(ctx, r, pid);
  const pv1 = firstOf(ctx, "PV1");
  if (pv1) checkPv1(ctx, r, pv1);
  return pv1;
}

export function validateADT_A01(ctx, r) {
  const pv1 = visitCore(ctx, r);
  if (pv1) {
    const cls = pv1.f(2).trim().toUpperCase();
    if (cls === "O" || cls === "P") {
      r.warn(at(pv1, 2), `Patient Class '${pv1.f(2)}' on an A01. v2.5.1 §3.3.1 intends A01 for admitted patients; an outpatient or pre-admit visit is A04 (register) or A05 (pre-admit).`);
    }
    if (!pv1.f(3)) r.warn(at(pv1, 3), "No Assigned Patient Location. An admission (A01) assigns the patient to a bed; bed boards and worklists key on PV1-3.");
    if (!pv1.f(19)) r.warn(at(pv1, 19), "No Visit Number. Later A02/A03/A08 messages for this stay need PV1-19 to find the right encounter.");
    if (!pv1.f(44)) r.warn(at(pv1, 44), "No Admit Date/Time. An A01 records an admission; PV1-44 is where receivers read when it happened.");
    if (pv1.f(45)) r.warn(at(pv1, 45), "Discharge Date/Time is populated on an admission. If the patient has left, send A03.");
  }
  r.note("ADT^A01", "A01 is for admitted (inpatient) encounters. Outpatient and emergency check-ins are normally A04; cancelling an admission is A11, not a second A01.");
}

export function validateADT_A04(ctx, r) {
  const pv1 = visitCore(ctx, r);
  if (pv1) {
    if (pv1.f(2).trim().toUpperCase() === "I") {
      r.warn(at(pv1, 2), "Patient Class 'I' (Inpatient) on an A04. v2.5.1 §3.3.4 uses A04 for patients who arrive or check in without being assigned a bed; an inpatient admission is A01.");
    }
    if (!pv1.f(19)) r.warn(at(pv1, 19), "No Visit Number. Orders and results for this visit cannot be tied back to the registration without PV1-19.");
    if (pv1.f(45)) r.warn(at(pv1, 45), "Discharge Date/Time is populated on a registration. Ending the visit is A03.");
  }
  r.note("ADT^A04", "A04 registers an outpatient or emergency visit and shares the ADT_A01 structure. A cancellation is A11.");
}

export function validateADT_A03(ctx, r) {
  const pv1 = visitCore(ctx, r);
  if (pv1) {
    if (!pv1.f(45)) r.warn(at(pv1, 45), "No Discharge Date/Time. v2.5.1 §3.3.3: an A03 signals the patient's status changed to discharged and a discharge date was recorded; receivers read it from PV1-45.");
    if (!pv1.f(19)) r.warn(at(pv1, 19), "No Visit Number. The receiver cannot tell which open encounter to close without PV1-19.");
    checkTableCode(r, at(pv1, 36), "0112", pv1.f(36), { severity: "warning" });
  }
  r.note("ADT^A03", "A03 ends the visit. Undoing a discharge sent in error is A13 (cancel discharge), not an A08.");
}

export function validateADT_A08(ctx, r) {
  const pv1 = visitCore(ctx, r);
  if (pv1 && !pv1.f(19)) {
    r.warn(at(pv1, 19), "No Visit Number. A08 is a visit-level update; without PV1-19 a receiver holding several open encounters for this patient cannot tell which one to update.");
  }
  r.note("ADT^A08", "A08 updates an existing patient and visit; receivers match on PID-3. If the identifier itself changes, use A40 (merge) or the appropriate change-identifier event, not A08.");
}

export function validateADT_A31(ctx, r) {
  const pv1 = visitCore(ctx, r);
  if (pv1) {
    if (pv1.f(19)) {
      r.warn(at(pv1, 19), "A31 is a person-level update but PV1-19 Visit Number is populated. Receivers may apply the change to that visit only; send A08 if a specific encounter is the target.");
    }
    const cls = pv1.f(2).trim().toUpperCase();
    if (cls && !["N", "U"].includes(cls)) r.note(at(pv1, 2), `Patient Class is '${pv1.f(2)}' on a person-level event. N (Not Applicable) is the conventional value when there is no encounter.`);
  }
  r.note("ADT^A31", "A31 updates the person with no encounter context; PV1 is still mandatory in ADT_A05, so send it minimally populated (PV1-2 = N).");
}

/** ADT_A39: MSH [{SFT}] EVN { PID [PD1] MRG [PV1] } — every PID is paired with the MRG that follows it. */
export function validateADT_A40(ctx, r) {
  const { compSep, repSep } = ctx;
  const pids = segsOf(ctx, "PID");
  const mrgs = segsOf(ctx, "MRG");
  if (pids.length > 1) r.note("PATIENT", `${pids.length} merge pairs in one message. Legal (the PATIENT group repeats), but confirm the receiver processes every pair, not just the first.`);
  pids.forEach((pid) => {
    checkPid(ctx, r, pid);
    const mrg = mrgs.find((m) => m.index > pid.index && !pids.some((p) => p.index > pid.index && p.index < m.index));
    if (!mrg) return;
    const prior = reps(mrg.f(1), repSep)[0];
    if (!prior) return;
    const survivor = reps(pid.f(3), repSep)[0] ?? "";
    const [sId, pId] = [comp(survivor, 1, compSep), comp(prior, 1, compSep)];
    const [sAuth, pAuth] = [comp(survivor, 4, compSep), comp(prior, 4, compSep)];
    if (!pId) r.err(at(mrg, 1, { comp: 1 }), "Prior identifier (MRG-1.1) is empty.", "101");
    if (sId && pId && sId === pId && sAuth === pAuth) {
      r.err(at(mrg, 1), `Self-merge: the prior identifier '${pId}' is the surviving identifier in ${pid.tag}-3. Depending on the receiver this either no-ops or collapses the record onto itself.`);
    }
    if (sAuth && pAuth && sAuth !== pAuth) {
      r.warn(at(mrg, 1, { comp: 4 }), `Merging across assigning authorities ('${pAuth}' into '${sAuth}' in ${pid.tag}-3.4). Occasionally intended during a facility consolidation; far more often a build error that merges two unrelated people.`);
    }
    if (pId && !pAuth) r.warn(at(mrg, 1, { comp: 4 }), "Prior identifier has no Assigning Authority, so the receiver must guess which namespace the retired MRN belongs to.");
  });
  if (segsOf(ctx, "PV1").length) r.note("PV1", "PV1 is optional in ADT_A39 and does not scope the merge: A40 applies at the identifier level, across every encounter.");
  r.note("ADT^A40", "After this message every downstream system must re-key data from MRG-1 onto PID-3. Verify PACS/VNA consume A40 rather than silently acknowledging it.");
}

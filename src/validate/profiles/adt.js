/** ADT profiles: A08, A31, A40. */
import { fielder, comp, reps } from "hl7v2-core";
import { checkEvn, checkPid, checkPv1, firstSeg, segLines, hasSeg } from "../common.js";

/** EVN + PID + PV1 checks shared by the visit-level events. Returns the PV1 accessor (or null). */
function visitCore(ctx, r, event, structure) {
  checkEvn(ctx, r);
  const pidLine = firstSeg(ctx, "PID");
  if (!pidLine) r.err("PID", `PID is required in ADT^${event}.`);
  else checkPid(pidLine, ctx, r);
  const pv1Line = firstSeg(ctx, "PV1");
  if (!pv1Line) {
    r.err("PV1", `PV1 is required — ADT^${event} uses the ${structure} structure, in which PV1 is mandatory.`);
    return null;
  }
  return checkPv1(pv1Line, ctx, r);
}

function noMrg(ctx, r, event) {
  if (hasSeg(ctx, "MRG")) {
    r.err("MRG", `MRG must not appear in ADT^${event}. Merging identities is ADT^A40 (ADT_A39 structure); an ADT^${event} carrying MRG will be ignored or misapplied.`);
  }
}

export function validateADT_A08(ctx, r) {
  const v = visitCore(ctx, r, "A08", "ADT_A01");
  if (v && !v(19)) {
    r.warn("PV1-19", "No Visit Number. A08 is a visit-level update; without PV1-19 a receiver holding several open encounters for this patient cannot tell which one to update.");
  }
  noMrg(ctx, r, "A08");
  r.note("ADT^A08", "A08 updates an existing patient and visit; receivers match on PID-3. If the identifier itself is changing this is not an A08 — use A40 to merge, or the appropriate change-identifier event. Downstream PACS must apply A08 demographic corrections or the images keep the old spelling permanently.");
}

export function validateADT_A31(ctx, r) {
  checkEvn(ctx, r);
  const pidLine = firstSeg(ctx, "PID");
  if (!pidLine) r.err("PID", "PID is required in ADT^A31.");
  else checkPid(pidLine, ctx, r);

  const pv1Line = firstSeg(ctx, "PV1");
  if (!pv1Line) {
    r.err("PV1", "PV1 is required — ADT^A31 uses the ADT_A05 structure, in which PV1 is mandatory by the abstract syntax even though A31 is a person-level event. Send it minimally populated.");
  } else {
    const v = checkPv1(pv1Line, ctx, r);
    if (v(19)) {
      r.warn("PV1-19", "A31 is a PERSON-level update but PV1-19 Visit Number is populated. Receivers may treat this as a visit update and apply the change to the wrong scope — send A08 if a specific encounter is the target.");
    }
    if (v(2) && !["N", "U"].includes(v(2).toUpperCase())) {
      r.note("PV1-2", `Patient Class is '${v(2)}' on a person-level event. N (Not Applicable) is the conventional filler when there is no encounter.`);
    }
  }
  if (hasSeg(ctx, "MRG")) r.err("MRG", "MRG must not appear in ADT^A31. Merging identities is ADT^A40.");
  r.note("ADT^A31", "A31 updates the master person record with no encounter context; A08 updates a specific visit. Sites that send A31 where the receiver only subscribes to A08 (or the reverse) get demographic drift that surfaces months later as mismatched studies.");
}

export function validateADT_A40(ctx, r) {
  const { lines, fieldSep, compSep, repSep } = ctx;
  checkEvn(ctx, r);

  const pidIdx = [];
  const mrgIdx = [];
  lines.forEach((l, i) => {
    if (l.slice(0, 3) === "PID") pidIdx.push(i);
    if (l.slice(0, 3) === "MRG") mrgIdx.push(i);
  });

  if (pidIdx.length === 0) r.err("PID", "PID is required — it carries the surviving identity.");
  if (mrgIdx.length === 0) r.err("MRG", "MRG is required in ADT^A40 — it carries the prior (losing) identifier. Without it the message says nothing about what to merge.");
  if (pidIdx.length !== mrgIdx.length) {
    r.err("PID/MRG", `${pidIdx.length} PID and ${mrgIdx.length} MRG segment(s). ADT_A39 repeats the PATIENT group as { PID [PD1] MRG [PV1] } — every PID must be paired with exactly one MRG.`);
  }
  if (pidIdx.length > 1) {
    r.note("PATIENT group", `${pidIdx.length} merge pairs in one message. This is legal — the PATIENT group repeats — but confirm the receiver processes every pair and not just the first.`);
  }

  const pairs = Math.min(pidIdx.length, mrgIdx.length);
  for (let i = 0; i < pairs; i++) {
    const tag = pairs > 1 ? `[pair ${i + 1}]` : "";
    const p = fielder(lines[pidIdx[i]], fieldSep);
    const m = fielder(lines[mrgIdx[i]], fieldSep);

    if (mrgIdx[i] < pidIdx[i]) r.err(`MRG${tag}`, "MRG appears before its PID. Within the PATIENT group the order is PID [PD1] MRG [PV1].");
    checkPid(lines[pidIdx[i]], ctx, r);

    const priorReps = reps(m(1), repSep);
    if (priorReps.length === 0) {
      r.err(`MRG-1${tag}`, "Prior Patient Identifier List is required — this is the identifier being retired.");
      continue;
    }
    const survivor = reps(p(3), repSep)[0] ?? "";
    const prior = priorReps[0];
    const sId = comp(survivor, 1, compSep);
    const pId = comp(prior, 1, compSep);
    const sAuth = comp(survivor, 4, compSep);
    const pAuth = comp(prior, 4, compSep);

    if (!pId) r.err(`MRG-1.1${tag}`, "Prior identifier component is empty.");
    if (sId && pId && sId === pId && sAuth === pAuth) {
      r.err(`PID-3/MRG-1${tag}`, `Self-merge: the surviving identifier '${sId}' is identical to the prior identifier. Depending on the receiver this either no-ops or collapses the record onto itself and orphans its studies.`);
    }
    if (sAuth && pAuth && sAuth !== pAuth) {
      r.warn(`PID-3.4/MRG-1.4${tag}`, `Merging across assigning authorities ('${pAuth}' into '${sAuth}'). This is occasionally intended during a facility consolidation, but far more often it is a build error that merges two unrelated people.`);
    }
    if (!pAuth) r.warn(`MRG-1.4${tag}`, "Prior identifier has no Assigning Authority, so the receiver must guess which namespace the retiring MRN belongs to.");
    if (m(2) || m(4)) {
      r.note(`MRG-2/4${tag}`, "MRG-2 Prior Alternate Patient ID and MRG-4 Prior Patient ID are retained for backward compatibility only (B) in v2.5.1; carry prior identifiers as repeats of MRG-1.");
    }
  }

  if (segLines(ctx, "PV1").length) {
    r.note("PV1", "PV1 is optional in ADT_A39 and does not scope the merge — an A40 always applies at the identifier level, across every encounter.");
  }
  r.note("ADT^A40", "After this message every downstream imaging system must re-key studies from MRG-1 onto PID-3. Verify the PACS and VNA actually consume A40 rather than silently acking it — studies stranded under the retired MRN are the usual failure, and they surface only when a clinician cannot find a prior.");
}

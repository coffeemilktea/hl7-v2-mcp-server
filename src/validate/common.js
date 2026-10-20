/** Segment checks shared by several profiles. */
import { fielder, comp, reps } from "hl7v2-core";
import { checkTs, checkTableCode } from "./report.js";

export const segLines = (ctx, name) => ctx.lines.filter((l) => l.startsWith(name + ctx.fieldSep) || l === name);
export const firstSeg = (ctx, name) => segLines(ctx, name)[0];
export const hasSeg = (ctx, name) => segLines(ctx, name).length > 0;

/** Shared PID checks used by every patient-bearing message. */
export function checkPid(pidLine, ctx, r, { requireName = true, prefix = "" } = {}) {
  const { fieldSep, compSep, repSep } = ctx;
  const p = fielder(pidLine, fieldSep);
  const L = (s) => `${prefix}${s}`;

  const idReps = reps(p(3), repSep);
  if (idReps.length === 0) {
    r.err(L("PID-3"), "Patient Identifier List is required — this is the MRN that joins images, orders and reports to the person.");
  } else {
    idReps.forEach((rep, i) => {
      const tag = L(idReps.length > 1 ? `PID-3[${i + 1}]` : "PID-3");
      if (!comp(rep, 1, compSep)) r.err(`${tag}.1`, "Identifier component is empty.");
      if (!comp(rep, 4, compSep)) r.warn(`${tag}.4`, "No Assigning Authority. An MRN without its authority is ambiguous once a second facility feeds the same system.");
      if (!comp(rep, 5, compSep)) r.warn(`${tag}.5`, "No Identifier Type Code (MR, PI, SS, DL...). Receivers use this to pick the right identifier out of the list.");
      else checkTableCode(r, `${tag}.5`, "0203", comp(rep, 5, compSep), { severity: "warning" });
    });
  }

  const nameReps = reps(p(5), repSep);
  if (nameReps.length === 0) {
    if (requireName) r.err(L("PID-5"), "Patient Name is required.");
  } else if (!comp(nameReps[0], 1, compSep)) {
    r.err(L("PID-5.1"), "Family Name is empty.");
  }

  if (p(7)) checkTs(L("PID-7"), comp(p(7), 1, compSep), r);
  if (p(8)) checkTableCode(r, L("PID-8"), "0001", p(8), { severity: "warning" });
  if (p(29)) checkTs(L("PID-29"), comp(p(29), 1, compSep), r);
  if (p(2)) r.note(L("PID-2"), "PID-2 is retained for backward compatibility only in v2.5.1 — carry all identifiers as repeats of PID-3.");
  if (p(19)) r.note(L("PID-19"), "PID-19 SSN is retained for backward compatibility only in v2.5.1 — send the SSN as a PID-3 repeat with identifier type SS.");
  if (p(20)) r.note(L("PID-20"), "PID-20 Driver's License is retained for backward compatibility only in v2.5.1 — use a PID-3 repeat with identifier type DL.");
  return p;
}

/** Shared EVN checks for ADT messages. */
export function checkEvn(ctx, r) {
  const { lines, fieldSep, compSep } = ctx;
  const evnLine = firstSeg(ctx, "EVN");
  if (!evnLine) {
    r.err("EVN", "EVN segment is required in every ADT message.");
    return;
  }
  const idx = lines.indexOf(evnLine);
  const between = lines.slice(1, idx).filter((l) => !l.startsWith("SFT"));
  if (between.length) r.err("EVN", "EVN must immediately follow MSH (only SFT may sit between them in v2.5.1).");
  const e = fielder(evnLine, fieldSep);
  if (!e(2)) r.err("EVN-2", "Recorded Date/Time is required.");
  else checkTs("EVN-2", comp(e(2), 1, compSep), r);
  if (e(6)) checkTs("EVN-6", comp(e(6), 1, compSep), r);
  if (e(1)) r.note("EVN-1", "EVN-1 Event Type Code is retained only for backward compatibility in v2.5.1; MSH-9 is authoritative and the two must agree.");
}

/** Shared PV1 checks. */
export function checkPv1(pv1Line, ctx, r) {
  const { fieldSep, compSep } = ctx;
  const v = fielder(pv1Line, fieldSep);
  if (!v(2)) r.err("PV1-2", "Patient Class is required.");
  else checkTableCode(r, "PV1-2", "0004", v(2), { strictUser: true });
  if (v(44)) checkTs("PV1-44", comp(v(44), 1, compSep), r);
  if (v(45)) checkTs("PV1-45", comp(v(45), 1, compSep), r);
  return v;
}

/** Shared ORC checks (order control, identifiers, timestamps). */
export function checkOrc(line, tag, ctx, r) {
  const { fieldSep, compSep } = ctx;
  const o = fielder(line, fieldSep);
  const ctrl = o(1).toUpperCase();
  const placer = o(2);
  const filler = o(3);
  if (!ctrl) r.err(`${tag}-1`, "Order Control is required — it determines what the receiver does with the order.");
  else checkTableCode(r, `${tag}-1`, "0119", o(1));
  if (!placer && !filler) {
    r.err(`${tag}-2/3`, "Neither Placer Order Number (ORC-2) nor Filler Order Number (ORC-3) is present — the order cannot be identified by the receiver.");
  }
  if (["CA", "DC", "HD", "RL", "RP", "SC", "XO"].includes(ctrl) && !placer && !filler) {
    r.err(`${tag}-1`, `Order Control '${ctrl}' acts on an order that already exists, but no order number is supplied to identify it.`);
  }
  if (ctrl === "NW" && filler && !placer) r.warn(`${tag}-2`, "New order (NW) supplies a filler order number but no placer order number.");
  if (ctrl === "SC" && !o(5)) {
    r.warn(`${tag}-5`, "Status Change (SC) sent without ORC-5 Order Status. Receivers that key off ORC-5 will not know what the new status is — and a receiver that mistakes SC for NW creates a duplicate worklist entry.");
  }
  if (o(5)) checkTableCode(r, `${tag}-5`, "0038", o(5), { severity: "warning" });
  if (o(9)) checkTs(`${tag}-9`, comp(o(9), 1, compSep), r);
  if (o(15)) checkTs(`${tag}-15`, comp(o(15), 1, compSep), r);
  return o;
}

/** Shared OBR checks for order messages. */
export function checkOrderObr(line, tag, ctx, r) {
  const { fieldSep, compSep } = ctx;
  const b = fielder(line, fieldSep);
  if (!b(4)) r.err(`${tag}-4`, "Universal Service Identifier is required — it carries the procedure code being ordered.");
  else if (!comp(b(4), 1, compSep)) r.err(`${tag}-4.1`, "Universal Service Identifier has no value in component 1 (Identifier).");
  if (b(7)) checkTs(`${tag}-7`, comp(b(7), 1, compSep), r);
  if (b(36)) checkTs(`${tag}-36`, comp(b(36), 1, compSep), r);
  if (b(25)) r.note(`${tag}-25`, "OBR-25 Result Status is populated on an order message; it is normally set on the ORU that returns the result.");
  return b;
}

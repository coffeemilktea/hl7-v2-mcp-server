/** Segment model and the shared semantic checks used by several profiles. */
import { dissect, fielder, comp, reps } from "hl7v2-core";
import { checkTableCode } from "./report.js";

/**
 * Dissect a message into { ...delimiters, lines, segs } where each seg is
 * { name, line, index, occ, tag, f } — `tag` is the canonical segment
 * reference (PID, or OBX[2] when OBX occurs more than once) and f(n) the raw
 * field accessor with standard MSH numbering.
 */
export function model(message) {
  const ctx = dissect(message);
  const totals = {};
  for (const l of ctx.lines) totals[l.slice(0, 3)] = (totals[l.slice(0, 3)] ?? 0) + 1;
  const seen = {};
  ctx.segs = ctx.lines.map((line, index) => {
    const name = line.slice(0, 3);
    const occ = (seen[name] = (seen[name] ?? 0) + 1);
    return { name, line, index, occ, tag: totals[name] > 1 ? `${name}[${occ}]` : name, f: fielder(line, ctx.fieldSep) };
  });
  return ctx;
}

export const segsOf = (ctx, name) => ctx.segs.filter((s) => s.name === name);
export const firstOf = (ctx, name) => ctx.segs.find((s) => s.name === name);

/** Canonical location: seg tag, field, optional repetition (>1), component, subcomponent. */
export function at(seg, field, { rep, comp: c, sub } = {}) {
  return `${seg.tag}-${field}${rep > 1 ? `[${rep}]` : ""}${c ? `.${c}` : ""}${c && sub ? `.${sub}` : ""}`;
}

/** Semantic PID checks beyond optionality and data types (which the generic layer covers). */
export function checkPid(ctx, r, pid) {
  const { compSep, repSep } = ctx;
  reps(pid.f(3), repSep).forEach((rep, i) => {
    const o = { rep: i + 1 };
    if (!comp(rep, 1, compSep)) r.err(at(pid, 3, { ...o, comp: 1 }), "Identifier (CX.1 ID Number) is empty.", "101");
    if (!comp(rep, 4, compSep)) r.warn(at(pid, 3, { ...o, comp: 4 }), "No Assigning Authority. An MRN without its authority is ambiguous once a second facility feeds the same system.");
    if (!comp(rep, 5, compSep)) r.warn(at(pid, 3, { ...o, comp: 5 }), "No Identifier Type Code (MR, PI, SS, DL...). Receivers use this to pick the right identifier out of the list.");
  });
  const name = reps(pid.f(5), repSep)[0];
  // XPN components are all optional in v2.5.1, so a name without a family name is conformant but rarely intended.
  if (name && !comp(name, 1, compSep)) r.warn(at(pid, 5, { comp: 1 }), "Family Name (XPN.1) is empty; patient matching usually depends on it.");
}

/** Shared PV1 checks. Patient class is a User table, but an unknown class breaks every downstream worklist, so it is an error. */
export function checkPv1(ctx, r, pv1) {
  checkTableCode(r, at(pv1, 2), "0004", pv1.f(2), { strictUser: true });
}

/** Shared ORC checks (order control semantics and identification). */
export function checkOrc(ctx, r, orc) {
  const ctrl = orc.f(1).toUpperCase();
  const placer = orc.f(2);
  const filler = orc.f(3);
  if (!placer && !filler) {
    r.err(at(orc, 2), `Neither Placer Order Number (ORC-2) nor Filler Order Number (ORC-3) is present${["CA", "DC", "HD", "RL", "RP", "SC", "XO"].includes(ctrl) ? `; order control '${ctrl}' acts on an existing order that cannot be identified` : ""}.`, "101");
  }
  if (ctrl === "NW" && filler && !placer) r.warn(at(orc, 2), "New order (NW) supplies a filler order number but no placer order number.");
  if (ctrl === "SC" && !orc.f(5)) {
    r.warn(at(orc, 5), "Status Change (SC) sent without ORC-5 Order Status. Receivers that key off ORC-5 will not know what the new status is.");
  }
}

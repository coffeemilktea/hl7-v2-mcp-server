/** Result profile: ORU^R01 (semantic checks; structure and field formats are generic). */
import { comp, validCodeSet } from "hl7v2-core";
import { checkTableCode } from "../report.js";
import { checkPid, firstOf, at } from "../common.js";

export function validateORU(ctx, r) {
  const { compSep } = ctx;
  const pid = firstOf(ctx, "PID");
  if (pid) checkPid(ctx, r, pid);
  else r.warn("PID", "No PID segment. The PATIENT group is optional in ORU_R01, but a result with no patient cannot be filed by a real receiver.");

  // OBX segments belong to the OBR before them (SPECIMEN-group OBX after an SPM are skipped).
  const groups = [];
  let cur = null;
  for (const s of ctx.segs) {
    if (s.name === "OBR") groups.push((cur = { obr: s, obx: [] }));
    else if (s.name === "SPM") cur = null;
    else if (s.name === "OBX" && cur) cur.obx.push(s);
  }

  const obxStatus = validCodeSet("0085");
  const obrStatus = validCodeSet("0123");
  for (const { obr, obx } of groups) {
    if (!obr.f(18) && !obr.f(2) && !obr.f(3)) {
      r.warn(at(obr, 3), "No accession or order number in OBR-2, OBR-3 or OBR-18. The report has nothing to key on and will not match its order or study.");
    }
    const rs = obr.f(25).trim().toUpperCase();
    if (!rs) {
      if (obx.length) r.err(at(obr, 25), "Result Status is required (condition) when the order group carries results.", "101");
    } else {
      const crossTable = obxStatus.has(rs) && !obrStatus.has(rs);
      checkTableCode(r, at(obr, 25), "0123", obr.f(25), {
        extra: crossTable ? ` '${rs}' is a table 0085 Observation Result Status code (OBX-11), not an OBR-25 value; conflating the two tables is a common ORU build error.` : "",
      });
    }
    if (!obx.length) r.warn(obr.tag, "Order group carries no OBX segments, so it delivers no result content.");

    const seen = new Set();
    for (const x of obx) {
      const vt = x.f(2).trim().toUpperCase();
      if (x.f(5) && !vt) r.err(at(x, 2), "Value Type is required when OBX-5 is valued (condition).", "101");
      const st = x.f(11).trim().toUpperCase();
      if (st && obxStatus.has(st) && obrStatus.has(rs)) {
        if (rs === "F" && ["P", "R", "I", "S"].includes(st)) {
          r.warn(at(x, 11), `${obr.tag}-25 says the report is Final but this observation is '${st}'. Receivers that trust OBR-25 will publish an unverified value as final.`);
        }
        if (rs === "P" && st === "F") r.warn(at(x, 11), `${obr.tag}-25 says Preliminary but this observation is Final.`);
        if (rs === "C" && !["C", "F"].includes(st)) r.warn(at(x, 11), `${obr.tag}-25 is a Correction but this observation is '${st}'; corrected observations carry C (or F).`);
      }
      const key = `${comp(x.f(3), 1, compSep) || x.f(3)}|${x.f(4)}`;
      if (x.f(3) && seen.has(key)) {
        r.warn(at(x, 4), `Observation Identifier '${comp(x.f(3), 1, compSep)}' repeats in this order group with the same OBX-4 Sub-ID${x.f(4) ? ` '${x.f(4)}'` : " (empty)"}. Receivers cannot tell the repeats apart and may overwrite one with the other.`);
      }
      seen.add(key);
    }
  }
  if (!firstOf(ctx, "ORC")) r.note("ORC", "No ORC segment. ORC is optional in ORU_R01, so this is conformant, but many receivers expect it.");
}

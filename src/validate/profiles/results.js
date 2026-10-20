/** Result profile: ORU^R01. */
import { fielder, comp, validCodeSet } from "hl7v2-core";
import { checkTs, checkTableCode } from "../report.js";
import { checkPid, segLines, firstSeg, hasSeg } from "../common.js";

export function validateORU(ctx, r) {
  const { lines, fieldSep, compSep } = ctx;

  const pidLine = firstSeg(ctx, "PID");
  if (!pidLine) {
    r.warn("PID", "No PID segment. The PATIENT group is optional in the ORU_R01 abstract syntax, but a result with no patient cannot be filed by any real receiver.");
  } else {
    checkPid(pidLine, ctx, r);
  }

  if (segLines(ctx, "OBR").length === 0) {
    r.err("OBR", "ORU^R01 requires at least one OBR — the ORDER_OBSERVATION group is mandatory and repeating.");
  }

  // Group OBX segments under the OBR that precedes them.
  const groups = [];
  let current = null;
  let orphanObx = 0;
  lines.forEach((l) => {
    const name = l.slice(0, 3);
    if (name === "OBR") {
      current = { obr: l, obx: [] };
      groups.push(current);
    } else if (name === "OBX") {
      if (current) current.obx.push(l);
      else orphanObx++;
    }
  });
  if (orphanObx > 0) r.err("OBX", `${orphanObx} OBX segment(s) appear before any OBR. Every observation must sit inside an ORDER_OBSERVATION group.`);

  const obxStatus = validCodeSet("0085");
  const obrStatus = validCodeSet("0123");

  groups.forEach((g, gi) => {
    const b = fielder(g.obr, fieldSep);
    const tag = groups.length > 1 ? `OBR[${gi + 1}]` : "OBR";

    if (!b(4)) r.err(`${tag}-4`, "Universal Service Identifier is required.");
    if (!b(18) && !b(2) && !b(3)) {
      r.warn(`${tag}-18`, "No accession or order number in OBR-18, OBR-2 or OBR-3. The report has nothing to key on and will not match the study it describes.");
    }
    if (b(7)) checkTs(`${tag}-7`, comp(b(7), 1, compSep), r);
    if (b(22)) checkTs(`${tag}-22`, comp(b(22), 1, compSep), r);

    const rs = b(25).trim().toUpperCase();
    if (!rs) {
      if (g.obx.length > 0) r.err(`${tag}-25`, "Result Status is required when the order group carries OBX segments.");
      else r.warn(`${tag}-25`, "Result Status is empty.");
    } else {
      const crossTable = obxStatus.has(rs) && !obrStatus.has(rs);
      checkTableCode(r, `${tag}-25`, "0123", b(25), {
        extra: crossTable
          ? ` '${rs}' is a table 0085 Observation Result Status code (OBX-11), not an OBR-25 value — conflating the two tables is the most common ORU build error.`
          : "",
      });
    }

    if (g.obx.length === 0) r.warn(`${tag}`, "Order group carries no OBX segments, so it delivers no result content.");

    const seenIds = new Map();
    g.obx.forEach((line, xi) => {
      const x = fielder(line, fieldSep);
      const xtag = `${groups.length > 1 ? `OBR[${gi + 1}]/` : ""}OBX[${xi + 1}]`;
      const vt = x(2).trim().toUpperCase();
      const val = x(5);
      const subId = x(4);

      if (val && !vt) r.err(`${xtag}-2`, "Value Type is required whenever OBX-5 is populated.");
      else if (vt) checkTableCode(r, `${xtag}-2`, "0125", x(2));
      if (!x(3)) r.err(`${xtag}-3`, "Observation Identifier is required.");

      const st = x(11).trim().toUpperCase();
      if (!st) r.err(`${xtag}-11`, "Observation Result Status is required.");
      else if (checkTableCode(r, `${xtag}-11`, "0085", x(11)) && rs && obrStatus.has(rs)) {
        if (rs === "F" && ["P", "R", "I", "S"].includes(st)) {
          r.warn(`${xtag}-11`, `OBR-25 says the report is Final but this observation is '${st}'. Receivers that trust OBR-25 will publish an unverified line as final.`);
        }
        if (rs === "P" && st === "F") r.warn(`${xtag}-11`, "OBR-25 says Preliminary but this observation is Final. Mixed status within one order group is ambiguous.");
        if (rs === "C" && !["C", "F"].includes(st)) {
          r.warn(`${xtag}-11`, `OBR-25 is a Correction but this observation is '${st}'. A correction should carry C (or F) on the observations it replaces.`);
        }
      }

      if (vt === "NM" && val) {
        const first = comp(val, 1, compSep);
        if (first && Number.isNaN(Number(first))) r.err(`${xtag}-5`, `Value Type is NM but '${first}' is not numeric.`);
      }
      if (["TX", "FT"].includes(vt) && !val.includes(`${ctx.escChar}.br${ctx.escChar}`) && val.length > 200) {
        r.note(`${xtag}-5`, "Long free-text value with no \\.br\\ escapes. Report line breaks must be escaped as \\.br\\ or the layout collapses in the receiving EMR.");
      }
      if (x(14)) checkTs(`${xtag}-14`, comp(x(14), 1, compSep), r);
      if (x(19)) checkTs(`${xtag}-19`, comp(x(19), 1, compSep), r);

      const idKey = comp(x(3), 1, compSep) || x(3);
      if (idKey) {
        if (seenIds.has(idKey) && !subId) {
          r.warn(`${xtag}-4`, `Observation Identifier '${idKey}' repeats within this order group but OBX-4 Sub-ID is empty. Without a Sub-ID the receiver cannot tell the repeats apart and may overwrite one with the other.`);
        }
        seenIds.set(idKey, xi);
      }
    });
  });

  if (hasSeg(ctx, "MRG")) r.err("MRG", "MRG has no place in ORU^R01.");
  if (!hasSeg(ctx, "ORC")) {
    r.note("ORC", "No ORC segment. ORC is optional inside ORDER_OBSERVATION in the v2.5.1 abstract syntax, so this is conformant — but many receivers expect it.");
  }
}

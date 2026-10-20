/** Order profile: ORM^O01. */
import { fielder, comp } from "hl7v2-core";
import { checkUid } from "../report.js";
import { checkPid, checkOrc, checkOrderObr, segLines, firstSeg, hasSeg } from "../common.js";

export function validateORM(ctx, r) {
  const { fieldSep, compSep } = ctx;
  const orcLines = segLines(ctx, "ORC");
  const obrLines = segLines(ctx, "OBR");

  const pidLine = firstSeg(ctx, "PID");
  if (!pidLine) {
    r.warn("PID", "No PID segment. The PATIENT group is optional in the ORM_O01 abstract syntax, but every practical radiology or lab interface requires it.");
  } else {
    checkPid(pidLine, ctx, r);
  }

  if (orcLines.length === 0) r.err("ORC", "ORM^O01 requires at least one ORC — the ORDER group is mandatory and repeating.");
  orcLines.forEach((line, i) => checkOrc(line, orcLines.length > 1 ? `ORC[${i + 1}]` : "ORC", ctx, r));

  if (obrLines.length === 0) {
    r.warn("OBR", "No OBR segment. ORM_O01 allows OBR, RQD, RQ1, RXO, ODS or ODT in the order-detail position, but a radiology or laboratory order uses OBR.");
  }
  if (orcLines.length && obrLines.length && orcLines.length !== obrLines.length) {
    r.warn("ORC/OBR", `${orcLines.length} ORC but ${obrLines.length} OBR segment(s). Each repetition of the ORDER group pairs one ORC with one order-detail segment.`);
  }
  obrLines.forEach((line, i) => {
    const tag = obrLines.length > 1 ? `OBR[${i + 1}]` : "OBR";
    const b = checkOrderObr(line, tag, ctx, r);
    if (!b(18) && !b(2) && !b(3)) {
      r.warn(`${tag}-18`, "No accession or order number in OBR-18, OBR-2 or OBR-3. IHE RAD maps the DICOM Accession Number (0008,0050) to OBR-18; without it the images and the report can never be reconciled to this order.");
    }
  });

  const zdsLine = firstSeg(ctx, "ZDS");
  if (zdsLine) {
    const z = fielder(zdsLine, fieldSep);
    checkUid("ZDS-1.1", comp(z(1), 1, compSep), r);
    if (z(2)) r.note("ZDS-2", "IHE RAD TF-2 defines only ZDS-1. Anything beyond it is a site-local extension that other systems will not read.");
  } else {
    r.note("ZDS", "No ZDS segment. IHE RAD Scheduled Workflow expects the Study Instance UID here at RAD-4 (Procedure Scheduled), so the PACS can pre-register the study before acquisition.");
  }

  if (hasSeg(ctx, "MRG")) r.err("MRG", "MRG has no place in ORM^O01. A patient merge is ADT^A40.");
}

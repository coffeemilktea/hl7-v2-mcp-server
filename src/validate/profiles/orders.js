/** Order profiles: ORM^O01 and OMI^O23. */
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

/**
 * OMI^O23 Imaging Order (OMI_O23):
 * MSH [{SFT}] [{NTE}] [PATIENT] { ORC [TIMING] OBR [{NTE}] [CTD] [{DG1}] [{OBSERVATION}] {IPC} }
 * IPC-1..4 are required in v2.5.1.
 */
export function validateOMI(ctx, r) {
  const { lines, fieldSep, compSep } = ctx;
  const pidLine = firstSeg(ctx, "PID");
  if (!pidLine) r.warn("PID", "No PID segment. The PATIENT group is optional in OMI_O23, but an imaging order without a patient cannot be scheduled.");
  else checkPid(pidLine, ctx, r);

  // Walk ORDER groups: each begins at an ORC.
  const groups = [];
  let cur = null;
  lines.forEach((l, i) => {
    const name = l.slice(0, 3);
    if (name === "ORC") {
      cur = { orc: l, orcIdx: i, obr: [], ipc: [] };
      groups.push(cur);
    } else if (cur && name === "OBR") cur.obr.push(l);
    else if (cur && name === "IPC") cur.ipc.push(l);
    else if (!cur && ["OBR", "IPC"].includes(name)) r.err(name, `${name} appears before any ORC. In OMI_O23 every OBR and IPC sits inside an ORDER group that starts with ORC.`);
  });

  if (groups.length === 0) r.err("ORC", "OMI^O23 requires at least one ORDER group (ORC ... OBR ... IPC).");
  groups.forEach((g, gi) => {
    const gt = groups.length > 1 ? `ORDER[${gi + 1}]/` : "";
    checkOrc(g.orc, `${gt}ORC`, ctx, r);
    if (g.obr.length === 0) r.err(`${gt}OBR`, "OBR is required in every OMI_O23 ORDER group.");
    if (g.obr.length > 1) r.err(`${gt}OBR`, `${g.obr.length} OBR segments in one ORDER group; OMI_O23 allows exactly one. Start a new ORC for each order.`);
    g.obr.slice(0, 1).forEach((line) => checkOrderObr(line, `${gt}OBR`, ctx, r));
    if (g.ipc.length === 0) {
      r.err(`${gt}IPC`, "At least one IPC (Imaging Procedure Control) is required in every OMI_O23 ORDER group — it carries the accession number, requested procedure, Study Instance UID and scheduled procedure step.");
    }
    const accessions = new Set();
    g.ipc.forEach((line, xi) => {
      const x = fielder(line, fieldSep);
      const tag = `${gt}IPC${g.ipc.length > 1 ? `[${xi + 1}]` : ""}`;
      const acc = comp(x(1), 1, compSep);
      if (!acc) r.err(`${tag}-1`, "Accession Identifier is required (maps to DICOM Accession Number 0008,0050).");
      else accessions.add(acc);
      if (!comp(x(2), 1, compSep)) r.err(`${tag}-2`, "Requested Procedure ID is required (maps to DICOM 0040,1001).");
      if (!x(3)) r.err(`${tag}-3`, "Study Instance UID is required (maps to DICOM 0020,000D).");
      else checkUid(`${tag}-3.1`, comp(x(3), 1, compSep), r);
      if (!comp(x(4), 1, compSep)) r.err(`${tag}-4`, "Scheduled Procedure Step ID is required (maps to DICOM 0040,0009).");
      if (x(5)) {
        const mod = comp(x(5), 1, compSep);
        const sys = comp(x(5), 3, compSep);
        if (sys && !/^DCM$/i.test(sys)) r.note(`${tag}-5`, `Modality is coded in '${sys}'. IHE RAD expects DICOM modality codes (coding system DCM, e.g. CT, MR, US).`);
        if (mod && !/^[A-Z0-9]{1,16}$/.test(mod)) r.warn(`${tag}-5.1`, `'${mod}' does not look like a DICOM modality code (uppercase letters and digits, up to 16 characters).`);
      }
    });
    if (accessions.size > 1) {
      r.warn(`${gt}IPC-1`, `IPC segments in one ORDER group carry different accession numbers (${[...accessions].join(", ")}). Multiple IPCs normally share one accession and differ by requested procedure or procedure step.`);
    }
  });

  if (hasSeg(ctx, "ZDS")) r.note("ZDS", "ZDS is the ORM^O01 convention for the Study Instance UID. OMI^O23 carries it in IPC-3, so ZDS is redundant here.");
  if (hasSeg(ctx, "MRG")) r.err("MRG", "MRG has no place in OMI^O23. A patient merge is ADT^A40.");
}

/** Order profiles: ORM^O01 and OMI^O23 (semantic checks; structure and field formats are generic). */
import { comp } from "hl7v2-core";
import { checkUid } from "../report.js";
import { checkPid, checkOrc, segsOf, firstOf, at } from "../common.js";

function patient(ctx, r, structure) {
  const pid = firstOf(ctx, "PID");
  if (pid) checkPid(ctx, r, pid);
  else r.warn("PID", `No PID segment. The PATIENT group is optional in ${structure}, but an order without a patient cannot be scheduled or filled.`);
}

export function validateORM(ctx, r) {
  const { compSep } = ctx;
  patient(ctx, r, "ORM_O01");
  segsOf(ctx, "ORC").forEach((orc) => checkOrc(ctx, r, orc));
  const obrs = segsOf(ctx, "OBR");
  if (!obrs.length) r.note("OBR", "No OBR. ORM_O01 allows OBR, RQD, RQ1, RXO, ODS or ODT as the order detail; radiology and laboratory orders use OBR.");
  for (const obr of obrs) {
    if (!obr.f(18) && !obr.f(2) && !obr.f(3)) {
      r.warn(at(obr, 18), "No accession or order number in OBR-2, OBR-3 or OBR-18. IHE RAD maps the DICOM Accession Number (0008,0050) to OBR-18; without it images and report cannot be reconciled to this order.");
    }
    if (obr.f(25)) r.note(at(obr, 25), "OBR-25 Result Status is populated on an order; it is normally set on the ORU that returns the result.");
  }
  const zds = firstOf(ctx, "ZDS");
  if (zds) {
    checkUid(r, at(zds, 1, { comp: 1 }), comp(zds.f(1), 1, compSep));
    if (zds.f(2)) r.note(at(zds, 2), "IHE RAD TF-2 defines only ZDS-1; further fields are a site-local extension.");
  } else {
    r.note("ZDS", "No ZDS segment. IHE RAD Scheduled Workflow (RAD-4) carries the Study Instance UID in ZDS-1 so the PACS can pre-register the study.");
  }
}

/** OMI_O23: MSH [{SFT}] [{NTE}] [PATIENT] { ORC [{TIMING}] OBR [{NTE}] [CTD] [{DG1}] [{OBSERVATION}] {IPC} } */
export function validateOMI(ctx, r) {
  const { compSep } = ctx;
  patient(ctx, r, "OMI_O23");
  segsOf(ctx, "ORC").forEach((orc) => checkOrc(ctx, r, orc));
  // IPC segments belong to the ORC before them.
  const groups = [];
  for (const s of ctx.segs) {
    if (s.name === "ORC") groups.push({ orc: s, ipc: [] });
    else if (s.name === "IPC" && groups.length) groups.at(-1).ipc.push(s);
  }
  for (const { orc, ipc } of groups) {
    const accessions = new Set();
    for (const x of ipc) {
      const acc = comp(x.f(1), 1, compSep);
      if (acc) accessions.add(acc);
      if (x.f(3)) checkUid(r, at(x, 3, { comp: 1 }), comp(x.f(3), 1, compSep));
      const sys = comp(x.f(5), 3, compSep);
      const mod = comp(x.f(5), 1, compSep);
      if (sys && !/^DCM$/i.test(sys)) r.note(at(x, 5, { comp: 3 }), `Modality is coded in '${sys}'. IHE RAD expects DICOM modality codes (coding system DCM, e.g. CT, MR, US).`);
      if (mod && !/^[A-Z0-9]{1,16}$/.test(mod)) r.warn(at(x, 5, { comp: 1 }), `'${mod}' does not look like a DICOM modality code (uppercase letters and digits, up to 16 characters).`);
    }
    if (accessions.size > 1) {
      r.warn(at(ipc[0], 1), `The IPC segments of the order at ${orc.tag} carry different accession numbers (${[...accessions].join(", ")}). IPCs in one order normally share one accession and differ by requested procedure or procedure step.`);
    }
  }
  if (firstOf(ctx, "ZDS")) r.note("ZDS", "ZDS is the ORM^O01 convention for the Study Instance UID. OMI^O23 carries it in IPC-3, so ZDS is redundant here.");
}

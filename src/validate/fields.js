/**
 * Generic, data-driven field checks for every segment defined in v2.5.1:
 * optionality (R, W, B), repetition, maximum length, field count, primitive
 * formats (DTM/TS, DT, TM, NM, SI) at field, component and subcomponent level,
 * and ID/IS values against their HL7 tables. OBX-5 is checked as the type in
 * OBX-2. A location a profile already reported on is not reported twice.
 * Z-segments are skipped: their content is defined locally or by IHE, not by HL7 tables.
 */
import { getSegment, getDatatype, getTable, checkCode, checkDate, checkTime, unescape, isNull, NM_RE, SI_RE } from "hl7v2-core";
import { E, checkTs, checkTableCode } from "./report.js";
import { at } from "./common.js";

/** Guidance for backward-compatible (B) fields people still send. */
const B_HINT = {
  "PID-2": "carry every identifier as a repeat of PID-3.",
  "PID-4": "carry every identifier as a repeat of PID-3.",
  "PID-19": "send the SSN as a PID-3 repeat with identifier type SS.",
  "PID-20": "send the licence as a PID-3 repeat with identifier type DL.",
  "MRG-2": "carry prior identifiers as repeats of MRG-1.",
  "MRG-4": "carry prior identifiers as repeats of MRG-1.",
  "SCH-11": "send the appointment timing in TQ1.",
  "MSA-3": "send the text in ERR-8 (User Message) or ERR-7 (Diagnostic Information).",
  "MSA-6": "send the error code in ERR-3.",
  "EVN-1": "MSH-9.2 is authoritative.",
  "ERR-1": "use ERR-2 (location) and ERR-3 (error code).",
  "ORC-7": "send timing in the TQ1/TQ2 segments.",
};

const split = (s, sep) => (sep ? s.split(sep) : [s]);
/** True when a raw value holds nothing but delimiters (e.g. "^^~^"). */
const blank = (raw, ctx) => [ctx.compSep, ctx.repSep, ctx.subSep].reduce((s, d) => (d ? s.split(d).join("") : s), raw).trim() === "";
/** A valid code of an ID/IS table is never "too long": v2.5.1 publishes OBX-2 length 2 although table 0125 has XAD, XCN, XON, XPN, XTN. */
const validCode = (type, table, v) => (type === "ID" || type === "IS") && table && checkCode(table, v.trim()).status === "valid";

/** Check one value of `type` (raw text); level 0 = field repetition, 1 = component, 2 = subcomponent. */
function checkValue(ctx, r, loc, type, raw, table, level) {
  if (!raw || isNull(raw)) return;
  const v = raw.trim();
  const bad = (msg) => !r.has(loc) && r.err(loc, msg, E.DATATYPE);
  switch (type) {
    case "DTM":
      return r.has(loc) || checkTs(r, loc, v);
    case "TS":
      // TS.1 is the DTM; TS.2 (degree of precision) is backward compatible only.
      if (level >= 2) return checkValue(ctx, r, loc, "DTM", raw, null, level);
      return checkValue(ctx, r, `${loc}.1`, "DTM", split(raw, level === 0 ? ctx.compSep : ctx.subSep)[0], null, level + 1);
    case "DT":
      return checkDate(v).errors.forEach(bad);
    case "TM":
      return checkTime(v).errors.forEach(bad);
    case "NM":
      return NM_RE.test(v) || bad(`'${v}' is not a valid NM (optional sign, digits, optional decimal point).`);
    case "SI":
      return SI_RE.test(v) || bad(`'${v}' is not a valid SI (a non-negative integer of at most 4 digits).`);
    case "ID":
    case "IS":
      // Inside a composite only HL7 tables are checked: User tables (namespaces, local codes) are site-defined.
      if (!table || r.has(loc) || (level > 0 && getTable(table)?.type === "User")) return;
      checkTableCode(r, loc, table, unescape(v, ctx), { severity: level === 0 ? "error" : "warning" });
      return;
  }
  const dt = getDatatype(type);
  if (!dt?.components?.length) {
    // A primitive value cannot contain the next delimiter down: it must be escaped (\S\, \T\).
    const [sep, esc] = level === 0 ? [ctx.compSep, "S"] : level === 1 ? [ctx.subSep, "T"] : [];
    if (sep && raw.includes(sep) && !r.has(loc)) {
      r.warn(loc, `${type} is a primitive type but the value contains the ${level === 0 ? "component" : "subcomponent"} separator '${sep}'. Escape it as ${ctx.escChar}${esc}${ctx.escChar} or the receiver splits the value.`);
    }
    return;
  }
  if (level >= 2) return;
  const parts = split(raw, level === 0 ? ctx.compSep : ctx.subSep);
  if (parts.length > dt.components.length && parts.slice(dt.components.length).some((p) => p !== "") && !r.has(loc)) {
    r.warn(loc, `${parts.length} ${level === 0 ? "components" : "subcomponents"}, but ${type} has ${dt.components.length} in v2.5.1.`);
  }
  dt.components.forEach((c, i) => {
    if (!parts[i]) return;
    const sub = `${loc}.${i + 1}`;
    checkValue(ctx, r, sub, c.type, parts[i], c.tableSource ? null : c.table, level + 1);
  });
}

export function checkFields(ctx, r) {
  for (const seg of ctx.segs) {
    const def = seg.name.startsWith("Z") ? null : getSegment(seg.name);
    if (!def) continue;
    const header = /^(MSH|FHS|BHS)$/.test(seg.name);
    let last = seg.line.split(ctx.fieldSep).length - (header ? 0 : 1);
    while (last > 0 && seg.f(last) === "") last--;
    if (last > def.fields.length) {
      r.warn(seg.tag, `${seg.name} has ${last} fields; v2.5.1 defines ${def.fields.length}. Fields beyond ${seg.name}-${def.fields.length} belong to a later version or a local extension.`);
    }
    for (const fd of def.fields) {
      if (header && fd.seq <= 2) continue;
      const raw = seg.f(fd.seq);
      const loc = at(seg, fd.seq);
      const label = `${seg.name}-${fd.seq} ${fd.name}`;
      if (raw === "" || (fd.opt === "R" && (isNull(raw) || blank(raw, ctx)))) {
        if (fd.opt === "R" && !r.has(loc)) {
          if (!isNull(raw)) r.err(loc, `${label} is required (R) in v2.5.1${raw ? " but holds only delimiters" : ""}.`, E.REQUIRED);
          else r.warn(loc, `${label} is required (R) but sent as the explicit null "", which tells the receiver to delete the value.`);
        }
        continue;
      }
      if (fd.opt === "W") {
        r.err(loc, `${label} is withdrawn (W) in v2.5.1 and must not be populated.`, E.DATATYPE);
        continue;
      }
      if (fd.opt === "B") r.note(loc, `${label} is retained for backward compatibility only (B) in v2.5.1${B_HINT[`${seg.name}-${fd.seq}`] ? `; ${B_HINT[`${seg.name}-${fd.seq}`]}` : "."}`);
      if (isNull(raw)) continue;
      const repsRaw = split(raw, ctx.repSep);
      const max = fd.rpt === "*" ? Infinity : Number(fd.rpt) || 1;
      if (repsRaw.length > max && !r.has(loc)) {
        r.err(loc, `${label} ${max === 1 ? "does not repeat" : `repeats at most ${max} times`} in v2.5.1 but has ${repsRaw.length} repetitions.`, E.DATATYPE);
      }
      let type = fd.type;
      if (seg.name === "OBX" && fd.seq === 5) type = getDatatype(seg.f(2).trim().toUpperCase()) ? seg.f(2).trim().toUpperCase() : null;
      const table = fd.src?.table && fd.src.table !== "HAPI" ? null : fd.table;
      repsRaw.forEach((rep, i) => {
        const rloc = at(seg, fd.seq, { rep: i + 1 });
        if (type && type !== "varies") checkValue(ctx, r, rloc, type, rep, table, 0);
        const len = unescape(rep, ctx).length;
        if (fd.len && len > fd.len && !r.has(rloc) && !validCode(type, table, rep)) r.warn(rloc, `${label} is ${len} characters; the v2.5.1 maximum is ${fd.len}.`);
      });
    }
  }
}

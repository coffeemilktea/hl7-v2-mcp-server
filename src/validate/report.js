/**
 * Validation report and the shared low-level checks (timestamps, UIDs, code
 * table membership) every layer uses.
 *
 * Locations are canonical HL7 paths with global segment occurrence:
 * SEG[occ]-field[rep].component.subcomponent, where [occ] appears only when the
 * segment occurs more than once and [rep] only for repetitions after the first.
 * Errors carry `code`, the HL7 table 0357 condition an ACK would report.
 */
import { checkTimestamp, checkCode, getTable, tableCodes, isNull } from "hl7v2-core";

export const E = { SEQUENCE: "100", REQUIRED: "101", DATATYPE: "102", TABLE: "103", MSG_TYPE: "200", EVENT: "201", PROC_ID: "202", VERSION: "203" };

export function makeReport() {
  const errors = [];
  const warnings = [];
  const info = [];
  const zoneless = [];
  const flagged = new Set();
  const add = (list, location, message, code) => {
    flagged.add(location);
    list.push(code ? { location, message, code } : { location, message });
  };
  return {
    errors,
    warnings,
    info,
    zoneless,
    err: (location, message, code) => add(errors, location, message, code),
    warn: (location, message) => add(warnings, location, message),
    note: (location, message) => info.push({ location, message }),
    /** True when an error or warning was already reported at exactly this location. */
    has: (location) => flagged.has(location),
  };
}

/** Validate a TS/DTM value (component 1 already extracted). Zoneless times are collected, not reported one by one. */
export function checkTs(r, loc, value) {
  const v = (value ?? "").trim();
  if (!v || isNull(v)) return true;
  const res = checkTimestamp(v);
  res.errors.forEach((m) => r.err(loc, m, E.DATATYPE));
  if (res.zoneless) r.zoneless.push(loc);
  return res.ok;
}

/** Validate a DICOM UID string (PS3.5 §9.1). */
export function checkUid(r, loc, uid, { label = "Study Instance UID" } = {}) {
  if (!uid) return r.err(loc, `${label} is empty.`, E.REQUIRED);
  if (!/^[0-9]+(\.[0-9]+)*$/.test(uid)) return r.err(loc, `'${uid}' is not a valid DICOM UID — only digits and dots are permitted.`, E.DATATYPE);
  if (uid.length > 64) r.err(loc, `UID is ${uid.length} characters; DICOM PS3.5 limits UIDs to 64.`, E.DATATYPE);
  if (/(^|\.)0[0-9]/.test(uid)) r.warn(loc, "A UID component has a leading zero, which DICOM PS3.5 disallows.");
}

/** Table 0396 lists patterns rather than literal codes for HL7 tables and local systems. */
const PATTERN_CODES = { "0396": [/^HL7\d{4}$/, /^99[A-Z0-9]{1,3}$/i, /^L$/] };

const validList = (id) => tableCodes(id, { status: "valid" }).map((v) => v.code);

/**
 * Check a coded value against a v2.5.1 table.
 *
 * - valid in v2.5.1            → passes (a note if only the case differs)
 * - in another version only    → `severity` (default error), naming the version
 * - listed later, unverifiable → warning (never presented as valid)
 * - unknown                    → `severity`, or a warning for User tables
 *   unless `strictUser` is set, because sites may extend User tables.
 * Returns true when the value is acceptable.
 */
export function checkTableCode(r, loc, tableId, value, { severity = "error", strictUser = false, extra = "", code = E.TABLE } = {}) {
  const v = String(value ?? "").trim();
  if (!v || isNull(v)) return true;
  const t = getTable(tableId);
  if (!t || t.values.length === 0) return true; // nothing published to check against (typically a User table)
  if (PATTERN_CODES[t.id]?.some((re) => re.test(v))) return true;
  const label = `table ${t.id}${t.name ? ` ${t.name}` : ""}`;
  const valid = validList(t.id);
  const validText = valid.length && valid.length <= 40 ? ` Valid v2.5.1 values: ${valid.join(", ")}.` : valid.length ? " Use lookup_code_table for the valid values." : "";
  const res = checkCode(t.id, v);
  const report = (sev, msg) => (sev === "error" ? r.err(loc, msg, code) : sev === "warning" ? r.warn(loc, msg) : r.note(loc, msg));
  if (res.known && res.status === "valid") {
    if (res.entry.code !== v) r.note(loc, `'${v}' matches ${label} code '${res.entry.code}' only when case is ignored; HL7 codes are case-sensitive.`);
    return true;
  }
  if (res.known && res.status === "not-in-2.5.1") {
    report(severity, `'${v}' is a ${label} code in other HL7 versions (${res.entry.history || res.entry.reason}), but it is not valid in v2.5.1.${validText}${extra}`);
    return false;
  }
  if (res.known) {
    r.warn(loc, `'${v}' appears in ${label} in later HL7 versions but could not be verified for v2.5.1 (${res.entry.reason}) Treat it as non-standard for v2.5.1.${validText}${extra}`);
    return false;
  }
  const isUser = t.type === "User";
  report(isUser && !strictUser ? "warning" : severity, `'${v}' is not a ${label} value.${validText}${isUser ? " This is a User-defined table; sites may add local codes, so confirm the receiver accepts it." : ""}${extra}`);
  return false;
}

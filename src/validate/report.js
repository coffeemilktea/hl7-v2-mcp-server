/**
 * Validation report and the shared low-level checks (timestamps, UIDs, code
 * table membership) every profile uses.
 */
import { checkTimestamp, checkCode, getTable, tableCodes } from "hl7v2-core";

export function makeReport() {
  const errors = [];
  const warnings = [];
  const info = [];
  return {
    errors,
    warnings,
    info,
    err: (location, message) => errors.push({ location, message }),
    warn: (location, message) => warnings.push({ location, message }),
    note: (location, message) => info.push({ location, message }),
  };
}

/** Validate an HL7 TS value (component 1 already extracted). */
export function checkTs(loc, value, r) {
  const v = (value ?? "").trim();
  if (!v) return;
  const res = checkTimestamp(v);
  res.errors.forEach((m) => r.err(loc, m));
  res.warnings.forEach((m) => r.warn(loc, m));
}

/** Validate a DICOM UID string (PS3.5 §9.1). */
export function checkUid(loc, uid, r, { label = "Study Instance UID" } = {}) {
  if (!uid) {
    r.err(loc, `${label} is empty.`);
    return;
  }
  if (!/^[0-9]+(\.[0-9]+)*$/.test(uid)) {
    r.err(loc, `'${uid}' is not a valid DICOM UID — only digits and dots are permitted.`);
    return;
  }
  if (uid.length > 64) r.err(loc, `UID is ${uid.length} characters; DICOM PS3.5 limits UIDs to 64.`);
  if (/(^|\.)0[0-9]/.test(uid)) r.warn(loc, "A UID component has a leading zero, which DICOM PS3.5 disallows.");
}

const listValid = (id) => tableCodes(id, { status: "valid" }).map((v) => v.code);

/**
 * Check a coded value against a v2.5.1 table.
 *
 * - valid in v2.5.1            → passes (a note if only the case differs)
 * - in a later version only    → `severity` (default error), naming the version
 * - listed later, unverifiable → warning (never presented as valid)
 * - unknown                    → `severity`, or a warning for User tables
 *   unless `strictUser` is set, because sites may extend User tables.
 */
export function checkTableCode(r, loc, tableId, value, { severity = "error", strictUser = false, extra = "" } = {}) {
  const v = String(value ?? "").trim();
  if (!v) return true;
  const t = getTable(tableId);
  if (!t || t.values.length === 0) return true; // nothing published to check against (typically a User table)
  const label = `table ${t.id}${t.name ? ` ${t.name}` : ""}`;
  const valid = listValid(t.id);
  const validText = valid.length ? ` Valid v2.5.1 values: ${valid.join(", ")}.` : "";
  const res = checkCode(t.id, v);
  const report = (sev, msg) => (sev === "error" ? r.err(loc, msg) : sev === "warning" ? r.warn(loc, msg) : r.note(loc, msg));
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
  const sev = isUser && !strictUser ? "warning" : severity;
  report(sev, `'${v}' is not a ${label} value.${validText}${isUser ? " This is a User-defined table; sites may add local codes, so confirm the receiver accepts it." : ""}${extra}`);
  return false;
}

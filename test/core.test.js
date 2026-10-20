import { test } from "node:test";
import assert from "node:assert/strict";
import * as core from "hl7v2-core";
import { ORU_R01, ALT_DELIMS } from "./fixtures.js";

test("parser numbers MSH fields as the standard does", () => {
  const p = core.parseMessage(ORU_R01);
  assert.equal(core.getValue(p, "MSH-1"), "|");
  assert.equal(core.getValue(p, "MSH-2"), "^~\\&");
  assert.equal(core.getValue(p, "MSH-9.2"), "R01");
  assert.equal(core.getValue(p, "MSH-10"), "MSG0002");
  assert.equal(core.getValue(p, "OBX[2]-5"), "72");
  assert.equal(core.getValue(p, "OBX[1]-3.1.2"), "IMP");
});

test("parser recovers non-default delimiters", () => {
  const p = core.parseMessage(ALT_DELIMS);
  assert.deepEqual(p.delimiters, { fieldSep: "#", compSep: "$", repSep: "*", escChar: "@", subSep: "!" });
  assert.equal(core.getValue(p, "PID-3.4"), "HOSP");
  assert.equal(core.getValue(p, "MSH-9.1"), "ORM");
});

test("unescape decodes standard escapes in one pass and leaves unknown ones", () => {
  const d = { fieldSep: "|", compSep: "^", repSep: "~", escChar: "\\", subSep: "&" };
  assert.equal(core.unescape("A\\T\\B\\F\\C\\S\\D\\R\\E\\E\\", d), "A&B|C^D~E\\");
  assert.equal(core.unescape("line1\\.br\\line2", d), "line1\nline2");
  assert.equal(core.unescape("\\X41\\\\H\\bold\\N\\", d), "Abold");
  assert.equal(core.unescape("\\Zcustom\\", d), "\\Zcustom\\");
  assert.equal(core.unescape(core.escape("a|b^c&d~e\\f", d), d), "a|b^c&d~e\\f");
});

test("parser strips MLLP framing and accepts \\n line endings", () => {
  const p = core.parseMessage("\x0B" + ORU_R01.replace(/\r/g, "\n") + "\x1C\x0D");
  assert.equal(p.segments.length, 6);
});

test("parseMessage rejects empty and non-MSH input", () => {
  assert.throws(() => core.parseMessage(""), /No segments/);
  assert.throws(() => core.parseMessage("PID|1"), /MSH/);
});

test("buildSegment drops trailing empty fields", () => {
  assert.equal(core.buildSegment("PID", ["1", "", "X", "", ""]), "PID|1||X");
  assert.equal(core.buildSegment("MSH", ["|", "^~\\&", "APP", "", ""]), "MSH|^~\\&|APP");
});

test("timestamps", () => {
  assert.equal(core.checkTimestamp("20261019103000-0700").errors.length, 0);
  assert.ok(core.checkTimestamp("20261019103000").warnings.length > 0);
  assert.ok(core.checkTimestamp("20261319").errors.length > 0);
  assert.ok(core.checkTimestamp("2026-10-19").errors.length > 0);
  assert.equal(core.toFhirDate("20261019103000-0700"), "2026-10-19T10:30:00-07:00");
  assert.match(core.nowTs(), core.TS_RE);
});

test("generated data covers all of v2.5.1", () => {
  const c = core.meta().counts;
  assert.equal(c.segments, 149);
  assert.equal(c.fields, 2078);
  assert.equal(c.datatypes, 89);
  assert.ok(c.structures >= 198);
  assert.ok(c.events >= 300);
  assert.ok(c.table_tables >= 450);
});

test("review bug fixes are reflected in the data", () => {
  const pid39 = core.getField("PID", 39);
  assert.equal(pid39.name, "Tribal Citizenship");
  assert.equal(pid39.type, "CWE");
  assert.equal(core.getField("MSA", 5).opt, "W");
  assert.equal(core.getField("SCH", 11).opt, "B");
  for (const n of [2, 4]) {
    const f = core.getField("MRG", n);
    assert.equal(f.opt, "B");
    assert.equal(f.len, 250);
  }
  assert.equal(core.getField("OBX", 2).len, 2);
  assert.equal(core.getField("PD1", 8).name, "Organ Donor Code");
  assert.equal(core.getDatatype("CE").components.length, 6);
});

test("table codes carry a v2.5.1 status", () => {
  assert.equal(core.checkCode("0123", "F").status, "valid");
  assert.equal(core.checkCode("0123", "M").status, "not-in-2.5.1");
  assert.equal(core.checkCode("0085", "A").status, "not-in-2.5.1");
  assert.equal(core.checkCode("0125", "CWE").status, "not-in-2.5.1");
  assert.equal(core.checkCode("0001", "X").status, "unverified");
  assert.equal(core.checkCode("0001", "ZZ").known, false);
  assert.deepEqual([...core.validCodeSet("0008")].sort(), ["AA", "AE", "AR", "CA", "CE", "CR"]);
  assert.equal(core.normalizeTableId("4"), "0004");
});

test("structures and events", () => {
  assert.equal(core.getStructure("ADT^A04").structure.id, "ADT_A01");
  assert.equal(core.getStructure("adt_a04").structure.id, "ADT_A01");
  assert.equal(core.getStructure("ORU_R01").structure.id, "ORU_R01");
  assert.match(core.getStructure("ORM^O01").structure.abstractSyntax, /< OBR \| RQD \| RQ1 \| RXO \| ODS \| ODT >/);
  assert.equal(core.getEvent("ACK").messageType, "ACK");
  assert.equal(core.getStructure("XYZ^Q99"), null);
});

test("search ranks exact ids first and requires every token", () => {
  assert.equal(core.search("PID-3").items[0].id, "PID-3");
  assert.equal(core.search("accession").items[0].id, "IPC-1");
  assert.equal(core.search("patient class", { kinds: ["field"] }).items.some((i) => i.id === "PV1-2"), true);
  assert.equal(core.search("zzzz-not-a-thing").total, 0);
  const p = core.search("date", { limit: 5, offset: 5 });
  assert.equal(p.items.length, 5);
  assert.equal(p.offset, 5);
});

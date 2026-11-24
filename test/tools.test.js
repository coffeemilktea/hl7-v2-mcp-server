import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import * as F from "./fixtures.js";

let client;
const call = async (name, args = {}) => client.callTool({ name, arguments: args });
const sc = async (name, args) => {
  const r = await call(name, args);
  assert.ok(!r.isError, `${name} failed: ${r.content?.[0]?.text}`);
  return r.structuredContent;
};

before(async () => {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer().connect(a);
  client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(b);
});
after(async () => client.close());

describe("tool catalogue", () => {
  test("every tool has a title, annotations and an output schema", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "deidentify_message", "diff_messages", "generate_ack", "get_datatype", "get_field", "get_message_structure", "get_segment",
      "list_message_types", "list_segments", "lookup_code_table", "parse_message", "search_definitions", "validate_message",
    ]);
    for (const t of tools) {
      assert.ok(t.title, `${t.name} title`);
      assert.equal(t.annotations?.readOnlyHint, true, `${t.name} readOnlyHint`);
      assert.equal(t.annotations?.openWorldHint, false, `${t.name} openWorldHint`);
      assert.equal(t.outputSchema?.type, "object", `${t.name} outputSchema`);
    }
  });
  test("resources", async () => {
    const r = await client.readResource({ uri: "hl7v2://segment/PID" });
    assert.equal(JSON.parse(r.contents[0].text).code, "PID");
    const t = await client.readResource({ uri: "hl7v2://table/4" });
    assert.equal(JSON.parse(t.contents[0].text).id, "0004");
    const s = await client.readResource({ uri: "hl7v2://about/sources" });
    assert.equal(JSON.parse(s.contents[0].text).standard, "HL7 v2.5.1");
    const { resourceTemplates } = await client.listResourceTemplates();
    assert.equal(resourceTemplates.length, 4);
  });
});

describe("reference tools", () => {
  test("list_segments paginates and filters", async () => {
    const p1 = await sc("list_segments", { limit: 10 });
    assert.equal(p1.segments.length, 10);
    assert.equal(p1.total, 150);
    assert.equal(p1.nextOffset, 10);
    const f = await sc("list_segments", { filter: "observation" });
    assert.ok(f.segments.some((s) => s.code === "OBX"));
  });
  test("get_segment accepts lower case and lists every field", async () => {
    const s = await sc("get_segment", { segment: "pid" });
    assert.equal(s.fieldCount, 39);
    assert.equal(s.fields[38].name, "Tribal Citizenship");
  });
  test("get_field coerces strings and resolves the data type", async () => {
    const f = await sc("get_field", { segment: "PID", field: "3" });
    assert.equal(f.dataType, "CX");
    assert.equal(f.components[4].name, "Identifier Type Code");
    assert.equal(f.optionality, "R");
  });
  test("get_field explains a missing field", async () => {
    const r = await call("get_field", { segment: "PID", field: 40 });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /fields 1–39/);
  });
  test("get_field optionality for withdrawn and backward-compatible fields", async () => {
    assert.equal((await sc("get_field", { segment: "MSA", field: 5 })).optionality, "W");
    assert.equal((await sc("get_field", { segment: "SCH", field: 11 })).optionality, "B");
  });
  test("get_datatype", async () => {
    const d = await sc("get_datatype", { datatype: "xpn" });
    assert.equal(d.components[0].name, "Family Name");
    assert.ok(d.usedBy.some((u) => u.startsWith("PID-5")));
    const r = await call("get_datatype", { datatype: "ZZZ" });
    assert.equal(r.isError, true);
  });
  test("get_message_structure accepts event or structure", async () => {
    const a = await sc("get_message_structure", { messageType: "adt a04" });
    assert.equal(a.structure, "ADT_A01");
    assert.ok(a.eventsUsingStructure.includes("ADT^A08"));
    const b = await sc("get_message_structure", { messageType: "OMI_O23" });
    assert.match(b.abstractSyntax, /IPC/);
  });
  test("list_message_types filters", async () => {
    const r = await sc("list_message_types", { filter: "SIU" });
    assert.ok(r.messageTypes.some((m) => m.type === "SIU^S12"));
  });
  test("lookup_code_table defaults to v2.5.1-valid codes and labels the rest", async () => {
    const t = await sc("lookup_code_table", { tableNumber: 123 });
    assert.equal(t.tableNumber, "0123");
    assert.ok(t.values.every((v) => v.status === "valid"));
    assert.equal(t.counts.notIn251, 2);
    const all = await sc("lookup_code_table", { tableNumber: "0123", status: "all" });
    const m = all.values.find((v) => v.code === "M");
    assert.equal(m.status, "not-in-2.5.1");
    assert.ok(m.reason);
  });
  test("search_definitions", async () => {
    const r = await sc("search_definitions", { query: "discharge date", kinds: ["field"] });
    assert.equal(r.results[0].id, "PV1-45");
  });
});

describe("message tools", () => {
  test("parse_message summary and labelled fields", async () => {
    const p = await sc("parse_message", { message: F.ORU_R01 });
    assert.equal(p.summary.messageType, "ORU^R01^ORU_R01");
    assert.equal(p.summary.accession, "ACC789");
    assert.equal(p.summary.accessionSource, "OBR-18");
    assert.ok(p.parsedSegments[0].fields["MSH-10 (Message Control ID)"]);
  });
  test("parse_message filters and paginates segments", async () => {
    const p = await sc("parse_message", { message: F.ORU_R01, segments: "OBX", limit: 1 });
    assert.equal(p.total, 2);
    assert.equal(p.parsedSegments.length, 1);
    assert.equal(p.nextOffset, 1);
  });
  test("parse_message decodes escapes, keeps repetitions and maps explicit null to null", async () => {
    const p = await sc("parse_message", { message: F.ADT_A01_RICH, segments: ["PID"] });
    const f = p.parsedSegments[0].fields;
    assert.equal(f["PID-5 (Patient Name)"][0], "O'BRIEN&SMITH");
    assert.equal(f["PID-11 (Patient Address)"][0][0], "12 HIGH ST|UNIT 4");
    assert.deepEqual(f["PID-3 (Patient Identifier List)"][0][3], ["HOSP", "1.2.3.4", "ISO"]);
    assert.equal(f["PID-16 (Marital Status)"], null);
    const alt = await sc("parse_message", { message: F.withAltDelimiters(F.ADT_A01_RICH), segments: "PID" });
    assert.deepEqual(alt.parsedSegments[0].fields["PID-3 (Patient Identifier List)"], f["PID-3 (Patient Identifier List)"]);
    assert.equal(alt.delimiters.fieldSep, "#");
  });
  test("parse_message rejects non-HL7 text", async () => {
    const r = await call("parse_message", { message: "hello" });
    assert.equal(r.isError, true);
  });
  test("validate_message", async () => {
    const r = await sc("validate_message", { message: F.setField(F.ORU_R01, "OBR", 25, "M") });
    assert.equal(r.valid, false);
  });
});

describe("generate_ack", () => {
  test("AA echoes the control id and swaps sender and receiver", async () => {
    const r = await sc("generate_ack", { message: F.ORU_R01, controlId: "ACK1", timestamp: "20261019120500-0700" });
    assert.equal(r.segments[0], "MSH|^~\\&|EMR|HOSP|RIS|HOSP|20261019120500-0700||ACK^R01^ACK|ACK1|P|2.5.1");
    assert.equal(r.segments[1], "MSA|AA|MSG0002");
  });
  test("explicit errors become ERR segments", async () => {
    const r = await sc("generate_ack", { message: F.ORU_R01, ackCode: "ae", errors: [{ location: "PID-3[2].4", code: 101, diagnostic: "Need authority" }] });
    assert.equal(r.segments[1], "MSA|AE|MSG0002");
    assert.equal(r.segments[2], "ERR||PID^1^3^2^4|101^Required field missing^HL70357|E|||Need authority");
  });
  test("fromValidation maps findings to table 0357 codes", async () => {
    const r = await sc("generate_ack", { message: F.setField(F.ORU_R01, "OBR", 25, "W"), fromValidation: true });
    assert.equal(r.acknowledgmentCode, "AE");
    assert.match(r.segments[2], /^ERR\|\|OBR\^1\^25\^1\|103\^Table value not found\^HL70357\|E/);
  });
  test("the ACK itself validates", async () => {
    const r = await sc("generate_ack", { message: F.ORU_R01 });
    const v = await sc("validate_message", { message: r.ack });
    assert.deepEqual(v.errors, []);
  });
  test("AE without errors is noted; invalid 0357 code rejected", async () => {
    const r = await sc("generate_ack", { message: F.ORU_R01, ackCode: "AR" });
    assert.match(r.notes.join(" "), /without an ERR/);
    const bad = await call("generate_ack", { message: F.ORU_R01, errors: [{ code: "199" }] });
    assert.equal(bad.isError, true);
  });
  test("escapes delimiters in diagnostics", async () => {
    const r = await sc("generate_ack", { message: F.ORU_R01, ackCode: "AE", errors: [{ code: "207", diagnostic: "a|b^c" }] });
    assert.match(r.segments[2], /a\\F\\b\\S\\c/);
  });
  test("ADT^A01 ACK: trigger echoed, segments terminated, original mode", async () => {
    const r = await sc("generate_ack", { message: F.ADT_A01, controlId: "ACK2", timestamp: "20261019080100-0700" });
    assert.equal(r.segments[0], "MSH|^~\\&|PACS|HOSP|ADT|HOSP|20261019080100-0700||ACK^A01^ACK|ACK2|P|2.5.1");
    assert.equal(r.mode, "original");
    assert.ok(r.ack.endsWith("MSA|AA|A01-0001\r"));
  });
  test("ERR-2 uses the global segment occurrence", async () => {
    const r = await sc("generate_ack", { message: F.ORU_R01.replace("||72|", "||seventy|"), fromValidation: true });
    assert.equal(r.acknowledgmentCode, "AE");
    assert.equal(r.segments[2], "ERR||OBX^2^5^1|102^Data type error^HL70357|E|||'seventy' is not a valid NM (optional sign, digits, optional decimal point).");
  });
  test("segment sequence errors map to 100 with a segment-only ERL", async () => {
    const r = await sc("generate_ack", { message: F.dropSegment(F.ADT_A01, "EVN"), fromValidation: true });
    assert.ok(r.segments.includes("ERR||EVN^1|100^Segment sequence error^HL70357|E|||Required EVN is missing before PID (ADT_A01)."));
  });
  test("unsupported message type is rejected (AR, 200)", async () => {
    const r = await sc("generate_ack", { message: F.setField(F.ADT_A08, "MSH", 9, "ZZZ^Z99"), fromValidation: true });
    assert.equal(r.acknowledgmentCode, "AR");
    assert.match(r.segments[2], /^ERR\|\|MSH\^1\^9\^1\^1\|200\^Unsupported message type\^HL70357\|E/);
  });
  test("enhanced mode: accept acknowledgment by default; MSH-15/16 advice", async () => {
    const r = await sc("generate_ack", { message: F.ADT_A01_RICH });
    assert.equal(r.mode, "enhanced");
    assert.equal(r.acknowledgmentCode, "CA");
    const app = await sc("generate_ack", { message: F.ADT_A01_RICH, ackCode: "AA" });
    assert.match(app.notes.join(" "), /MSH-16 .* 'NE'/);
    const orig = await sc("generate_ack", { message: F.ORU_R01, ackCode: "CA" });
    assert.match(orig.notes.join(" "), /original mode/);
  });
  test("enhanced mode: content errors → application ack AE (not CE); unsupported type → CR", async () => {
    const content = await sc("generate_ack", { message: F.setField(F.ADT_A01_RICH, "PV1", 2, "Q"), fromValidation: true });
    assert.equal(content.acknowledgmentCode, "AE");
    assert.match(content.notes.join(" "), /would be CA/);
    const reject = await sc("generate_ack", { message: F.setField(F.ADT_A01_RICH, "MSH", 12, "9.9"), errors: [{ location: "MSH-12", code: 203 }] });
    assert.equal(reject.acknowledgmentCode, "CR");
  });
  test("ERR segments from validation are capped", async () => {
    const many = F.ORU_R01 + "\r" + Array.from({ length: 150 }, (_, i) => `OBX|${i + 3}|NM|X^Y^LN||bad|||||F`).join("\r");
    const r = await sc("generate_ack", { message: many, fromValidation: true });
    assert.equal(r.errCount, 100);
    assert.match(r.notes.join(" "), /first 100/);
  });
  test("custom delimiters are reused in the ACK", async () => {
    const r = await sc("generate_ack", { message: F.withAltDelimiters(F.ORU_R01), ackCode: "AE", errors: [{ location: "PID-3", code: 101, diagnostic: "a#b" }], controlId: "A1", timestamp: "20261019" });
    assert.equal(r.segments[0], "MSH#$*@!#EMR#HOSP#RIS#HOSP#20261019##ACK$R01$ACK#A1#P#2.5.1");
    assert.equal(r.segments[2], "ERR##PID$1$3$1#101$Required field missing$HL70357#E###a@F@b");
    const v = await sc("validate_message", { message: r.ack });
    assert.deepEqual(v.errors, []);
  });
  test("non-2.5.1 version is noted; ACKs are not acknowledged", async () => {
    const r = await sc("generate_ack", { message: F.setField(F.ORU_R01, "MSH", 12, "2.3") });
    assert.match(r.notes.join(" "), /203/);
    const ack = await sc("generate_ack", { message: F.ORU_R01 });
    const again = await call("generate_ack", { message: ack.ack });
    assert.equal(again.isError, true);
    assert.match(again.content[0].text, /never acknowledged/);
  });
});

describe("input validation", () => {
  test("empty, whitespace and oversized messages are rejected with a clear error", async () => {
    for (const message of ["", "   \r\n", "MSH|" + "X".repeat(1_000_001)]) {
      const r = await call("validate_message", { message });
      assert.equal(r.isError, true);
    }
  });
  test("non-HL7 text gives an MCP error, not a crash", async () => {
    for (const name of ["parse_message", "generate_ack", "deidentify_message"]) {
      const r = await call(name, { message: "hello world" });
      assert.equal(r.isError, true, name);
      assert.match(r.content[0].text, /MSH/, name);
    }
    const v = await sc("validate_message", { message: "hello world" });
    assert.equal(v.valid, false);
  });
});

describe("diff_messages", () => {
  test("identical apart from MSH-7/10", async () => {
    const right = F.setField(F.setField(F.ORU_R01, "MSH", 10, "OTHER"), "MSH", 7, "20261020000000-0700");
    const r = await sc("diff_messages", { left: F.ORU_R01, right });
    assert.equal(r.identical, true);
  });
  test("component changes and added segments", async () => {
    const right = F.ORU_R01.replace("|72|", "|75|").replace("DOE^JANE", "DOE^JANET") + "\rNTE|1||note";
    const r = await sc("diff_messages", { left: F.ORU_R01, right });
    assert.equal(r.identical, false);
    assert.deepEqual(r.differences.map((d) => d.location), ["PID-5.2", "OBX[2]-5.1"]);
    assert.equal(r.differences[0].fieldName, "Patient Name");
    assert.deepEqual(r.segmentChanges.map((s) => `${s.change} ${s.segment}`), ["added NTE[1]"]);
    assert.equal(r.segmentOrderChanged, false);
  });
  test("field level and ignore lists", async () => {
    const right = F.ORU_R01.replace("DOE^JANE", "DOE^JANET");
    const r = await sc("diff_messages", { left: F.ORU_R01, right, level: "field" });
    assert.equal(r.differences[0].location, "PID-5");
    const ig = await sc("diff_messages", { left: F.ORU_R01, right, ignore: ["PID"] });
    assert.equal(ig.identical, true);
  });
  test("compares decoded values across delimiters", async () => {
    const left = "MSH|^~\\&|A|B|C|D|20261019||ADT^A08|1|P|2.5.1\rPID|1||X^^^H^MR";
    const right = "MSH#$*@!#A#B#C#D#20261019##ADT$A08#1#P#2.5.1\rPID#1##X$$$H$MR";
    const r = await sc("diff_messages", { left, right });
    assert.deepEqual(r.differences.map((d) => d.location), ["MSH-1", "MSH-2"]);
  });
});

describe("deidentify_message", () => {
  const SENSITIVE = F.ADT_A01 + "\rNK1|1|DOE^JOHN|SPO|123 MAIN ST^^SPRINGFIELD^IL^62701|^PRN^PH^^1^217^5559999\rOBX|1|TX|NOTE||Jane Doe called\rZPI|secret";
  test("removes Safe Harbor identifiers and never returns originals", async () => {
    const r = await sc("deidentify_message", { message: SENSITIVE, seed: "test-seed-1234" });
    for (const s of ["MRN12345", "DOE", "JANE", "MAIN ST", "62701", "5551234", "5559999", "SPRINGFIELD", "19800214", "secret", "V0001", "Jane Doe"]) {
      assert.equal(r.message.includes(s), false, `leaked ${s}`);
      assert.equal(JSON.stringify(r.changes).includes(s), false, `changes leaked ${s}`);
    }
    assert.match(r.message, /PID\|1\|\|ANON[0-9A-Z]{10}\^\^\^HOSP\^MR\|\|REDACTED\|\|1980\|F\|\|\|\^\^\^IL\^\^USA/);
    assert.ok(r.changes.some((c) => c.location === "ZPI"));
  });
  test("pseudonyms are consistent within a message and repeatable with a seed", async () => {
    const m = F.ADT_A40.replace("MRG|MRN99999", "MRG|MRN12345");
    const a = await sc("deidentify_message", { message: m, seed: "seed-abcdefgh" });
    const pid = a.message.split("\r").find((l) => l.startsWith("PID")).split("|")[3];
    const mrg = a.message.split("\r").find((l) => l.startsWith("MRG")).split("|")[1];
    assert.equal(pid, mrg);
    const b = await sc("deidentify_message", { message: m, seed: "seed-abcdefgh" });
    assert.equal(a.message, b.message);
  });
  test("ages over 89 drop the birth date", async () => {
    const r = await sc("deidentify_message", { message: F.ADT_A01.replace("19800214", "19300214") });
    assert.ok(r.changes.some((c) => c.location === "PID-7" && /over 89/.test(c.action)));
  });
  test("UIDs are remapped to 2.25 UIDs", async () => {
    const r = await sc("deidentify_message", { message: F.OMI_O23 });
    const ipc = r.message.split("\r").find((l) => l.startsWith("IPC")).split("|");
    assert.match(ipc[3], /^2\.25\.\d+$/);
    assert.ok(ipc[3].length <= 64);
    assert.match(ipc[5], /^CT\^/);
  });
  test("date shifting keeps precision and offset", async () => {
    const r = await sc("deidentify_message", { message: F.ORM_O01, dateMode: "shift", dateShiftDays: -10 });
    assert.match(r.message, /\|20261009103000-0700\|\|ORM/);
    assert.match(r.method.dates, /NOT Safe Harbor/);
  });
  test("keep and redactFreeText options", async () => {
    const r = await sc("deidentify_message", { message: SENSITIVE, keep: ["PID-5"], redactFreeText: false });
    assert.match(r.message, /DOE\^JANE/);
    assert.match(r.message, /Jane Doe called/);
    assert.ok(r.warnings.some((w) => /free text kept/.test(w)));
  });
  test("output still parses and validates structurally", async () => {
    const r = await sc("deidentify_message", { message: F.ORU_R01 });
    const v = await sc("validate_message", { message: r.message });
    assert.equal(v.messageType, "ORU^R01");
    assert.deepEqual(v.errors.filter((e) => !/Result Status|Observation/.test(e.message)), []);
  });
  test("shift mode needs dateShiftDays", async () => {
    const r = await call("deidentify_message", { message: F.ORU_R01, dateMode: "shift" });
    assert.equal(r.isError, true);
  });
});

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validateMessage, PROFILES } from "../src/validate/index.js";
import * as F from "./fixtures.js";

const { setField, dropSegment, seg } = F;
const v = (m) => validateMessage(m);
const has = (list, loc, re) => list.some((i) => i.location === loc && (!re || re.test(i.message)));
const codeAt = (r, loc) => r.errors.find((e) => e.location === loc)?.code;
const clean = (r) => {
  assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
  assert.deepEqual(r.warnings, [], JSON.stringify(r.warnings));
};

describe("good fixtures pass their profile", () => {
  for (const [name, key] of [
    ["ADT_A01", "ADT^A01"], ["ADT_A03", "ADT^A03"], ["ADT_A04", "ADT^A04"], ["ADT_A08", "ADT^A08"], ["ADT_A31", "ADT^A31"],
    ["ADT_A40", "ADT^A40"], ["ORM_O01", "ORM^O01"], ["ORU_R01", "ORU^R01"], ["OMI_O23", "OMI^O23"], ["SIU_S12", "SIU^S12"],
    ["ADT_A01_RICH", "ADT^A01"], ["ORU_R01_LAB", "ORU^R01"],
  ]) {
    test(name, () => {
      const r = v(F[name]);
      assert.equal(r.profileApplied.startsWith(key), true, r.profileApplied);
      clean(r);
    });
  }
  test("every profile has a fixture", () => assert.equal(Object.keys(PROFILES).length, 10));
});

describe("delimiters, terminators and encoding", () => {
  test("custom delimiters from MSH-1/MSH-2 validate like the defaults", () => {
    for (const m of [F.ORU_R01_LAB, F.ADT_A01_RICH, F.ORM_O01]) clean(v(F.withAltDelimiters(m)));
  });
  test("LF, CRLF and MLLP framing are tolerated", () => {
    clean(v(F.ORU_R01_LAB.replace(/\r/g, "\n")));
    clean(v(F.ORU_R01_LAB.replace(/\r/g, "\r\n") + "\r\n"));
    clean(v("\x0B" + F.ORU_R01_LAB + "\r\x1C\x0D"));
  });
  test("MSH-2 shorter than four characters is an error", () => {
    const r = v(F.ADT_A08.replace("MSH|^~\\&|", "MSH|^~\\|"));
    assert.equal(has(r.errors, "MSH-2", /four characters/), true);
  });
  test("a v2.7 truncation character in MSH-2 warns", () => assert.equal(has(v(F.ADT_A08.replace("MSH|^~\\&|", "MSH|^~\\&#|")).warnings, "MSH-2", /v2\.7/), true));
  test("duplicate delimiters are an error", () => assert.equal(has(v(F.ADT_A08.replace("MSH|^~\\&|", "MSH|^^\\&|")).errors, "MSH-2", /distinct/), true));
  test("escape sequences in data do not upset field checks", () => {
    clean(v(F.ORU_R01.replace("No acute cardiopulmonary process.", "A\\F\\B\\S\\C\\T\\D\\R\\E\\E\\.br\\next \\X41\\")));
  });
});

describe("base checks", () => {
  test("empty message", () => assert.equal(has(v("").errors, "message"), true));
  test("first segment must be MSH", () => assert.equal(has(v("PID|1").errors, "MSH"), true));
  test("batch envelopes are explained", () => assert.equal(has(v("FHS|^~\\&\rBHS|^~\\&\r" + F.ADT_A08).errors, "MSH", /batch/), true));
  test("structure must match the event", () => {
    const r = v(setField(F.ADT_A04, "MSH", 9, "ADT^A04^ADT_A04"));
    assert.equal(has(r.errors, "MSH-9.3", /uses ADT_A01/), true);
  });
  test("missing structure names the right one", () => assert.equal(has(v(setField(F.ADT_A04, "MSH", 9, "ADT^A04")).warnings, "MSH-9.3", /ADT_A01/), true));
  test("missing trigger event is an error", () => assert.equal(codeAt(v(setField(F.ADT_A04, "MSH", 9, "ADT")), "MSH-9.2"), "101"));
  test("unknown message type → 200, unknown event combination → 201", () => {
    assert.equal(codeAt(v(setField(F.ADT_A08, "MSH", 9, "ZZZ^A08")), "MSH-9.1"), "200");
    assert.equal(codeAt(v(setField(F.ADT_A08, "MSH", 9, "ADT^R01")), "MSH-9.2"), "201");
  });
  test("processing id (202) and acknowledgment types", () => {
    let r = v(setField(F.ORM_O01, "MSH", 11, "X"));
    assert.equal(has(r.errors, "MSH-11.1", /table 0103/), true);
    assert.equal(codeAt(r, "MSH-11.1"), "202");
    r = v(setField(F.ORM_O01, "MSH", 15, "XX"));
    assert.equal(has(r.errors, "MSH-15", /table 0155/), true);
  });
  test("non-2.5.1 version warns", () => assert.equal(has(v(setField(F.ORM_O01, "MSH", 12, "2.3")).warnings, "MSH-12", /203/), true));
  test("control id over 20 characters", () => assert.equal(has(v(setField(F.ORM_O01, "MSH", 10, "X".repeat(21))).errors, "MSH-10"), true));
  test("undefined non-Z segment warns", () => assert.equal(has(v(F.ORM_O01 + "\rQQQ|1").warnings, "message", /QQQ/), true));
  test("Z-segments are allowed anywhere", () => clean(v(F.ADT_A08 + "\rZPV|local")));
  test("EVN-1 must agree with MSH-9.2", () => assert.equal(has(v(setField(F.ADT_A08, "EVN", 1, "A01")).errors, "EVN-1"), true));
  test("zoneless times are a single note, not warnings", () => {
    const r = v(F.ADT_A08.replace(/-0700/g, ""));
    clean(r);
    assert.equal(has(r.info, "timestamps", /MSH-7\.1/), true);
  });
});

describe("ACK messages", () => {
  const ACK = "MSH|^~\\&|EMR|HOSP|RIS|HOSP|20261019120500-0700||ACK^R01^ACK|ACK1|P|2.5.1\rMSA|AA|MSG0002";
  test("a correct ACK is clean", () => clean(v(ACK)));
  test("ACK with ERR is clean", () => clean(v(`${ACK.replace("|AA|", "|AE|")}\rERR||PID^1^3|101^Required field missing^HL70357|E`)));
  test("withdrawn MSA-5", () => assert.equal(has(v(ACK + "|||D").errors, "MSA-5", /withdrawn/), true));
  test("MSA required", () => assert.equal(codeAt(v(ACK.split("\r")[0]), "MSA"), "100"));
  test("ACK must use structure ACK", () => assert.equal(has(v(ACK.replace("ACK^R01^ACK", "ACK^R01^ORU_R01")).errors, "MSH-9.3"), true));
  test("ERR-3 and ERR-4 required; ERR-4 against table 0516", () => {
    const r = v(`${ACK}\rERR||PID^1^3||F`);
    assert.equal(codeAt(r, "ERR-3"), "101");
    assert.equal(has(r.errors, "ERR-4", /table 0516.*not valid in v2\.5\.1/), true);
  });
});

describe("segment sequence (abstract message syntax)", () => {
  test("OBX before any OBR", () => {
    const lines = F.ORU_R01.split("\r");
    const r = v([lines[0], lines[1], lines[4], lines[2], lines[3]].join("\r"));
    assert.equal(has(r.errors, "OBR", /missing before OBX/), true);
    assert.equal(codeAt(r, "OBR"), "100");
  });
  test("missing EVN in ADT", () => assert.equal(has(v(dropSegment(F.ADT_A01, "EVN")).errors, "EVN", /missing/), true));
  test("missing PV1 in ADT^A01", () => assert.equal(has(v(dropSegment(F.ADT_A01, "PV1")).errors, "PV1"), true));
  test("MRG is not part of ADT_A01", () => assert.equal(has(v(F.ADT_A01 + "\rMRG|X^^^HOSP^MR").errors, "MRG", /not part of the ADT_A01/), true));
  test("MRG required in A40, and MRG before PID is out of order", () => {
    assert.equal(has(v(dropSegment(F.ADT_A40, "MRG")).errors, "MRG", /missing/), true);
    const l = F.ADT_A40.split("\r");
    assert.equal(v([l[0], l[1], l[3], l[2]].join("\r")).valid, false);
  });
  test("two OBRs in one OMI order group", () => {
    const r = v(F.OMI_O23.replace("\rIPC", "\rOBR|2|PL3002||74177^CT^C4\rIPC"));
    assert.equal(has(r.errors, "OBR[2]", /out of sequence/), true);
  });
  test("IPC required in OMI", () => assert.equal(has(v(dropSegment(F.OMI_O23, "IPC")).errors, "IPC"), true));
  test("missing ORC in ORM", () => assert.equal(v(dropSegment(F.ORM_O01, "ORC")).valid, false));
  test("SIU resources need an RGS", () => assert.equal(has(v(dropSegment(F.SIU_S12, "RGS")).errors, "RGS", /missing before AIS/), true));
  test("several problems are reported, not just the first", () => {
    const r = v(F.ADT_A01 + "\rMRG|X\rQRD|1");
    assert.ok(r.errors.filter((e) => e.code === "100").length >= 2);
  });
});

describe("field checks (optionality, repetition, length, data types, tables)", () => {
  test("required field missing → 101", () => {
    const r = v(setField(F.ADT_A08, "PID", 5, ""));
    assert.equal(codeAt(r, "PID-5"), "101");
  });
  test("non-repeating field repeated → 102", () => assert.equal(codeAt(v(setField(F.ADT_A08, "PID", 8, "F~M")), "PID-8"), "102"));
  test("explicit null is accepted in an optional field and flagged in a required one", () => {
    clean(v(setField(F.ADT_A08, "PID", 8, '""')));
    assert.equal(has(v(setField(F.ADT_A08, "PV1", 2, '""')).warnings, "PV1-2", /explicit null/), true);
  });
  test("DTM precision and ranges", () => {
    assert.equal(codeAt(v(setField(F.ORM_O01, "MSH", 7, "2026-10-19")), "MSH-7.1"), "102");
    assert.equal(has(v(setField(F.ORM_O01, "MSH", 7, "20260230")).errors, "MSH-7.1", /Day/), true);
    assert.equal(has(v(setField(F.ORM_O01, "MSH", 7, "2026.5")).errors, "MSH-7.1"), true);
    assert.equal(has(v(setField(F.ORM_O01, "MSH", 7, "20261019103000+1500")).errors, "MSH-7.1", /offset/), true);
    clean(v(setField(F.ORM_O01, "MSH", 7, "20261019103000.1234+0530")));
    clean(v(setField(F.ORM_O01, "MSH", 7, "2026")));
  });
  test("TS inside a repeating composite (subcomponent level)", () => {
    const r = v(setField(F.ADT_A08, "PID", 3, "MRN12345^^^HOSP^MR^^20261301"));
    assert.equal(has(r.errors, "PID-3.7", /Month/), true);
  });
  test("OBX-5 is checked as the OBX-2 type", () => {
    assert.equal(has(v(F.ORU_R01.replace("|72|", "|seventy|")).errors, "OBX[2]-5", /not a valid NM/), true);
    assert.equal(has(v(F.ORU_R01.replace("|NM|8867-4^Heart rate^LN||72|", "|DT|8867-4^Heart rate^LN||20261399|")).errors, "OBX[2]-5", /Month/), true);
  });
  test("withdrawn and backward-compatible fields", () => {
    assert.equal(has(v(setField(F.ADT_A08, "PID", 19, "123456789")).info, "PID-19", /SS/), true);
  });
  test("over-length value warns", () => assert.equal(has(v(setField(F.ADT_A08, "PV1", 19, "V".repeat(260))).warnings, "PV1-19", /maximum is 250/), true));
  test("fields beyond the v2.5.1 definition warn", () => assert.equal(has(v(setField(F.ADT_A08, "PID", 40, "X")).warnings, "PID", /defines 39/), true));
  test("HL7 table values inside components are checked; table 0396 patterns accepted", () => {
    assert.equal(has(v(setField(F.ADT_A08, "PID", 3, "MRN12345^^^HOSP^MR~X^^^H^MR^^^^^^^^Q")).warnings, "PID-3[2]"), true);
    clean(v(F.ORU_R01.replace("71046^XR CHEST 2 VIEWS^C4", "71046^XR CHEST 2 VIEWS^99LOC")));
  });
});

describe("second-pass conformance fixes", () => {
  test("3-character v2.5.1 value types are not 'too long' for OBX-2 (published length 2)", () => {
    const xad = F.ORU_R01.replace("|NM|8867-4^Heart rate^LN||72|/min^beats per minute^ISO+|60-100|N|", "|XAD|56799-0^Address^LN||1 MAIN ST^^SPRINGFIELD^IL^62701^USA||||");
    clean(v(xad));
    assert.equal(has(v(F.ORU_R01.replace("OBX|1|TX|", "OBX|1|CWE|")).errors, "OBX[1]-2", /not valid in v2\.5\.1/), true);
  });
  test("table 0203 is user-defined in v2.5.1: local identifier types are not flagged", () => {
    clean(v(setField(F.ADT_A08, "PID", 3, "MRN12345^^^HOSP^LOCALMRN")));
  });
  test("MSA-3 and MSA-6 are backward-compatible only", () => {
    const r = v("MSH|^~\\&|EMR|HOSP|RIS|HOSP|20261019120500-0700||ACK^R01^ACK|ACK1|P|2.5.1\rMSA|AE|MSG0002|Bad PID|||101^Required field missing^HL70357");
    assert.equal(has(r.info, "MSA-3", /ERR-8/), true);
    assert.equal(has(r.info, "MSA-6", /ERR-3/), true);
  });
  test("a required field holding only delimiters is missing", () => assert.equal(codeAt(v(setField(F.ADT_A08, "PID", 5, "^^")), "PID-5"), "101"));
  test("an empty family name is a warning, not a required-field error (XPN components are optional)", () => {
    const r = v(setField(F.ADT_A08, "PID", 5, "^JANE"));
    assert.deepEqual(r.errors, []);
    assert.equal(has(r.warnings, "PID-5.1"), true);
  });
  test("unescaped delimiters inside primitive values warn", () => {
    assert.equal(has(v(F.ORU_R01.replace("19005-8^", "19005-8&IMP^")).warnings, "OBX[1]-3.1", /subcomponent separator/), true);
    assert.equal(has(v(F.ORU_R01.replace("No acute cardiopulmonary process.", "Impression^none")).warnings, "OBX[1]-5", /\\S\\/), true);
  });
  test("issue lists are capped so a broken large message still returns a usable report", () => {
    const r = v(F.ORU_R01 + "\r" + Array.from({ length: 400 }, (_, i) => `OBX|${i + 3}|NM|X^Y^LN||bad|||||F`).join("\r"));
    assert.ok(r.counts.errors > 400);
    assert.equal(r.errors.length, 200);
    assert.match(r.truncated, /200/);
    assert.equal(r.segmentCount, 406);
  });
  test("table 0396 ISOnnnn and IBTnnnn patterns are accepted", () => {
    clean(v(F.ORU_R01.replace("^beats per minute^ISO+", "^beats per minute^ISO2955")));
  });
});

describe("ORU^R01", () => {
  test("OBX-11 code in OBR-25 is called out", () => assert.equal(has(v(setField(F.ORU_R01, "OBR", 25, "W")).errors, "OBR-25", /table 0085/), true));
  test("OBR-25 M is a later-version code, not v2.5.1", () => assert.equal(has(v(setField(F.ORU_R01, "OBR", 25, "M")).errors, "OBR-25", /not valid in v2\.5\.1/), true));
  test("OBX-2 CWE is not a v2.5.1 value type", () => assert.equal(has(v(F.ORU_R01.replace("OBX|1|TX|", "OBX|1|CWE|")).errors, "OBX[1]-2", /added v2\.6/), true));
  test("final report with preliminary observation warns", () => assert.equal(has(v(F.ORU_R01.replace("|N|||F", "|N|||P")).warnings, "OBX[2]-11", /Final/), true));
  test("status checks are per order group", () => {
    const r = v(F.ORU_R01_LAB.replace(/\|P$/, "|F"));
    assert.equal(has(r.warnings, "OBX[3]-11", /Preliminary/), true);
  });
  test("result status required when OBX present", () => assert.equal(codeAt(v(setField(F.ORU_R01, "OBR", 25, "")), "OBR-25"), "101"));
  test("repeated observation id without sub-id", () => {
    const r = v(F.ORU_R01 + "\r" + seg("OBX", { 1: "3", 2: "NM", 3: "8867-4^Heart rate^LN", 5: "75", 11: "F" }));
    assert.equal(has(r.warnings, "OBX[3]-4"), true);
  });
});

describe("ORM^O01 / OMI^O23", () => {
  test("unknown order control", () => assert.equal(has(v(setField(F.ORM_O01, "ORC", 1, "ZZ")).errors, "ORC-1", /table 0119/), true));
  test("later-version order control is not v2.5.1", () => assert.equal(has(v(setField(F.ORM_O01, "ORC", 1, "MC")).errors, "ORC-1", /not valid in v2\.5\.1/), true));
  test("order must be identifiable", () => assert.equal(codeAt(v(setField(setField(F.ORM_O01, "ORC", 2, ""), "ORC", 3, "")), "ORC-2"), "101"));
  test("bad study UID", () => assert.equal(has(v(F.ORM_O01.replace("ZDS|1.2.840", "ZDS|1.2.A840")).errors, "ZDS-1.1"), true));
  test("IPC-1..4 required", () => {
    const r = v(F.OMI_O23.replace(/IPC\|.*$/, "IPC||||"));
    for (const n of [1, 2, 3, 4]) assert.equal(codeAt(r, `IPC-${n}`), "101", `IPC-${n}`);
  });
  test("UID with a leading zero", () => assert.equal(has(v(F.OMI_O23.replace("1.2.840.113619.2.55.3.1.1", "1.2.840.01")).warnings, "IPC-3.1", /leading zero/), true));
  test("non-DICOM modality coding is noted", () => assert.equal(has(v(F.OMI_O23.replace("^DCM", "^L")).info, "IPC-5.3"), true));
});

describe("ADT", () => {
  test("A01 for an outpatient warns", () => assert.equal(has(v(setField(F.ADT_A01, "PV1", 2, "O")).warnings, "PV1-2", /A04/), true));
  test("A01 without admit time warns", () => assert.equal(has(v(setField(F.ADT_A01, "PV1", 44, "")).warnings, "PV1-44"), true));
  test("A04 for an inpatient warns", () => assert.equal(has(v(setField(F.ADT_A04, "PV1", 2, "I")).warnings, "PV1-2", /A01/), true));
  test("A04 with a discharge time warns", () => assert.equal(has(v(setField(F.ADT_A04, "PV1", 45, "20261019100000-0700")).warnings, "PV1-45"), true));
  test("A03 without discharge time warns", () => assert.equal(has(v(setField(F.ADT_A03, "PV1", 45, "")).warnings, "PV1-45", /discharge/i), true));
  test("invalid patient class errors", () => assert.equal(has(v(setField(F.ADT_A03, "PV1", 2, "Q")).errors, "PV1-2", /table 0004/), true));
  test("self-merge", () => assert.equal(has(v(F.ADT_A40.replace("MRG|MRN99999", "MRG|MRN12345")).errors, "MRG-1", /Self-merge/), true));
  test("cross-authority merge", () => assert.equal(has(v(F.ADT_A40.replace("MRN99999^^^HOSP", "MRN99999^^^OTHER")).warnings, "MRG-1.4"), true));
  test("A31 with a visit number warns", () => assert.equal(has(v(setField(F.ADT_A31, "PV1", 19, "V1")).warnings, "PV1-19"), true));
  test("A08 without a visit number warns", () => assert.equal(has(v(setField(F.ADT_A08, "PV1", 19, "")).warnings, "PV1-19"), true));
});

describe("SIU^S12", () => {
  test("SCH required", () => assert.equal(has(v(dropSegment(F.SIU_S12, "SCH")).errors, "SCH"), true));
  test("appointment id required", () => assert.equal(has(v(setField(setField(F.SIU_S12, "SCH", 1, ""), "SCH", 2, "")).errors, "SCH-1"), true));
  test("SCH-11 is backward-compatible only", () => assert.equal(has(v(setField(F.SIU_S12, "SCH", 11, "^^30^20261021090000-0700")).info, "SCH-11", /TQ1/), true));
  test("no timing at all warns", () => assert.equal(has(v(dropSegment(F.SIU_S12, "TQ1")).warnings, "TQ1"), true));
  test("AIS-3 required", () => assert.equal(codeAt(v(setField(F.SIU_S12, "AIS", 3, "")), "AIS-3"), "101"));
  test("segment action code checked against 0206", () => assert.equal(has(v(setField(F.SIU_S12, "RGS", 2, "Q")).errors, "RGS-2", /table 0206/), true));
  test("seg builder", () => assert.equal(seg("PV1", { 2: "I" }), "PV1||I"));
});

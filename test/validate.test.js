import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validateMessage, PROFILES } from "../src/validate/index.js";
import * as F from "./fixtures.js";

const { setField, dropSegment, seg } = F;
const v = (m) => validateMessage(m);
const has = (list, loc, re) => list.some((i) => i.location === loc && (!re || re.test(i.message)));

describe("good fixtures pass their profile", () => {
  for (const [name, key] of [
    ["ADT_A01", "ADT^A01"], ["ADT_A03", "ADT^A03"], ["ADT_A04", "ADT^A04"], ["ADT_A08", "ADT^A08"], ["ADT_A31", "ADT^A31"],
    ["ADT_A40", "ADT^A40"], ["ORM_O01", "ORM^O01"], ["ORU_R01", "ORU^R01"], ["OMI_O23", "OMI^O23"], ["SIU_S12", "SIU^S12"],
  ]) {
    test(name, () => {
      const r = v(F[name]);
      assert.equal(r.profileApplied.startsWith(key), true, r.profileApplied);
      assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
      assert.deepEqual(r.warnings, [], JSON.stringify(r.warnings));
    });
  }
  test("every profile has a fixture", () => assert.equal(Object.keys(PROFILES).length, 10));
});

describe("base checks", () => {
  test("empty message", () => assert.equal(has(v("").errors, "message"), true));
  test("first segment must be MSH", () => assert.equal(has(v("PID|1").errors, "MSH"), true));
  test("structure must match the event", () => {
    const r = v(setField(F.ADT_A04, "MSH", 9, "ADT^A04^ADT_A04"));
    assert.equal(has(r.errors, "MSH-9.3", /uses ADT_A01/), true);
  });
  test("missing structure suggests the right one", () => {
    const r = v(setField(F.ADT_A04, "MSH", 9, "ADT^A04"));
    assert.equal(has(r.info, "MSH-9.3", /ADT_A01/), true);
  });
  test("unknown processing id and ack conditions", () => {
    let r = v(setField(F.ORM_O01, "MSH", 11, "X"));
    assert.equal(has(r.errors, "MSH-11", /table 0103/), true);
    r = v(setField(F.ORM_O01, "MSH", 15, "XX"));
    assert.equal(has(r.errors, "MSH-15", /table 0155/), true);
  });
  test("non-2.5.1 version warns", () => assert.equal(has(v(setField(F.ORM_O01, "MSH", 12, "2.3")).warnings, "MSH-12"), true));
  test("control id over 20 characters", () => assert.equal(has(v(setField(F.ORM_O01, "MSH", 10, "X".repeat(21))).errors, "MSH-10"), true));
  test("bad timestamp", () => assert.equal(has(v(setField(F.ORM_O01, "MSH", 7, "2026-10-19")).errors, "MSH-7"), true));
  test("undefined non-Z segment warns", () => assert.equal(has(v(F.ORM_O01 + "\rQQQ|1").warnings, "segments", /QQQ/), true));
  test("EVN-1 must agree with MSH-9.2", () => assert.equal(has(v(setField(F.ADT_A08, "EVN", 1, "A01")).errors, "EVN-1"), true));
  test("ACK with withdrawn MSA-5", () => {
    const ack = "MSH|^~\\&|A|B|C|D|20261019120000-0700||ACK^R01^ACK|X1|P|2.5.1\rMSA|AA|MSG0002|||D";
    assert.equal(has(v(ack).errors, "MSA-5", /withdrawn/), true);
  });
  test("works with non-default delimiters", () => {
    const r = v(F.ALT_DELIMS);
    assert.equal(r.messageType, "ORM^O01");
    assert.equal(has(r.errors, "MSH-2"), false);
  });
});

describe("ORU^R01", () => {
  test("OBX-11 code in OBR-25 is called out", () => {
    const r = v(setField(F.ORU_R01, "OBR", 25, "W"));
    assert.equal(has(r.errors, "OBR-25", /table 0085/), true);
  });
  test("OBR-25 M is a later-version code, not v2.5.1", () => {
    const r = v(setField(F.ORU_R01, "OBR", 25, "M"));
    assert.equal(has(r.errors, "OBR-25", /not valid in v2\.5\.1/), true);
  });
  test("OBX-2 CWE is not a v2.5.1 value type", () => {
    const r = v(F.ORU_R01.replace("OBX|1|TX|", "OBX|1|CWE|"));
    assert.equal(has(r.errors, "OBX[1]-2", /added v2\.6/), true);
  });
  test("non-numeric NM value", () => {
    const r = v(F.ORU_R01.replace("|72|", "|seventy|"));
    assert.equal(has(r.errors, "OBX[2]-5", /not numeric/), true);
  });
  test("final report with preliminary observation warns", () => {
    const r = v(F.ORU_R01.replace("|N|||F", "|N|||P"));
    assert.equal(has(r.warnings, "OBX[2]-11", /Final/), true);
  });
  test("OBX before OBR", () => {
    const lines = F.ORU_R01.split("\r");
    const r = v([lines[0], lines[1], lines[4], lines[2], lines[3]].join("\r"));
    assert.equal(has(r.errors, "OBX", /before any OBR/), true);
  });
});

describe("ORM^O01", () => {
  test("missing ORC", () => assert.equal(has(v(dropSegment(F.ORM_O01, "ORC")).errors, "ORC"), true));
  test("unknown order control", () => assert.equal(has(v(setField(F.ORM_O01, "ORC", 1, "ZZ")).errors, "ORC-1", /table 0119/), true));
  test("later-version order control is not v2.5.1", () => assert.equal(has(v(setField(F.ORM_O01, "ORC", 1, "MC")).errors, "ORC-1", /not valid in v2\.5\.1/), true));
  test("bad study UID", () => assert.equal(has(v(F.ORM_O01.replace("ZDS|1.2.840", "ZDS|1.2.A840")).errors, "ZDS-1.1"), true));
  test("MRG not allowed", () => assert.equal(has(v(F.ORM_O01 + "\rMRG|X").errors, "MRG"), true));
});

describe("ADT^A01/A04/A03", () => {
  test("A01 for an outpatient warns", () => assert.equal(has(v(setField(F.ADT_A01, "PV1", 2, "O")).warnings, "PV1-2", /A04/), true));
  test("A01 without admit time warns", () => assert.equal(has(v(setField(F.ADT_A01, "PV1", 44, "")).warnings, "PV1-44"), true));
  test("A01 without PV1 errors", () => assert.equal(has(v(dropSegment(F.ADT_A01, "PV1")).errors, "PV1"), true));
  test("A04 for an inpatient warns", () => assert.equal(has(v(setField(F.ADT_A04, "PV1", 2, "I")).warnings, "PV1-2", /A01/), true));
  test("A04 with a discharge time warns", () => assert.equal(has(v(setField(F.ADT_A04, "PV1", 45, "20261019100000-0700")).warnings, "PV1-45"), true));
  test("A03 without discharge time warns", () => assert.equal(has(v(setField(F.ADT_A03, "PV1", 45, "")).warnings, "PV1-45", /discharge/i), true));
  test("invalid patient class errors", () => assert.equal(has(v(setField(F.ADT_A03, "PV1", 2, "Q")).errors, "PV1-2", /table 0004/), true));
  test("EVN missing", () => assert.equal(has(v(dropSegment(F.ADT_A01, "EVN")).errors, "EVN"), true));
  test("MRG in A01", () => assert.equal(has(v(F.ADT_A01 + "\rMRG|X^^^HOSP^MR").errors, "MRG"), true));
});

describe("ADT^A40/A31/A08", () => {
  test("self-merge", () => {
    const r = v(F.ADT_A40.replace("MRG|MRN99999", "MRG|MRN12345"));
    assert.equal(has(r.errors, "PID-3/MRG-1", /Self-merge/), true);
  });
  test("cross-authority merge", () => assert.equal(has(v(F.ADT_A40.replace("MRN99999^^^HOSP", "MRN99999^^^OTHER")).warnings, "PID-3.4/MRG-1.4"), true));
  test("A40 without MRG", () => assert.equal(has(v(dropSegment(F.ADT_A40, "MRG")).errors, "MRG"), true));
  test("A31 with a visit number warns", () => assert.equal(has(v(setField(F.ADT_A31, "PV1", 19, "V1")).warnings, "PV1-19"), true));
  test("A08 without a visit number warns", () => assert.equal(has(v(setField(F.ADT_A08, "PV1", 19, "")).warnings, "PV1-19"), true));
});

describe("OMI^O23", () => {
  test("IPC required", () => assert.equal(has(v(dropSegment(F.OMI_O23, "IPC")).errors, "IPC"), true));
  test("IPC-1..4 required", () => {
    const r = v(F.OMI_O23.replace(/IPC\|.*$/, "IPC||||"));
    for (const n of [1, 2, 3, 4]) assert.equal(has(r.errors, `IPC-${n}`), true, `IPC-${n}`);
  });
  test("bad Study Instance UID", () => assert.equal(has(v(F.OMI_O23.replace("1.2.840.113619.2.55.3.1.1", "1.2.840.01")).warnings, "IPC-3.1", /leading zero/), true));
  test("two OBRs in one order group", () => {
    const r = v(F.OMI_O23.replace("\rIPC", "\rOBR|2|PL3002||74177^CT^CPT\rIPC"));
    assert.equal(has(r.errors, "OBR", /exactly one/), true);
  });
  test("non-DICOM modality coding is noted", () => assert.equal(has(v(F.OMI_O23.replace("^DCM", "^L")).info, "IPC-5"), true));
});

describe("SIU^S12", () => {
  test("SCH required", () => assert.equal(has(v(dropSegment(F.SIU_S12, "SCH")).errors, "SCH"), true));
  test("appointment id required", () => {
    const r = v(setField(setField(F.SIU_S12, "SCH", 1, ""), "SCH", 2, ""));
    assert.equal(has(r.errors, "SCH-1/2"), true);
  });
  test("SCH-11 is backward-compatible only", () => {
    const r = v(setField(F.SIU_S12, "SCH", 11, "^^30^20261021090000-0700"));
    assert.equal(has(r.info, "SCH-11", /TQ1/), true);
  });
  test("no timing at all warns", () => assert.equal(has(v(dropSegment(F.SIU_S12, "TQ1")).warnings, "SCH-11/TQ1"), true));
  test("RGS required and resources need an RGS", () => {
    const r = v(dropSegment(F.SIU_S12, "RGS"));
    assert.equal(has(r.errors, "RGS"), true);
    assert.equal(has(r.errors, "AIS[1]", /before any RGS/), true);
  });
  test("AIS-3 required", () => assert.equal(has(v(setField(F.SIU_S12, "AIS", 3, "")).errors, "AIS[1]-3"), true));
  test("segment action code checked against 0206", () => assert.equal(has(v(setField(F.SIU_S12, "RGS", 2, "Q")).errors, "RGS[1]-2", /table 0206/), true));
  test("seg builder", () => assert.equal(seg("PV1", { 2: "I" }), "PV1||I"));
});

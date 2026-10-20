# hl7v2-core

HL7 v2.5.1 reference data and a small, dependency-free message parser. It is shared by
[hl7-v2-mcp-server](https://github.com/coffeemilktea/hl7-v2-mcp-server) and
[hl7-v2-fhir-mcp-server](https://github.com/coffeemilktea/hl7-v2-fhir-mcp-server).

| Data | Count |
|---|---|
| Segments | 149 standard, plus the curated ZDS |
| Fields | 2,078 (210 with curated implementation notes) |
| Data types | 89 (78 composite, each with its components) |
| Message structures | 200 (groups and choices, abstract syntax) |
| Trigger events | 349 (message type^event → structure) |
| Tables | 498, with 5,955 codes |

Every table code has a v2.5.1 `status`:

- `valid`: the FHIR STU3 v2 table history shows the code was in v2.5.1.
- `not-in-2.5.1`: the code was added after v2.5.1 or removed before it. `history` says which.
- `unverified`: the code appears in HL7 Terminology, but no per-version history confirms it for v2.5.1. Don't treat it as a v2.5.1 value.

Each record carries a `src` object that names the source of each attribute. See [NOTICE](NOTICE) for sources and licences.

## Use

```js
import { parseMessage, getValue, getField, getStructure, checkCode, search } from "hl7v2-core";

const msg = parseMessage("MSH|^~\\&|RIS|HOSP|PACS|HOSP|20261019103000-0700||ORM^O01^ORM_O01|1|P|2.5.1\rPID|1||123^^^HOSP^MR||DOE^JANE");
getValue(msg, "PID-3.4");          // "HOSP"
getField("PID", 39).name;          // "Tribal Citizenship"
getStructure("ADT^A04").structure.id; // "ADT_A01"
checkCode("0123", "M").status;     // "not-in-2.5.1"
search("accession").items;         // IPC-1, SAC-1, SAC-2, ...
```

Exports:

- **Parser:** `parseMessage`, `getValue`, `parsePath`, `dissect`, `fielder`, `comp`, `reps`, `unescape`, `escape`, `buildSegment`
- **Timestamps:** `checkTimestamp`, `toFhirDate`, `nowTs`
- **Data:** `getSegment`, `getField`, `getDatatype`, `getStructure`, `getEvent`, `getTable`, `tableCodes`, `checkCode`, `validCodeSet`, `search`, `paginate`, `meta`

## Regenerating the data

```sh
npm run fetch-sources   # downloads HAPI 2.5.1 sources, THO 7.4.0 and FHIR STU3 v2 tables into .sources/
npm run generate        # rebuilds data/*.json; output is deterministic
```

The generator reads two inputs besides the downloaded sources:

- `data/overlay/*.json`: hand-written notes. They're attached to the generated records, but they never override structure.
- `data/overrides.json`: sourced corrections. Each one carries its evidence.

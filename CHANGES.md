# Changes

## 2.0.0 (unreleased, branch `buildout`)

### Data: the full HL7 v2.5.1 standard

- New `hl7v2-core` workspace package (`core/`). It holds generated data and a shared parser, and is used by this server and by hl7-v2-fhir-mcp-server.

| Item | v1 | v2 |
|---|---|---|
| Segments | 15 + ZDS | 149 + ZDS |
| Fields | 211 | 2,078 |
| Data types | 0 | 89 |
| Structures | 16 | 200 |
| Trigger events | 16 | 349 |
| Tables | 13 (240 codes) | 498 (5,955 codes) |

- **Sources:**
  - Structure comes from HAPI `hapi-structures-v251` 2.5.1.
  - Table content comes from HL7 Terminology 7.4.0 (CC0).
  - Each code's v2.5.1 status comes from the FHIR STU3 v2 table version history (CC0).
- **Code status:** every code is `valid`, `not-in-2.5.1` or `unverified`. Codes that aren't valid in v2.5.1 are never presented as valid.
- **Bindings and notes:**
  - CE/CWE table bindings HAPI lacks come from THO "where used" and are tagged with that source.
  - The original hand-written definitions are kept as curated notes on the generated records.
- **Provenance:** sourced corrections are in `core/data/overrides.json`; NOTICE lists every source and licence.

### Fixes from the review

- **PID-39 Tribal Citizenship (CWE) exists in v2.5.1.** The README said it doesn't; the README and the data are both corrected.
- **MSA-5** is withdrawn (W), not "deprecated". The validator now flags it when populated.
- **SCH-11** is B (was R).
- **MRG-2 and MRG-4** are B, with length 250.
- **OBX-2** length is 2.
- **Table 0123:** M and N are now labelled as later-version codes, using evidence from the Caristix 2.5.1 table and the FHIR STU3 history.
- **Claude Code setup:** the README's instructions used `.claude/settings.json`. Claude Code reads project servers from `.mcp.json` or `claude mcp add`.
- **PD1:** documented that Organ Donor Code is PD1-8. The FHIR server had it as PD1-6.

### Server

- **Structure:**
  - The server is split into `src/server.js`, `src/tools/*`, `src/validate/*` and `src/transport/*`.
  - `server.js` remains as the v1 HTTP entry point.
- **stdio transport:**
  - `bin/cli.js` defaults to stdio, so `npx hl7-v2-mcp-server` works once published.
  - `--http` starts Streamable HTTP.
- **HTTP hardening:**
  - Host-header validation (DNS rebinding).
  - Origin checks.
  - No CORS unless `ALLOWED_ORIGINS` is set.
  - Constant-time API key comparison.
  - Idle-session expiry (`SESSION_IDLE_MS`) and a session cap (`MAX_SESSIONS`).
  - Body limit, and JSON-RPC errors for malformed or oversized bodies.
- **Tool registration:**
  - Every tool uses `registerTool`, with a title, read-only annotations and an output schema (`structuredContent`).
  - Inputs are lenient (numbers as strings, table `4` → `0004`, `adt_a04` → `ADT^A04`).
- **Output size:**
  - List tools and `parse_message` paginate (`offset`/`limit`).
  - Results are capped by `HL7_MCP_MAX_OUTPUT_CHARS`, with guidance on how to narrow the request.
- **Resources:** `hl7v2://segment|datatype|table|structure/{id}` and `hl7v2://about/sources`.
- **Dependencies:**
  - `@modelcontextprotocol/sdk` ^1.32.1, express 5, zod 3.25. The lockfile is committed.
  - Node 20+.

### New tools

- `search_definitions`: searches across segments, fields, data types, events, structures, tables and codes.
- `get_datatype`: a data type's components and the fields that use it.
- `generate_ack`: v2.5.1 ACK with ERR segments; `fromValidation` maps validator errors to table 0357 codes.
- `diff_messages`: segment, field, component and subcomponent differences.
- `deidentify_message`: HIPAA Safe Harbor de-identification driven by v2.5.1 field definitions.

### Validator

- New profiles: `ADT^A01`, `ADT^A03`, `ADT^A04`, `SIU^S12`, `OMI^O23`. There are now 10 in total.
- **Table checks:**
  - Codes are checked against the v2.5.1-valid set.
  - Codes from later versions are errors and name the version.
  - Unverifiable codes are warnings.
  - Unknown codes in User tables are warnings.
  - Tables with no published values are skipped.
- **New base checks:**
  - MSH-9 message code, trigger and structure, checked against tables 0076, 0003 and 0354, including whether the structure matches the event.
  - MSH-11 against table 0103.
  - Segments that aren't defined in v2.5.1.
  - MSA-5 withdrawn.
- **New profile checks:**
  - OBX-2 against table 0125.
  - PID-3.5 against table 0203.
  - ORC-5 against table 0038.

### Tests and CI

- 122 `node:test` tests:
  - unit tests (parser, data, search, validator)
  - MCP integration over the in-memory transport
  - HTTP security tests (Host, Origin, CORS, API key, session expiry, body limit)
  - a stdio spawn test
- `.github/workflows/ci.yml` runs on Node 20, 22 and 24.
- `.github/workflows/data.yml` regenerates the data from upstream and checks it matches the committed files.

### Breaking changes

- `npx hl7-v2-mcp-server` and the `bin` now default to **stdio**. Use `--http` (or `npm start` / `node server.js`) for HTTP.
- `lookup_code_table` returns only codes valid in v2.5.1 by default. Pass `status: "all"` for the rest.
- Tool results now include `structuredContent`. The text content is the same JSON.
- Express 5 and Node 20+.

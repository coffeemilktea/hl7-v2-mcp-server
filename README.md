# HL7 v2.5.1 Reference MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that gives LLMs structured access
to the **complete HL7 v2.5.1 standard**: every segment, field, data type, message structure, trigger
event and code table. It also has tools to parse, validate, diff and de-identify messages, and to
build ACKs.

It's built for PACS administrators, healthcare IT engineers and interface analysts.

| | |
|---|---|
| **Transports** | stdio (default) and Streamable HTTP |
| **Standard** | HL7 v2.5.1, plus the IHE RAD ZDS segment |
| **Runtime** | Node.js 20+ |
| **License** | MIT (data sources are listed in [NOTICE](NOTICE)) |

> **Companion server:** [hl7-v2-fhir-mcp-server](https://github.com/coffeemilktea/hl7-v2-fhir-mcp-server)
> answers *what does this field become in FHIR R4* and converts whole messages into a transaction
> Bundle. This server answers *what does this segment mean*. Both servers share the
> [`hl7v2-core`](core/) data package.

## What's covered

| | v1 | v2 |
|---|---|---|
| Segments | 15 + ZDS | **149** + ZDS |
| Fields | 211 | **2,078**. The original 210 hand-written notes are kept. |
| Data types | 0 | **89**, with components |
| Message structures | 16 hand-written | **200**, with groups and choices |
| Trigger events | 16 | **349** |
| Code tables | 13 (240 codes) | **498 (5,955 codes)**, each code tagged with its v2.5.1 status |

Every table code has a v2.5.1 status:

- **valid:** confirmed in v2.5.1.
- **not-in-2.5.1:** added later or removed earlier; the history says which.
- **unverified:** listed in HL7 Terminology, but no source confirms it for v2.5.1.

`lookup_code_table` returns only valid codes unless you ask for the others. The validator reports
codes from later versions as errors and unverifiable codes as warnings. See [core/NOTICE](core/NOTICE)
for where each piece of data comes from.

## Quick start

### Claude Code

```bash
claude mcp add hl7-reference -- npx -y hl7-v2-mcp-server
```

Or add it to the project's `.mcp.json`:

```json
{
  "mcpServers": {
    "hl7-reference": { "command": "npx", "args": ["-y", "hl7-v2-mcp-server"] }
  }
}
```

### Claude Desktop, Cursor and other stdio clients

```json
{
  "mcpServers": {
    "hl7-reference": { "command": "npx", "args": ["-y", "hl7-v2-mcp-server"] }
  }
}
```

The Claude Desktop config is at `~/Library/Application Support/Claude/claude_desktop_config.json`
(Mac) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows).

### Over HTTP

```bash
npx hl7-v2-mcp-server --http          # http://localhost:3000/mcp
# or from a clone: npm install && npm start
claude mcp add --transport http hl7-reference http://localhost:3000/mcp
```

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port (`--port`) |
| `HOST` | `127.0.0.1` | Bind address (`--host`). A non-loopback address requires `API_KEY`. |
| `API_KEY` / `MCP_API_KEY` | _(unset)_ | Clients send `Authorization: Bearer <key>` or `X-API-Key`. Compared in constant time. |
| `ALLOWED_HOSTS` | _(loopback)_ | Extra `Host` header names to accept (DNS-rebinding protection). |
| `ALLOWED_ORIGINS` | _(none)_ | Browser origins allowed through CORS. No CORS headers are sent by default. |
| `SESSION_IDLE_MS` | `1800000` | Idle sessions are closed after this many milliseconds (default 30 minutes). |
| `MAX_SESSIONS` | `100` | Cap on concurrent sessions. |
| `MAX_BODY` | `4mb` | Request body limit. |
| `HL7_MCP_MAX_OUTPUT_CHARS` | `60000` | Larger tool results return an error that explains how to narrow the request. |

`/health` returns the server name and version. `node server.js` still starts the HTTP server, as it
did in v1.

## Tools

All tools are read-only, return `structuredContent` that matches a published output schema, and
accept lenient input: `"3"` or `3`, table `4` or `0004`, and `adt_a04`, `ADT^A04` or `ADT A04`.

| Tool | What it does |
|---|---|
| `list_segments` | Lists every segment with its field count. Paginated, with a filter. |
| `get_segment` | Full segment definition: each field's data type, optionality (R/O/C/B/W), repetition, length, table and curated notes. |
| `get_field` | One field, with its data type's components and a summary of its table. |
| `get_datatype` | **New.** A data type's components and the fields that use it. |
| `list_message_types` | Every message type^event and the structure it uses. Paginated, with a filter. |
| `get_message_structure` | Abstract message syntax for an event (`ADT^A04`) or a structure (`ADT_A01`): groups, choices, required and repeating segments. |
| `lookup_code_table` | Table values with their v2.5.1 status. Defaults to valid codes only. Paginated. |
| `search_definitions` | **New.** Searches segments, fields, data types, events, structures, tables and codes by concept ("accession", "discharge date"). |
| `parse_message` | Parses to JSON with fields labelled by name and escapes decoded. It also returns a summary (MRN, prior MRN, order control, accession and *which field it came from*, Study Instance UID, result status). Filter by segment type and page with offset/limit. |
| `validate_message` | Base and structural checks, plus deep profiles (below). |
| `generate_ack` | **New.** Builds a v2.5.1 ACK: swapped MSH, `ACK^<trigger>^ACK`, and MSA echoing MSH-10. It can add ERR segments with ERL location, a table 0357 code and severity. `fromValidation` turns validation errors into ERRs. |
| `diff_messages` | **New.** Compares two messages by segment, field, component or subcomponent, using decoded values and field names. MSH-7 and MSH-10 are ignored by default. |
| `deidentify_message` | **New.** Removes or pseudonymises HIPAA Safe Harbor identifiers by v2.5.1 field and data type (details below). It never returns the original values. |

Resources: `hl7v2://segment/{code}`, `hl7v2://datatype/{code}`, `hl7v2://table/{id}`,
`hl7v2://structure/{id}`, `hl7v2://about/sources`.

### Validation

These base checks run on every message:

- MSH delimiters.
- MSH-7 and other timestamps.
- MSH-9 message code, trigger and structure, checked against tables 0076, 0003 and 0354, including whether the structure matches the event.
- MSH-10 length.
- MSH-11 (table 0103), MSH-12 and MSH-15/16 (table 0155).
- Segments that aren't defined in v2.5.1.
- EVN-1 agreeing with MSH-9.2.
- MSA on ACK messages (MSA-5 is withdrawn in v2.5.1).

| Profile | What it checks beyond the base checks |
|---|---|
| `ADT^A01` | EVN; PID; PV1, which is required; an outpatient class on an admission; and that PV1-3, PV1-19 and PV1-44 are present. It also flags a discharge time on an admission. |
| `ADT^A03` | PV1-45 discharge date/time present, PV1-19, and PV1-36 against table 0112 when HL7 publishes values for it. |
| `ADT^A04` | An inpatient class on a registration; PV1-19; and a discharge time on a registration. |
| `ADT^A08` | EVN placement, PV1 required by ADT_A01, **PV1-19 missing**, and MRG rejected. |
| `ADT^A31` | PV1 required by ADT_A05, **PV1-19 populated on a person-level event**, and a patient class other than N. |
| `ADT^A40` | PID↔MRG pairing across the repeating PATIENT group, MRG order, **self-merge**, cross-authority merges, and MRG-2/4 as backward-compatible only. |
| `ORM^O01` | ORC-1 (table 0119), order numbers, action codes on existing orders, **SC without ORC-5**, ORC↔OBR pairing, OBR-4, the accession, and the ZDS DICOM UID. |
| `OMI^O23` | ORDER groups (ORC, one OBR, at least one IPC). IPC-1 to IPC-4 are required (accession, requested procedure, Study Instance UID, scheduled procedure step). Also checks UID format, DICOM modality coding and consistent accessions. |
| `ORU^R01` | OBX grouped under its OBR, OBR-25 (table 0123) with an explicit callout when a table 0085 code is used, OBX-11 (table 0085), OBX-2 (table 0125: **CWE is not a v2.5.1 value type**), **OBR-25 checked against every OBX-11**, NM values that aren't numeric, and repeated OBX-3 without OBX-4. |
| `SIU^S12` | SCH first and present only once; SCH-1 or SCH-2; SCH-6, SCH-16 and SCH-20 required; SCH-11 is backward-compatible only (use TQ1); timing present; RGS groups with AIS, AIG, AIL and AIP inside them; AIS-3; action codes (table 0206). |

### De-identification

`deidentify_message` follows the HIPAA Safe Harbor list (45 CFR 164.514(b)(2)):

- **Names:** names (XPN) become `REDACTED`.
- **Addresses (XAD):** only state, country and address type are kept. ZIP codes are dropped.
- **Contact and personal numbers:** phone numbers (XTN), SSNs and licence numbers are removed.
- **Identifiers:** MRNs, account, visit, order, accession and appointment numbers get keyed HMAC pseudonyms. A value always maps to the same pseudonym within a message, and across messages when you pass a `seed`. Assigning authority and identifier type are kept.
- **DICOM UIDs** (IPC-3, ZDS-1) become new `2.25.` UIDs.
- **Dates:** every date, found through the v2.5.1 data types, is cut to the year. `dateMode: "shift"` shifts dates instead, which isn't Safe Harbor.
- **Ages over 89:** the birth date is dropped.
- **Free text** (OBX-5 TX/FT/ST, NTE-3, PV2-12) and embedded ED/RP data are redacted.
- **Local Z-segments** are dropped by default.

You still need to review the output: Safe Harbor also requires that you have no actual knowledge
that what remains could identify the person.

## Version traps this server encodes

Most HL7 material online blends v2.3 to v2.9. These are the places where v2.5.1 differs from what
people expect.

| Trap | The v2.5.1 position |
|---|---|
| **CE vs CWE** | In v2.5.1 the coded fields are `CE`: OBR-4, OBX-3, MSH-19, NTE-4, DG1-3, AL1-2/3/4, IN1-2/17, SCH-6/7/25. Later v2 versions moved to CWE. The exceptions are ERR-3, ERR-5 and PID-39, which are CWE in v2.5.1. |
| **CWE in OBX-2** | Table 0125 in v2.5.1 has no CWE, CNE or DTM value types. They were added in v2.6 and v2.7. |
| **Table 0123 vs 0085** | OBR-25 uses table 0123 (O, I, S, A, P, C, R, F, X, Y, Z). OBX-11 uses table 0085 (C, D, F, I, N, O, P, R, S, U, W, X). Putting an OBX-11 code in OBR-25 is the most common ORU build error. M and N appear in table 0123 only in later versions. |
| **PID-39** | v1 of this README said PID ends at PID-38. That was wrong: v2.5.1 defines **PID-39 Tribal Citizenship (CWE)**. |
| **PD1-8** | Organ Donor Code is PD1-8. PD1-6 is Handicap. |
| **MSA-5** | Withdrawn (W) in v2.5.1. Don't populate it. |
| **MRG-2 / MRG-4, SCH-11** | Backward compatibility only (B). Carry prior identifiers as MRG-1 repeats, and timing in TQ1. |
| **ZDS** | IHE RAD TF-2 defines exactly one field, of type `RP`; the UID sits in ZDS-1.1. OMI^O23 carries the UID in IPC-3 instead. |
| **ORC and PID in ORU** | Both are optional in the ORU_R01 abstract syntax, so the validator warns rather than errors. |
| **Repeating groups** | ADT_A39 repeats `{ PID [PD1] MRG [PV1] }`. ORM_O01 repeats ORDER. ORU_R01 repeats PATIENT_RESULT and ORDER_OBSERVATION. |
| **SCH-9 vs SCH-11** | Appointment Duration is SCH-9, with its units in SCH-10. SCH-11 is the backward-compatible TQ timing field. |
| **Table 0078** | The off-scale abnormal flags are `<` and `>`. |
| **OBR-18 accession** | Using OBR-18 for the DICOM Accession Number is an IHE RAD convention. `parse_message` reports which field it found the accession in. |
| **MSH-3 / MSH-5** | Optional in the standard, so they're reported as warnings. |

## Example prompts

```text
"What does PID-3 contain and what's its data type?"          → get_field
"Where does the accession number go in an OMI?"               → search_definitions, get_message_structure
"Is OBR-25 = M valid in 2.5.1?"                               → lookup_code_table(0123, status: all)
"Validate this SIU^S12 and build the ACK I should send back." → validate_message, generate_ack(fromValidation)
"What changed between these two A08s?"                        → diff_messages
"Strip the PHI from this ORU so I can paste it in a ticket."  → deidentify_message
```

## Development

```bash
npm install          # installs the core workspace too
npm test             # unit, MCP integration (in-memory), HTTP security and stdio tests
npm run fetch-sources && npm run generate   # rebuild core/data from the upstream sources
```

The layout:

- `core/`: the `hl7v2-core` package (data, parser, search).
- `src/server.js`: the tool and resource registry.
- `src/tools/`: the tools.
- `src/validate/`: validation profiles.
- `src/transport/`: stdio and HTTP.
- `bin/cli.js`: the entry point.

## Remote deployment (synthetic or de-identified data only)

Don't expose the server without authentication. If you bind a non-loopback `HOST` without an
`API_KEY`, the server refuses to start.

```bash
HOST=0.0.0.0 API_KEY="$(openssl rand -hex 32)" ALLOWED_HOSTS=hl7.example.org npx hl7-v2-mcp-server --http
```

The server accepts whatever message you POST. Treat remote instances as lab or synthetic-data
playgrounds, never as a place to send real PHI.

## Related

- [hl7-v2-fhir-mcp-server](https://github.com/coffeemilktea/hl7-v2-fhir-mcp-server): the companion v2-to-FHIR mapping and conversion server
- [coffeemilktea.github.io](https://coffeemilktea.github.io/): browser-based healthcare IT tools
- [hl7-dicom-tools](https://github.com/coffeemilktea/hl7-dicom-tools): DICOM and HL7 v2 browser tools

HL7® and FHIR® are registered trademarks of Health Level Seven International. This project isn't
affiliated with or endorsed by HL7 International. MIT licensed; see [LICENSE](LICENSE) and
[NOTICE](NOTICE).

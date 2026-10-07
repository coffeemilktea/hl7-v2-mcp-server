# HL7 v2.5.1 Reference MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that gives LLMs structured access
to the **HL7 v2.5.1** standard — segment definitions, field metadata, message structures, code
tables, a message parser, and a validator with deep profiles for `ORM^O01`, `ADT^A08`, `ADT^A31`,
`ADT^A40` and `ORU^R01`.

Built for PACS administrators, healthcare IT engineers, and interface analysts.

| | |
|---|---|
| **Protocol** | MCP Streamable HTTP |
| **Standard** | HL7 v2.5.1 + IHE RAD extensions |
| **Runtime** | Node.js 18+ |
| **License** | MIT |

> **Companion server:** [hl7-v2-fhir-mcp-server](https://github.com/coffeemilktea/hl7-v2-fhir-mcp-server)
> answers *what does this field become in FHIR R4* and converts whole messages into a transaction
> Bundle. The two are companions, not versions of each other — this one answers *what does this
> segment mean*. They listen on 3000 and 3001, so both can run at once.

---

## Quick start

```bash
git clone https://github.com/coffeemilktea/hl7-v2-mcp-server.git
cd hl7-v2-mcp-server
npm install
npm start
# HL7 v2.5.1 MCP server listening on http://localhost:3000/mcp
```

### Add to Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac) or
`%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "hl7-reference": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

Restart Claude Desktop. The eight tools appear in the tool panel.

### Add to Claude Code

In your project's `.claude/settings.json`:

```json
{
  "mcpServers": {
    "hl7-reference": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port the server listens on |
| `HOST` | `127.0.0.1` | Bind address. Non-loopback requires `API_KEY`. |
| `API_KEY` | _(unset)_ | Bearer / X-API-Key secret. Required when `HOST` is not loopback. |

A health check is served at `/health`.

---

## Tools

Eight tools covering the full HL7 v2.5.1 reference surface.

| Tool | Parameters | What it does |
|---|---|---|
| `list_segments` | — | List all supported segments with their names and field counts. |
| `get_segment` | `segment` | Full definition of a segment — every field with data type, length, optionality, repeatability, and a detailed description. |
| `get_field` | `segment`, `field` | Look up a single field by segment and sequence number. |
| `list_message_types` | — | List all supported message types and events with short descriptions. |
| `get_message_structure` | `messageType` | The required and optional segment sequence for a message type. |
| `lookup_code_table` | `tableNumber`, `filter?` | Look up values in a standard HL7 code table. |
| `parse_message` | `message` | Parse a pipe-delimited message into structured JSON. Strips MLLP framing, labels every field by name, and extracts a key-identifiers summary — MRN, prior MRN, order control, accession (reporting *which* field it came from), Study Instance UID and result status. |
| `validate_message` | `message` | Validate against v2.5.1 rules, returning errors, warnings and advisory notes separately. |

### Deep validation profiles

Beyond the base MSH, delimiter, timestamp and code-table checks that run on every message, five
message types are validated against their specific semantics:

| Message | What the profile checks beyond the basics |
|---|---|
| `ORM^O01` | ORC-1 against table 0119; that an order number exists in ORC-2 or ORC-3; that action codes (CA, DC, HD, RL, RP, SC, XO) actually identify an existing order; **SC sent without ORC-5**, the classic duplicate-worklist cause; ORC↔OBR pairing across the repeating ORDER group; OBR-4 present; accession recoverable from OBR-18/2/3; and ZDS Study Instance UID validated as a real DICOM UID — digits and dots only, ≤64 chars, no leading-zero components. |
| `ADT^A08` | EVN present and second; EVN-1 agrees with MSH-9.2; PV1 required per the ADT_A01 structure; PV1-2 against table 0004; **missing PV1-19** flagged, since a visit-level update with no visit number can land on the wrong encounter; MRG rejected outright. |
| `ADT^A31` | PV1 required by the ADT_A05 structure even though A31 is person-level; **warns when PV1-19 is populated**, because a person-level event carrying a visit number is the usual A08/A31 mix-up; notes when Patient Class is something other than N. |
| `ADT^A40` | MRG required; **PID↔MRG pairing across the repeating PATIENT group** of ADT_A39, so multi-merge messages are checked pair by pair; MRG ordered after its PID; **self-merge detection** when PID-3 equals MRG-1; and a warning when the two identifiers come from different assigning authorities. |
| `ORU^R01` | OBX segments grouped under their owning OBR; OBX appearing before any OBR flagged; OBR-25 against table 0123 with an explicit callout when a table 0085 code is used by mistake; OBX-11 against 0085; **cross-checks OBR-25 against every OBX-11** so a "Final" report containing preliminary lines is caught; NM values that are not numeric; and repeated OBX-3 within a group with no OBX-4 Sub-ID. |

---

## Supported HL7 content

### Segments

| Code | Name | Notes |
|---|---|---|
| MSH | Message Header | All 21 fields, delimiter rules, version check |
| MSA | Message Acknowledgment | ACK codes AA/AE/AR/CA/CE/CR |
| EVN | Event Type | Recorded vs. planned date, reason codes |
| PID | Patient Identification | All 38 v2.5.1 fields, deprecated ones included and marked |
| PV1 | Patient Visit | Patient class, location, attending/referring/admitting physicians |
| ORC | Common Order | Order control codes, placer/filler numbers |
| OBR | Observation Request | OBR-18 accession, OBR-25 result status, diagnostic service section |
| OBX | Observation/Result | All value types, abnormal flags, result status |
| NTE | Notes and Comments | Source codes, formatted text |
| MRG | Merge Patient Information | Prior patient ID — used in ADT^A40 |
| AL1 | Patient Allergy Information | Allergen type, severity, reaction |
| DG1 | Diagnosis | ICD codes, diagnosis type, priority |
| IN1 | Insurance | Plan, company, insured relationship |
| SCH | Scheduling Activity Information | SIU/SRM messages |
| ERR | Error | HL7 error condition codes (Table 0357) |
| ZDS | Study Instance UID | IHE RAD extension — one field only, RP data type |

### Message types

`ADT^A01` `ADT^A02` `ADT^A03` `ADT^A04` `ADT^A05` `ADT^A08` `ADT^A11` `ADT^A13` `ADT^A28`
`ADT^A31` `ADT^A40` `ORM^O01` (with IHE RAD ZDS) `ORR^O02` `ORU^R01` `ACK` `SIU^S12`

### Code tables

| Table | Name |
|---|---|
| 0001 | Administrative Sex (F/M/O/U/A/N) |
| 0003 | Event Type (A01–A45, O01, R01, T02…) |
| 0004 | Patient Class (I/O/E/P/B/U…) |
| 0007 | Admission Type (Accident/Elective/Emergency/Routine/Urgent) |
| 0008 | Acknowledgment Code (AA/AE/AR/CA/CE/CR) |
| 0074 | Diagnostic Service Section ID (RAD/CT/NMR/LAB/CH/HM…) |
| 0078 | Abnormal Flags (L/H/LL/HH/A/N/U/D/S/R/I…) |
| 0085 | Observation Result Status — **OBX-11** (C/D/F/I/N/O/P/R/S/U/W/X) |
| 0119 | Order Control Codes (NW/CA/DC/HD/RL/RP/SC/OK/UA…) |
| 0123 | Result Status — **OBR-25** (O/I/S/A/P/C/R/F/X/Y/Z — no M, N, U or W) |
| 0155 | Accept/Application Acknowledgment Conditions (AL/ER/NE/SU) |
| 0190 | Address Type (H/B/M/C/O/P/TM…) |
| 0357 | Message Error Condition Codes (0/100/101/200/204…) |

---

## Version traps this server encodes

Most HL7 reference material circulating online is a blend of v2.3 through v2.9. These are the points
where v2.5.1 specifically differs from what people expect, and where the reference data here has been
pinned to the 2.5.1 standard.

| Trap | The v2.5.1 position |
|---|---|
| **CE vs CWE** | In v2.5.1 the coded fields are `CE`, not CWE — OBR-4, OBX-3, MSH-19, NTE-4, DG1-3, AL1-2/3/4, IN1-2/17, SCH-6/7/25. CWE replaced CE from v2.7. The exceptions are ERR-3 and ERR-5, which genuinely *are* CWE in 2.5.1 because ERR was rewritten in v2.5. |
| **Table 0123 vs 0085** | OBR-25 uses table 0123 (O, I, S, A, P, C, R, F, X, Y, Z). OBX-11 uses table 0085 (C, D, F, I, N, O, P, R, S, U, W, X). **M, N, U and W are not valid in OBR-25** — putting an OBX-11 code there is the single most common ORU build error, and the validator names it explicitly. |
| **PID-39** | Does not exist in v2.5.1. PID ends at `PID-38` (Production Class Code). Tribal Citizenship arrived in v2.6. |
| **ZDS** | IHE RAD TF-2 defines **exactly one field**, and its data type is `RP` (Reference Pointer), not ST — components are Pointer^Application ID^Type of Data^Subtype, so the UID sits in ZDS-1.1. Anything in ZDS-2 onward is a site-local invention. |
| **ORC in ORU** | ORC is *optional* inside the ORDER_OBSERVATION group of ORU^R01, and the whole PATIENT group — so **PID too** — is optional in the abstract syntax. Real interfaces require both, but a message without them is still conformant, so the validator warns rather than errors. |
| **Repeating groups** | ADT_A39 repeats `{ PID [PD1] MRG [PV1] }`, so one A40 can carry several merges. ORM_O01 repeats the ORDER group and ORU_R01 repeats both PATIENT_RESULT and ORDER_OBSERVATION. Flattened references that show one of each are wrong, and the validator pairs the repeats up properly. |
| **SCH-9 vs SCH-11** | Appointment Duration is `SCH-9`, with its units in SCH-10. SCH-11 is Appointment Timing Quantity (TQ). |
| **Table 0078** | The off-scale abnormal flags are `<` and `>`, not `<=` and `>=`. |
| **OBR-18 accession** | Mapping the DICOM Accession Number (0008,0050) to OBR-18 is an **IHE RAD convention, not an HL7 requirement**. Sites also use OBR-2, OBR-3 or ORC-3. `parse_message` therefore reports which field it actually found the accession in rather than assuming. |
| **MSH-3 / MSH-5** | Optional in the standard, despite nearly every site treating them as mandatory. Reported as warnings, not errors. |

---

## Example prompts

Once connected, you can ask Claude questions like:

```text
# Field lookup
"What does PID-3 contain and what's its data type?"
  → get_field(segment="PID", field=3)

# Message structure
"What segments are required in an ADT A40 merge message?"
  → get_message_structure(messageType="ADT^A40")

# Parse a real message
"Parse this HL7 message and tell me the patient's MRN and accession number."
  → parse_message(message="MSH|^~\&|RIS|HOSP|PACS|HOSP|...")

# Code table lookup
"What does ORC-1 code 'SC' mean?"
  → lookup_code_table(tableNumber="0119", filter="SC")

# Validate before sending
"Validate this ORM^O01 and tell me what's missing."
  → validate_message(message="MSH|^~\&|...")

# Merge integrity
"Is this A40 safe to send? Check the merge direction."
  → validate_message(...)   catches self-merge, unpaired PID/MRG, cross-authority merge

# Report status consistency
"This ORU says Final but the EMR shows it as preliminary. Why?"
  → validate_message(...)   cross-checks OBR-25 vs OBX-11

# Segment overview
"Explain the ZDS segment and what it's used for in IHE."
  → get_segment(segment="ZDS")
```

---

---

## ⚠️ Remote deploy warning (lab / synthetic only)

**Do not expose this server on the public internet without authentication.**

Defaults are intentional for local use:

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Bind loopback only |
| `PORT` | see above | HTTP port |
| `API_KEY` (or `MCP_API_KEY`) | _(unset)_ | Optional on loopback; **required** for any non-loopback bind |

If you set `HOST=0.0.0.0` (or any non-loopback address) and omit `API_KEY`, the process
**refuses to start**. When `API_KEY` is set, every route except `/health` requires
`Authorization: Bearer <API_KEY>` or `X-API-Key: <API_KEY>`.

These servers hold HL7 reference/mapping logic and will happily accept whatever message
you POST — treat remote instances as **lab or synthetic-data playgrounds**, never as a
place to send real PHI.

### Deploying remotely (only with auth)

Railway, Render, and similar hosts typically bind `0.0.0.0`. That is fine **only** if you
also set a strong `API_KEY` (and prefer putting the service behind your own gateway).

**Do not** recommend or configure a wide-open Railway/Render deploy with open CORS and no
auth — that was an earlier mistake in this README.

```bash
# Example: remote bind with auth
HOST=0.0.0.0 API_KEY="$(openssl rand -hex 32)" PORT=3000 npm start
# Clients: Authorization: Bearer <that key>
```

## Related

- [hl7-v2-fhir-mcp-server](https://github.com/coffeemilktea/hl7-v2-fhir-mcp-server) — the companion
  v2-to-FHIR mapping and conversion server
- [coffeemilktea.github.io](https://coffeemilktea.github.io/) — browser-based healthcare IT tools,
  including an HL7 v2 ↔ FHIR converter built from this same reference data
- [hl7-dicom-tools](https://github.com/coffeemilktea/hl7-dicom-tools) — the DICOM and HL7 v2 browser tools

HL7 v2.5.1 content is based on the published HL7 International standard. HL7® and FHIR® are
registered trademarks of Health Level Seven International; this project is not affiliated with or
endorsed by HL7 International.

MIT licensed — see [LICENSE](LICENSE).

#!/usr/bin/env node
/**
 * HL7 v2.5.1 Reference MCP Server
 *
 * Implements the Model Context Protocol over Streamable HTTP.
 * Run locally: node server.js
 * Then add to claude_desktop_config.json (see README.md).
 *
 * Requires Node.js 18+
 * Dependencies: npm install @modelcontextprotocol/sdk express zod cors
 */

import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// ─── HL7 v2.5.1 Reference Data ───────────────────────────────────────────────

const SEGMENTS = {
  MSH: {
    name: "Message Header",
    description:
      "Defines the intent, source, destination and some specifics of the syntax of a message. Always the first segment of every HL7 message.",
    fields: [
      { seq: 1, name: "Field Separator", type: "ST", len: 1, opt: "R", rpt: 1, desc: "Defines the character that separates fields. Literal value |" },
      { seq: 2, name: "Encoding Characters", type: "ST", len: 4, opt: "R", rpt: 1, desc: "Four characters in this order: component separator ^, repetition separator ~, escape character \\, subcomponent separator &. Default: ^~\\&" },
      { seq: 3, name: "Sending Application", type: "HD", len: 227, opt: "O", rpt: 1, desc: "Uniquely identifies the sending application among all other applications within the network enterprise." },
      { seq: 4, name: "Sending Facility", type: "HD", len: 227, opt: "O", rpt: 1, desc: "Further identifies the sending application. Can be an organizational unit or department." },
      { seq: 5, name: "Receiving Application", type: "HD", len: 227, opt: "O", rpt: 1, desc: "Uniquely identifies the receiving application among all other applications within the network enterprise." },
      { seq: 6, name: "Receiving Facility", type: "HD", len: 227, opt: "O", rpt: 1, desc: "Further identifies the receiving application. Can be an organizational unit or department." },
      { seq: 7, name: "Date/Time Of Message", type: "TS", len: 26, opt: "R", rpt: 1, desc: "Contains the date/time that the sending system created the message. Format: YYYYMMDDHHMMSS[.SSSS][+/-ZZZZ]" },
      { seq: 8, name: "Security", type: "ST", len: 40, opt: "O", rpt: 1, desc: "Used to implement a security check between applications." },
      { seq: 9, name: "Message Type", type: "MSG", len: 15, opt: "R", rpt: 1, desc: "Contains the message type, trigger event, and message structure for the message. E.g., ADT^A01^ADT_A01" },
      { seq: 10, name: "Message Control ID", type: "ST", len: 20, opt: "R", rpt: 1, desc: "A number or other identifier that uniquely identifies the message. Used to reference the message in acknowledgements." },
      { seq: 11, name: "Processing ID", type: "PT", len: 3, opt: "R", rpt: 1, desc: "Used to decide whether to process the message as defined in HL7 application (real) processing rules. P=Production, D=Debugging, T=Training." },
      { seq: 12, name: "Version ID", type: "VID", len: 60, opt: "R", rpt: 1, desc: "Matched by the receiving system to its own version to be sure the message will be interpreted correctly. Use 2.5.1 for this version." },
      { seq: 13, name: "Sequence Number", type: "NM", len: 15, opt: "O", rpt: 1, desc: "Non-null value in this field implies that the sequence number protocol is in use." },
      { seq: 14, name: "Continuation Pointer", type: "ST", len: 180, opt: "O", rpt: 1, desc: "Used to define continuations in application-level fields." },
      { seq: 15, name: "Accept Acknowledgment Type", type: "ID", len: 2, opt: "O", rpt: 1, desc: "AL=Always, NE=Never, ER=Error/reject only, SU=Successful only. Table 0155." },
      { seq: 16, name: "Application Acknowledgment Type", type: "ID", len: 2, opt: "O", rpt: 1, desc: "AL=Always, NE=Never, ER=Error/reject only, SU=Successful only. Table 0155." },
      { seq: 17, name: "Country Code", type: "ID", len: 3, opt: "O", rpt: 1, desc: "Country of origin for the message. ISO 3166 two-character codes." },
      { seq: 18, name: "Character Set", type: "ID", len: 16, opt: "O", rpt: "∞", desc: "The character set for the entire message. Table 0211. Default is ASCII." },
      { seq: 19, name: "Principal Language Of Message", type: "CE", len: 250, opt: "O", rpt: 1, desc: "Primary language of the message. Data type is CE in v2.5.1; it became CWE in v2.7." },
      { seq: 20, name: "Alternate Character Set Handling Scheme", type: "ID", len: 20, opt: "O", rpt: 1, desc: "Alternate character set handling scheme. Table 0356." },
      { seq: 21, name: "Message Profile Identifier", type: "EI", len: 427, opt: "O", rpt: "∞", desc: "Uniquely identifies the HL7 application message processing rules for the message." },
    ],
  },
  MSA: {
    name: "Message Acknowledgment",
    description:
      "Defines the acknowledgment code and control information for the acknowledgment message. Always returned in an ACK message.",
    fields: [
      { seq: 1, name: "Acknowledgment Code", type: "ID", len: 2, opt: "R", rpt: 1, desc: "AA=Application Accept, AE=Application Error, AR=Application Reject, CA=Commit Accept, CE=Commit Error, CR=Commit Reject. Table 0008." },
      { seq: 2, name: "Message Control ID", type: "ST", len: 20, opt: "R", rpt: 1, desc: "The Message Control ID of the message being acknowledged (MSH-10 from the original)." },
      { seq: 3, name: "Text Message", type: "ST", len: 80, opt: "O", rpt: 1, desc: "DEPRECATED in v2.5. Human-readable text giving further detail on a non-AA response." },
      { seq: 4, name: "Expected Sequence Number", type: "NM", len: 15, opt: "O", rpt: 1, desc: "DEPRECATED. Sequence number the sender expected." },
      { seq: 5, name: "Delayed Acknowledgment Type", type: "ID", len: 1, opt: "O", rpt: 1, desc: "DEPRECATED." },
      { seq: 6, name: "Error Condition", type: "CE", len: 250, opt: "O", rpt: 1, desc: "DEPRECATED. Error condition." },
    ],
  },
  EVN: {
    name: "Event Type",
    description: "Used to communicate necessary trigger event information to receiving applications.",
    fields: [
      { seq: 1, name: "Event Type Code", type: "ID", len: 3, opt: "B", rpt: 1, desc: "DEPRECATED in v2.3.1+. Redundant with MSH-9 trigger event." },
      { seq: 2, name: "Recorded Date/Time", type: "TS", len: 26, opt: "R", rpt: 1, desc: "The date and time the event was actually recorded." },
      { seq: 3, name: "Date/Time Planned Event", type: "TS", len: 26, opt: "O", rpt: 1, desc: "The date/time the event is planned to occur." },
      { seq: 4, name: "Event Reason Code", type: "IS", len: 3, opt: "O", rpt: 1, desc: "Table 0062. Describes the reason for the event. E.g., 01=Patient request, 02=Physician order, 03=Census management." },
      { seq: 5, name: "Operator ID", type: "XCN", len: 250, opt: "O", rpt: "∞", desc: "The login of the person who entered the event. Used for audit." },
      { seq: 6, name: "Event Occurred", type: "TS", len: 26, opt: "O", rpt: 1, desc: "The date and time the event actually occurred." },
      { seq: 7, name: "Event Facility", type: "HD", len: 241, opt: "O", rpt: 1, desc: "Identifies the facility where the event occurred." },
    ],
  },
  PID: {
    name: "Patient Identification",
    description:
      "Used by all applications as the primary means of communicating patient identification information. Contains all demographics. The most important segment in HL7 v2.",
    fields: [
      { seq: 1, name: "Set ID - PID", type: "SI", len: 4, opt: "O", rpt: 1, desc: "For first occurrence of PID in a message, the value 1 is used." },
      { seq: 2, name: "Patient ID", type: "CX", len: 20, opt: "B", rpt: 1, desc: "DEPRECATED. Retained for backward compatibility. External patient ID." },
      { seq: 3, name: "Patient Identifier List", type: "CX", len: 250, opt: "R", rpt: "∞", desc: "Primary patient identification. CX components: ID^Check Digit^Check Digit Scheme^Assigning Authority^Identifier Type Code. Identifier Type Codes: MR=Medical Record, PI=Patient Internal ID, SS=SSN, DL=Driver's License." },
      { seq: 4, name: "Alternate Patient ID - PID", type: "CX", len: 20, opt: "B", rpt: "∞", desc: "DEPRECATED. Third party identifiers for this patient." },
      { seq: 5, name: "Patient Name", type: "XPN", len: 250, opt: "R", rpt: "∞", desc: "Legal name. XPN: Family^Given^Middle^Suffix^Prefix^Degree^Name Type. Name Type L=Legal, A=Alias, N=Nickname, P=Name of Partner/Spouse, M=Maiden." },
      { seq: 6, name: "Mother's Maiden Name", type: "XPN", len: 250, opt: "O", rpt: "∞", desc: "Family name under which the mother was born." },
      { seq: 7, name: "Date/Time of Birth", type: "TS", len: 26, opt: "O", rpt: 1, desc: "Patient's date and time of birth. Format: YYYYMMDD[HHMM[SS[.SSSS]]][+/-ZZZZ]." },
      { seq: 8, name: "Administrative Sex", type: "IS", len: 1, opt: "O", rpt: 1, desc: "Table 0001. F=Female, M=Male, O=Other, U=Unknown, A=Ambiguous, N=Not applicable." },
      { seq: 9, name: "Patient Alias", type: "XPN", len: 250, opt: "B", rpt: "∞", desc: "DEPRECATED. Other names used by the patient." },
      { seq: 10, name: "Race", type: "CE", len: 250, opt: "O", rpt: "∞", desc: "Table 0005. Patient's race. E.g., 1002-5=American Indian or Alaska Native, 2028-9=Asian, 2054-5=Black, 2076-8=Native Hawaiian, 2106-3=White." },
      { seq: 11, name: "Patient Address", type: "XAD", len: 250, opt: "O", rpt: "∞", desc: "Mailing and home addresses. XAD: Street^Other^City^State^Zip^Country^Address Type. Address types: H=Home, B=Business, M=Mailing, BA=Bad address." },
      { seq: 12, name: "County Code", type: "IS", len: 4, opt: "B", rpt: 1, desc: "DEPRECATED. Use PID-11 (address) county/parish instead." },
      { seq: 13, name: "Phone Number - Home", type: "XTN", len: 250, opt: "O", rpt: "∞", desc: "Patient's home phone number(s). XTN: [unused]^Telecom Use^Equipment Type^Email^Country Code^Area Code^Local Number^Extension^..." },
      { seq: 14, name: "Phone Number - Business", type: "XTN", len: 250, opt: "O", rpt: "∞", desc: "Patient's business telephone number(s)." },
      { seq: 15, name: "Primary Language", type: "CE", len: 250, opt: "O", rpt: 1, desc: "Patient's primary spoken language. ISO 639 codes." },
      { seq: 16, name: "Marital Status", type: "CE", len: 250, opt: "O", rpt: 1, desc: "Table 0002. A=Separated, B=Unmarried, C=Common law, D=Divorced, E=Legally separated, G=Living together, I=Interlocutory, M=Married, N=Annulled, O=Other, P=Domestic partner, R=Registered domestic partner, S=Single, T=Unreported, U=Unknown, W=Widowed." },
      { seq: 17, name: "Religion", type: "CE", len: 250, opt: "O", rpt: 1, desc: "Table 0006. Patient's religion." },
      { seq: 18, name: "Patient Account Number", type: "CX", len: 250, opt: "O", rpt: 1, desc: "Patient account number assigned by accounting to which all charges, payments, etc. are recorded." },
      { seq: 19, name: "SSN Number - Patient", type: "ST", len: 16, opt: "B", rpt: 1, desc: "DEPRECATED. Social Security Number. Use PID-3 with identifier type SS." },
      { seq: 20, name: "Driver's License Number - Patient", type: "DLN", len: 25, opt: "B", rpt: 1, desc: "DEPRECATED. Driver's license number." },
      { seq: 21, name: "Mother's Identifier", type: "CX", len: 250, opt: "O", rpt: "∞", desc: "Used as a link field for newborns." },
      { seq: 22, name: "Ethnic Group", type: "CE", len: 250, opt: "O", rpt: "∞", desc: "Table 0189. 2135-2=Hispanic or Latino, 2186-5=Not Hispanic or Latino, U=Unknown." },
      { seq: 23, name: "Birth Place", type: "ST", len: 250, opt: "O", rpt: 1, desc: "Free-text description of patient's birth place." },
      { seq: 24, name: "Multiple Birth Indicator", type: "ID", len: 1, opt: "O", rpt: 1, desc: "Y=Yes, N=No. Indicates if this patient was part of a multiple birth." },
      { seq: 25, name: "Birth Order", type: "NM", len: 2, opt: "O", rpt: 1, desc: "Birth order for multiple births. 1=First, 2=Second, etc." },
      { seq: 26, name: "Citizenship", type: "CE", len: 250, opt: "O", rpt: "∞", desc: "Citizenship of the patient. ISO 3166 codes." },
      { seq: 27, name: "Veterans Military Status", type: "CE", len: 250, opt: "O", rpt: 1, desc: "Table 0172. Military status of the patient." },
      { seq: 28, name: "Nationality", type: "CE", len: 250, opt: "O", rpt: 1, desc: "DEPRECATED. Table 0212." },
      { seq: 29, name: "Patient Death Date and Time", type: "TS", len: 26, opt: "O", rpt: 1, desc: "Date and time of patient death." },
      { seq: 30, name: "Patient Death Indicator", type: "ID", len: 1, opt: "O", rpt: 1, desc: "Y=Yes, N=No. Indicates if the patient is deceased." },
      { seq: 31, name: "Identity Unknown Indicator", type: "ID", len: 1, opt: "O", rpt: 1, desc: "Y=Yes, N=No. Indicates whether or not the patient's/person's identity is known." },
      { seq: 32, name: "Identity Reliability Code", type: "IS", len: 20, opt: "O", rpt: "∞", desc: "Table 0445. AL=Patient/Person Name is an Alias, UA=Unknown/Default Address, UD=Unknown/Default Date of Birth, US=Unknown/Default Social Security Number." },
      { seq: 33, name: "Last Update Date/Time", type: "TS", len: 26, opt: "O", rpt: 1, desc: "Date and time when this record was last updated in the sending system." },
      { seq: 34, name: "Last Update Facility", type: "HD", len: 241, opt: "O", rpt: 1, desc: "Identifies the facility of the last update to a patient record." },
      { seq: 35, name: "Species Code", type: "CE", len: 250, opt: "C", rpt: 1, desc: "Table 0446. The species of the patient. Used in veterinary context." },
      { seq: 36, name: "Breed Code", type: "CE", len: 250, opt: "C", rpt: 1, desc: "Table 0447. The breed of the animal. Used in veterinary context." },
      { seq: 37, name: "Strain", type: "ST", len: 80, opt: "O", rpt: 1, desc: "An indication of a strain of an organism." },
      { seq: 38, name: "Production Class Code", type: "CE", len: 250, opt: "O", rpt: 2, desc: "Table 0429. Veterinary only. BF=Beef, BR=Breeding, DA=Dairy, DR=Draft, DU=Dual Purpose, LY=Layer, MT=Meat, NA=Not Applicable, OT=Other, PL=Pleasure, RA=Racing, SH=Show, U=Unknown." },
    ],
  },
  PV1: {
    name: "Patient Visit",
    description:
      "Used by Registration/ADT applications to communicate information on an account or visit-specific basis.",
    fields: [
      { seq: 1, name: "Set ID - PV1", type: "SI", len: 4, opt: "O", rpt: 1, desc: "Sequence number of this segment. For first occurrence: 1." },
      { seq: 2, name: "Patient Class", type: "IS", len: 1, opt: "R", rpt: 1, desc: "Table 0004. B=Obstetrics, C=Commercial Account, E=Emergency, I=Inpatient, N=Not Applicable, O=Outpatient, P=Preadmit, R=Recurring Patient, U=Unknown." },
      { seq: 3, name: "Assigned Patient Location", type: "PL", len: 80, opt: "O", rpt: 1, desc: "PL: Point of Care^Room^Bed^Facility^Location Status^Person Location Type^Building^Floor^Location Description^Comprehensive Location Identifier^Assigning Authority. The patient's assigned bed/location." },
      { seq: 4, name: "Admission Type", type: "IS", len: 2, opt: "O", rpt: 1, desc: "Table 0007. A=Accident, C=Elective, E=Emergency, L=Labor and Delivery, N=Newborn, R=Routine, U=Urgent." },
      { seq: 5, name: "Preadmit Number", type: "CX", len: 250, opt: "O", rpt: 1, desc: "Uniquely identifies the patient's pre-admission account." },
      { seq: 6, name: "Prior Patient Location", type: "PL", len: 80, opt: "O", rpt: 1, desc: "Previous patient location for transfers." },
      { seq: 7, name: "Attending Doctor", type: "XCN", len: 250, opt: "O", rpt: "∞", desc: "Attending physician. XCN: ID^Family^Given^Middle^Suffix^Prefix^Degree^Source Table^Assigning Authority^Name Type." },
      { seq: 8, name: "Referring Doctor", type: "XCN", len: 250, opt: "O", rpt: "∞", desc: "Referring physician." },
      { seq: 9, name: "Consulting Doctor", type: "XCN", len: 250, opt: "B", rpt: "∞", desc: "DEPRECATED." },
      { seq: 10, name: "Hospital Service", type: "IS", len: 3, opt: "O", rpt: 1, desc: "Table 0069. The treatment or type of surgery the patient is scheduled for." },
      { seq: 11, name: "Temporary Location", type: "PL", len: 80, opt: "O", rpt: 1, desc: "Temporary patient location." },
      { seq: 14, name: "Admit Source", type: "IS", len: 6, opt: "O", rpt: 1, desc: "Table 0023. 1=Physician referral, 2=Clinic referral, 3=HMO referral, 4=Transfer from hospital, 5=Transfer from SNF, 6=Transfer from another health care facility, 7=Emergency room, 8=Court/law enforcement, 9=Information not available." },
      { seq: 15, name: "Ambulatory Status", type: "IS", len: 2, opt: "O", rpt: "∞", desc: "Table 0009. A0=No functional limitations, A1=Ambulates with assistive device, A2=Wheelchair/stretcher bound, A3=Comatose, A4=Disoriented, A5=Vision impaired, A6=Hearing impaired, A7=Speech impaired, A8=Non-English speaking, A9=Functional level unknown, B1=Oxygen therapy, B2=Special equipment, B3=Amputee, B4=Mastectomy, B5=Paraplegic, B6=Pregnant." },
      { seq: 16, name: "VIP Indicator", type: "IS", len: 2, opt: "O", rpt: 1, desc: "Table 0099. Indicates whether patient is considered a VIP." },
      { seq: 17, name: "Admitting Doctor", type: "XCN", len: 250, opt: "O", rpt: "∞", desc: "Admitting physician." },
      { seq: 18, name: "Patient Type", type: "IS", len: 2, opt: "O", rpt: 1, desc: "Table 0018. Site-defined patient type." },
      { seq: 19, name: "Visit Number", type: "CX", len: 250, opt: "O", rpt: 1, desc: "Unique number assigned to each patient visit. Often called encounter number." },
      { seq: 44, name: "Admit Date/Time", type: "TS", len: 26, opt: "O", rpt: 1, desc: "Date and time of admission." },
      { seq: 45, name: "Discharge Date/Time", type: "TS", len: 26, opt: "O", rpt: "∞", desc: "Date and time of discharge." },
      { seq: 51, name: "Visit Indicator", type: "IS", len: 1, opt: "O", rpt: 1, desc: "Table 0326. A=Account Level, V=Visit Level." },
    ],
  },
  ORC: {
    name: "Common Order",
    description:
      "Used to transmit fields that are common to all orders (all types of services that are requested). ORC is REQUIRED in each ORDER group of ORM^O01 and ORR^O02. It is OPTIONAL in the ORDER_OBSERVATION group of ORU^R01 — a common misconception is that ORU requires it.",
    fields: [
      { seq: 1, name: "Order Control", type: "ID", len: 2, opt: "R", rpt: 1, desc: "Table 0119. The function of the order segment. NW=New Order, CA=Cancel Order, DC=Discontinue Order, HD=Hold Order, RL=Release Previous Hold, RP=Order/Service Replace Request, RU=Replaced Unsolicited, SC=Status Changed, SN=Send Order Number, OK=Order Accepted, UA=Unable to Accept Order, UC=Unable to Cancel, UM=Unable to Discontinue, UH=Unable to Put on Hold, UR=Unable to Release, UX=Unable to Change, AF=Order/Service Refill Request Approval, NA=Number Assigned, RE=Observations/Performed Service to Follow, OR=Released as Requested, RF=Refill Order Request, PA=Parent Order." },
      { seq: 2, name: "Placer Order Number", type: "EI", len: 22, opt: "C", rpt: 1, desc: "Identifier of the order placed by the placer application. EI: Entity Identifier^Namespace ID^Universal ID^Universal ID Type." },
      { seq: 3, name: "Filler Order Number", type: "EI", len: 22, opt: "C", rpt: 1, desc: "Order number assigned by the filling application (e.g., RIS accession number in radiology)." },
      { seq: 4, name: "Placer Group Number", type: "EI", len: 22, opt: "O", rpt: 1, desc: "Allows an order placing application to group sets of orders together." },
      { seq: 5, name: "Order Status", type: "ID", len: 2, opt: "O", rpt: 1, desc: "Table 0038. Status of the order: A=Some, but not all, results available, CA=Order was canceled, CM=Order is completed, DC=Order was discontinued, ER=Error, hold order, HD=Order is on hold, IP=In process, unspecified, RP=Order has been replaced, SC=In process, scheduled." },
      { seq: 7, name: "Quantity/Timing", type: "TQ", len: 200, opt: "B", rpt: "∞", desc: "DEPRECATED in v2.5. Replaced by ORC-7 and ORC-8 in earlier versions; timing now in TQ1/TQ2 segments." },
      { seq: 9, name: "Date/Time of Transaction", type: "TS", len: 26, opt: "O", rpt: 1, desc: "Date and time the current transaction enters the order." },
      { seq: 10, name: "Entered By", type: "XCN", len: 250, opt: "O", rpt: "∞", desc: "Person who placed the request." },
      { seq: 11, name: "Verified By", type: "XCN", len: 250, opt: "O", rpt: "∞", desc: "Person who verified the order." },
      { seq: 12, name: "Ordering Provider", type: "XCN", len: 250, opt: "O", rpt: "∞", desc: "Provider who ordered the procedure." },
      { seq: 13, name: "Enterer's Location", type: "PL", len: 80, opt: "O", rpt: 1, desc: "Location where the order was entered." },
      { seq: 14, name: "Call Back Phone Number", type: "XTN", len: 250, opt: "O", rpt: 2, desc: "Phone number to call when the order is completed." },
      { seq: 15, name: "Order Effective Date/Time", type: "TS", len: 26, opt: "O", rpt: 1, desc: "Date/time that the changes indicated by the order control code take effect." },
      { seq: 16, name: "Order Control Code Reason", type: "CE", len: 250, opt: "O", rpt: 1, desc: "Explanation or reason codes for the order event." },
      { seq: 17, name: "Entering Organization", type: "CE", len: 250, opt: "O", rpt: 1, desc: "Organization that entered the order." },
      { seq: 18, name: "Entering Device", type: "CE", len: 250, opt: "O", rpt: 1, desc: "Physical device (terminal, etc.) used to enter the order." },
      { seq: 19, name: "Action By", type: "XCN", len: 250, opt: "O", rpt: "∞", desc: "Provider responsible for the action." },
      { seq: 21, name: "Ordering Facility Name", type: "XON", len: 250, opt: "O", rpt: "∞", desc: "Name of the facility with which the ordering provider is associated." },
      { seq: 22, name: "Ordering Facility Address", type: "XAD", len: 250, opt: "O", rpt: "∞", desc: "Address of the facility associated with the ordering provider." },
    ],
  },
  OBR: {
    name: "Observation Request",
    description:
      "Used to transmit information specific to an order for a diagnostic study or observation. In radiology: the procedure request. OBR-18 is the Accession Number. OBR-25 is Result Status.",
    fields: [
      { seq: 1, name: "Set ID - OBR", type: "SI", len: 4, opt: "O", rpt: 1, desc: "For the first order transmitted, the sequence number shall be 1." },
      { seq: 2, name: "Placer Order Number", type: "EI", len: 22, opt: "C", rpt: 1, desc: "Identifier assigned by the placer. Same as ORC-2." },
      { seq: 3, name: "Filler Order Number", type: "EI", len: 22, opt: "C", rpt: 1, desc: "Identifier assigned by the filler (RIS). Same as ORC-3." },
      { seq: 4, name: "Universal Service Identifier", type: "CE", len: 250, opt: "R", rpt: 1, desc: "Identifies universally the service to be performed. Contains the procedure code. E.g., CT abdomen, MRI brain. Use CPT-4, LOINC or site-defined codes. Data type is CE in v2.5.1 (CWE from v2.7)." },
      { seq: 5, name: "Priority", type: "ID", len: 2, opt: "B", rpt: 1, desc: "DEPRECATED. Kept for backward compatibility." },
      { seq: 6, name: "Requested Date/Time", type: "TS", len: 26, opt: "B", rpt: 1, desc: "DEPRECATED. Date/time the order was requested." },
      { seq: 7, name: "Observation Date/Time", type: "TS", len: 26, opt: "C", rpt: 1, desc: "Observation start date/time. In radiology: when the procedure began." },
      { seq: 8, name: "Observation End Date/Time", type: "TS", len: 26, opt: "O", rpt: 1, desc: "End date and time of observation period." },
      { seq: 9, name: "Collection Volume", type: "CQ", len: 20, opt: "O", rpt: 1, desc: "For laboratory: quantity of specimen collected." },
      { seq: 10, name: "Collector Identifier", type: "XCN", len: 250, opt: "O", rpt: "∞", desc: "Person who collected the specimen." },
      { seq: 11, name: "Specimen Action Code", type: "ID", len: 1, opt: "O", rpt: 1, desc: "Table 0065. Action to take with the specimen. A=Add ordered tests, G=Generated order, L=Lab to obtain specimen from patient, O=Specimen obtained by service, P=Pending specimen, Q=Specimen obtained by lab, R=Revised order, S=Schedule the tests, T=Transfer specimen." },
      { seq: 12, name: "Danger Code", type: "CE", len: 250, opt: "O", rpt: 1, desc: "Code and/or text indicating any special handling considerations for the specimen." },
      { seq: 13, name: "Relevant Clinical Information", type: "ST", len: 300, opt: "O", rpt: 1, desc: "Additional clinical information about the patient or specimen to guide the filler. The clinical indication or reason for study." },
      { seq: 16, name: "Ordering Provider", type: "XCN", len: 250, opt: "O", rpt: "∞", desc: "Provider who ordered the procedure. Same as ORC-12." },
      { seq: 17, name: "Order Callback Phone Number", type: "XTN", len: 250, opt: "O", rpt: 2, desc: "Phone number for results callback." },
      { seq: 18, name: "Placer Field 1", type: "ST", len: 60, opt: "O", rpt: 1, desc: "User-defined placer field. In radiology, IHE RAD TF-2 maps the DICOM Accession Number (0008,0050) to OBR-18 for the Scheduled Workflow profile, and that is the most common convention. Be aware it is a convention, not a v2.5.1 requirement — some sites instead carry the accession in OBR-2, OBR-3 or ORC-3, so always confirm against the site's interface specification before mapping." },
      { seq: 19, name: "Placer Field 2", type: "ST", len: 60, opt: "O", rpt: 1, desc: "Additional placer-defined field." },
      { seq: 20, name: "Filler Field 1", type: "ST", len: 60, opt: "O", rpt: 1, desc: "Filler-defined field." },
      { seq: 21, name: "Filler Field 2", type: "ST", len: 60, opt: "O", rpt: 1, desc: "Filler-defined field." },
      { seq: 22, name: "Results Rpt/Status Chng - Date/Time", type: "TS", len: 26, opt: "C", rpt: 1, desc: "Date/time when the results were reported or status changed." },
      { seq: 24, name: "Diagnostic Serv Sect ID", type: "ID", len: 10, opt: "O", rpt: 1, desc: "Table 0074. AU=Audiology, BG=Blood Gases, BLB=Blood Bank, CG=Cytogenetics, CH=Chemistry, CP=Cytopathology, CT=CAT Scan, CTH=Cardiac Catheterization, CUS=Cardiac Ultrasound, EC=Electrocardiac, EN=Electroneuro, GE=Genetics, HM=Hematology, ICU=Bedside ICU Monitoring, IMG=Diagnostic Imaging, IMM=Immunology, LAB=Laboratory, MB=Microbiology, MCB=Mycobacteriology, MYC=Mycology, NMR=Nuclear Magnetic Resonance, NMS=Nuclear Medicine Scan, NRS=Nursing Service Measures, OSL=Outside Lab, OT=Occupational Therapy, OTH=Other, OUS=OB Ultrasound, PAR=Parasitology, PAT=Pathology, PF=Pulmonary Function, PHR=Pharmacy, PHY=Physician (Hx. Dx. Rx.), PT=Physical Therapy, RAD=Radiology, RC=Respiratory Care (Therapy), RT=Radiation Therapy, RUS=Radiology Ultrasound, RX=Radiograph, SP=Surgical Pathology, SR=Serology, TX=Toxicology, URN=Urinalysis, VR=Virology, VUS=Vascular Ultrasound." },
      { seq: 25, name: "Result Status", type: "ID", len: 1, opt: "C", rpt: 1, desc: "Table 0123. Required whenever OBX segments are present. O=Order received, specimen not yet received; I=No results available, specimen received, procedure incomplete; S=No results available, procedure scheduled but not done; A=Some but not all results available; P=Preliminary (a verified early result is available); C=Correction to results; R=Results stored, not yet verified; F=Final results (can only be changed by a corrected result); X=No results available, order canceled; Y=No order on record for this test (query response only); Z=No record of this patient (query response only). Note: M, N and W are NOT valid table 0123 values — they belong to OBX-11 / table 0085." },
      { seq: 26, name: "Parent Result", type: "PRL", len: 400, opt: "O", rpt: 1, desc: "Links to the parent order." },
      { seq: 29, name: "Parent", type: "EIP", len: 200, opt: "O", rpt: 1, desc: "Used to link child orders to parent orders." },
      { seq: 31, name: "Reason for Study", type: "CE", len: 250, opt: "O", rpt: "∞", desc: "Clinical indication for the study." },
      { seq: 32, name: "Principal Result Interpreter", type: "NDL", len: 200, opt: "O", rpt: 1, desc: "Person who analyzed the observation and identified the conclusion." },
      { seq: 34, name: "Technician", type: "NDL", len: 200, opt: "O", rpt: "∞", desc: "Person who performed the observation." },
      { seq: 36, name: "Scheduled Date/Time", type: "TS", len: 26, opt: "O", rpt: 1, desc: "Scheduled date and time for the study." },
      { seq: 44, name: "Procedure Code", type: "CE", len: 250, opt: "O", rpt: 1, desc: "Unique identifier for the procedure. E.g., CPT code." },
      { seq: 45, name: "Procedure Code Modifier", type: "CE", len: 250, opt: "O", rpt: "∞", desc: "Contains the procedure code modifier to the procedure code." },
    ],
  },
  OBX: {
    name: "Observation/Result",
    description:
      "Used to transmit a single observation or observation fragment. In radiology: used for report text and measurements. Can contain text, numeric values, coded values, images, and more.",
    fields: [
      { seq: 1, name: "Set ID - OBX", type: "SI", len: 4, opt: "O", rpt: 1, desc: "Sequence number for multiple OBX segments." },
      { seq: 2, name: "Value Type", type: "ID", len: 3, opt: "C", rpt: 1, desc: "Table 0125. CE=Coded Entry, CWE=Coded with Exceptions, CX=Extended Composite ID, DT=Date, DTM=Date/Time, ED=Encapsulated Data, FT=Formatted Text, GTS=General Timing Specification, ID=Coded Value for HL7, IS=Coded Value for User-Defined, MO=Money, NA=Numeric Array, NM=Numeric, RP=Reference Pointer, SN=Structured Numeric, ST=String Data, TM=Time, TX=Text Data, XAD=Extended Address, XCN=Extended Composite ID, XON=Extended Composite Name for Organizations, XPN=Extended Person Name, XTN=Extended Telecommunications Number." },
      { seq: 3, name: "Observation Identifier", type: "CE", len: 250, opt: "R", rpt: 1, desc: "Uniquely identifies the observation. Use LOINC codes when possible. E.g., 18782-3=Radiology Study Observation. Components: Identifier^Text^Name of Coding System^Alternate Identifier^Alternate Text^Name of Alternate Coding System. Data type is CE in v2.5.1 (CWE from v2.7)." },
      { seq: 4, name: "Observation Sub-ID", type: "ST", len: 20, opt: "C", rpt: 1, desc: "Distinguishes between multiple OBX segments with the same OBX-3. Used when a result has sub-components." },
      { seq: 5, name: "Observation Value", type: "varies", len: "∞", opt: "C", rpt: "∞", desc: "Contains the value observed by the observation producer. Data type matches OBX-2. For text reports use FT (Formatted Text) or TX (Text Data)." },
      { seq: 6, name: "Units", type: "CE", len: 250, opt: "O", rpt: 1, desc: "Description of the units of measure for the result." },
      { seq: 7, name: "References Range", type: "ST", len: 60, opt: "O", rpt: 1, desc: "Normal range for the value. Format: low-high, or >value, or <value." },
      { seq: 8, name: "Abnormal Flags", type: "IS", len: 5, opt: "O", rpt: "∞", desc: "Table 0078. L=Below low normal, H=Above high normal, LL=Below lower panic limits, HH=Above upper panic limits, <=(Less than), >=(Greater than), A=Abnormal, AA=Very abnormal, N=Normal, U=Significant change up, D=Significant change down, B=Better, W=Worse, S=Susceptible, R=Resistant, I=Intermediate, MS=Moderately susceptible, VS=Very susceptible." },
      { seq: 11, name: "Observation Result Status", type: "ID", len: 1, opt: "R", rpt: 1, desc: "Table 0085. C=Record coming over is a correction and thus replaces a final result, D=Deletes the OBX record, F=Final results, I=Specimen in lab; results pending, N=Not asked; used only on queries where only certain results are requested, O=Order detail description only (no result), P=Preliminary results, R=Results entered, not verified, S=Partial results, U=Results status change to Final — results did not change, W=Post original as wrong, X=Results cannot be obtained for this observation." },
      { seq: 14, name: "Date/Time of the Observation", type: "TS", len: 26, opt: "O", rpt: 1, desc: "Date and time the observation was performed." },
      { seq: 15, name: "Producer's ID", type: "CE", len: 250, opt: "O", rpt: 1, desc: "Identifies the person who created this observation." },
      { seq: 16, name: "Responsible Observer", type: "XCN", len: 250, opt: "O", rpt: "∞", desc: "Person responsible for verifying the observation." },
      { seq: 17, name: "Observation Method", type: "CE", len: 250, opt: "O", rpt: "∞", desc: "Method used for the observation." },
      { seq: 18, name: "Equipment Instance Identifier", type: "EI", len: 22, opt: "O", rpt: "∞", desc: "Identifies the device that produced the measurement." },
      { seq: 19, name: "Date/Time of the Analysis", type: "TS", len: 26, opt: "O", rpt: 1, desc: "Date and time the observation was analyzed." },
    ],
  },
  NTE: {
    name: "Notes and Comments",
    description: "Used to send notes and comments associated with the adjacent segment. Can appear after multiple segment types.",
    fields: [
      { seq: 1, name: "Set ID - NTE", type: "SI", len: 4, opt: "O", rpt: 1, desc: "Sequence number for multiple NTE segments." },
      { seq: 2, name: "Source of Comment", type: "ID", len: 8, opt: "O", rpt: 1, desc: "Table 0105. L=Ancillary (filler) department, P=Orderer (placer) department, O=Other system." },
      { seq: 3, name: "Comment", type: "FT", len: 65536, opt: "O", rpt: "∞", desc: "Free text comments. FT type allows embedded formatting (\\H\\ for highlight, \\N\\ for normal, \\.br\\ for line break)." },
      { seq: 4, name: "Comment Type", type: "CE", len: 250, opt: "O", rpt: 1, desc: "Table 0364. AI=Ancillary Instructions, AR=Ancillary Results, DR=Duplicate/Interaction Reason, GI=General Instructions, GR=General Results, PI=Patient Instructions, RE=Remark. Data type is CE in v2.5.1." },
    ],
  },
  MRG: {
    name: "Merge Patient Information",
    description:
      "Used in patient merging (ADT^A40). Contains prior patient identifier(s). The MRN in MRG-1 is the 'losing' or prior ID — all records under it should be merged into the patient identified in PID.",
    fields: [
      { seq: 1, name: "Prior Patient Identifier List", type: "CX", len: 250, opt: "R", rpt: "∞", desc: "Prior patient identifier list. Used during patient merges." },
      { seq: 2, name: "Prior Alternate Patient ID", type: "CX", len: 20, opt: "B", rpt: "∞", desc: "DEPRECATED." },
      { seq: 3, name: "Prior Patient Account Number", type: "CX", len: 250, opt: "O", rpt: 1, desc: "Prior patient account number." },
      { seq: 4, name: "Prior Patient ID", type: "CX", len: 20, opt: "B", rpt: 1, desc: "DEPRECATED." },
      { seq: 5, name: "Prior Visit Number", type: "CX", len: 250, opt: "O", rpt: 1, desc: "Prior visit number." },
      { seq: 6, name: "Prior Alternate Visit ID", type: "CX", len: 250, opt: "O", rpt: 1, desc: "Prior alternate visit number." },
      { seq: 7, name: "Prior Patient Name", type: "XPN", len: 250, opt: "O", rpt: "∞", desc: "Prior patient name." },
    ],
  },
  AL1: {
    name: "Patient Allergy Information",
    description: "Transmits information about patient allergy or adverse reaction information.",
    fields: [
      { seq: 1, name: "Set ID - AL1", type: "SI", len: 4, opt: "R", rpt: 1, desc: "Sequence number." },
      { seq: 2, name: "Allergen Type Code", type: "CE", len: 250, opt: "O", rpt: 1, desc: "Table 0127. DA=Drug Allergy, EA=Environmental Allergy, FA=Food Allergy, LA=Pollen Allergy, MA=Miscellaneous Allergy, MC=Miscellaneous Contraindication, PA=Plant Allergy. Data type is CE in v2.5.1." },
      { seq: 3, name: "Allergen Code/Mnemonic/Description", type: "CE", len: 250, opt: "R", rpt: 1, desc: "Uniquely identifies the allergy (allergen). Code and description of the allergy. Data type is CE in v2.5.1." },
      { seq: 4, name: "Allergy Severity Code", type: "CE", len: 250, opt: "O", rpt: 1, desc: "Table 0128. MI=Mild, MO=Moderate, SV=Severe, U=Unknown. Data type is CE in v2.5.1." },
      { seq: 5, name: "Allergy Reaction Code", type: "ST", len: 15, opt: "O", rpt: "∞", desc: "Free text string for the allergic reaction experienced." },
      { seq: 6, name: "Identification Date", type: "DT", len: 8, opt: "B", rpt: 1, desc: "DEPRECATED. Date the allergy was identified." },
    ],
  },
  DG1: {
    name: "Diagnosis",
    description: "Contains patient diagnosis information of various types.",
    fields: [
      { seq: 1, name: "Set ID - DG1", type: "SI", len: 4, opt: "R", rpt: 1, desc: "Sequence number." },
      { seq: 2, name: "Diagnosis Coding Method", type: "ID", len: 2, opt: "B", rpt: 1, desc: "DEPRECATED." },
      { seq: 3, name: "Diagnosis Code - DG1", type: "CE", len: 250, opt: "O", rpt: 1, desc: "Identifies the diagnosis. Use ICD-9-CM, ICD-10-CM, or SNOMED codes. Data type is CE in v2.5.1." },
      { seq: 4, name: "Diagnosis Description", type: "ST", len: 40, opt: "B", rpt: 1, desc: "DEPRECATED. Free text description of the diagnosis." },
      { seq: 5, name: "Diagnosis Date/Time", type: "TS", len: 26, opt: "O", rpt: 1, desc: "Date and time when the diagnosis was made." },
      { seq: 6, name: "Diagnosis Type", type: "IS", len: 2, opt: "R", rpt: 1, desc: "Table 0052. A=Admitting, W=Working, F=Final." },
      { seq: 15, name: "Diagnosis Priority", type: "ID", len: 2, opt: "O", rpt: 1, desc: "Table 0359. 0=Not included in diagnosis ranking, 1=Principal diagnosis, 2-∞=For ranked secondary diagnoses." },
      { seq: 16, name: "Diagnosing Clinician", type: "XCN", len: 250, opt: "O", rpt: "∞", desc: "Provider who made the diagnosis." },
      { seq: 17, name: "Diagnosis Classification", type: "IS", len: 3, opt: "O", rpt: 1, desc: "Table 0228. C=Consultation, D=Diagnosis, M=Medication (antibiotic), N=Nursing Diagnosis, O=Order, P=Procedure, R=Radiology, S=Sign and Symptom, T=Test, I=Invasive procedure not classified elsewhere." },
      { seq: 19, name: "Attestation Date/Time", type: "TS", len: 26, opt: "O", rpt: 1, desc: "Date the diagnosis was attested." },
    ],
  },
  ZDS: {
    name: "Study Instance UID (IHE Extension)",
    description:
      "Non-standard Z-segment defined by IHE (Integrating the Healthcare Enterprise) in the Scheduled Workflow (SWF) profile. Carries the DICOM Study Instance UID in an HL7 ORM message, enabling the RIS to assign the UID before acquisition and communicate it to the PACS. Defined in IHE RAD TF Vol 2, transaction RAD-4.",
    fields: [
      { seq: 1, name: "Study Instance UID", type: "RP", len: 200, opt: "R", rpt: 1, desc: "DICOM Study Instance UID (0020,000D). RP (Reference Pointer) data type with components Pointer^Application ID^Type of Data^Subtype. The UID goes in the first component; IHE examples populate the remainder as ^100^Application^DICOM. Example: 1.2.840.113619.2.1.1.322987881.621.736170080.681^100^Application^DICOM. The UID itself is limited to 64 characters by DICOM PS3.5 and must consist only of digits and dots." },
    ],
    note: "IHE RAD TF-2 defines exactly ONE field for ZDS. Segments in the wild that carry an accession number, procedure code or modality in ZDS-2 onward are site-local extensions, not part of the IHE definition.",
  },
  IN1: {
    name: "Insurance",
    description: "Contains insurance policy coverage information necessary to produce properly pro-rated and patient and insurance bills.",
    fields: [
      { seq: 1, name: "Set ID - IN1", type: "SI", len: 4, opt: "R", rpt: 1, desc: "Sequence number." },
      { seq: 2, name: "Insurance Plan ID", type: "CE", len: 250, opt: "R", rpt: 1, desc: "Uniquely identifies the insurance plan. Data type is CE in v2.5.1." },
      { seq: 3, name: "Insurance Company ID", type: "CX", len: 250, opt: "R", rpt: "∞", desc: "Uniquely identifies the insurance company." },
      { seq: 4, name: "Insurance Company Name", type: "XON", len: 250, opt: "O", rpt: "∞", desc: "Name of the insurance company." },
      { seq: 5, name: "Insurance Company Address", type: "XAD", len: 250, opt: "O", rpt: "∞", desc: "Address of the insurance company." },
      { seq: 15, name: "Plan Type", type: "IS", len: 3, opt: "O", rpt: 1, desc: "Table 0086. Type of insurance plan." },
      { seq: 16, name: "Name Of Insured", type: "XPN", len: 250, opt: "O", rpt: "∞", desc: "Name of the insured person." },
      { seq: 17, name: "Insured's Relationship To Patient", type: "CE", len: 250, opt: "O", rpt: 1, desc: "Table 0063. SEL=Self, SPO=Spouse, CHD=Child, OTH=Other, UNK=Unknown, MTH=Mother, FTH=Father, BRO=Brother, SIS=Sister, GRP=Grandparent. Data type is CE in v2.5.1." },
      { seq: 35, name: "Company Plan Code", type: "IS", len: 8, opt: "O", rpt: 1, desc: "Table 0042. Identifies the specific medical benefit plan offered by the insurance company." },
    ],
  },
  SCH: {
    name: "Scheduling Activity Information",
    description: "Contains information about the scheduled appointment in SIU and SRM messages.",
    fields: [
      { seq: 1, name: "Placer Appointment ID", type: "EI", len: 75, opt: "C", rpt: 1, desc: "Identifier assigned to the appointment by the placer application." },
      { seq: 2, name: "Filler Appointment ID", type: "EI", len: 75, opt: "C", rpt: 1, desc: "Identifier assigned to the appointment by the filler application." },
      { seq: 5, name: "Schedule ID", type: "CE", len: 250, opt: "O", rpt: 1, desc: "Identifier of the schedule this appointment is booked against." },
      { seq: 6, name: "Event Reason", type: "CE", len: 250, opt: "R", rpt: 1, desc: "Reason this event occurred (why the appointment was booked, modified or cancelled). Data type is CE in v2.5.1." },
      { seq: 7, name: "Appointment Reason", type: "CE", len: 250, opt: "O", rpt: 1, desc: "Table 0276. Reason the appointment is to take place. ROUTINE, WALKIN, CHECKUP, EMERGENCY, FOLLOWUP." },
      { seq: 8, name: "Appointment Type", type: "CE", len: 250, opt: "O", rpt: 1, desc: "Table 0277. Type of appointment: Normal, Tentative, Complete." },
      { seq: 9, name: "Appointment Duration", type: "NM", len: 20, opt: "O", rpt: 1, desc: "Duration of the appointment. Units given in SCH-10. Note: this is SCH-9, not SCH-11." },
      { seq: 10, name: "Appointment Duration Units", type: "CE", len: 250, opt: "O", rpt: 1, desc: "Units of measure for SCH-9 Appointment Duration (e.g., min, hr)." },
      { seq: 11, name: "Appointment Timing Quantity", type: "TQ", len: 200, opt: "R", rpt: "∞", desc: "Start date/time and repeating interval of the appointment. TQ data type; retained in v2.5.1 for the SCH segment even though TQ is deprecated elsewhere in favour of TQ1/TQ2." },
      { seq: 25, name: "Filler Status Code", type: "CE", len: 250, opt: "O", rpt: 1, desc: "Table 0278. Status of the appointment in the filler system: Pending, Waitlist, Booked, Started, Complete, Cancelled, Discontinued, Overbook, Noshow, Blocked, Deleted. Data type is CE in v2.5.1." },
    ],
  },
  ERR: {
    name: "Error",
    description: "Contains information about errors detected in the processing of HL7 messages. Replaces MSA-3 for error details.",
    fields: [
      { seq: 1, name: "Error Code and Location", type: "ELD", len: 493, opt: "B", rpt: "∞", desc: "DEPRECATED. Error code and location." },
      { seq: 2, name: "Error Location", type: "ERL", len: 18, opt: "O", rpt: "∞", desc: "Identifies the location in a message related to the identified error." },
      { seq: 3, name: "HL7 Error Code", type: "CWE", len: 705, opt: "R", rpt: 1, desc: "Table 0357. 0=Message accepted, 100=Segment sequence error, 101=Required field missing, 102=Data type error, 103=Table value not found, 200=Unsupported message type, 201=Unsupported event code, 202=Unsupported processing ID, 203=Unsupported version ID, 204=Unknown key identifier, 205=Duplicate key identifier, 206=Application record locked, 207=Application internal error." },
      { seq: 4, name: "Severity", type: "ID", len: 2, opt: "R", rpt: 1, desc: "Table 0516. I=Informational, W=Warning, E=Error." },
      { seq: 5, name: "Application Error Code", type: "CWE", len: 705, opt: "O", rpt: 1, desc: "Application-specific error code." },
      { seq: 6, name: "Application Error Parameter", type: "ST", len: 80, opt: "O", rpt: 10, desc: "Additional information to be used, together with the Application Error Code, to understand a particular error condition." },
      { seq: 7, name: "Diagnostic Information", type: "TX", len: 2048, opt: "O", rpt: 1, desc: "Information that may be used by help desk or system support personnel to diagnose a problem." },
      { seq: 8, name: "User Message", type: "TX", len: 250, opt: "O", rpt: 1, desc: "The text message to be displayed to the user of the application where the error occurred." },
    ],
  },
};

const MESSAGE_STRUCTURES = {
  "ADT^A01": {
    description: "Admit/Visit Notification — patient is admitted to the facility",
    segments: [
      { seg: "MSH", req: "R", rpt: 1 },
      { seg: "EVN", req: "R", rpt: 1 },
      { seg: "PID", req: "R", rpt: 1 },
      { seg: "PD1", req: "O", rpt: 1 },
      { seg: "NK1", req: "O", rpt: "∞" },
      { seg: "PV1", req: "R", rpt: 1 },
      { seg: "PV2", req: "O", rpt: 1 },
      { seg: "DB1", req: "O", rpt: "∞" },
      { seg: "OBX", req: "O", rpt: "∞" },
      { seg: "AL1", req: "O", rpt: "∞" },
      { seg: "DG1", req: "O", rpt: "∞" },
      { seg: "DRG", req: "O", rpt: 1 },
      { seg: "PR1", req: "O", rpt: "∞" },
      { seg: "GT1", req: "O", rpt: "∞" },
      { seg: "IN1", req: "O", rpt: "∞" },
    ],
    notes: "Used for inpatient admissions and emergency visit starts. Triggers the creation of a patient account in downstream systems.",
  },
  "ADT^A02": {
    description: "Transfer a Patient — patient transferred to a different location within the facility",
    segments: [
      { seg: "MSH", req: "R", rpt: 1 },
      { seg: "EVN", req: "R", rpt: 1 },
      { seg: "PID", req: "R", rpt: 1 },
      { seg: "PD1", req: "O", rpt: 1 },
      { seg: "PV1", req: "R", rpt: 1 },
      { seg: "PV2", req: "O", rpt: 1 },
      { seg: "DB1", req: "O", rpt: "∞" },
      { seg: "OBX", req: "O", rpt: "∞" },
    ],
    notes: "PV1-3 contains new location; PV1-6 contains prior location.",
  },
  "ADT^A03": {
    description: "Discharge/End Visit — patient is discharged from the facility",
    segments: [
      { seg: "MSH", req: "R", rpt: 1 },
      { seg: "EVN", req: "R", rpt: 1 },
      { seg: "PID", req: "R", rpt: 1 },
      { seg: "PD1", req: "O", rpt: 1 },
      { seg: "PV1", req: "R", rpt: 1 },
      { seg: "PV2", req: "O", rpt: 1 },
      { seg: "DB1", req: "O", rpt: "∞" },
      { seg: "DG1", req: "O", rpt: "∞" },
      { seg: "DRG", req: "O", rpt: 1 },
      { seg: "PR1", req: "O", rpt: "∞" },
      { seg: "OBX", req: "O", rpt: "∞" },
    ],
    notes: "PV1-45 contains the discharge date/time. PV1-36 contains the discharge disposition code.",
  },
  "ADT^A04": {
    description: "Register a Patient — patient registered as outpatient",
    segments: [
      { seg: "MSH", req: "R", rpt: 1 },
      { seg: "EVN", req: "R", rpt: 1 },
      { seg: "PID", req: "R", rpt: 1 },
      { seg: "PD1", req: "O", rpt: 1 },
      { seg: "NK1", req: "O", rpt: "∞" },
      { seg: "PV1", req: "R", rpt: 1 },
      { seg: "PV2", req: "O", rpt: 1 },
      { seg: "DB1", req: "O", rpt: "∞" },
      { seg: "OBX", req: "O", rpt: "∞" },
      { seg: "AL1", req: "O", rpt: "∞" },
      { seg: "DG1", req: "O", rpt: "∞" },
      { seg: "IN1", req: "O", rpt: "∞" },
    ],
    notes: "Same structure as A01 but for outpatient registration. PV1-2 should be O (Outpatient).",
  },
  "ADT^A05": {
    description: "Pre-Admit a Patient — patient pre-admitted, no actual physical arrival yet",
    segments: [
      { seg: "MSH", req: "R", rpt: 1 },
      { seg: "EVN", req: "R", rpt: 1 },
      { seg: "PID", req: "R", rpt: 1 },
      { seg: "PD1", req: "O", rpt: 1 },
      { seg: "NK1", req: "O", rpt: "∞" },
      { seg: "PV1", req: "R", rpt: 1 },
      { seg: "PV2", req: "O", rpt: 1 },
      { seg: "DB1", req: "O", rpt: "∞" },
      { seg: "OBX", req: "O", rpt: "∞" },
      { seg: "AL1", req: "O", rpt: "∞" },
      { seg: "DG1", req: "O", rpt: "∞" },
      { seg: "IN1", req: "O", rpt: "∞" },
    ],
    notes: "PV1-2 should be P (Preadmit). Triggers worklist preparation.",
  },
  "ADT^A08": {
    description: "Update Patient Information — demographics or other patient info changed",
    messageStructure: "ADT_A01",
    notes2: "A08 shares the ADT_A01 structure. It is a VISIT-level update: PV1 is required by the abstract syntax. Use A08 to correct demographics on an existing encounter; use A31 for person-level changes with no encounter context.",
    segments: [
      { seg: "MSH", req: "R", rpt: 1 },
      { seg: "EVN", req: "R", rpt: 1 },
      { seg: "PID", req: "R", rpt: 1 },
      { seg: "PD1", req: "O", rpt: 1 },
      { seg: "NK1", req: "O", rpt: "∞" },
      { seg: "PV1", req: "R", rpt: 1 },
      { seg: "PV2", req: "O", rpt: 1 },
      { seg: "DB1", req: "O", rpt: "∞" },
      { seg: "OBX", req: "O", rpt: "∞" },
      { seg: "AL1", req: "O", rpt: "∞" },
      { seg: "DG1", req: "O", rpt: "∞" },
      { seg: "IN1", req: "O", rpt: "∞" },
    ],
    notes: "Downstream systems (PACS) must update existing patient records. Critical for name corrections.",
  },
  "ADT^A11": {
    description: "Cancel Admit/Visit Notification — cancels a previously sent A01",
    segments: [
      { seg: "MSH", req: "R", rpt: 1 },
      { seg: "EVN", req: "R", rpt: 1 },
      { seg: "PID", req: "R", rpt: 1 },
      { seg: "PD1", req: "O", rpt: 1 },
      { seg: "PV1", req: "R", rpt: 1 },
      { seg: "PV2", req: "O", rpt: 1 },
      { seg: "DB1", req: "O", rpt: "∞" },
      { seg: "OBX", req: "O", rpt: "∞" },
    ],
    notes: "Cancels the admission. EVN-5 contains the original event date/time.",
  },
  "ADT^A13": {
    description: "Cancel Discharge/End Visit — cancels a previously sent A03",
    segments: [
      { seg: "MSH", req: "R", rpt: 1 },
      { seg: "EVN", req: "R", rpt: 1 },
      { seg: "PID", req: "R", rpt: 1 },
      { seg: "PD1", req: "O", rpt: 1 },
      { seg: "PV1", req: "R", rpt: 1 },
      { seg: "PV2", req: "O", rpt: 1 },
      { seg: "DB1", req: "O", rpt: "∞" },
      { seg: "DG1", req: "O", rpt: "∞" },
      { seg: "OBX", req: "O", rpt: "∞" },
    ],
    notes: "Reinstates the visit cancelled by A03.",
  },
  "ADT^A28": {
    description: "Add Person Information — adds a new person to the MPI without an associated visit",
    segments: [
      { seg: "MSH", req: "R", rpt: 1 },
      { seg: "EVN", req: "R", rpt: 1 },
      { seg: "PID", req: "R", rpt: 1 },
      { seg: "PD1", req: "O", rpt: 1 },
      { seg: "NK1", req: "O", rpt: "∞" },
      { seg: "PV1", req: "R", rpt: 1 },
      { seg: "IN1", req: "O", rpt: "∞" },
    ],
    notes: "Person-level event — no encounter. Often used to pre-populate the MPI.",
  },
  "ADT^A31": {
    description: "Update Person Information — updates person-level data without a visit",
    messageStructure: "ADT_A05",
    segments: [
      { seg: "MSH", req: "R", rpt: 1 },
      { seg: "SFT", req: "O", rpt: "∞" },
      { seg: "EVN", req: "R", rpt: 1 },
      { seg: "PID", req: "R", rpt: 1 },
      { seg: "PD1", req: "O", rpt: 1 },
      { seg: "ROL", req: "O", rpt: "∞" },
      { seg: "NK1", req: "O", rpt: "∞" },
      { seg: "PV1", req: "R", rpt: 1, note: "Required by the ADT_A05 abstract syntax even though A31 is person-level; usually sent minimally populated" },
      { seg: "PV2", req: "O", rpt: 1 },
      { seg: "DB1", req: "O", rpt: "∞" },
      { seg: "OBX", req: "O", rpt: "∞" },
      { seg: "AL1", req: "O", rpt: "∞" },
      { seg: "DG1", req: "O", rpt: "∞" },
      { seg: "IN1", req: "O", rpt: "∞" },
    ],
    notes: "A31 shares the ADT_A05 structure. PERSON-level update — it changes the master person record, not an encounter. PV1 is structurally required but carries no meaningful visit; populating PV1-19 Visit Number on an A31 is a common source of confusion downstream. Use A08 when the change is scoped to a visit.",
  },
  "ADT^A40": {
    description: "Merge Patient — Patient Identifier List — merges two patient identities into one",
    messageStructure: "ADT_A39",
    segments: [
      { seg: "MSH", req: "R", rpt: 1 },
      { seg: "SFT", req: "O", rpt: "∞" },
      { seg: "EVN", req: "R", rpt: 1 },
      { seg: "PID", req: "R", rpt: 1, group: "PATIENT (repeating)" },
      { seg: "PD1", req: "O", rpt: 1, group: "PATIENT (repeating)" },
      { seg: "MRG", req: "R", rpt: 1, group: "PATIENT (repeating)" },
      { seg: "PV1", req: "O", rpt: 1, group: "PATIENT (repeating)" },
    ],
    notes:
      "A40 uses the ADT_A39 structure: MSH [SFT] EVN { PID [PD1] MRG [PV1] }. The PATIENT group REPEATS, so one A40 can carry several merges — each PID must be paired with its own MRG. PID-3 holds the surviving (winning) identifier; MRG-1 holds the prior (losing) identifier being retired. PACS must re-key all studies from MRG-1 onto PID-3. The assigning authority (component 4) of PID-3 and MRG-1 should match; a merge across two different authorities is almost always a build error.",
  },
  "ORM^O01": {
    description: "Order Message — transmits orders from an order-placing application to an order-filling application",
    messageStructure: "ORM_O01",
    abstractSyntax:
      "MSH [{NTE}] [ PID [PD1] [{NTE}] [PV1 [PV2]] [{IN1 [IN2] [IN3]}] [GT1] [{AL1}] ] { ORC [ OBR | RQD | RQ1 | RXO | ODS | ODT ] [{NTE}] [CTD] [{DG1}] [{ OBX [{NTE}] }] [{FT1}] [{CTI}] [BLG] }",
    segments: [
      { seg: "MSH", req: "R", rpt: 1 },
      { seg: "NTE", req: "O", rpt: "∞" },
      { seg: "PID", req: "O", rpt: 1, group: "PATIENT (optional as a whole)" },
      { seg: "PD1", req: "O", rpt: 1, group: "PATIENT" },
      { seg: "NTE", req: "O", rpt: "∞", group: "PATIENT" },
      { seg: "PV1", req: "O", rpt: 1, group: "PATIENT_VISIT" },
      { seg: "PV2", req: "O", rpt: 1, group: "PATIENT_VISIT" },
      { seg: "IN1", req: "O", rpt: "∞", group: "INSURANCE" },
      { seg: "GT1", req: "O", rpt: 1, group: "PATIENT" },
      { seg: "AL1", req: "O", rpt: "∞", group: "PATIENT" },
      { seg: "ORC", req: "R", rpt: 1, group: "ORDER (repeating)" },
      { seg: "OBR", req: "C", rpt: 1, group: "ORDER_DETAIL — choice of OBR | RQD | RQ1 | RXO | ODS | ODT" },
      { seg: "NTE", req: "O", rpt: "∞", group: "ORDER_DETAIL" },
      { seg: "CTD", req: "O", rpt: 1, group: "ORDER_DETAIL" },
      { seg: "DG1", req: "O", rpt: "∞", group: "ORDER_DETAIL" },
      { seg: "OBX", req: "O", rpt: "∞", group: "OBSERVATION" },
      { seg: "ZDS", req: "O", rpt: 1, group: "ORDER — IHE RAD extension, not part of base HL7 v2.5.1", note: "Carries the DICOM Study Instance UID (IHE RAD-4)" },
      { seg: "BLG", req: "O", rpt: 1, group: "ORDER" },
    ],
    notes:
      "The ORDER group REPEATS — one ORM can carry many orders, each with its own ORC and order-detail segment. PID is optional in the abstract syntax (the whole PATIENT group is optional) but required by every practical radiology interface. ORC-1 Order Control drives the semantics: NW=New, CA=Cancel, DC=Discontinue, HD=Hold, RL=Release, RP=Replace, SC=Status Change, XO=Change. IHE RAD Scheduled Workflow adds the non-standard ZDS segment to carry the Study Instance UID at RAD-4 Procedure Scheduled.",
  },
  "ORR^O02": {
    description: "Order Response — general response to ORM^O01",
    segments: [
      { seg: "MSH", req: "R", rpt: 1 },
      { seg: "MSA", req: "R", rpt: 1 },
      { seg: "ERR", req: "O", rpt: "∞" },
      { seg: "NTE", req: "O", rpt: "∞" },
      { seg: "PID", req: "O", rpt: 1 },
      { seg: "NTE", req: "O", rpt: "∞" },
      { seg: "ORC", req: "R", rpt: 1 },
      { seg: "OBR", req: "O", rpt: 1 },
      { seg: "NTE", req: "O", rpt: "∞" },
    ],
    notes: "MSA-1 values: AA=Application Accept (order processed), AE=Application Error, AR=Application Reject.",
  },
  "ORU^R01": {
    description: "Unsolicited Observation Result — transmits observations and results",
    messageStructure: "ORU_R01",
    abstractSyntax:
      "MSH [SFT] { [ PID [PD1] [{NTE}] [{NK1}] [{ PV1 [PV2] }] ] { [ORC] OBR [{NTE}] [{TQ1 [{TQ2}]}] [{ OBX [{NTE}] }] [{FT1}] [{CTI}] } } [DSC]",
    segments: [
      { seg: "MSH", req: "R", rpt: 1 },
      { seg: "SFT", req: "O", rpt: "∞" },
      { seg: "PID", req: "O", rpt: 1, group: "PATIENT (optional, inside repeating PATIENT_RESULT)" },
      { seg: "PD1", req: "O", rpt: 1, group: "PATIENT" },
      { seg: "NTE", req: "O", rpt: "∞", group: "PATIENT" },
      { seg: "NK1", req: "O", rpt: "∞", group: "PATIENT" },
      { seg: "PV1", req: "O", rpt: 1, group: "PATIENT/VISIT" },
      { seg: "PV2", req: "O", rpt: 1, group: "PATIENT/VISIT" },
      { seg: "ORC", req: "O", rpt: 1, group: "ORDER_OBSERVATION (repeating)" },
      { seg: "OBR", req: "R", rpt: 1, group: "ORDER_OBSERVATION (repeating)" },
      { seg: "NTE", req: "O", rpt: "∞", group: "ORDER_OBSERVATION" },
      { seg: "OBX", req: "O", rpt: "∞", group: "OBSERVATION (repeating)" },
      { seg: "NTE", req: "O", rpt: "∞", group: "OBSERVATION" },
      { seg: "DSC", req: "O", rpt: 1 },
    ],
    notes:
      "Two commonly-misstated points: PID is OPTIONAL in the abstract syntax (the PATIENT group is optional inside PATIENT_RESULT) and ORC is OPTIONAL inside ORDER_OBSERVATION — although virtually every real-world radiology and lab interface requires both. Both PATIENT_RESULT and ORDER_OBSERVATION repeat, so one ORU can carry several orders and several patients. OBR-25 Result Status uses table 0123 (P=Preliminary, F=Final, C=Correction); OBX-11 uses the DIFFERENT table 0085. In radiology, ORU^R01 carries the dictated/signed report keyed on the accession number issued at scheduling.",
  },
  "ACK": {
    description: "General Acknowledgment — response to any received message requiring acknowledgment",
    segments: [
      { seg: "MSH", req: "R", rpt: 1 },
      { seg: "MSA", req: "R", rpt: 1 },
      { seg: "ERR", req: "O", rpt: "∞" },
    ],
    notes: "MSA-1: AA=Accept, AE=Error, AR=Reject. MSA-2 echoes the MSH-10 of the original message. ERR-3 provides detailed error codes.",
  },
  "SIU^S12": {
    description: "Notification of New Appointment Booking — new appointment has been booked",
    segments: [
      { seg: "MSH", req: "R", rpt: 1 },
      { seg: "SCH", req: "R", rpt: 1 },
      { seg: "TQ1", req: "O", rpt: "∞" },
      { seg: "NTE", req: "O", rpt: "∞" },
      { seg: "PID", req: "R", rpt: 1 },
      { seg: "PD1", req: "O", rpt: 1 },
      { seg: "PV1", req: "O", rpt: 1 },
      { seg: "PV2", req: "O", rpt: 1 },
      { seg: "OBX", req: "O", rpt: "∞" },
      { seg: "DG1", req: "O", rpt: "∞" },
      { seg: "RGS", req: "R", rpt: 1 },
      { seg: "AIS", req: "R", rpt: "∞" },
      { seg: "NTE", req: "O", rpt: "∞" },
      { seg: "AIL", req: "O", rpt: "∞" },
      { seg: "AIP", req: "O", rpt: "∞" },
    ],
    notes: "Used for scheduling workflow. S12=New, S13=Rescheduled, S14=Modified, S15=Cancelled, S17=Deletion of Appointment.",
  },
};

const CODE_TABLES = {
  "0001": {
    name: "Administrative Sex",
    values: [
      { code: "A", desc: "Ambiguous" },
      { code: "F", desc: "Female" },
      { code: "M", desc: "Male" },
      { code: "N", desc: "Not applicable" },
      { code: "O", desc: "Other" },
      { code: "U", desc: "Unknown" },
    ],
  },
  "0003": {
    name: "Event Type",
    values: [
      { code: "A01", desc: "ADT/ACK - Admit/visit notification" },
      { code: "A02", desc: "ADT/ACK - Transfer a patient" },
      { code: "A03", desc: "ADT/ACK - Discharge/end visit" },
      { code: "A04", desc: "ADT/ACK - Register a patient" },
      { code: "A05", desc: "ADT/ACK - Pre-admit a patient" },
      { code: "A06", desc: "ADT/ACK - Change an outpatient to an inpatient" },
      { code: "A07", desc: "ADT/ACK - Change an inpatient to an outpatient" },
      { code: "A08", desc: "ADT/ACK - Update patient information" },
      { code: "A09", desc: "ADT/ACK - Patient departing - tracking" },
      { code: "A10", desc: "ADT/ACK - Patient arriving - tracking" },
      { code: "A11", desc: "ADT/ACK - Cancel admit/visit notification" },
      { code: "A12", desc: "ADT/ACK - Cancel transfer" },
      { code: "A13", desc: "ADT/ACK - Cancel discharge/end visit" },
      { code: "A14", desc: "ADT/ACK - Pending admit" },
      { code: "A15", desc: "ADT/ACK - Pending transfer" },
      { code: "A16", desc: "ADT/ACK - Pending discharge" },
      { code: "A17", desc: "ADT/ACK - Swap patients" },
      { code: "A18", desc: "ADT/ACK - Merge patient information" },
      { code: "A19", desc: "QRY/ADR - Patient query" },
      { code: "A20", desc: "ADT/ACK - Bed status update" },
      { code: "A21", desc: "ADT/ACK - Patient goes on a leave of absence" },
      { code: "A22", desc: "ADT/ACK - Patient returns from a leave of absence" },
      { code: "A23", desc: "ADT/ACK - Delete a patient record" },
      { code: "A24", desc: "ADT/ACK - Link patient information" },
      { code: "A25", desc: "ADT/ACK - Cancel pending discharge" },
      { code: "A26", desc: "ADT/ACK - Cancel pending transfer" },
      { code: "A27", desc: "ADT/ACK - Cancel pending admit" },
      { code: "A28", desc: "ADT/ACK - Add person or patient information" },
      { code: "A29", desc: "ADT/ACK - Delete person information" },
      { code: "A30", desc: "ADT/ACK - Merge person information" },
      { code: "A31", desc: "ADT/ACK - Update person information" },
      { code: "A32", desc: "ADT/ACK - Cancel patient arriving - tracking" },
      { code: "A33", desc: "ADT/ACK - Cancel patient departing - tracking" },
      { code: "A34", desc: "ADT/ACK - Merge patient information - patient ID only" },
      { code: "A35", desc: "ADT/ACK - Merge patient information - account number only" },
      { code: "A36", desc: "ADT/ACK - Merge patient information - patient ID and account number" },
      { code: "A37", desc: "ADT/ACK - Unlink patient information" },
      { code: "A38", desc: "ADT/ACK - Cancel pre-admit" },
      { code: "A39", desc: "ADT/ACK - Merge person - patient ID" },
      { code: "A40", desc: "ADT/ACK - Merge patient - patient identifier list" },
      { code: "A41", desc: "ADT/ACK - Merge account - patient account number" },
      { code: "A42", desc: "ADT/ACK - Merge visit - visit number" },
      { code: "A43", desc: "ADT/ACK - Move patient information - patient identifier list" },
      { code: "A44", desc: "ADT/ACK - Move account information - patient account number" },
      { code: "A45", desc: "ADT/ACK - Move visit information - visit number" },
      { code: "O01", desc: "ORM - Order message (also ORM^O01)" },
      { code: "O02", desc: "ORR - Order acknowledgment" },
      { code: "R01", desc: "ORU - Unsolicited transmission of an observation message" },
      { code: "R02", desc: "QRY - Query for results of observation" },
      { code: "T02", desc: "MDM - Original document notification and content" },
      { code: "T11", desc: "MDM - Document cancel notification" },
    ],
  },
  "0004": {
    name: "Patient Class",
    values: [
      { code: "B", desc: "Obstetrics" },
      { code: "C", desc: "Commercial Account" },
      { code: "E", desc: "Emergency" },
      { code: "I", desc: "Inpatient" },
      { code: "N", desc: "Not Applicable" },
      { code: "O", desc: "Outpatient" },
      { code: "P", desc: "Preadmit" },
      { code: "R", desc: "Recurring Patient" },
      { code: "U", desc: "Unknown" },
    ],
  },
  "0007": {
    name: "Admission Type",
    values: [
      { code: "A", desc: "Accident" },
      { code: "C", desc: "Elective" },
      { code: "E", desc: "Emergency" },
      { code: "L", desc: "Labor and Delivery" },
      { code: "N", desc: "Newborn (birth in healthcare facility)" },
      { code: "R", desc: "Routine" },
      { code: "U", desc: "Urgent" },
    ],
  },
  "0008": {
    name: "Acknowledgment Code",
    values: [
      { code: "AA", desc: "Original mode: Application Accept - Enhanced mode: Application acknowledgment: Accept" },
      { code: "AE", desc: "Original mode: Application Error - Enhanced mode: Application acknowledgment: Error" },
      { code: "AR", desc: "Original mode: Application Reject - Enhanced mode: Application acknowledgment: Reject" },
      { code: "CA", desc: "Enhanced mode: Accept acknowledgment: Commit Accept" },
      { code: "CE", desc: "Enhanced mode: Accept acknowledgment: Commit Error" },
      { code: "CR", desc: "Enhanced mode: Accept acknowledgment: Commit Reject" },
    ],
  },
  "0074": {
    name: "Diagnostic Service Section ID",
    values: [
      { code: "AU", desc: "Audiology" },
      { code: "BG", desc: "Blood Gases" },
      { code: "BLB", desc: "Blood Bank" },
      { code: "CH", desc: "Chemistry" },
      { code: "CP", desc: "Cytopathology" },
      { code: "CT", desc: "CAT Scan" },
      { code: "CTH", desc: "Cardiac Catheterization" },
      { code: "CUS", desc: "Cardiac Ultrasound" },
      { code: "EC", desc: "Electrocardiac (EKG/ECG)" },
      { code: "EN", desc: "Electroneuro (EEG/EMG/EP/PSG)" },
      { code: "GE", desc: "Genetics" },
      { code: "HM", desc: "Hematology" },
      { code: "ICU", desc: "Bedside ICU Monitoring" },
      { code: "IMG", desc: "Diagnostic Imaging" },
      { code: "IMM", desc: "Immunology" },
      { code: "LAB", desc: "Laboratory" },
      { code: "MB", desc: "Microbiology" },
      { code: "MCB", desc: "Mycobacteriology" },
      { code: "MYC", desc: "Mycology" },
      { code: "NMR", desc: "Nuclear Magnetic Resonance (MRI)" },
      { code: "NMS", desc: "Nuclear Medicine Scan" },
      { code: "NRS", desc: "Nursing Service Measures" },
      { code: "OT", desc: "Occupational Therapy" },
      { code: "OTH", desc: "Other" },
      { code: "OUS", desc: "OB Ultrasound" },
      { code: "PAR", desc: "Parasitology" },
      { code: "PAT", desc: "Pathology (gross and histologic diagnosis)" },
      { code: "PF", desc: "Pulmonary Function" },
      { code: "PHR", desc: "Pharmacy" },
      { code: "PT", desc: "Physical Therapy" },
      { code: "RAD", desc: "Radiology" },
      { code: "RC", desc: "Respiratory Care (Therapy)" },
      { code: "RT", desc: "Radiation Therapy" },
      { code: "RUS", desc: "Radiology Ultrasound" },
      { code: "RX", desc: "Radiograph" },
      { code: "SP", desc: "Surgical Pathology" },
      { code: "SR", desc: "Serology" },
      { code: "TX", desc: "Toxicology" },
      { code: "URN", desc: "Urinalysis" },
      { code: "VR", desc: "Virology" },
      { code: "VUS", desc: "Vascular Ultrasound" },
      { code: "XRC", desc: "Cineradiograph" },
    ],
  },
  "0078": {
    name: "Abnormal Flags",
    values: [
      { code: "L", desc: "Below low normal" },
      { code: "H", desc: "Above high normal" },
      { code: "LL", desc: "Below lower panic limits" },
      { code: "HH", desc: "Above upper panic limits" },
      { code: "<", desc: "Below absolute low-off instrument scale" },
      { code: ">", desc: "Above absolute high-off instrument scale" },
      { code: "A", desc: "Abnormal (applies to non-numeric results)" },
      { code: "AA", desc: "Very abnormal (applies to non-numeric results)" },
      { code: "null", desc: "No range defined, or normal ranges don't apply" },
      { code: "N", desc: "Normal (applies to non-numeric results)" },
      { code: "I", desc: "Intermediate (microbiology susceptibilities only)" },
      { code: "MS", desc: "Moderately susceptible (microbiology susceptibilities only)" },
      { code: "R", desc: "Resistant (microbiology susceptibilities only)" },
      { code: "S", desc: "Susceptible (microbiology susceptibilities only)" },
      { code: "VS", desc: "Very susceptible (microbiology susceptibilities only)" },
      { code: "U", desc: "Significant change up" },
      { code: "D", desc: "Significant change down" },
      { code: "B", desc: "Better — use when direction not relevant" },
      { code: "W", desc: "Worse — use when direction not relevant" },
    ],
  },
  "0085": {
    name: "Observation Result Status Codes Interpretation",
    values: [
      { code: "C", desc: "Record coming over is a correction and thus replaces a final result" },
      { code: "D", desc: "Deletes the OBX record" },
      { code: "F", desc: "Final results; Can only be changed with a corrected result" },
      { code: "I", desc: "Specimen in lab; results pending" },
      { code: "N", desc: "Not asked; used only on queries where only certain results are requested" },
      { code: "O", desc: "Order detail description only (no result)" },
      { code: "P", desc: "Preliminary results" },
      { code: "R", desc: "Results entered, not verified" },
      { code: "S", desc: "Partial results" },
      { code: "U", desc: "Results status change to final without retransmitting results already sent as 'preliminary'" },
      { code: "W", desc: "Post original as wrong, e.g. transmitted for wrong patient" },
      { code: "X", desc: "Results cannot be obtained for this observation" },
    ],
  },
  "0119": {
    name: "Order Control Codes",
    values: [
      { code: "NW", desc: "New order/service" },
      { code: "OK", desc: "Order/service accepted & OK" },
      { code: "UA", desc: "Unable to accept order/service" },
      { code: "CA", desc: "Cancel order/service request" },
      { code: "OC", desc: "Order/service canceled" },
      { code: "CR", desc: "Canceled as requested" },
      { code: "UC", desc: "Unable to cancel" },
      { code: "DC", desc: "Discontinue order/service request" },
      { code: "OD", desc: "Order/service discontinued" },
      { code: "DR", desc: "Discontinued as requested" },
      { code: "UD", desc: "Unable to discontinue" },
      { code: "HD", desc: "Hold order request" },
      { code: "OH", desc: "Order/service held" },
      { code: "UH", desc: "Unable to put on hold" },
      { code: "HR", desc: "On hold as requested" },
      { code: "RL", desc: "Release previous hold" },
      { code: "OE", desc: "Order/service released" },
      { code: "OR", desc: "Released as requested" },
      { code: "UR", desc: "Unable to release" },
      { code: "RP", desc: "Order/service replace request" },
      { code: "RU", desc: "Replaced unsolicited" },
      { code: "RO", desc: "Replacement order" },
      { code: "RQ", desc: "Replaced as requested" },
      { code: "UM", desc: "Unable to replace" },
      { code: "PA", desc: "Parent order" },
      { code: "CH", desc: "Child order" },
      { code: "XO", desc: "Change order/service request" },
      { code: "XX", desc: "Order/service changed, unsol." },
      { code: "UX", desc: "Unable to change" },
      { code: "XR", desc: "Changed as requested" },
      { code: "DE", desc: "Data errors" },
      { code: "RE", desc: "Observations/Performed Service to Follow" },
      { code: "RR", desc: "Request received" },
      { code: "SR", desc: "Response to send order/service status request" },
      { code: "SS", desc: "Send order/service status request" },
      { code: "SC", desc: "Status changed" },
      { code: "SN", desc: "Send order/service number" },
      { code: "NA", desc: "Number assigned" },
      { code: "CN", desc: "Combined result" },
      { code: "RF", desc: "Refill order request" },
      { code: "AF", desc: "Order/service refill request approval" },
      { code: "DF", desc: "Order/service refill request denied" },
      { code: "FU", desc: "Order/service refilled, unsolicited" },
      { code: "OF", desc: "Order/service refilled as requested" },
      { code: "UF", desc: "Unable to refill" },
    ],
  },
  "0123": {
    name: "Result Status - OBR",
    note: "Applies to OBR-25 only. Do not confuse with table 0085 (OBX-11), which uses an overlapping but different code set — 0123 has no M, N, U or W.",
    values: [
      { code: "O", desc: "Order received; specimen not yet received" },
      { code: "I", desc: "No results available; specimen received, procedure incomplete" },
      { code: "S", desc: "No results available; procedure scheduled, but not done" },
      { code: "A", desc: "Some, but not all, results available" },
      { code: "P", desc: "Preliminary: A verified early result is available, final results not yet obtained" },
      { code: "C", desc: "Correction to results" },
      { code: "R", desc: "Results stored; not yet verified" },
      { code: "F", desc: "Final results; results stored and verified. Can only be changed with a corrected result" },
      { code: "X", desc: "No results available; Order canceled" },
      { code: "Y", desc: "No order on record for this test (used only on queries)" },
      { code: "Z", desc: "No record of this patient (used only on queries)" },
    ],
  },
  "0155": {
    name: "Accept/Application Acknowledgment Conditions",
    values: [
      { code: "AL", desc: "Always" },
      { code: "ER", desc: "Error/reject conditions only" },
      { code: "NE", desc: "Never" },
      { code: "SU", desc: "Successful completion only" },
    ],
  },
  "0190": {
    name: "Address Type",
    values: [
      { code: "B", desc: "Firm/Business" },
      { code: "BA", desc: "Bad address" },
      { code: "BDL", desc: "Birth delivery location (mother's address)" },
      { code: "BR", desc: "Residence at birth (newborn's address at birth)" },
      { code: "C", desc: "Current Or Temporary" },
      { code: "F", desc: "Country Of Origin" },
      { code: "H", desc: "Home" },
      { code: "L", desc: "Legal Address" },
      { code: "M", desc: "Mailing" },
      { code: "N", desc: "Birth (nee) (birth address)" },
      { code: "O", desc: "Office/Business" },
      { code: "P", desc: "Permanent" },
      { code: "RH", desc: "Registry home. Refers to the information system used as the master. Used if there is a difference in what information is exchanged with the 'official' source." },
      { code: "TM", desc: "Tribal/Community" },
      { code: "V", desc: "Visit Address" },
    ],
  },
  "0357": {
    name: "Message Error Condition Codes",
    values: [
      { code: "0", desc: "Message accepted" },
      { code: "100", desc: "Segment sequence error" },
      { code: "101", desc: "Required field missing" },
      { code: "102", desc: "Data type error" },
      { code: "103", desc: "Table value not found" },
      { code: "200", desc: "Unsupported message type" },
      { code: "201", desc: "Unsupported event code" },
      { code: "202", desc: "Unsupported processing ID" },
      { code: "203", desc: "Unsupported version ID" },
      { code: "204", desc: "Unknown key identifier" },
      { code: "205", desc: "Duplicate key identifier" },
      { code: "206", desc: "Application record locked" },
      { code: "207", desc: "Application internal error" },
    ],
  },
};

// ─── MCP Server ──────────────────────────────────────────────────────────────

/**
 * Build a fully-registered server instance.
 * One McpServer per transport: an instance cannot be shared across concurrent
 * sessions, so each session gets its own.
 */
function createServer() {
const server = new McpServer({
  name: "hl7-v251-reference",
  version: "1.0.0",
});

server.tool(
  "list_segments",
  "List all available HL7 v2.5.1 segments with brief descriptions.",
  {},
  async () => {
    const list = Object.entries(SEGMENTS).map(([code, seg]) => ({
      code,
      name: seg.name,
      fieldCount: seg.fields.length,
      description: seg.description.split(".")[0] + ".",
    }));
    return { content: [{ type: "text", text: JSON.stringify(list, null, 2) }] };
  }
);

server.tool(
  "get_segment",
  "Get the full definition of an HL7 v2.5.1 segment including all field definitions.",
  { segment: z.string().describe("Segment code, e.g. MSH, PID, OBR, OBX, ZDS") },
  async ({ segment }) => {
    const key = segment.toUpperCase();
    const seg = SEGMENTS[key];
    if (!seg) {
      const available = Object.keys(SEGMENTS).join(", ");
      return {
        content: [
          {
            type: "text",
            text: `Segment '${key}' not found. Available: ${available}`,
          },
        ],
        isError: true,
      };
    }
    return { content: [{ type: "text", text: JSON.stringify({ code: key, ...seg }, null, 2) }] };
  }
);

server.tool(
  "get_field",
  "Get the definition of a specific field within an HL7 v2.5.1 segment.",
  {
    segment: z.string().describe("Segment code, e.g. PID"),
    field: z.number().int().positive().describe("Field sequence number, e.g. 3 for PID-3"),
  },
  async ({ segment, field }) => {
    const key = segment.toUpperCase();
    const seg = SEGMENTS[key];
    if (!seg) {
      return {
        content: [{ type: "text", text: `Segment '${key}' not found.` }],
        isError: true,
      };
    }
    const f = seg.fields.find((fld) => fld.seq === field);
    if (!f) {
      return {
        content: [
          {
            type: "text",
            text: `Field ${key}-${field} not found. Available fields: ${seg.fields.map((fld) => fld.seq).join(", ")}`,
          },
        ],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              location: `${key}-${field}`,
              name: f.name,
              dataType: f.type,
              maxLength: f.len,
              optionality: f.opt === "R" ? "Required" : f.opt === "C" ? "Conditional" : f.opt === "B" ? "Backward Compat (deprecated)" : "Optional",
              repeatability: f.rpt === 1 ? "Not repeating" : `Repeating (max: ${f.rpt})`,
              description: f.desc,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "get_message_structure",
  "Get the required and optional segments for an HL7 v2.5.1 message type and event.",
  {
    messageType: z
      .string()
      .describe("Message type and event, e.g. ADT^A01, ORM^O01, ORU^R01, ADT^A40, ACK"),
  },
  async ({ messageType }) => {
    const key = messageType.toUpperCase();
    const structure = MESSAGE_STRUCTURES[key];
    if (!structure) {
      const available = Object.keys(MESSAGE_STRUCTURES).join(", ");
      return {
        content: [
          {
            type: "text",
            text: `Message type '${key}' not found. Available: ${available}`,
          },
        ],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ messageType: key, ...structure }, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "list_message_types",
  "List all supported HL7 v2.5.1 message types with descriptions.",
  {},
  async () => {
    const list = Object.entries(MESSAGE_STRUCTURES).map(([type, def]) => ({
      type,
      description: def.description,
    }));
    return { content: [{ type: "text", text: JSON.stringify(list, null, 2) }] };
  }
);

server.tool(
  "lookup_code_table",
  "Look up values in an HL7 v2.5.1 standard code/value table.",
  {
    tableNumber: z
      .string()
      .describe("Table number as a string, e.g. '0001', '0008', '0119', '0123'"),
    filter: z
      .string()
      .optional()
      .describe("Optional search term to filter codes by code value or description"),
  },
  async ({ tableNumber, filter }) => {
    const table = CODE_TABLES[tableNumber];
    if (!table) {
      const available = Object.keys(CODE_TABLES).join(", ");
      return {
        content: [
          {
            type: "text",
            text: `Table '${tableNumber}' not found. Available: ${available}`,
          },
        ],
        isError: true,
      };
    }
    const values = filter
      ? table.values.filter(
          (v) =>
            v.code.toLowerCase().includes(filter.toLowerCase()) ||
            v.desc.toLowerCase().includes(filter.toLowerCase())
        )
      : table.values;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { tableNumber, name: table.name, matchCount: values.length, values },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "parse_message",
  "Parse an HL7 v2.x message string into a structured JSON representation. Handles MLLP wrapper if present.",
  {
    message: z.string().describe("HL7 message text (pipe-delimited). MLLP wrapper (0x0B...0x1C0x0D) is stripped automatically."),
  },
  async ({ message }) => {
    try {
      // Strip MLLP wrapper if present
      let raw = message.replace(/^\x0B/, "").replace(/\x1C\x0D$/, "");
      // Normalize line endings — HL7 uses \r as segment terminator
      raw = raw.replace(/\r\n/g, "\r").replace(/\n/g, "\r");
      const segmentLines = raw.split("\r").filter((s) => s.trim().length > 0);

      if (segmentLines.length === 0) {
        return {
          content: [{ type: "text", text: "No segments found in message." }],
          isError: true,
        };
      }

      const mshLine = segmentLines[0];
      if (!mshLine.startsWith("MSH")) {
        return {
          content: [{ type: "text", text: "Message must begin with MSH segment." }],
          isError: true,
        };
      }

      const fieldSep = mshLine[3];
      const compSep = mshLine[4];
      const repSep = mshLine[5];
      const subSep = mshLine[7];

      const parseField = (fieldStr) => {
        if (!fieldStr) return null;
        const reps = fieldStr.split(repSep);
        const parsed = reps.map((rep) => {
          const comps = rep.split(compSep);
          if (comps.length === 1) return comps[0];
          return comps.map((c) => {
            const subs = c.split(subSep);
            return subs.length === 1 ? subs[0] : subs;
          });
        });
        return parsed.length === 1 ? parsed[0] : parsed;
      };

      const parsedSegments = segmentLines.map((line, idx) => {
        const segName = line.substring(0, 3);
        const isMsg = segName === "MSH";
        const rawFields = line.substring(4).split(fieldSep);
        const fields = {};

        if (isMsg) {
          fields[1] = fieldSep;
          fields[2] = rawFields[0]; // encoding chars
          rawFields.slice(1).forEach((f, i) => {
            fields[i + 3] = parseField(f);
          });
        } else {
          rawFields.forEach((f, i) => {
            fields[i + 1] = parseField(f);
          });
        }

        const knownSeg = SEGMENTS[segName];
        const enrichedFields = {};
        Object.entries(fields).forEach(([seq, val]) => {
          const seqNum = parseInt(seq);
          const fieldDef = knownSeg?.fields.find((fd) => fd.seq === seqNum);
          enrichedFields[`${segName}-${seq}${fieldDef ? ` (${fieldDef.name})` : ""}`] = val;
        });

        return { segment: segName, index: idx + 1, fields: enrichedFields };
      });

      // Extract key identifiers
      const mshSeg = parsedSegments[0];
      const pidSeg = parsedSegments.find((s) => s.segment === "PID");
      const obrSeg = parsedSegments.find((s) => s.segment === "OBR");

      const mrgSeg = parsedSegments.find((s) => s.segment === "MRG");
      const orcSeg = parsedSegments.find((s) => s.segment === "ORC");
      const zdsSeg = parsedSegments.find((s) => s.segment === "ZDS");

      // The accession lives in OBR-18 by IHE RAD convention, but sites vary.
      // Report the value together with where it was actually found.
      const accCandidates = [
        ["OBR-18", obrSeg?.fields["OBR-18 (Placer Field 1)"]],
        ["OBR-3", obrSeg?.fields["OBR-3 (Filler Order Number)"]],
        ["ORC-3", orcSeg?.fields["ORC-3 (Filler Order Number)"]],
      ].filter(([, v]) => v !== undefined && v !== null && v !== "");
      const [accSource, accValue] = accCandidates[0] ?? [null, null];

      const flat = (v) => (Array.isArray(v) ? v.flat(Infinity).filter(Boolean)[0] : v);

      const summary = {
        messageType: mshSeg.fields["MSH-9 (Message Type)"],
        controlId: mshSeg.fields["MSH-10 (Message Control ID)"],
        sendingApp: mshSeg.fields["MSH-3 (Sending Application)"],
        sendingFacility: mshSeg.fields["MSH-4 (Sending Facility)"],
        dateTime: mshSeg.fields["MSH-7 (Date/Time Of Message)"],
        version: mshSeg.fields["MSH-12 (Version ID)"],
        patientId: pidSeg?.fields["PID-3 (Patient Identifier List)"],
        patientName: pidSeg?.fields["PID-5 (Patient Name)"],
        priorPatientId: mrgSeg?.fields["MRG-1 (Prior Patient Identifier List)"],
        orderControl: orcSeg?.fields["ORC-1 (Order Control)"],
        accession: accValue ?? null,
        accessionSource: accSource,
        studyInstanceUid: flat(zdsSeg?.fields["ZDS-1 (Study Instance UID)"]) ?? null,
        resultStatus: obrSeg?.fields["OBR-25 (Result Status)"],
        segmentCount: parsedSegments.length,
        segments: parsedSegments.map((s) => s.segment),
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ summary, parsedSegments }, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Parse error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// ─── Validation engine ───────────────────────────────────────────────────────

const codeSet = (t) => new Set(CODE_TABLES[t].values.map((v) => v.code.toUpperCase()));
const TBL_ORDER_CONTROL = codeSet("0119");
const TBL_PATIENT_CLASS = codeSet("0004");
const TBL_OBR_STATUS = codeSet("0123");
const TBL_OBX_STATUS = codeSet("0085");
const TBL_ACK = codeSet("0008");
const TBL_SEX = codeSet("0001");

/** Split a message into segment lines and recover its delimiters from MSH. */
function dissect(message) {
  let raw = String(message).replace(/^\x0B/, "").replace(/\x1C\x0D?$/, "");
  raw = raw.replace(/\r\n/g, "\r").replace(/\n/g, "\r");
  const lines = raw
    .split("\r")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.length > 0);
  const msh = lines[0] ?? "";
  return {
    lines,
    fieldSep: msh.length > 3 ? msh[3] : "|",
    compSep: msh.length > 4 ? msh[4] : "^",
    repSep: msh.length > 5 ? msh[5] : "~",
    subSep: msh.length > 7 ? msh[7] : "&",
  };
}

/**
 * Build a 1-based field accessor for a segment line.
 * f(3) returns PID-3. MSH is offset-corrected so f(1) is the field separator
 * and f(2) the encoding characters, matching how the standard numbers them.
 */
function fielder(line, fieldSep) {
  const isMsh = line.startsWith("MSH");
  const parts = line.split(fieldSep);
  return (n) => (isMsh ? (n === 1 ? fieldSep : parts[n - 1] ?? "") : parts[n] ?? "");
}

const comp = (val, n, sep) => ((val ?? "").split(sep)[n - 1] ?? "").trim();
const reps = (val, sep) => (val ?? "").split(sep).filter((x) => x.length > 0);

function makeReport() {
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
function checkTs(loc, value, r) {
  const v = (value ?? "").trim();
  if (!v) return;
  const m = /^(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\.\d{1,4})?([+-]\d{4})?$/.exec(v);
  if (!m) {
    r.err(loc, `'${v}' is not a valid TS timestamp. Expected YYYY[MM[DD[HH[MM[SS[.SSSS]]]]]][+/-ZZZZ].`);
    return;
  }
  const [, , mo, d, h, mi, s] = m;
  if (mo && (+mo < 1 || +mo > 12)) r.err(loc, `Month '${mo}' is out of range.`);
  if (d && (+d < 1 || +d > 31)) r.err(loc, `Day '${d}' is out of range.`);
  if (h && +h > 23) r.err(loc, `Hour '${h}' is out of range.`);
  if (mi && +mi > 59) r.err(loc, `Minute '${mi}' is out of range.`);
  if (s && +s > 60) r.err(loc, `Second '${s}' is out of range.`);
  if (h && !/[+-]\d{4}$/.test(v)) {
    r.warn(loc, "No timezone offset. Without one the receiver applies its own locale, which shifts study and report times across sites.");
  }
}

/** Validate a DICOM UID string. */
function checkUid(loc, uid, r) {
  if (!uid) {
    r.err(loc, "Study Instance UID is empty.");
    return;
  }
  if (!/^[0-9]+(\.[0-9]+)*$/.test(uid)) {
    r.err(loc, `'${uid}' is not a valid DICOM UID — only digits and dots are permitted.`);
    return;
  }
  if (uid.length > 64) r.err(loc, `UID is ${uid.length} characters; DICOM PS3.5 limits UIDs to 64.`);
  if (/(^|\.)0[0-9]/.test(uid)) r.warn(loc, "A UID component has a leading zero, which DICOM PS3.5 disallows.");
}

/** Shared PID checks used by every patient-bearing message. */
function checkPid(pidLine, ctx, r, { requireName = true } = {}) {
  const { fieldSep, compSep, repSep } = ctx;
  const p = fielder(pidLine, fieldSep);

  const idReps = reps(p(3), repSep);
  if (idReps.length === 0) {
    r.err("PID-3", "Patient Identifier List is required — this is the MRN that joins images, orders and reports to the person.");
  } else {
    idReps.forEach((rep, i) => {
      const tag = idReps.length > 1 ? `PID-3[${i + 1}]` : "PID-3";
      if (!comp(rep, 1, compSep)) r.err(`${tag}.1`, "Identifier component is empty.");
      if (!comp(rep, 4, compSep)) r.warn(`${tag}.4`, "No Assigning Authority. An MRN without its authority is ambiguous once a second facility feeds the same system.");
      if (!comp(rep, 5, compSep)) r.warn(`${tag}.5`, "No Identifier Type Code (MR, PI, SS, DL...). Receivers use this to pick the right identifier out of the list.");
    });
  }

  const nameReps = reps(p(5), repSep);
  if (nameReps.length === 0) {
    if (requireName) r.err("PID-5", "Patient Name is required.");
  } else if (!comp(nameReps[0], 1, compSep)) {
    r.err("PID-5.1", "Family Name is empty.");
  }

  if (p(7)) checkTs("PID-7", comp(p(7), 1, compSep), r);
  if (p(8) && !TBL_SEX.has(p(8).toUpperCase())) {
    r.warn("PID-8", `'${p(8)}' is not a table 0001 Administrative Sex value (A, F, M, N, O, U).`);
  }
  if (p(29)) checkTs("PID-29", comp(p(29), 1, compSep), r);
  if (p(2)) r.note("PID-2", "PID-2 is deprecated in v2.5.1 — carry all identifiers as repeats of PID-3.");
  if (p(19)) r.note("PID-19", "PID-19 SSN is deprecated in v2.5.1 — send the SSN as a PID-3 repeat with identifier type SS.");
  if (p(20)) r.note("PID-20", "PID-20 Driver's License is deprecated in v2.5.1 — use a PID-3 repeat with identifier type DL.");
  return p;
}

/** Shared EVN checks for ADT messages. */
function checkEvn(ctx, r) {
  const { lines, fieldSep, compSep } = ctx;
  const evnLine = lines.find((l) => l.startsWith("EVN"));
  if (!evnLine) {
    r.err("EVN", "EVN segment is required in every ADT message.");
    return;
  }
  if (lines[1] !== evnLine) {
    r.err("EVN", "EVN must immediately follow MSH (SFT may sit between them in v2.5.1).");
  }
  const e = fielder(evnLine, fieldSep);
  if (!e(2)) r.err("EVN-2", "Recorded Date/Time is required.");
  else checkTs("EVN-2", comp(e(2), 1, compSep), r);
  if (e(6)) checkTs("EVN-6", comp(e(6), 1, compSep), r);
  if (e(1)) r.note("EVN-1", "EVN-1 Event Type Code is retained only for backward compatibility in v2.5.1; MSH-9 is authoritative and the two must agree.");
}

/** Shared PV1 checks. */
function checkPv1(pv1Line, ctx, r) {
  const { fieldSep, compSep } = ctx;
  const v = fielder(pv1Line, fieldSep);
  const cls = v(2).toUpperCase();
  if (!cls) r.err("PV1-2", "Patient Class is required.");
  else if (!TBL_PATIENT_CLASS.has(cls)) {
    r.err("PV1-2", `'${v(2)}' is not a table 0004 Patient Class value (B, C, E, I, N, O, P, R, U).`);
  }
  if (v(44)) checkTs("PV1-44", comp(v(44), 1, compSep), r);
  if (v(45)) checkTs("PV1-45", comp(v(45), 1, compSep), r);
  return v;
}

// ─── Per-message-type profiles ───────────────────────────────────────────────

function validateORM(ctx, r) {
  const { lines, fieldSep, compSep, repSep } = ctx;
  const orcLines = lines.filter((l) => l.startsWith("ORC"));
  const obrLines = lines.filter((l) => l.startsWith("OBR"));

  const pidLine = lines.find((l) => l.startsWith("PID"));
  if (!pidLine) {
    r.warn("PID", "No PID segment. The PATIENT group is optional in the ORM_O01 abstract syntax, but every practical radiology or lab interface requires it.");
  } else {
    checkPid(pidLine, ctx, r);
  }

  if (orcLines.length === 0) {
    r.err("ORC", "ORM^O01 requires at least one ORC — the ORDER group is mandatory and repeating.");
  }

  orcLines.forEach((line, i) => {
    const o = fielder(line, fieldSep);
    const tag = orcLines.length > 1 ? `ORC[${i + 1}]` : "ORC";
    const ctrl = o(1).toUpperCase();
    const placer = o(2);
    const filler = o(3);

    if (!ctrl) r.err(`${tag}-1`, "Order Control is required — it determines what the receiver does with the order.");
    else if (!TBL_ORDER_CONTROL.has(ctrl)) r.err(`${tag}-1`, `'${o(1)}' is not a valid table 0119 Order Control code.`);

    if (!placer && !filler) {
      r.err(`${tag}-2/3`, "Neither Placer Order Number (ORC-2) nor Filler Order Number (ORC-3) is present — the order cannot be identified by the receiver.");
    }
    if (["CA", "DC", "HD", "RL", "RP", "SC", "XO"].includes(ctrl) && !placer && !filler) {
      r.err(`${tag}-1`, `Order Control '${ctrl}' acts on an order that already exists, but no order number is supplied to identify it.`);
    }
    if (ctrl === "NW" && filler && !placer) {
      r.warn(`${tag}-2`, "New order (NW) supplies a filler order number but no placer order number.");
    }
    if (ctrl === "SC" && !o(5)) {
      r.warn(`${tag}-5`, "Status Change (SC) sent without ORC-5 Order Status. Receivers that key off ORC-5 will not know what the new status is — and a receiver that mistakes SC for NW creates a duplicate worklist entry.");
    }
    if (o(9)) checkTs(`${tag}-9`, comp(o(9), 1, compSep), r);
    if (o(15)) checkTs(`${tag}-15`, comp(o(15), 1, compSep), r);
  });

  if (obrLines.length === 0) {
    r.warn("OBR", "No OBR segment. ORM_O01 allows RQD/RQ1/RXO/ODS/ODT in the order-detail position, but a radiology or laboratory order uses OBR.");
  }
  if (orcLines.length && obrLines.length && orcLines.length !== obrLines.length) {
    r.warn("ORC/OBR", `${orcLines.length} ORC but ${obrLines.length} OBR segment(s). Each repetition of the ORDER group pairs one ORC with one order-detail segment.`);
  }

  obrLines.forEach((line, i) => {
    const b = fielder(line, fieldSep);
    const tag = obrLines.length > 1 ? `OBR[${i + 1}]` : "OBR";
    if (!b(4)) r.err(`${tag}-4`, "Universal Service Identifier is required — it carries the procedure code being ordered.");
    else if (!comp(b(4), 1, compSep)) r.err(`${tag}-4.1`, "Universal Service Identifier has no value in component 1 (Identifier).");
    if (!b(18) && !b(2) && !b(3)) {
      r.warn(`${tag}-18`, "No accession or order number in OBR-18, OBR-2 or OBR-3. IHE RAD maps the DICOM Accession Number (0008,0050) to OBR-18; without it the images and the report can never be reconciled to this order.");
    }
    if (b(7)) checkTs(`${tag}-7`, comp(b(7), 1, compSep), r);
    if (b(36)) checkTs(`${tag}-36`, comp(b(36), 1, compSep), r);
    if (b(25)) r.note(`${tag}-25`, "OBR-25 Result Status is populated on an order message; it is normally set on the ORU that returns the result.");
  });

  const zdsLine = lines.find((l) => l.startsWith("ZDS"));
  if (zdsLine) {
    const z = fielder(zdsLine, fieldSep);
    checkUid("ZDS-1.1", comp(z(1), 1, compSep), r);
    if (z(2)) r.note("ZDS-2", "IHE RAD TF-2 defines only ZDS-1. Anything beyond it is a site-local extension that other systems will not read.");
  } else {
    r.note("ZDS", "No ZDS segment. IHE RAD Scheduled Workflow expects the Study Instance UID here at RAD-4 (Procedure Scheduled), so the PACS can pre-register the study before acquisition.");
  }

  if (lines.some((l) => l.startsWith("MRG"))) {
    r.err("MRG", "MRG has no place in ORM^O01. A patient merge is ADT^A40.");
  }
}

function validateADT_A08(ctx, r) {
  const { lines } = ctx;
  checkEvn(ctx, r);

  const pidLine = lines.find((l) => l.startsWith("PID"));
  if (!pidLine) r.err("PID", "PID is required in ADT^A08.");
  else checkPid(pidLine, ctx, r);

  const pv1Line = lines.find((l) => l.startsWith("PV1"));
  if (!pv1Line) {
    r.err("PV1", "PV1 is required — ADT^A08 uses the ADT_A01 structure, in which PV1 is mandatory.");
  } else {
    const v = checkPv1(pv1Line, ctx, r);
    if (!v(19)) {
      r.warn("PV1-19", "No Visit Number. A08 is a visit-level update; without PV1-19 a receiver holding several open encounters for this patient cannot tell which one to update.");
    }
  }

  if (lines.some((l) => l.startsWith("MRG"))) {
    r.err("MRG", "MRG must not appear in ADT^A08. Merging identities is ADT^A40 (ADT_A39 structure); an A08 carrying MRG will be ignored or misapplied.");
  }
  r.note("ADT^A08", "A08 updates an existing patient and visit; receivers match on PID-3. If the identifier itself is changing this is not an A08 — use A40 to merge, or the appropriate change-identifier event. Downstream PACS must apply A08 demographic corrections or the images keep the old spelling permanently.");
}

function validateADT_A31(ctx, r) {
  const { lines } = ctx;
  checkEvn(ctx, r);

  const pidLine = lines.find((l) => l.startsWith("PID"));
  if (!pidLine) r.err("PID", "PID is required in ADT^A31.");
  else checkPid(pidLine, ctx, r);

  const pv1Line = lines.find((l) => l.startsWith("PV1"));
  if (!pv1Line) {
    r.err("PV1", "PV1 is required — ADT^A31 uses the ADT_A05 structure, in which PV1 is mandatory by the abstract syntax even though A31 is a person-level event. Send it minimally populated.");
  } else {
    const v = checkPv1(pv1Line, ctx, r);
    if (v(19)) {
      r.warn("PV1-19", "A31 is a PERSON-level update but PV1-19 Visit Number is populated. Receivers may treat this as a visit update and apply the change to the wrong scope — send A08 if a specific encounter is the target.");
    }
    if (v(2) && !["N", "U"].includes(v(2).toUpperCase())) {
      r.note("PV1-2", `Patient Class is '${v(2)}' on a person-level event. N (Not Applicable) is the conventional filler when there is no encounter.`);
    }
  }

  if (lines.some((l) => l.startsWith("MRG"))) {
    r.err("MRG", "MRG must not appear in ADT^A31. Merging identities is ADT^A40.");
  }
  r.note("ADT^A31", "A31 updates the master person record with no encounter context; A08 updates a specific visit. Sites that send A31 where the receiver only subscribes to A08 (or the reverse) get demographic drift that surfaces months later as mismatched studies.");
}

function validateADT_A40(ctx, r) {
  const { lines, fieldSep, compSep, repSep } = ctx;
  checkEvn(ctx, r);

  const pidIdx = [];
  const mrgIdx = [];
  lines.forEach((l, i) => {
    if (l.startsWith("PID")) pidIdx.push(i);
    if (l.startsWith("MRG")) mrgIdx.push(i);
  });

  if (pidIdx.length === 0) r.err("PID", "PID is required — it carries the surviving identity.");
  if (mrgIdx.length === 0) {
    r.err("MRG", "MRG is required in ADT^A40 — it carries the prior (losing) identifier. Without it the message says nothing about what to merge.");
  }
  if (pidIdx.length !== mrgIdx.length) {
    r.err("PID/MRG", `${pidIdx.length} PID and ${mrgIdx.length} MRG segment(s). ADT_A39 repeats the PATIENT group as { PID [PD1] MRG [PV1] } — every PID must be paired with exactly one MRG.`);
  }
  if (pidIdx.length > 1) {
    r.note("PATIENT group", `${pidIdx.length} merge pairs in one message. This is legal — the PATIENT group repeats — but confirm the receiver processes every pair and not just the first.`);
  }

  const pairs = Math.min(pidIdx.length, mrgIdx.length);
  for (let i = 0; i < pairs; i++) {
    const tag = pairs > 1 ? `[pair ${i + 1}]` : "";
    const p = fielder(lines[pidIdx[i]], fieldSep);
    const m = fielder(lines[mrgIdx[i]], fieldSep);

    if (mrgIdx[i] < pidIdx[i]) {
      r.err(`MRG${tag}`, "MRG appears before its PID. Within the PATIENT group the order is PID [PD1] MRG [PV1].");
    }

    checkPid(lines[pidIdx[i]], ctx, r);

    const priorReps = reps(m(1), repSep);
    if (priorReps.length === 0) {
      r.err(`MRG-1${tag}`, "Prior Patient Identifier List is required — this is the identifier being retired.");
      continue;
    }

    const survivor = reps(p(3), repSep)[0] ?? "";
    const prior = priorReps[0];
    const sId = comp(survivor, 1, compSep);
    const pId = comp(prior, 1, compSep);
    const sAuth = comp(survivor, 4, compSep);
    const pAuth = comp(prior, 4, compSep);

    if (!pId) r.err(`MRG-1.1${tag}`, "Prior identifier component is empty.");

    if (sId && pId && sId === pId && sAuth === pAuth) {
      r.err(
        `PID-3/MRG-1${tag}`,
        `Self-merge: the surviving identifier '${sId}' is identical to the prior identifier. Depending on the receiver this either no-ops or collapses the record onto itself and orphans its studies.`
      );
    }
    if (sAuth && pAuth && sAuth !== pAuth) {
      r.warn(
        `PID-3.4/MRG-1.4${tag}`,
        `Merging across assigning authorities ('${pAuth}' into '${sAuth}'). This is occasionally intended during a facility consolidation, but far more often it is a build error that merges two unrelated people.`
      );
    }
    if (!pAuth) {
      r.warn(`MRG-1.4${tag}`, "Prior identifier has no Assigning Authority, so the receiver must guess which namespace the retiring MRN belongs to.");
    }
  }

  if (lines.some((l) => l.startsWith("PV1"))) {
    r.note("PV1", "PV1 is optional in ADT_A39 and does not scope the merge — an A40 always applies at the identifier level, across every encounter.");
  }
  r.note(
    "ADT^A40",
    "After this message every downstream imaging system must re-key studies from MRG-1 onto PID-3. Verify the PACS and VNA actually consume A40 rather than silently acking it — studies stranded under the retired MRN are the usual failure, and they surface only when a clinician cannot find a prior."
  );
}

function validateORU(ctx, r) {
  const { lines, fieldSep, compSep, repSep } = ctx;

  const pidLine = lines.find((l) => l.startsWith("PID"));
  if (!pidLine) {
    r.warn("PID", "No PID segment. The PATIENT group is optional in the ORU_R01 abstract syntax, but a result with no patient cannot be filed by any real receiver.");
  } else {
    checkPid(pidLine, ctx, r);
  }

  const obrLines = lines.filter((l) => l.startsWith("OBR"));
  if (obrLines.length === 0) {
    r.err("OBR", "ORU^R01 requires at least one OBR — the ORDER_OBSERVATION group is mandatory and repeating.");
  }

  // Group OBX segments under the OBR that precedes them.
  const groups = [];
  let current = null;
  lines.forEach((l) => {
    if (l.startsWith("OBR")) {
      current = { obr: l, obx: [] };
      groups.push(current);
    } else if (l.startsWith("OBX") && current) {
      current.obx.push(l);
    }
  });

  const orphanObx = lines.filter((l) => l.startsWith("OBX")).length - groups.reduce((n, g) => n + g.obx.length, 0);
  if (orphanObx > 0) {
    r.err("OBX", `${orphanObx} OBX segment(s) appear before any OBR. Every observation must sit inside an ORDER_OBSERVATION group.`);
  }

  groups.forEach((g, gi) => {
    const b = fielder(g.obr, fieldSep);
    const tag = groups.length > 1 ? `OBR[${gi + 1}]` : "OBR";

    if (!b(4)) r.err(`${tag}-4`, "Universal Service Identifier is required.");
    if (!b(18) && !b(2) && !b(3)) {
      r.warn(`${tag}-18`, "No accession or order number in OBR-18, OBR-2 or OBR-3. The report has nothing to key on and will not match the study it describes.");
    }
    if (b(7)) checkTs(`${tag}-7`, comp(b(7), 1, compSep), r);
    if (b(22)) checkTs(`${tag}-22`, comp(b(22), 1, compSep), r);

    const rs = b(25).toUpperCase();
    if (!rs) {
      if (g.obx.length > 0) {
        r.err(`${tag}-25`, "Result Status is required when the order group carries OBX segments.");
      } else {
        r.warn(`${tag}-25`, "Result Status is empty.");
      }
    } else if (!TBL_OBR_STATUS.has(rs)) {
      r.err(
        `${tag}-25`,
        `'${b(25)}' is not a valid table 0123 value. Valid: O, I, S, A, P, C, R, F, X, Y, Z. Note that M, N, U and W belong to table 0085 (OBX-11) and are NOT valid in OBR-25 — conflating the two tables is the most common ORU build error.`
      );
    }

    if (g.obx.length === 0) {
      r.warn(`${tag}`, "Order group carries no OBX segments, so it delivers no result content.");
    }

    const seenIds = new Map();
    g.obx.forEach((line, xi) => {
      const x = fielder(line, fieldSep);
      const xtag = `${groups.length > 1 ? `OBR[${gi + 1}]/` : ""}OBX[${xi + 1}]`;
      const vt = x(2).toUpperCase();
      const val = x(5);
      const subId = x(4);

      if (val && !vt) r.err(`${xtag}-2`, "Value Type is required whenever OBX-5 is populated.");
      if (!x(3)) r.err(`${xtag}-3`, "Observation Identifier is required.");

      const st = x(11).toUpperCase();
      if (!st) r.err(`${xtag}-11`, "Observation Result Status is required.");
      else if (!TBL_OBX_STATUS.has(st)) {
        r.err(`${xtag}-11`, `'${x(11)}' is not a valid table 0085 value. Valid: C, D, F, I, N, O, P, R, S, U, W, X.`);
      } else if (rs && TBL_OBR_STATUS.has(rs)) {
        if (rs === "F" && ["P", "R", "I", "S"].includes(st)) {
          r.warn(`${xtag}-11`, `OBR-25 says the report is Final but this observation is '${st}'. Receivers that trust OBR-25 will publish an unverified line as final.`);
        }
        if (rs === "P" && st === "F") {
          r.warn(`${xtag}-11`, `OBR-25 says Preliminary but this observation is Final. Mixed status within one order group is ambiguous.`);
        }
        if (rs === "C" && !["C", "F"].includes(st)) {
          r.warn(`${xtag}-11`, `OBR-25 is a Correction but this observation is '${st}'. A correction should carry C (or F) on the observations it replaces.`);
        }
      }

      if (vt === "NM" && val) {
        const first = comp(val, 1, compSep);
        if (first && Number.isNaN(Number(first))) {
          r.err(`${xtag}-5`, `Value Type is NM but '${first}' is not numeric.`);
        }
      }
      if (["TX", "FT"].includes(vt) && val.includes("\\.br\\") === false && val.length > 200) {
        r.note(`${xtag}-5`, "Long free-text value with no \\.br\\ escapes. Report line breaks must be escaped as \\.br\\ or the layout collapses in the receiving EMR.");
      }
      if (x(14)) checkTs(`${xtag}-14`, comp(x(14), 1, compSep), r);

      const idKey = comp(x(3), 1, compSep) || x(3);
      if (idKey) {
        const prev = seenIds.get(idKey);
        if (prev !== undefined && !subId) {
          r.warn(`${xtag}-4`, `Observation Identifier '${idKey}' repeats within this order group but OBX-4 Sub-ID is empty. Without a Sub-ID the receiver cannot tell the repeats apart and may overwrite one with the other.`);
        }
        seenIds.set(idKey, xi);
      }
    });
  });

  if (lines.some((l) => l.startsWith("MRG"))) {
    r.err("MRG", "MRG has no place in ORU^R01.");
  }

  const orcLines = lines.filter((l) => l.startsWith("ORC"));
  if (orcLines.length === 0) {
    r.note("ORC", "No ORC segment. ORC is optional inside ORDER_OBSERVATION in the v2.5.1 abstract syntax, so this is conformant — but many receivers expect it.");
  }
}

const PROFILES = {
  "ORM^O01": { label: "Order Message", fn: validateORM },
  "ADT^A08": { label: "Update Patient Information", fn: validateADT_A08 },
  "ADT^A31": { label: "Update Person Information", fn: validateADT_A31 },
  "ADT^A40": { label: "Merge Patient — Patient Identifier List", fn: validateADT_A40 },
  "ORU^R01": { label: "Unsolicited Observation Result", fn: validateORU },
};

server.tool(
  "validate_message",
  "Validate an HL7 v2.5.1 message. Runs base MSH/structural checks on any message, plus a deep message-specific profile for ORM^O01, ADT^A08, ADT^A31, ADT^A40 and ORU^R01 covering required fields, code-table membership, timestamp format, identifier integrity and cross-segment consistency.",
  {
    message: z.string().describe("HL7 message text to validate. MLLP framing is stripped automatically."),
  },
  async ({ message }) => {
    const r = makeReport();
    const ctx = dissect(message);
    const { lines, fieldSep, compSep } = ctx;

    if (lines.length === 0) {
      r.err("message", "Message is empty.");
      return {
        content: [{ type: "text", text: JSON.stringify({ valid: false, errors: r.errors, warnings: [], info: [] }, null, 2) }],
      };
    }

    const segNames = lines.map((l) => l.substring(0, 3));

    // ── base structural checks ──
    if (!lines[0].startsWith("MSH")) {
      r.err("MSH", "The first segment must be MSH.");
    }

    const badNames = segNames.filter((n) => !/^[A-Z][A-Z0-9]{2}$/.test(n));
    if (badNames.length) {
      r.err("segments", `Malformed segment name(s): ${[...new Set(badNames)].join(", ")}. Segment names are three uppercase alphanumeric characters.`);
    }

    const m = fielder(lines[0], fieldSep);
    const encoding = m(2);
    if (encoding.length < 4) {
      r.err("MSH-2", `Encoding characters '${encoding}' should be exactly four: component, repetition, escape, subcomponent (default ^~\\&).`);
    } else if (new Set([fieldSep, ...encoding.slice(0, 4)]).size !== 5) {
      r.err("MSH-2", "Field separator and encoding characters are not all distinct.");
    }

    if (!m(3)) r.warn("MSH-3", "Sending Application is empty. Optional in the standard, but routing and audit both depend on it.");
    if (!m(5)) r.warn("MSH-5", "Receiving Application is empty.");
    if (!m(7)) r.err("MSH-7", "Date/Time of Message is required.");
    else checkTs("MSH-7", comp(m(7), 1, compSep), r);

    const msgType = m(9);
    const msgCode = comp(msgType, 1, compSep).toUpperCase();
    const trigger = comp(msgType, 2, compSep).toUpperCase();
    const structure = comp(msgType, 3, compSep).toUpperCase();
    const typeKey = trigger ? `${msgCode}^${trigger}` : msgCode;

    if (!msgType) r.err("MSH-9", "Message Type is required.");
    else if (!trigger && msgCode !== "ACK") {
      r.warn("MSH-9.2", "No trigger event in MSH-9.2. v2.5.1 expects Message Code^Trigger Event^Message Structure.");
    }
    if (!structure && msgCode !== "ACK") {
      r.note("MSH-9.3", "No Message Structure ID in MSH-9.3. Populating it (e.g. ADT_A01) lets the receiver pick the right parser without inferring it from the trigger.");
    }

    if (!m(10)) r.err("MSH-10", "Message Control ID is required — acknowledgements echo it in MSA-2.");
    else if (m(10).length > 20) r.err("MSH-10", `Message Control ID is ${m(10).length} characters; the v2.5.1 maximum is 20.`);

    const procId = comp(m(11), 1, compSep).toUpperCase();
    if (!procId) r.err("MSH-11", "Processing ID is required.");
    else if (!["P", "D", "T"].includes(procId)) {
      r.err("MSH-11", `'${comp(m(11), 1, compSep)}' is not a valid Processing ID (P=Production, D=Debugging, T=Training).`);
    }

    const version = comp(m(12), 1, compSep);
    if (!version) r.err("MSH-12", "Version ID is required.");
    else if (version !== "2.5.1") {
      r.warn("MSH-12", `Version ID is '${version}'. This validator applies v2.5.1 rules; segment and data-type definitions differ in other versions.`);
    }

    if (m(15) && !["AL", "NE", "ER", "SU"].includes(m(15).toUpperCase())) {
      r.err("MSH-15", `'${m(15)}' is not a valid table 0155 value (AL, NE, ER, SU).`);
    }
    if (m(16) && !["AL", "NE", "ER", "SU"].includes(m(16).toUpperCase())) {
      r.err("MSH-16", `'${m(16)}' is not a valid table 0155 value (AL, NE, ER, SU).`);
    }

    // EVN/MSH-9 agreement for ADT
    if (msgCode === "ADT") {
      const evnLine = lines.find((l) => l.startsWith("EVN"));
      if (evnLine) {
        const evnType = fielder(evnLine, fieldSep)(1).toUpperCase();
        if (evnType && trigger && evnType !== trigger) {
          r.err("EVN-1", `EVN-1 is '${evnType}' but MSH-9.2 is '${trigger}'. When both are sent they must agree.`);
        }
      }
    }

    // ACK/ORR checks
    if (msgCode === "ACK" || msgCode === "ORR") {
      const msaLine = lines.find((l) => l.startsWith("MSA"));
      if (!msaLine) r.err("MSA", `${msgCode} requires an MSA segment.`);
      else {
        const a = fielder(msaLine, fieldSep);
        const ack = a(1).toUpperCase();
        if (!ack) r.err("MSA-1", "Acknowledgment Code is required.");
        else if (!TBL_ACK.has(ack)) r.err("MSA-1", `'${a(1)}' is not a valid table 0008 value (AA, AE, AR, CA, CE, CR).`);
        if (!a(2)) r.err("MSA-2", "Message Control ID is required — it must echo MSH-10 of the message being acknowledged.");
        if (a(3)) r.note("MSA-3", "MSA-3 Text Message is deprecated in v2.5.1; send error detail in ERR instead.");
      }
    }

    // ── message-specific profile ──
    const profile = PROFILES[typeKey];
    if (profile) {
      profile.fn(ctx, r);
    } else if (msgCode) {
      r.note(
        "profile",
        `No deep profile for '${typeKey}'. Base structural checks were applied. Deep profiles exist for: ${Object.keys(PROFILES).join(", ")}.`
      );
    }

    // duplicate-segment sanity for segments that appear once per group
    ["MSH", "EVN", "MSA", "MRG"].forEach((s) => {
      const count = segNames.filter((n) => n === s).length;
      if (count > 1 && !(s === "MRG" && typeKey === "ADT^A40")) {
        r.warn("structure", `Segment ${s} appears ${count} times; it should appear once.`);
      }
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              valid: r.errors.length === 0,
              messageType: typeKey || null,
              messageStructure: structure || null,
              version: version || null,
              profileApplied: profile ? `${typeKey} — ${profile.label}` : "base checks only",
              counts: { errors: r.errors.length, warnings: r.warnings.length, info: r.info.length },
              errors: r.errors,
              warnings: r.warnings,
              info: r.info,
              segmentsFound: segNames,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

  return server;
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────

const app = express();
app.use(cors({ exposedHeaders: ["Mcp-Session-Id"] }));
app.use(express.json({ limit: "8mb" }));

/** sessionId -> { server, transport } */
const sessions = new Map();

const notFound = (res) =>
  res.status(404).json({
    jsonrpc: "2.0",
    error: { code: -32001, message: "Session not found or expired. Re-initialize with POST /mcp." },
    id: null,
  });

app.post("/mcp", async (req, res) => {
  try {
    const sessionId = req.headers["mcp-session-id"];

    if (sessionId) {
      const entry = sessions.get(sessionId);
      if (!entry) return notFound(res);
      return await entry.transport.handleRequest(req, res, req.body);
    }

    // No session header — this is an initialize request. Give it its own
    // server instance; a single McpServer cannot back concurrent transports.
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => sessions.set(id, { server, transport }),
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
      server.close().catch(() => {});
    };
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("POST /mcp failed:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

app.get("/mcp", async (req, res) => {
  const entry = sessions.get(req.headers["mcp-session-id"]);
  if (!entry) return notFound(res);
  try {
    await entry.transport.handleRequest(req, res);
  } catch (err) {
    console.error("GET /mcp failed:", err);
    if (!res.headersSent) res.status(500).end();
  }
});

app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  const entry = sessions.get(sessionId);
  if (!entry) return notFound(res);
  try {
    await entry.transport.handleRequest(req, res);
  } catch (err) {
    console.error("DELETE /mcp failed:", err);
    if (!res.headersSent) res.status(500).end();
  } finally {
    sessions.delete(sessionId);
  }
});

app.get("/health", (_req, res) => res.json({ status: "ok", server: "hl7-v251-reference" }));

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`HL7 v2.5.1 MCP server listening on http://localhost:${PORT}/mcp`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

#!/usr/bin/env python3
"""Validate HHGOA submission files against the supplied answer contract and index."""

from __future__ import annotations

import json
import math
import re
import argparse
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INDEX_PATH = ROOT / "data" / "hhgoa" / "index.json"
CASES_DIR = ROOT / "output" / "hhgoa" / "cases"

STATUSES = {"open", "closed_fraud", "closed_legitimate", "escalated"}
VERDICTS = {"fraud", "legitimate", "uncertain"}
PATTERNS = {
    "card_testing", "card_not_present_fraud", "card_not_present_new_device",
    "out_of_region_use", "account_takeover", "undocumented", "none",
}
EVIDENCE_SOURCES = {"graph", "document", "customer", "external"}
REQUEST_TYPES = {"customer_validation", "step_up_auth", "analyst_info"}
ROUTES = {"auto", "L1", "L2"}
AUTO_ACTIONS = {
    "ALLOW_TRANSACTION", "MONITOR_CARD", "MONITOR_CONNECTED_CARDS",
    "WARN_CUSTOMER", "VERIFY_WITH_CUSTOMER", "STEP_UP_AUTH",
    "GENERATE_REPORT", "CREATE_CASE", "ESCALATE_TO_ANALYST", "CLOSE_NO_FRAUD",
}
L1_ACTIONS = {"DECLINE_TRANSACTION"}
L2_ACTIONS = {"BLOCK_ALL_CARDS", "FILE_REPORT"}
ALL_ACTIONS = AUTO_ACTIONS | L1_ACTIONS | L2_ACTIONS | {"BLOCK_CARD"}


def require(condition: bool, message: str, errors: list[str]) -> None:
    if not condition:
        errors.append(message)


def sentence_count(text: str) -> int:
    return len(re.findall(r"(?<=[.!?])(?:\s+|$)", text.strip()))


def transaction_map(context: dict) -> dict[str, dict]:
    rows = [
        context["flagged_transaction"],
        *context.get("customer_history", []),
        *context.get("shared_device_activity", []),
    ]
    return {str(row["transaction_id"]): row for row in rows}


def validate_action(item: dict, exposure: float, label: str, errors: list[str]) -> None:
    action = item.get("action")
    route = item.get("route")
    require(action in ALL_ACTIONS, f"{label}: unknown action {action!r}", errors)
    require(route in ROUTES, f"{label}: unknown route {route!r}", errors)
    require(bool(str(item.get("reason", "")).strip()), f"{label}: missing reason", errors)
    if action in AUTO_ACTIONS:
        require(route == "auto", f"{label}: {action} must use auto", errors)
    elif action in L1_ACTIONS:
        require(route == "L1", f"{label}: {action} must use L1", errors)
    elif action in L2_ACTIONS:
        require(route == "L2", f"{label}: {action} must use L2", errors)
    elif action == "BLOCK_CARD":
        expected = "L1" if exposure <= 2500 else "L2"
        require(route == expected, f"{label}: BLOCK_CARD must use {expected} for ${exposure:.2f}", errors)


def validate_case(answer: dict, context: dict, errors: list[str], warnings: list[str]) -> None:
    case_id = context["case"]["case_id"]
    prefix = case_id
    required_top = {
        "case_id", "case", "evidence_requests", "next_best_actions", "sar",
        "stop_reason", "tool_calls", "tokens", "latency_s",
    }
    require(required_top <= answer.keys(), f"{prefix}: missing top-level fields {sorted(required_top - answer.keys())}", errors)
    require(answer.get("case_id") == case_id, f"{prefix}: case_id mismatch", errors)

    record = answer.get("case", {})
    required_case = {
        "status", "verdict", "fraud_probability", "pattern", "pattern_description",
        "affected_txn_ids", "first_suspicious_txn_id", "connected_card_ids",
        "connected_device_profiles", "exposure_usd", "evidence", "similar_prior_cases",
        "summary", "written_to_graph", "graph_case_id",
    }
    require(required_case <= record.keys(), f"{prefix}: missing case fields {sorted(required_case - record.keys())}", errors)
    require(record.get("status") in STATUSES, f"{prefix}: invalid status", errors)
    require(record.get("verdict") in VERDICTS, f"{prefix}: invalid verdict", errors)
    probability = record.get("fraud_probability")
    require(isinstance(probability, (int, float)) and 0 <= probability <= 1, f"{prefix}: invalid fraud_probability", errors)
    require(record.get("pattern") in PATTERNS, f"{prefix}: invalid pattern", errors)
    if record.get("pattern") == "undocumented":
        require(sentence_count(record.get("pattern_description", "")) in {2, 3}, f"{prefix}: undocumented description must be 2-3 sentences", errors)
    else:
        require(record.get("pattern_description") == "", f"{prefix}: pattern_description must be empty", errors)

    known_transactions = transaction_map(context)
    affected = record.get("affected_txn_ids", [])
    require(isinstance(affected, list) and len(affected) == len(set(affected)), f"{prefix}: affected transactions must be a unique list", errors)
    missing = [txn_id for txn_id in affected if txn_id not in known_transactions]
    require(not missing, f"{prefix}: unknown affected transaction IDs {missing}", errors)
    if not missing:
        expected_exposure = round(sum(abs(float(known_transactions[item]["amount"])) for item in affected), 2)
        require(math.isclose(float(record.get("exposure_usd", -1)), expected_exposure, abs_tol=0.01), f"{prefix}: exposure is ${record.get('exposure_usd')} but transactions total ${expected_exposure}", errors)
        if affected:
            chronological = sorted(affected, key=lambda item: (known_transactions[item]["timestamp"], item))
            require(record.get("first_suspicious_txn_id") == chronological[0], f"{prefix}: first_suspicious_txn_id is not the earliest episode transaction", errors)
            require(affected == chronological, f"{prefix}: affected_txn_ids are not chronological", errors)

    verdict = record.get("verdict")
    if verdict == "legitimate":
        require(affected == [], f"{prefix}: legitimate case has affected transactions", errors)
        require(record.get("first_suspicious_txn_id") == "", f"{prefix}: legitimate case has a first suspicious transaction", errors)
        require(float(record.get("exposure_usd", -1)) == 0, f"{prefix}: legitimate exposure must be zero", errors)
    elif verdict == "fraud":
        require(context["case"]["flagged_txn_id"] in affected, f"{prefix}: fraud episode omits the flagged transaction", errors)

    require(sentence_count(record.get("summary", "")) in range(2, 7), f"{prefix}: summary must be 2-6 sentences", errors)
    require(isinstance(record.get("written_to_graph"), bool), f"{prefix}: written_to_graph must be boolean", errors)
    if not record.get("written_to_graph"):
        warnings.append(f"{prefix}: case memory is not written to TigerGraph (expected until live credentials are configured)")
        require(record.get("graph_case_id") == "", f"{prefix}: graph_case_id must be empty when not written", errors)

    for number, evidence in enumerate(record.get("evidence", []), start=1):
        label = f"{prefix} evidence {number}"
        require(bool(str(evidence.get("claim", "")).strip()), f"{label}: missing claim", errors)
        require(evidence.get("source") in EVIDENCE_SOURCES, f"{label}: invalid source", errors)
        require(bool(str(evidence.get("ref", "")).strip()), f"{label}: missing ref", errors)
        require(isinstance(evidence.get("entity_ids"), list) and bool(evidence["entity_ids"]), f"{label}: entity_ids must be non-empty", errors)

    requests = answer.get("evidence_requests", [])
    for number, request in enumerate(requests, start=1):
        label = f"{prefix} evidence request {number}"
        require(request.get("type") in REQUEST_TYPES, f"{label}: invalid type", errors)
        require(isinstance(request.get("asked_after_step"), int), f"{label}: asked_after_step must be int", errors)
        require(bool(str(request.get("assumed_response", "")).strip()), f"{label}: missing assumed_response", errors)
        ref = f"evidence_request:{number}"
        require(any(item.get("ref") == ref and item.get("source") == "customer" for item in record.get("evidence", [])), f"{label}: assumed response is not cited in case evidence", errors)

    action_plan = answer.get("next_best_actions", {})
    initial = action_plan.get("initial", [])
    final = action_plan.get("final", [])
    require(isinstance(initial, list) and bool(initial), f"{prefix}: initial actions must be non-empty", errors)
    require(isinstance(final, list) and bool(final), f"{prefix}: final actions must be non-empty", errors)
    for phase, actions in (("initial", initial), ("final", final)):
        for number, item in enumerate(actions, start=1):
            validate_action(item, float(record.get("exposure_usd", 0)), f"{prefix} {phase} action {number}", errors)
    changed = action_plan.get("what_changed", "")
    if not requests:
        require(initial == final, f"{prefix}: initial and final actions differ without an evidence request", errors)
        require(changed == "nothing", f"{prefix}: what_changed must be 'nothing' without an evidence request", errors)
    else:
        require(changed != "nothing" and bool(str(changed).strip()), f"{prefix}: requested evidence but did not explain what changed", errors)

    final_names = {item.get("action") for item in final}
    sar = answer.get("sar", {})
    report_in_actions = "FILE_REPORT" in final_names
    require(sar.get("file") is report_in_actions, f"{prefix}: sar.file disagrees with FILE_REPORT", errors)
    require(bool(str(sar.get("reason", "")).strip()), f"{prefix}: SAR reason is missing", errors)
    if report_in_actions:
        require("CREATE_CASE" in final_names, f"{prefix}: FILE_REPORT requires CREATE_CASE", errors)
        require(sentence_count(sar.get("narrative", "")) in range(6, 13), f"{prefix}: SAR narrative must be 6-12 sentences", errors)
        require(isinstance(sar.get("subjects"), list) and bool(sar["subjects"]), f"{prefix}: SAR subjects are missing", errors)
        require(math.isclose(float(sar.get("total_amount_usd", -1)), float(record.get("exposure_usd", 0)), abs_tol=0.01), f"{prefix}: SAR total does not match exposure", errors)
        dates = sar.get("activity_dates")
        require(isinstance(dates, list) and len(dates) == 2 and all(re.fullmatch(r"\d{4}-\d{2}-\d{2}", item or "") for item in dates), f"{prefix}: SAR activity_dates must contain two ISO dates", errors)
    else:
        require(sar.get("narrative") == "" and sar.get("subjects") == [] and sar.get("total_amount_usd") == 0 and sar.get("activity_dates") == [], f"{prefix}: non-filed SAR fields must be empty/zero", errors)

    require(bool(str(answer.get("stop_reason", "")).strip()), f"{prefix}: stop_reason is missing", errors)
    require(isinstance(answer.get("tool_calls"), int) and answer["tool_calls"] >= 0, f"{prefix}: tool_calls must be a non-negative int", errors)
    require(isinstance(answer.get("tokens"), int) and answer["tokens"] >= 0, f"{prefix}: tokens must be a non-negative int", errors)
    require(isinstance(answer.get("latency_s"), (int, float)) and answer["latency_s"] >= 0, f"{prefix}: latency_s must be non-negative", errors)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cases-dir", type=Path, default=CASES_DIR)
    args = parser.parse_args()
    if not INDEX_PATH.exists():
        raise SystemExit(f"Missing {INDEX_PATH}. Run: npm run data:build")
    index = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    contexts = {item["case"]["case_id"]: item for item in index["cases"]}
    expected = set(contexts)
    files = sorted(args.cases_dir.glob("*.json"))
    found = {item.stem for item in files}
    errors: list[str] = []
    warnings: list[str] = []
    require(found == expected, f"Submission filenames differ: missing={sorted(expected-found)}, extra={sorted(found-expected)}", errors)
    for path in files:
        if path.stem not in contexts:
            continue
        try:
            answer = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            errors.append(f"{path.name}: invalid JSON: {exc}")
            continue
        validate_case(answer, contexts[path.stem], errors, warnings)

    if errors:
        print(f"FAILED: {len(errors)} validation error(s)")
        for item in errors:
            print(f"  - {item}")
        return 1
    print(f"PASS: validated {len(files)} HHGOA answer files")
    print(f"WARNINGS: {len(warnings)}" + (" (cases remain local until TigerGraph credentials are configured)" if warnings else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

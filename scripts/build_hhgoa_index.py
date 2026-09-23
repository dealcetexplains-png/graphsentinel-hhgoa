"""Build a compact investigation index from the HHGOA IEEE-CIS package.

The 708 MB transaction file remains the source of truth. This script streams it
once and keeps only the records needed to investigate the 20 benchmark cases,
their shared-device neighborhoods, and the closed-case memory used for retrieval.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "docs"
DEFAULT_OUTPUT = ROOT / "data" / "hhgoa" / "index.json"


def text(value: object) -> str:
    if value is None:
        return ""
    value = str(value)
    return "" if value.lower() == "nan" else value


def number(value: object, default: float = 0.0) -> float:
    try:
        parsed = float(text(value))
        return parsed if math.isfinite(parsed) else default
    except (TypeError, ValueError):
        return default


def integer(value: object, default: int = 0) -> int:
    try:
        return int(float(text(value)))
    except (TypeError, ValueError):
        return default


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        return [{key: text(value) for key, value in row.items()} for row in csv.DictReader(stream)]


def device_profile(identity: dict[str, str]) -> str:
    parts = [identity.get(key, "") for key in ("DeviceInfo", "id_30", "id_31", "id_33")]
    if not any(parts):
        return ""
    return " | ".join(part or "unknown" for part in parts)


def device_id(profile: str) -> str:
    if not profile:
        return ""
    return f"DVC-{hashlib.sha1(profile.encode('utf-8')).hexdigest()[:10].upper()}"


def card_fingerprint(row: dict[str, str]) -> str:
    fields = [row.get("customer_id", "")] + [row.get(f"card{i}", "") for i in range(1, 7)]
    return "|".join(fields)


def iso_date(value: str) -> datetime:
    return datetime.fromisoformat(value)


def compact_identity(row: dict[str, str]) -> dict[str, str]:
    profile = device_profile(row)
    return {
        "transaction_id": row["TransactionID"],
        "device_id": device_id(profile),
        "profile": profile,
        "device_type": row.get("DeviceType", ""),
        "device_info": row.get("DeviceInfo", ""),
        "device_status": row.get("id_15", ""),
        "proxy": row.get("id_23", ""),
        "os": row.get("id_30", ""),
        "browser": row.get("id_31", ""),
        "screen": row.get("id_33", ""),
        "match_status": row.get("id_34", ""),
        "identity_ratings": {key: row.get(key, "") for key in ("id_01", "id_02", "id_05", "id_06", "id_11")},
    }


TRANSACTION_FIELDS = [
    "TransactionID", "TransactionDT", "TransactionAmt", "ProductCD",
    "card1", "card2", "card3", "card4", "card5", "card6",
    "addr1", "addr2", "P_emaildomain", "R_emaildomain",
    "C1", "C2", "C4", "C6", "C8", "C11", "C13", "C14",
    "D1", "D2", "D3", "D4", "D5", "D10", "D11", "D15",
    "M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9",
    "customer_id", "ts", "channel", "risk_score",
]


def compact_transaction(values: list[str], positions: dict[str, int]) -> dict[str, object]:
    row = {name: values[index] if index < len(values) else "" for name, index in positions.items()}
    result: dict[str, object] = {
        "transaction_id": row["TransactionID"],
        "customer_id": row["customer_id"],
        "timestamp": row["ts"],
        "amount": round(number(row["TransactionAmt"]), 2),
        "product_code": row["ProductCD"],
        "channel": row["channel"],
        "risk_score": round(number(row["risk_score"]), 4),
        "billing_region": row["addr1"],
        "billing_country": row["addr2"],
        "purchaser_email": row["P_emaildomain"],
        "recipient_email": row["R_emaildomain"],
        "card": {key: row[key] for key in ("card1", "card2", "card3", "card4", "card5", "card6")},
        "count_signals": {key: row[key] for key in ("C1", "C2", "C4", "C6", "C8", "C11", "C13", "C14")},
        "time_signals": {key: row[key] for key in ("D1", "D2", "D3", "D4", "D5", "D10", "D11", "D15")},
        "match_flags": {key: row[key] for key in ("M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9")},
    }
    result["card_fingerprint"] = card_fingerprint({
        "customer_id": row["customer_id"],
        **{key: row[key] for key in ("card1", "card2", "card3", "card4", "card5", "card6")},
    })
    return result


def history_record(row: dict[str, str]) -> dict[str, object]:
    return {
        "case_id": row["case_id"],
        "customer_id": row["customer_id"],
        "card_id": row["card_id"],
        "opened_at": row["opened_at"],
        "closed_at": row["closed_at"],
        "outcome": row["outcome"],
        "pattern": row["pattern"],
        "first_fraud_txn_id": row["first_fraud_txn_id"],
        "txn_ids": [item for item in row["txn_ids"].split("|") if item],
        "n_txns": integer(row["n_txns"]),
        "exposure_usd": round(number(row["exposure_usd"]), 2),
        "connected_card_ids": [item for item in row["connected_card_ids"].split("|") if item],
        "actions_taken": [item for item in row["actions_taken"].split("|") if item],
        "report_filed": row["report_filed"].lower() == "yes",
        "analyst_notes": row["analyst_notes"],
    }


def similarity_score(case: dict[str, str], flagged: dict[str, object], identity: dict[str, object] | None,
                     prior: dict[str, object], closed_transactions: dict[str, dict[str, object]],
                     identities: dict[str, dict[str, str]]) -> float:
    score = 0.0
    if prior["customer_id"] == case["customer_id"]:
        score += 8.0
    if prior["card_id"] == case["card_id"]:
        score += 4.0
    prior_txn = closed_transactions.get(str(prior["first_fraud_txn_id"]))
    if prior_txn:
        if prior_txn["channel"] == flagged["channel"]:
            score += 1.4
        if prior_txn["product_code"] == flagged["product_code"]:
            score += 0.8
        if prior_txn["billing_region"] and prior_txn["billing_region"] == flagged["billing_region"]:
            score += 1.0
        a = max(float(flagged["amount"]), 1.0)
        b = max(float(prior_txn["amount"]), 1.0)
        score += max(0.0, 1.2 - abs(math.log(a / b)))
        prior_ident = identities.get(str(prior["first_fraud_txn_id"]))
        if identity and prior_ident and identity.get("profile") == prior_ident.get("profile"):
            score += 10.0
    if identity and identity.get("device_status") == "New" and prior["pattern"] in {"card_not_present_new_device", "account_takeover"}:
        score += 1.5
    if flagged["channel"] == "in_person" and prior["pattern"] == "out_of_region_use":
        score += 1.5
    return round(score, 4)


def case_features(case: dict[str, str], flagged: dict[str, object], history: list[dict[str, object]],
                  identity: dict[str, object] | None, connected: list[dict[str, object]]) -> dict[str, object]:
    flagged_at = iso_date(str(flagged["timestamp"]))
    same_card = [row for row in history if row["card_id"] == case["card_id"]]
    prior = [row for row in same_card if iso_date(str(row["timestamp"])) < flagged_at]
    recent_48h = [row for row in same_card if abs((iso_date(str(row["timestamp"])) - flagged_at).total_seconds()) <= 48 * 3600]
    tiny_preceding = [row for row in same_card if 0 <= (flagged_at - iso_date(str(row["timestamp"]))).total_seconds() <= 3600 and float(row["amount"]) < 5]
    prior_regions = {str(row["billing_region"]) for row in prior if row["billing_region"]}
    region_novel = bool(flagged["billing_region"] and flagged["billing_region"] not in prior_regions and len(prior_regions) >= 2)
    normal_regions = Counter(str(row["billing_region"]) for row in prior if row["billing_region"])
    normal_region = normal_regions.most_common(1)[0][0] if normal_regions else ""
    concurrent_home = any(
        normal_region and row["billing_region"] == normal_region and
        abs((iso_date(str(row["timestamp"])) - flagged_at).total_seconds()) <= 72 * 3600
        for row in same_card if row["transaction_id"] != flagged["transaction_id"]
    )
    mismatches = [key for key, value in dict(flagged["match_flags"]).items() if value == "F"]
    return {
        "history_count": len(same_card),
        "transactions_within_48h": len(recent_48h),
        "tiny_authorizations_preceding_1h": len(tiny_preceding),
        "new_device": bool(identity and identity.get("device_status") == "New"),
        "proxy_detected": bool(identity and identity.get("proxy")),
        "novel_billing_region": region_novel,
        "normal_billing_region": normal_region,
        "normal_activity_continued": concurrent_home,
        "match_flag_failures": mismatches,
        "shared_device_transaction_count": len(connected),
        "shared_device_customer_count": len({str(row["customer_id"]) for row in connected if row["customer_id"] != case["customer_id"]}),
    }


def build(source: Path, output: Path) -> None:
    required = [source / name for name in ("README.md", "case_pack.csv", "closed_cases_history.csv", "identity.csv", "transactions.csv")]
    missing = [path.name for path in required if not path.exists()]
    partial = source / "transactions.csv.crdownload"
    if missing:
        note = ""
        if partial.exists():
            note = f" Found an incomplete browser download ({partial.name}, {partial.stat().st_size:,} bytes)."
        raise SystemExit(f"Dataset is incomplete. Missing: {', '.join(missing)}.{note}")

    cases = read_csv(source / "case_pack.csv")
    history_rows = read_csv(source / "closed_cases_history.csv")
    history = [history_record(row) for row in history_rows]
    identities_raw = read_csv(source / "identity.csv")
    identities = {row["TransactionID"]: compact_identity(row) for row in identities_raw}
    profile_transactions: dict[str, list[str]] = defaultdict(list)
    for transaction_id, item in identities.items():
        if item["device_id"]:
            profile_transactions[str(item["device_id"])].append(transaction_id)

    case_by_flag = {case["flagged_txn_id"]: case for case in cases}
    target_customers = {case["customer_id"] for case in cases}
    closed_ids = {txn_id for item in history for txn_id in item["txn_ids"]}
    closed_ids.update(str(item["first_fraud_txn_id"]) for item in history if item["first_fraud_txn_id"])
    online_ids = set(identities)
    relevant_ids = set(case_by_flag) | closed_ids

    target_history: dict[str, list[dict[str, object]]] = defaultdict(list)
    relevant_transactions: dict[str, dict[str, object]] = {}
    online_transactions: dict[str, dict[str, object]] = {}
    total_rows = 0

    with (source / "transactions.csv").open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.reader(stream)
        header = next(reader)
        header_positions = {name: index for index, name in enumerate(header)}
        missing_columns = [name for name in TRANSACTION_FIELDS if name not in header_positions]
        if missing_columns:
            raise SystemExit(f"transactions.csv is missing required columns: {', '.join(missing_columns)}")
        positions = {name: header_positions[name] for name in TRANSACTION_FIELDS}
        txn_id_pos = header_positions["TransactionID"]
        customer_pos = header_positions["customer_id"]
        for values in reader:
            total_rows += 1
            if len(values) != len(header):
                raise SystemExit(f"Malformed transactions.csv row {total_rows + 1}: expected {len(header)} fields, found {len(values)}")
            transaction_id = values[txn_id_pos]
            customer_id = values[customer_pos]
            if customer_id in target_customers or transaction_id in relevant_ids or transaction_id in online_ids:
                item = compact_transaction(values, positions)
                if transaction_id in online_ids:
                    online_transactions[transaction_id] = {
                        key: item[key] for key in (
                            "transaction_id", "customer_id", "timestamp", "amount", "product_code",
                            "channel", "risk_score", "billing_region", "billing_country",
                            "purchaser_email", "recipient_email", "card_fingerprint",
                        )
                    }
                if customer_id in target_customers or transaction_id in relevant_ids:
                    if transaction_id in identities:
                        item["identity"] = identities[transaction_id]
                    relevant_transactions[transaction_id] = item
                    if customer_id in target_customers:
                        target_history[customer_id].append(item)
            if total_rows % 100_000 == 0:
                print(f"Read {total_rows:,} transactions", file=sys.stderr)

    if total_rows != 590_742:
        raise SystemExit(f"transactions.csv row-count check failed: expected 590,742, found {total_rows:,}")

    missing_flags = sorted(set(case_by_flag) - set(relevant_transactions))
    if missing_flags:
        raise SystemExit(f"Flagged transactions missing from transactions.csv: {', '.join(missing_flags)}")

    fingerprint_to_card: dict[str, str] = {}
    for case in cases:
        txn = relevant_transactions[case["flagged_txn_id"]]
        fingerprint_to_card[str(txn["card_fingerprint"])] = case["card_id"]
    for prior in history:
        txn = relevant_transactions.get(str(prior["first_fraud_txn_id"]))
        if txn:
            fingerprint_to_card[str(txn["card_fingerprint"])] = str(prior["card_id"])

    # Benchmark customers have their complete history, so assign remaining card
    # fingerprints deterministically while preserving every known K-number.
    for customer_id, rows in target_history.items():
        fingerprints = sorted({str(row["card_fingerprint"]) for row in rows})
        used = {
            integer(card.rsplit("-K", 1)[1])
            for fp, card in fingerprint_to_card.items()
            if fp.startswith(f"{customer_id}|") and "-K" in card
        }
        next_number = 1
        for fingerprint in fingerprints:
            if fingerprint in fingerprint_to_card:
                continue
            while next_number in used:
                next_number += 1
            fingerprint_to_card[fingerprint] = f"{customer_id}-K{next_number}"
            used.add(next_number)

    for transaction in relevant_transactions.values():
        transaction["card_id"] = fingerprint_to_card.get(str(transaction["card_fingerprint"]), "")
    for transaction in online_transactions.values():
        transaction["card_id"] = fingerprint_to_card.get(str(transaction["card_fingerprint"]), "")

    case_contexts = []
    for case in cases:
        flagged = relevant_transactions[case["flagged_txn_id"]]
        case_history = sorted(target_history[case["customer_id"]], key=lambda item: str(item["timestamp"]))
        identity = identities.get(case["flagged_txn_id"])
        connected: list[dict[str, object]] = []
        if identity and identity["device_id"]:
            for transaction_id in profile_transactions[str(identity["device_id"])]:
                txn = online_transactions.get(transaction_id)
                if txn and txn["customer_id"] != case["customer_id"]:
                    connected.append({**txn, "identity": identities.get(transaction_id)})
            connected.sort(key=lambda item: str(item["timestamp"]))

        scored_memory = []
        for prior in history:
            score = similarity_score(case, flagged, identity, prior, relevant_transactions, identities)
            if score > 0:
                scored_memory.append({**prior, "similarity_score": score})
        scored_memory.sort(key=lambda item: (-float(item["similarity_score"]), str(item["case_id"])))

        features = case_features(case, flagged, case_history, identity, connected)
        connected.sort(key=lambda item: abs((iso_date(str(item["timestamp"])) - iso_date(str(flagged["timestamp"]))).total_seconds()))

        case_contexts.append({
            "case": {
                **case,
                "risk_score": number(case["risk_score"], number(flagged["risk_score"])),
            },
            "flagged_transaction": flagged,
            "identity": identity,
            "customer_history": case_history,
            "shared_device_activity": connected[:250],
            "shared_device_activity_truncated": len(connected) > 250,
            "features": features,
            "similar_prior_cases": scored_memory[:12],
        })

    stats = {
        "transactions": total_rows,
        "identity_records": len(identities),
        "closed_cases": len(history),
        "benchmark_cases": len(cases),
        "closed_case_outcomes": dict(Counter(str(item["outcome"]) for item in history)),
        "closed_case_patterns": dict(Counter(str(item["pattern"]) for item in history)),
    }
    payload = {
        "schema_version": 1,
        "source": "HHGOA_IEEE",
        "stats": stats,
        "cases": case_contexts,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {output} ({output.stat().st_size:,} bytes)")
    print(json.dumps(stats, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    build(args.source.resolve(), args.output.resolve())


if __name__ == "__main__":
    main()

"""Stream HHGOA source CSVs into compact, reproducible TigerGraph load files."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CARD_FIELDS = [f"card{i}" for i in range(1, 7)]


def fingerprint(values: list[str], pos: dict[str, int]) -> str:
    return "|".join([values[pos["customer_id"]], *[values[pos[name]] for name in CARD_FIELDS]])


def device_profile(row: dict[str, str]) -> str:
    parts = [row.get(name, "") for name in ("DeviceInfo", "id_30", "id_31", "id_33")]
    return " | ".join(part or "unknown" for part in parts) if any(parts) else ""


def device_id(profile: str) -> str:
    return f"DVC-{hashlib.sha1(profile.encode('utf-8')).hexdigest()[:10].upper()}" if profile else ""


def read_rows(path: Path):
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        yield from csv.DictReader(stream)


def known_cards(source: Path) -> tuple[dict[str, str], list[dict[str, str]]]:
    transaction_cards: dict[str, str] = {}
    for row in read_rows(source / "case_pack.csv"):
        transaction_cards[row["flagged_txn_id"]] = row["card_id"]
    closed = list(read_rows(source / "closed_cases_history.csv"))
    for row in closed:
        for transaction_id in filter(None, row["txn_ids"].split("|")):
            transaction_cards[transaction_id] = row["card_id"]
        if row["first_fraud_txn_id"]:
            transaction_cards[row["first_fraud_txn_id"]] = row["card_id"]
    return transaction_cards, closed


def assign_cards(transactions: Path, transaction_cards: dict[str, str], limit: int | None):
    fingerprints_by_customer: dict[str, set[str]] = defaultdict(set)
    fingerprint_to_card: dict[str, str] = {}
    with transactions.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.reader(stream)
        header = next(reader)
        pos = {name: header.index(name) for name in ["TransactionID", "customer_id", *CARD_FIELDS]}
        for index, values in enumerate(reader, 1):
            if limit and index > limit:
                break
            customer = values[pos["customer_id"]]
            card_fingerprint = fingerprint(values, pos)
            fingerprints_by_customer[customer].add(card_fingerprint)
            known = transaction_cards.get(values[pos["TransactionID"]])
            if known:
                fingerprint_to_card[card_fingerprint] = known

    for customer, fingerprints in fingerprints_by_customer.items():
        used = {
            int(card.rsplit("-K", 1)[1]) for item, card in fingerprint_to_card.items()
            if item.startswith(f"{customer}|") and "-K" in card and card.rsplit("-K", 1)[1].isdigit()
        }
        next_number = 1
        for item in sorted(fingerprints):
            if item in fingerprint_to_card:
                continue
            while next_number in used:
                next_number += 1
            fingerprint_to_card[item] = f"{customer}-K{next_number}"
            used.add(next_number)
    return fingerprint_to_card


def open_writer(output: Path, name: str, header: list[str]):
    stream = (output / name).open("w", encoding="utf-8", newline="")
    writer = csv.writer(stream)
    writer.writerow(header)
    return stream, writer


def prepare(source: Path, output: Path, limit: int | None = None) -> dict[str, int]:
    required = ["transactions.csv", "identity.csv", "closed_cases_history.csv", "case_pack.csv"]
    missing = [name for name in required if not (source / name).exists()]
    if missing:
        raise SystemExit(f"Missing HHGOA source files: {', '.join(missing)}")
    output.mkdir(parents=True, exist_ok=True)
    transaction_cards, closed_cases = known_cards(source)
    fingerprint_to_card = assign_cards(source / "transactions.csv", transaction_cards, limit)

    definitions = {
        "transactions.csv": ["id", "ts", "amount", "product_code", "channel", "risk_score", "billing_country", "model_signals"],
        "owns.csv": ["customer_id", "card_id"],
        "made.csv": ["card_id", "transaction_id"],
        "purchaser_email.csv": ["transaction_id", "email"],
        "recipient_email.csv": ["transaction_id", "email"],
        "billed_in.csv": ["transaction_id", "region_id"],
        "next.csv": ["from_id", "to_id", "elapsed_seconds"],
    }
    handles = {}
    writers = {}
    for name, header in definitions.items():
        handles[name], writers[name] = open_writer(output, name, header)

    customer_stats: dict[str, dict] = {}
    card_stats: dict[str, dict] = {}
    emails: set[str] = set()
    regions: dict[str, str] = {}
    emitted_transactions: set[str] = set()
    last_by_card: dict[str, tuple[str, str]] = {}
    owns: set[tuple[str, str]] = set()

    with (source / "transactions.csv").open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.reader(stream)
        header = next(reader)
        needed = ["TransactionID", "TransactionAmt", "ProductCD", "addr1", "addr2", "P_emaildomain", "R_emaildomain", "customer_id", "ts", "channel", "risk_score", *CARD_FIELDS]
        pos = {name: header.index(name) for name in needed}
        for index, values in enumerate(reader, 1):
            if limit and index > limit:
                break
            transaction_id = values[pos["TransactionID"]]
            customer = values[pos["customer_id"]]
            timestamp = values[pos["ts"]]
            card_fingerprint = fingerprint(values, pos)
            card = fingerprint_to_card[card_fingerprint]
            product = values[pos["ProductCD"]]
            risk_score = values[pos["risk_score"]] or "0"
            writers["transactions.csv"].writerow([transaction_id, timestamp, values[pos["TransactionAmt"]] or 0, product, values[pos["channel"]], risk_score, values[pos["addr2"]], f"risk_score={risk_score}"])
            writers["made.csv"].writerow([card, transaction_id])
            if (customer, card) not in owns:
                writers["owns.csv"].writerow([customer, card])
                owns.add((customer, card))
            emitted_transactions.add(transaction_id)

            customer_item = customer_stats.setdefault(customer, {"count": 0, "first": timestamp, "last": timestamp})
            customer_item["count"] += 1
            customer_item["first"] = min(customer_item["first"], timestamp)
            customer_item["last"] = max(customer_item["last"], timestamp)
            card_item = card_stats.setdefault(card, {"fingerprint": card_fingerprint, "products": set(), "count": 0, "first": timestamp, "last": timestamp})
            card_item["products"].add(product)
            card_item["count"] += 1
            card_item["first"] = min(card_item["first"], timestamp)
            card_item["last"] = max(card_item["last"], timestamp)

            for column, filename in (("P_emaildomain", "purchaser_email.csv"), ("R_emaildomain", "recipient_email.csv")):
                email = values[pos[column]]
                if email:
                    emails.add(email)
                    writers[filename].writerow([transaction_id, email])
            region = values[pos["addr1"]]
            if region:
                region_id = f"REGION-{region}"
                regions[region_id] = values[pos["addr2"]]
                writers["billed_in.csv"].writerow([transaction_id, region_id])
            previous = last_by_card.get(card)
            if previous and timestamp:
                elapsed = max(0, int((datetime.fromisoformat(timestamp) - datetime.fromisoformat(previous[1])).total_seconds()))
                writers["next.csv"].writerow([previous[0], transaction_id, elapsed])
            if timestamp:
                last_by_card[card] = (transaction_id, timestamp)

    for stream in handles.values():
        stream.close()

    stream, writer = open_writer(output, "customers.csv", ["id", "transaction_count", "first_seen", "last_seen"])
    for item_id, item in sorted(customer_stats.items()):
        writer.writerow([item_id, item["count"], item["first"], item["last"]])
    stream.close()
    stream, writer = open_writer(output, "cards.csv", ["id", "fingerprint", "product_codes", "transaction_count", "first_seen", "last_seen"])
    for item_id, item in sorted(card_stats.items()):
        writer.writerow([item_id, item["fingerprint"], "|".join(sorted(item["products"])), item["count"], item["first"], item["last"]])
    stream.close()
    stream, writer = open_writer(output, "email_domains.csv", ["id"])
    for item in sorted(emails):
        writer.writerow([item])
    stream.close()
    stream, writer = open_writer(output, "billing_regions.csv", ["id", "country"])
    for item_id, country in sorted(regions.items()):
        writer.writerow([item_id, country])
    stream.close()

    stream, writer = open_writer(output, "devices.csv", ["id", "profile", "device_info", "operating_system", "browser", "screen"])
    edge_stream, edge_writer = open_writer(output, "from_device.csv", ["transaction_id", "device_id", "device_status", "proxy"])
    seen_devices: set[str] = set()
    for row in read_rows(source / "identity.csv"):
        if row["TransactionID"] not in emitted_transactions:
            continue
        profile = device_profile(row)
        item_id = device_id(profile)
        if not item_id:
            continue
        if item_id not in seen_devices:
            writer.writerow([item_id, profile, row.get("DeviceInfo", ""), row.get("id_30", ""), row.get("id_31", ""), row.get("id_33", "")])
            seen_devices.add(item_id)
        edge_writer.writerow([row["TransactionID"], item_id, row.get("id_15", ""), row.get("id_23", "")])
    stream.close()
    edge_stream.close()

    stream, writer = open_writer(output, "closed_cases.csv", ["id", "opened_at", "closed_at", "outcome", "pattern", "exposure_usd", "report_filed", "analyst_notes"])
    involves_stream, involves = open_writer(output, "closed_case_involves.csv", ["case_id", "transaction_id"])
    cards_stream, on_card = open_writer(output, "closed_case_cards.csv", ["case_id", "card_id", "reason"])
    for row in closed_cases:
        writer.writerow([row["case_id"], row["opened_at"], row["closed_at"], row["outcome"], row["pattern"], row["exposure_usd"] or 0, str(row["report_filed"].lower() == "yes").lower(), row["analyst_notes"]])
        for transaction_id in filter(None, row["txn_ids"].split("|")):
            if transaction_id in emitted_transactions:
                involves.writerow([row["case_id"], transaction_id])
        on_card.writerow([row["case_id"], row["card_id"], "subject_card"])
        for card in filter(None, row["connected_card_ids"].split("|")):
            on_card.writerow([row["case_id"], card, "connected_card"])
    stream.close()
    involves_stream.close()
    cards_stream.close()

    stats = {
        "transactions": len(emitted_transactions),
        "customers": len(customer_stats),
        "cards": len(card_stats),
        "devices": len(seen_devices),
        "closed_cases": len(closed_cases),
    }
    (output / "manifest.json").write_text(json.dumps(stats, indent=2) + "\n", encoding="utf-8")
    return stats


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=ROOT / "docs")
    parser.add_argument("--output", type=Path, default=ROOT / "data" / "tigergraph")
    parser.add_argument("--limit", type=int, help="Prepare only the first N transactions for a smoke test")
    args = parser.parse_args()
    stats = prepare(args.source, args.output, args.limit)
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()


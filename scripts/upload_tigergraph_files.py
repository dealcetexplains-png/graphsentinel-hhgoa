"""Upload the reproducible HHGOA CSV load files to a Savanna loading job.

Requires a local .env.local containing TIGERGRAPH_HOST, TIGERGRAPH_GRAPH and
TIGERGRAPH_TOKEN. The file is ignored by Git and must never be committed.
"""

from __future__ import annotations

import os
import sys
import csv
import argparse
from pathlib import Path

from pyTigerGraph import TigerGraphConnection


ROOT = Path(__file__).resolve().parents[1]
FILES = {
    "f_customers": "customers.csv", "f_cards": "cards.csv", "f_transactions": "transactions.csv",
    "f_devices": "devices.csv", "f_emails": "email_domains.csv", "f_regions": "billing_regions.csv",
    "f_owns": "owns.csv", "f_made": "made.csv", "f_from_device": "from_device.csv",
    "f_purchaser_email": "purchaser_email.csv", "f_recipient_email": "recipient_email.csv",
    "f_billed_in": "billed_in.csv", "f_next": "next.csv", "f_closed_cases": "closed_cases.csv",
    "f_closed_involves": "closed_case_involves.csv", "f_closed_cards": "closed_case_cards.csv",
}


def load_env(path: Path) -> None:
    for raw in path.read_text(encoding="utf-8").splitlines():
        if "=" in raw and not raw.lstrip().startswith("#"):
            key, value = raw.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--resume", action="store_true", help="skip the customers and cards already loaded")
    parser.add_argument("--rows-per-upload", type=int, default=25000)
    args = parser.parse_args()
    load_env(ROOT / ".env.local")
    host = os.environ["TIGERGRAPH_HOST"]
    graph = os.environ["TIGERGRAPH_GRAPH"]
    token = os.environ["TIGERGRAPH_TOKEN"]
    if token == "__PENDING_TOKEN__":
        raise SystemExit("TIGERGRAPH_TOKEN is not configured.")
    connection = TigerGraphConnection(host=host, graphname=graph, apiToken=token, tgCloud=True)
    items = list(FILES.items())
    if args.resume:
        items = items[2:]
    for tag, filename in items:
        path = ROOT / "data" / "tigergraph" / filename
        chunk_dir = ROOT / "tmp" / "tigergraph-chunks" / tag
        chunk_dir.mkdir(parents=True, exist_ok=True)
        chunks = sorted(chunk_dir.glob("*.csv"))
        if not chunks:
            with path.open("r", encoding="utf-8", newline="") as source:
                reader = csv.reader(source)
                header = next(reader)
                index = 0
                rows = []
                for row in reader:
                    rows.append(row)
                    if len(rows) == args.rows_per_upload:
                        with (chunk_dir / f"{index:05d}.csv").open("w", encoding="utf-8", newline="") as target:
                            writer = csv.writer(target); writer.writerow(header); writer.writerows(rows)
                        rows = []; index += 1
                if rows:
                    with (chunk_dir / f"{index:05d}.csv").open("w", encoding="utf-8", newline="") as target:
                        writer = csv.writer(target); writer.writerow(header); writer.writerows(rows)
            chunks = sorted(chunk_dir.glob("*.csv"))
        for index, chunk in enumerate(chunks, 1):
            print(f"Uploading {filename} ({index}/{len(chunks)})...", flush=True)
            result = connection.runLoadingJobWithFile(str(chunk), tag, "load_hhgoa", timeout=0)
            if not result or (isinstance(result, dict) and result.get("error")):
                raise RuntimeError(f"{filename} chunk {index} failed: {result}")
        print(f"Loaded {filename}", flush=True)
    print("PASS: all HHGOA graph files loaded", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"FAILED: {error}", file=sys.stderr, flush=True)
        raise

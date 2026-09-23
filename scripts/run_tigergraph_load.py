"""Run the HHGOA TigerGraph loading job against files prepared locally."""

from __future__ import annotations

import argparse
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FILES = {
    "f_customers": "customers.csv", "f_cards": "cards.csv", "f_transactions": "transactions.csv",
    "f_devices": "devices.csv", "f_emails": "email_domains.csv", "f_regions": "billing_regions.csv",
    "f_owns": "owns.csv", "f_made": "made.csv", "f_from_device": "from_device.csv",
    "f_purchaser_email": "purchaser_email.csv", "f_recipient_email": "recipient_email.csv",
    "f_billed_in": "billed_in.csv", "f_next": "next.csv", "f_closed_cases": "closed_cases.csv",
    "f_closed_involves": "closed_case_involves.csv", "f_closed_cards": "closed_case_cards.csv",
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=ROOT / "data" / "tigergraph")
    parser.add_argument("--gsql", default="gsql")
    args = parser.parse_args()
    missing = [name for name in FILES.values() if not (args.data / name).exists()]
    if missing:
        raise SystemExit(f"Prepare load data first. Missing: {', '.join(missing)}")
    assignments = ", ".join(f'{variable}="{(args.data / filename).resolve().as_posix()}"' for variable, filename in FILES.items())
    command = f"USE GRAPH GraphSentinel\nRUN LOADING JOB load_hhgoa USING {assignments}\n"
    with tempfile.NamedTemporaryFile("w", suffix=".gsql", encoding="utf-8", delete=False) as stream:
        stream.write(command)
        command_file = Path(stream.name)
    try:
        subprocess.run([args.gsql, str(command_file)], check=True)
    finally:
        command_file.unlink(missing_ok=True)


if __name__ == "__main__":
    main()

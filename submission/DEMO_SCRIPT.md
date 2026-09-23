# GraphSentinel three-minute demo script

## 0:00–0:35 — Problem and case

“Fraud alerts usually arrive as disconnected signals. GraphSentinel connects the transaction to the customer, card, device, region, email domains, and resolved cases before recommending an action.”

Open **HHG-014**. Point out the low-level alert and the connected investigation graph.

## 0:35–1:25 — Run the investigation

Select **Run agent**.

“The deterministic layer retrieves graph context, calculates exposure, detects patterns, and searches case memory. The model layer explains the evidence and votes on useful read-only tools. It cannot execute actions or change approval rules.”

Show the trace and model consensus panel.

## 1:25–2:05 — Decision and guardrail

“The shared device links activity across unrelated customers. The episode contains 40 transactions, $6,214.17 in exposure, and 12 connected cards. Policy R6 and R9 require a case, connected-card monitoring, escalation, and a suspicious activity report.”

Point to the L2 approval marker. Explain that the model can recommend the filing, but a fraud manager must approve it.

## 2:05–2:40 — Deliverable

Open the **SAR** section, then **Complete JSON**.

“The dashboard contains the standalone regulatory narrative and the exact three-part HHGOA answer: internal case, SAR, and next best actions.”

## 2:40–3:00 — Case memory

Show the new `InvestigationCase` in TigerGraph.

“After TigerGraph accepts the atomic write, the case becomes memory for future investigations. The submission includes full loading scripts, live query tests, case writeback tests, and 20 validated answer files.”


# GraphSentinel submission checklist

## Required technical checks

- [ ] Revoked every API key previously pasted into chat and created fresh keys.
- [ ] Stored fresh keys only in a local secret store or `.env.local`.
- [ ] Loaded the full HHGOA graph using `npm run graph:prepare`, `tigergraph/schema.gsql`, `tigergraph/loading.gsql`, and `npm run graph:load`.
- [ ] Installed `tigergraph/queries.gsql`.
- [ ] Set `DEMO_MODE=false` and confirmed `GET /api/health` reports TigerGraph `live`.
- [ ] Ran `npm run test:tigergraph:live` successfully.
- [ ] Ran `npm run submission:live`; all 20 cases wrote to TigerGraph.
- [ ] Validated live files with `npm run submission:validate-live`.
- [ ] Ran `npm test`, `npm run data:validate`, and `npm run build`.

## Demo checks

- [ ] HHG-001 demonstrates a legitimate decision and no SAR.
- [ ] HHG-014 demonstrates shared-device fraud, connected cards, an SAR, and case writeback.
- [ ] The model panel explains evidence and proposes only read-only allowlisted tools.
- [ ] Restricted actions visibly require deterministic L1/L2 approval.
- [ ] The SAR and Complete JSON tabs are visible.
- [ ] A written `InvestigationCase` can be retrieved from TigerGraph.

## Upload checks

- [ ] No `.env`, `.env.local`, tokens, API keys, dataset CSVs, `node_modules`, or temporary files.
- [ ] Exactly 20 JSON answers are present in the submitted `output/hhgoa/cases` folder.
- [ ] README setup commands were tested on a clean machine or fresh directory.
- [ ] Submission archive checksum matches `submission/GraphSentinel-HHGOA.zip.sha256`.
- [ ] Repository/ZIP, slides, and demo video are uploaded before the deadline.


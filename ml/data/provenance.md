# Hybrid Dataset Provenance

- External ServiceNow incident snapshots: 6,000.
- Simulated ContractorLink records: 6,000.
- Total records: 12,000.
- Breach outcomes: 1,530.

I use the simulated records to represent service scenarios in ContractorLink. The dataset is still imbalanced: 1,530 of the 12,000 records have a breach label, and all of those labels come from the simulated portion.

The external records are sampled initial snapshots from the UCI Incident Management Process Enriched Event Log (https://doi.org/10.24432/C57S4H). Their labels use the initial `made_sla` value, rather than the final incident outcome. SLA targets are assigned from priority. The preparation script uses seed 42 for repeatable sampling and simulation.

There are 6,227 duplicate rows across the retained columns. Original incident identifiers are not included, so this CSV alone cannot establish whether matching records belong to independent incidents. I discuss this limitation in the Colab notebook and treat the model results as a dataset experiment, rather than evidence of performance in a real organization.

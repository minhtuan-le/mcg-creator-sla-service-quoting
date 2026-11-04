# MCG Creator SLA Service Quoting

Source tracking for the SLA Service Quoting pages in Zoho Creator.

## Structure

- `pages/` – HTML snippet wrappers from the **crm-homepage** app. Each page embeds a page from the **recurring-invoice-report** app.
- `widgets/` – Widget source downloaded from **recurring-invoice-report** (Settings → Widgets).

## Page → widget map

| Page (crm-homepage)                  | Widget (recurring-invoice-report) | Folder                               |
|--------------------------------------|-----------------------------------|--------------------------------------|
| 1. Existing Services & Risk Analysis | Existing Services Risk Widget (v26) | `widgets/existing-services-risk`   |
| 2. Client Service & Quotation        | SLA Services Tracking Widget (client_service v21) | `widgets/sla-services-tracking` |
| 3. Missing Services & Proposals      | Missing Services Proposals (v25)  | `widgets/missing-services-proposals` |
| 4. Quote Finalisation                | Quote Finalisation Widget (v20)   | `widgets/quote-finalisation`         |
| 5. Saved Works                       | Created Work (v3)                 | `widgets/created-work`               |
| –                                    | Import Raw Data                   | `widgets/import-raw-data`            |
| –                                    | "adad" in crm-homepage (client_service v17, older copy) | `widgets/client-service-quotation` |

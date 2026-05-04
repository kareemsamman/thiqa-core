# Bulk import old policies for agent THQ-4XTZ

Agent confirmed: `ali masri` / `ali.masri.22@gmail.com` / short_code `THQ-4XTZ` / id `6a2e7957-1444-4cb2-a6f8-abc104003fa0`. All inserts will be scoped to this `agent_id`.

## What I need from you before starting

**Please upload the Excel file.** It was mentioned but I don't see it attached. Once uploaded I will:
1. Parse the file with the column mapping you gave (A+B = name, C = id, F = phone, dates, prices, packages, payment columns, services column with codes ج/ש/רח, etc.).
2. Show you the first 5 parsed rows for confirmation before any insert.

## Column mapping (from your message)

| Col | Field |
|---|---|
| A + B | client.full_name (شم פרטי + שם משפחה) |
| C | client.id_number |
| F | client.phone_number |
| (dates cols) | policy.start_date / end_date / issue_date (DD MM YYYY) |
| car number col | cars.car_number → enrich via `fetch-vehicle` API |
| company col | insurance_companies.name (تيك تاك = tik tak, etc.) |
| price col | policy.insurance_price |
| paid col ("שולם 5400") | policy_payments row, type = cash (default) |
| T | package addon flag — if `אין` skip, else create THIRD_FULL or package |
| services col | codes ג=جرار, ש=زجاج, רח=سيارة بديلة → road_services rows, all priced 0 |

If a column doesn't exist in a row → leave field null and add to a "manual fill" report at the end.

## Import logic

1. **Resolve agent** → use `id = 6a2e7957-1444-4cb2-a6f8-abc104003fa0`.
2. **Client**: lookup by `(agent_id, id_number)`. If exists → reuse. If not → insert.
3. **Car**: lookup by `(agent_id, car_number)`. If not exists → call `fetch-vehicle` edge function with the plate; insert with returned manufacturer/model/year/color/car_type. If API returns nothing → insert row with only car_number + client_id and add to manual-fill report.
4. **Insurance company**: lookup by `(agent_id, name)` per company in the sheet. If `تيك تاك` / `tik tak` doesn't exist → insert it. Same for any other missing company.
5. **Road services**: ensure 3 services exist for this agent: `زجاج`, `جرار`, `سيارة بديلة`. Insert if missing. Price = 0.
6. **Policy**: insert one row per Excel row. `policy_type_parent` chosen from the columns:
   - main car policy (ELZAMI/THIRD_FULL) per row
   - if T column ≠ `אين` → also insert package addon policies (ROAD_SERVICE entries with the codes from the services column, all price 0)
   - **No ELZAMI inserts** (per your instruction "no need for the elzami").
   - `cancelled = false`, `transferred = false`.
7. **Payment**: if a "שולם X" amount is present → insert one `policy_payments` row, type `cash`, amount = X, date = policy.start_date. Remaining (price − paid) stays as debt automatically (no extra row needed).
8. **No SMS**: do NOT trigger any SMS. I'll bypass any SMS triggers by inserting directly via service-role edge function (no automated_sms_log writes).
9. **No signatures**: don't insert into `customer_signatures`.

## How it will run technically

- Create a one-off edge function `import-thq-4xtz-policies` (service role, super-admin only) that:
  - accepts the parsed JSON rows
  - performs the lookup/insert logic above in dependency order
  - calls `fetch-vehicle` internally for each unique car number
  - returns per-row status (`inserted` / `skipped-duplicate` / `manual-fill-needed` with reason)
- I parse the Excel locally (`/tmp`), POST rows to the function in batches of 50.
- At the end I produce `/mnt/documents/thq-4xtz-import-report.xlsx` with: rows inserted, duplicates skipped, cars needing manual fill, any errors.

## Safety guarantees

- Scoped strictly to `agent_id = 6a2e7957-1444-4cb2-a6f8-abc104003fa0`. No other agent touched.
- Idempotent: re-running won't duplicate clients/cars/companies (uses lookup-then-insert).
- No SMS, no signature requests, no notifications.
- Dry-run first: I'll process the first 3 rows and show you the result for approval before running the full file.

## Next step

Approve this plan, then upload the Excel file. I will:
1. Parse and show first 5 rows mapped.
2. Build the edge function.
3. Run dry-run on 3 rows → you confirm.
4. Run full import → deliver report.

How to update your Excel with refund/follow-up rows

1) Place your `KTA Database.xlsx` file in the project root (same folder as `package.json`).

2) Install dependency:

```bash
npm install xlsx
```

3) Run the script to append a refund/follow-up row. Example:

```bash
node scripts/update_refunds.js --file "KTA Database.xlsx" --student E005 --subject Maths --status "follow-up" --note "11-day follow-up requested" --out "KTA Database.updated.xlsx"
```

4) The script will create `KTA Database.updated.xlsx` with a `Refunds` sheet (created if missing) and the appended row.

If you prefer, upload the original file here and I will run the script and return the updated file for you.
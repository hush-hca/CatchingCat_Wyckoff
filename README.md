# Catching Cat

A dependency-free market navigator for manually executed altcoin trades. It implements the supplied product specification as an interactive dashboard with:

- Binance Futures public price polling with a resilient demo fallback
- Priority opportunities and Wyckoff phase labels
- Relative-volume “Volume Fire” ranking
- Auto-mapped PS, SC, AR, ST, Spring, Test, and SOS chart annotations
- Discipline monitor and mechanical trading reminders
- Four-rule pre-trade clearance flow
- Persistent scanner threshold setting

## Run

From this folder:

```powershell
node scripts/dev-server.cjs
```

Then open `http://127.0.0.1:4173`.

No account credentials are used and no trades are executed.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const frontendRoot = fileURLToPath(new URL("../", import.meta.url));
const fixtures = [
  {
    path: "lib/detailsDemo.ts",
    requiredPatterns: [
      /SYNTHETIC_DATA_ONLY/,
    ],
    fieldPrefixes: {
      conid: "demo-contract-",
      originating_order_id: "demo-order-",
      originating_transaction_id: "demo-transaction-",
    },
  },
  {
    path: "components/TradesView.tsx",
    requiredPatterns: [/SYNTHETIC_DATA_ONLY/],
    fieldPrefixes: { transaction_id: "synthetic-trade-" },
  },
  {
    path: "components/CashView.tsx",
    requiredPatterns: [/SYNTHETIC_DATA_ONLY/],
    fieldPrefixes: { related_trade_id: "synthetic-trade-" },
  },
];

const forbiddenProvenance = [
  /pulled from (?:the )?server database/i,
  /pulled from production/i,
  /production trades/i,
  /account(?:'s)? (?:actual|real) (?:activity|liquidity)/i,
  /derived from (?:an|the) account/i,
];

const failures = [];

for (const fixture of fixtures) {
  const source = readFileSync(new URL(fixture.path, `file://${frontendRoot}/`), "utf8");

  for (const pattern of fixture.requiredPatterns) {
    pattern.lastIndex = 0;
    if (!pattern.test(source)) {
      failures.push(`${fixture.path}: missing required synthetic-data marker ${pattern}`);
    }
  }

  for (const pattern of forbiddenProvenance) {
    if (pattern.test(source)) {
      failures.push(`${fixture.path}: contains forbidden production-data provenance ${pattern}`);
    }
  }

  for (const [field, prefix] of Object.entries(fixture.fieldPrefixes ?? {})) {
    const values = [...source.matchAll(new RegExp(`${field}:\\s*"([^"]+)"`, "g"))].map((match) => match[1]);
    if (values.length === 0) {
      failures.push(`${fixture.path}: expected at least one ${field} fixture value`);
      continue;
    }
    for (const value of values) {
      if (!value.startsWith(prefix)) {
        failures.push(`${fixture.path}: ${field} must use the ${prefix} synthetic namespace`);
      }
    }
  }

  if (fixture.path === "lib/detailsDemo.ts" && /"\d{9,}"/.test(source)) {
    failures.push(`${fixture.path}: contains a long numeric identifier that could be brokerage-derived`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Demo-data fixtures are explicitly synthetic.");

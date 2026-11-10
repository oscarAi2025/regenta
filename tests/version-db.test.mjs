import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { MIGRACION_ESPERADA } from "../src/lib/version-db.ts";

test("la migración esperada por el código es la última de db/migrations", () => {
  const ultima = readdirSync(new URL("../db/migrations/", import.meta.url)).filter((f) => /^\d{3}.*\.sql$/.test(f)).sort().at(-1);
  assert.equal(MIGRACION_ESPERADA, ultima);
});

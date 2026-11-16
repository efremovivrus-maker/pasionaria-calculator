import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function latestSaveFunction(): string {
  const directory = path.resolve(process.cwd(), "../supabase/migrations");
  const sources = readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(path.join(directory, name), "utf8"));
  const combined = sources.join("\n");
  const matches = [...combined.matchAll(/create or replace function public\.save_account_proposal\([\s\S]*?\$\$;/g)];
  return matches.at(-1)?.[0] ?? "";
}

describe("proposal save sql", () => {
  it("does not let the proposal_id argument collide with the item column", () => {
    const fn = latestSaveFunction();
    expect(fn).toContain("existing_items.proposal_id = saved.id");
    expect(fn).toContain("existing_refs.proposal_id = saved.id");
    expect(fn).not.toMatch(/delete from public\.proposal_items where proposal_id/);
    expect(fn).not.toMatch(/delete from public\.proposal_file_refs where proposal_id/);
    expect(fn).toContain("item_position");
    expect(fn).not.toMatch(/^\s*position integer/m);
  });
});

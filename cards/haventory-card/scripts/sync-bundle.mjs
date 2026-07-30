// Copy the freshly built card next to the integration that ships it.
//
// HACS installs an Integration-category repository by copying
// `custom_components/<domain>/` and nothing else, so the card has to live there
// or it never reaches a user's disk. `cards/www/haventory/` stays the build
// output the dev deploy path reads; this is the tracked copy that travels with
// the integration, and `async_setup_entry` puts it in `config/www/` at runtime.
//
// The copy is checked in, so it can go stale against the source. CI rebuilds and
// fails on any diff — see the `frontend` job.

import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const built = path.join(repoRoot, "cards", "www", "haventory", "haventory-card.js");
const shipped = path.join(repoRoot, "custom_components", "haventory", "haventory-card.js");

mkdirSync(path.dirname(shipped), { recursive: true });
copyFileSync(built, shipped);
console.log(`synced ${(readFileSync(shipped).length / 1024).toFixed(0)} KiB -> custom_components/haventory/haventory-card.js`);

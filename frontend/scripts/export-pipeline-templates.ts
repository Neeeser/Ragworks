/**
 * Write the shipped create-pipeline templates to the backend test assets.
 *
 * Run `npm run export:templates` after changing a template — the vitest guard
 * in `pipeline-templates.test.ts` fails while the committed asset is stale,
 * and the pytest guard validates whatever it holds.
 */
import { writeFileSync } from "node:fs";

import { serializeTemplates, TEMPLATE_ASSET_PATH } from "./pipeline-template-export";

writeFileSync(TEMPLATE_ASSET_PATH, serializeTemplates());

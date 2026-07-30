// download-openai-model-bundle.mjs
//
// Regenerates app/providers/openai_model_bundle.json from first-party data:
// the account's `GET /v1/models` listing crossed with OpenAI's own per-model
// docs pages (platform.openai.com/docs/models/<id>.md), which publish the
// capabilities the API itself does not (context window, max output tokens,
// reasoning support, endpoints, deprecation).
//
// Usage: OPENAI_API_KEY=sk-... node scripts/download-openai-model-bundle.mjs
// (falls back to OPENAI_API_KEY from .env.sandbox at the repo root).
// The output is committed — run `make refresh-openai-bundle`, review the
// diff, and let the guard test (tests/providers/test_openai_bundle.py)
// validate the shape.

import fs from "node:fs/promises";
import path from "node:path";

const REPO_ROOT = path.join(import.meta.dirname, "..");
const OUT_PATH = path.join(REPO_ROOT, "app", "providers", "openai_model_bundle.json");
const DOCS_BASE = "https://platform.openai.com/docs/models";
const API_BASE = "https://api.openai.com/v1";

const FETCH_HEADERS = {
    "user-agent": "ragworks-openai-bundle/1.0 (+local metadata refresh script)",
};

/** A dated snapshot id maps onto its base model's docs page. */
const SNAPSHOT_SUFFIX = /-\d{4}-\d{2}-\d{2}$/;

/**
 * Price ceiling for the sampling probe, in USD per million tokens.
 *
 * Set at the top of the standard tier, which excludes the research and `-pro`
 * models (from $40 to $600 per million output). The spend it admits is
 * fractions of a cent: a rejected probe bills nothing at all, and an accepted
 * one is 16 output tokens — under $0.0005 even at the ceiling.
 *
 * Reaching the whole standard tier matters because the probe answers two
 * questions, and the second one is load-bearing. `gpt-5.6-terra` and
 * `gpt-5.6-sol` accept `reasoning.effort: none` without their docs pages
 * saying so; unmeasured, the app leaves them reasoning and every sampling
 * knob it offers them fails.
 *
 * A model priced above this, or one whose page states no price, is left
 * unprobed and records `sampling: null` — read as unknown and treated
 * permissively, the same fallback any model OpenAI ships after this bundle
 * gets. Permissive is the safe direction: a knob the model rejects comes back
 * naming the field, where hiding one the model accepts cannot be undone.
 */
const MAX_PROBE_INPUT_USD_PER_M = 5;
const MAX_PROBE_OUTPUT_USD_PER_M = 30;

/** A model that has not answered by now is not worth waiting on. */
const PROBE_TIMEOUT_MS = 30_000;

function parsePricing(text) {
    const section = text.match(/### Text tokens\n([\s\S]*?)(\n### |\n## |$)/);
    if (!section) return { input: null, output: null };
    const price = (metric) => {
        const match = section[1].match(new RegExp(`\\| ${metric} \\| \\$([\\d.]+) \\|`));
        return match ? Number(match[1]) : null;
    };
    return { input: price("Input"), output: price("Output") };
}

/** True when the probe may call this model without meaningful spend. */
function affordableToProbe(pricing) {
    if (pricing.input === null || pricing.output === null) return false;
    return (
        pricing.input <= MAX_PROBE_INPUT_USD_PER_M &&
        pricing.output <= MAX_PROBE_OUTPUT_USD_PER_M
    );
}

async function apiKey() {
    if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
    try {
        const env = await fs.readFile(path.join(REPO_ROOT, ".env.sandbox"), "utf8");
        const line = env.split("\n").find((l) => l.startsWith("OPENAI_API_KEY="));
        if (line) return line.slice("OPENAI_API_KEY=".length).trim();
    } catch {
        // fall through to the error below
    }
    throw new Error("OPENAI_API_KEY is not set (env or .env.sandbox)");
}

async function listModelIds(key) {
    const res = await fetch(`${API_BASE}/models`, {
        headers: { authorization: `Bearer ${key}`, ...FETCH_HEADERS },
    });
    if (!res.ok) throw new Error(`GET /v1/models -> ${res.status}`);
    const body = await res.json();
    return body.data.map((m) => m.id).sort();
}

async function fetchDocsPage(baseId) {
    const res = await fetch(`${DOCS_BASE}/${baseId}.md`, {
        headers: FETCH_HEADERS,
        redirect: "follow",
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`docs page for ${baseId} -> ${res.status}`);
    const text = await res.text();
    // The docs host answers unknown ids with a redirect to an HTML shell
    // rather than a 404; a page without the model-details heading is a miss.
    if (!text.includes("## Model details")) return null;
    return text;
}

function parseNumber(text, pattern) {
    const match = text.match(pattern);
    if (!match) return null;
    return Number(match[1].replaceAll(",", ""));
}

function parseModalities(text, direction) {
    const match = text.match(new RegExp(`- ${direction} modalities: ([^\\n]+)`));
    if (!match) return ["text"];
    return match[1].split(",").map((m) => m.trim());
}

function parseEndpoints(text) {
    const supported = {};
    for (const row of text.matchAll(/\| ([^|]+) \| `v1\/([^`]+)` \| (Supported|Not supported) \|/g)) {
        supported[row[2]] = row[3] === "Supported";
    }
    return {
        chat_completions: supported["chat/completions"] ?? false,
        responses: supported["responses"] ?? false,
        embeddings: supported["embeddings"] ?? false,
    };
}

function parseFeatures(text) {
    const section = text.match(/## Supported features\n([\s\S]*?)(\n## |$)/);
    if (!section) return [];
    return [...section[1].matchAll(/^- ([a-z_]+)$/gm)].map((m) => m[1]);
}

function parseSnapshots(text) {
    const section = text.match(/## Snapshots\n([\s\S]*?)(\n## |$)/);
    if (!section) return [];
    return [...section[1].matchAll(/^- `([^`]+)`$/gm)].map((m) => m[1]);
}

function parseReasoningEfforts(text) {
    // Stated in prose, e.g. "Reasoning.effort supports: none (default), low,
    // medium, high and xhigh." — only reasoning models carry the sentence.
    const match = text.match(/Reasoning\.effort supports:? ([^.]+)\./i);
    if (!match) return null;
    const efforts = [...match[1].matchAll(/\b(none|minimal|low|medium|high|xhigh)\b/g)].map(
        (m) => m[1],
    );
    return efforts.length > 0 ? efforts : null;
}

function parsePage(text) {
    const features = parseFeatures(text);
    return {
        display_name: text.match(/^# (.+)$/m)?.[1] ?? null,
        context_window: parseNumber(text, /- ([\d,]+) context window/),
        max_output_tokens: parseNumber(text, /- ([\d,]+) max output tokens/),
        input_modalities: parseModalities(text, "Input"),
        output_modalities: parseModalities(text, "Output"),
        knowledge_cutoff: text.match(/- (.+) knowledge cutoff/)?.[1] ?? null,
        reasoning: /- Reasoning token support/.test(text),
        reasoning_efforts: parseReasoningEfforts(text),
        endpoints: parseEndpoints(text),
        function_calling: features.includes("function_calling"),
        structured_outputs: features.includes("structured_outputs"),
        streaming: features.includes("streaming"),
        deprecated: /^> Deprecated\b/m.test(text) || /^Deprecated\b/m.test(text),
        snapshots: parseSnapshots(text),
        pricing: parsePricing(text),
    };
}

/**
 * Measure whether a reasoning model still accepts sampling knobs.
 *
 * The docs never state this, and it is not derivable from the model's name:
 * gpt-5.4 accepts `temperature` while gpt-5.5 does not, and gpt-5 never does.
 * What does predict it is whether the model accepts `reasoning.effort: none`
 * — a model that can be asked not to reason takes the knobs while it isn't,
 * and a model that always reasons never takes them.
 *
 * One request answers both questions, because the rejection names the field
 * it rejected: `reasoning.effort` means `none` is unavailable (so the model
 * always reasons), `temperature` means it reasons anyway. `temperature`,
 * `top_p`, and `top_logprobs` were verified to move as one group, so probing
 * one covers all three.
 */
async function probeSampling(key, modelId) {
    let response;
    try {
        response = await fetch(`${API_BASE}/responses`, {
            method: "POST",
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
            headers: {
                authorization: `Bearer ${key}`,
                "content-type": "application/json",
                ...FETCH_HEADERS,
            },
            body: JSON.stringify({
                model: modelId,
                input: "hi",
                max_output_tokens: 16,
                store: false,
                temperature: 0.3,
                reasoning: { effort: "none" },
            }),
        });
    } catch {
        return { sampling: null, supportsNoEffort: false };
    }
    if (response.ok) return { sampling: "without_reasoning", supportsNoEffort: true };
    if (response.status !== 400) {
        // 404 (no access), 429, or an outage: record nothing rather than a guess.
        return { sampling: null, supportsNoEffort: false };
    }
    const body = await response.json().catch(() => ({}));
    const param = body?.error?.param ?? "";
    return {
        sampling: "never",
        supportsNoEffort: !param.startsWith("reasoning"),
    };
}

async function main() {
    const key = await apiKey();
    const ids = await listModelIds(key);
    console.log(`Account lists ${ids.length} models`);

    // One docs page per base id; dated snapshots resolve through it.
    const baseIds = [...new Set(ids.map((id) => id.replace(SNAPSHOT_SUFFIX, "")))].sort();

    const models = {};
    const unresolved = [];
    for (const baseId of baseIds) {
        const page = await fetchDocsPage(baseId);
        if (page === null) {
            unresolved.push(baseId);
            console.log(`  ?? ${baseId} (no docs page)`);
            continue;
        }
        const parsed = parsePage(page);
        // A non-reasoning model always takes the knobs, so it needs no probe.
        if (!parsed.reasoning || !parsed.endpoints.responses) {
            parsed.sampling = parsed.reasoning ? null : "always";
        } else if (!affordableToProbe(parsed.pricing)) {
            parsed.sampling = null;
            const { input, output } = parsed.pricing;
            const price = input === null ? "no published price" : `$${input}/$${output} per 1M`;
            console.log(`  ok ${baseId} [sampling=unprobed: ${price}]`);
            delete parsed.pricing;
            models[baseId] = parsed;
            continue;
        } else {
            const probe = await probeSampling(key, baseId);
            parsed.sampling = probe.sampling;
            // Kept beside the parsed list rather than merged into it: several
            // models accept `none` without the docs ever saying so, and
            // overwriting the documented levels with the probe's single fact
            // would drop low/medium/high for exactly those models.
            parsed.supports_effort_none = probe.supportsNoEffort;
        }
        delete parsed.pricing;
        models[baseId] = parsed;
        console.log(`  ok ${baseId}${parsed.sampling ? ` [sampling=${parsed.sampling}]` : ""}`);
    }

    const bundle = {
        source: `${DOCS_BASE}/<id>.md`,
        generated_at: new Date().toISOString().slice(0, 10),
        models,
        unresolved: unresolved.sort(),
    };
    await fs.writeFile(OUT_PATH, JSON.stringify(bundle, null, 2) + "\n");
    console.log(
        `Wrote ${Object.keys(models).length} models (${unresolved.length} unresolved) to ${OUT_PATH}`,
    );
}

await main();

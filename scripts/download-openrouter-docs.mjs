// download-openrouter-docs.mjs
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const OUT_DIR = path.join(import.meta.dirname, "..", "docs", "external-api", "openrouter");
const INDEX_URL = "https://openrouter.ai/docs/llms.txt";

// polite + identifiable
const FETCH_HEADERS = {
    "user-agent": "openrouter-docs-downloader/1.0 (+local backup script)",
};

async function fetchText(url) {
    const res = await fetch(url, { headers: FETCH_HEADERS, redirect: "follow" });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`${res.status} ${res.statusText} for ${url}\n${body.slice(0, 200)}`);
    }
    return res.text();
}

// Convert a docs URL to the preferred Markdown URL you want to download.
// - If it ends with .mdx, try .md first.
// - If it has no extension, append .md.
function preferredMarkdownUrl(u) {
    if (u.endsWith(".mdx")) return u.slice(0, -4) + ".md";
    if (u.endsWith(".md")) return u;
    return u.replace(/\/$/, "") + ".md";
}

// Map URL to a local filepath under OUT_DIR mirroring /docs/...
function urlToLocalPath(urlStr) {
    const u = new URL(urlStr);
    // Strip leading "/docs/"
    let p = u.pathname.replace(/^\/docs\//, "");
    if (!p || p === "/") p = "index.md";

    // Ensure local extension is .md (even if we downloaded .mdx as fallback)
    if (p.endsWith(".mdx")) p = p.slice(0, -4) + ".md";
    if (!p.endsWith(".md")) p += ".md";

    return path.join(OUT_DIR, p);
}

async function main() {
    await fs.mkdir(OUT_DIR, { recursive: true });

    const llms = await fetchText(INDEX_URL);

    // Extract markdown-style links: [Title](URL)
    const urls = [...llms.matchAll(/\((https:\/\/openrouter\.ai\/docs\/[^)]+)\)/g)]
        .map((m) => m[1])
        .filter(Boolean);

    const unique = [...new Set(urls)].sort();
    console.log(`Found ${unique.length} docs URLs in llms.txt`);

    const manifest = [];

    for (let i = 0; i < unique.length; i++) {
        const original = unique[i];
        const mdUrl = preferredMarkdownUrl(original);
        const outPath = urlToLocalPath(mdUrl);

        await fs.mkdir(path.dirname(outPath), { recursive: true });

        let content = null;
        let usedUrl = null;

        // Try .md first
        try {
            content = await fetchText(mdUrl);
            usedUrl = mdUrl;
        } catch (e1) {
            // Fallback to the original URL (often .mdx)
            try {
                content = await fetchText(original);
                usedUrl = original;
            } catch (e2) {
                console.warn(`❌ Failed: ${original}\n  .md error: ${String(e1).split("\n")[0]}\n  orig error: ${String(e2).split("\n")[0]}`);
                continue;
            }
        }

        await fs.writeFile(outPath, content, "utf8");
        manifest.push({ url: original, downloadedFrom: usedUrl, savedAs: outPath });

        process.stdout.write(`✅ ${i + 1}/${unique.length} ${outPath}\n`);

        // tiny delay to be nice (tweak as you want)
        await sleep(120);
    }

    await fs.writeFile(
        path.join(OUT_DIR, "_manifest.json"),
        JSON.stringify({ index: INDEX_URL, count: manifest.length, files: manifest }, null, 2),
        "utf8"
    );

    console.log(`\nDone. Saved ${manifest.length} files under ./${OUT_DIR}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

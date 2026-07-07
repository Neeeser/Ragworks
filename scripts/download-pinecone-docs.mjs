// download-pinecone-docs.mjs
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const OUT_DIR = path.join(import.meta.dirname, "..", "docs", "external-api", "pinecone");
const INDEX_URL = "https://docs.pinecone.io/llms.txt";

const FETCH_HEADERS = {
    "user-agent": "pinecone-docs-downloader/1.0 (+local backup script)",
};

async function fetchText(url) {
    const res = await fetch(url, { headers: FETCH_HEADERS, redirect: "follow" });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`${res.status} ${res.statusText} for ${url}\n${body.slice(0, 200)}`);
    }
    return res.text();
}

function preferredMarkdownUrl(u) {
    // Most Pinecone links in llms.txt are already .md, but keep this robust:
    if (u.endsWith(".md")) return u;
    if (u.endsWith("/")) return u.slice(0, -1) + ".md";
    if (!/\.[a-zA-Z0-9]+$/.test(u)) return u + ".md";
    return u;
}

function urlToLocalPath(urlStr) {
    const u = new URL(urlStr);

    // Mirror the site path under OUT_DIR (strip leading "/")
    let p = u.pathname.replace(/^\//, "");

    if (!p) p = "index.md";
    if (p.endsWith("/")) p += "index.md";
    if (!p.endsWith(".md")) p += ".md";

    return path.join(OUT_DIR, p);
}

async function main() {
    await fs.mkdir(OUT_DIR, { recursive: true });

    const llms = await fetchText(INDEX_URL);

    // Extract markdown-style links: [Title](URL)
    const urls = [...llms.matchAll(/\((https:\/\/docs\.pinecone\.io\/[^)]+)\)/g)]
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

        try {
            const content = await fetchText(mdUrl);
            await fs.writeFile(outPath, content, "utf8");
            manifest.push({ url: original, downloadedFrom: mdUrl, savedAs: outPath });
            process.stdout.write(`✅ ${i + 1}/${unique.length} ${outPath}\n`);
        } catch (e) {
            console.warn(`❌ Failed: ${mdUrl}\n  ${String(e).split("\n")[0]}`);
        }

        // small delay to be polite (adjust/remove if you want)
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

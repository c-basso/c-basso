const { readFile, writeFile, readdir } = require("node:fs/promises");
const path = require("node:path");

const CONFIG = {
    artistId: "1239180595",
    artistName: "Vladimir Ivakhnenko",
    siteName: "c-basso",
    rootPath: path.join(__dirname, ".."),
    templatePath: path.join(__dirname, "template.html"),
    linksConfigPath: path.join(__dirname, "links.json"),
    indexOutputPath: path.join(__dirname, "..", "index.html"),
    linksOutputPath: path.join(__dirname, "..", "links.html"),
    cnamePath: path.join(__dirname, "..", "CNAME"),
    robotsPath: path.join(__dirname, "..", "robots.txt"),
    sitemapPath: path.join(__dirname, "..", "sitemap.xml")
};

const LOOKUP_URL = `https://itunes.apple.com/lookup?id=${encodeURIComponent(CONFIG.artistId)}&entity=software&limit=200`;

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function escapeJsonLd(value) {
    // JSON-LD is embedded in <script>, so we only need to neutralize </script.
    return JSON.stringify(value).replace(/</g, "\\u003C");
}

function renderStars(rating) {
    const safeRating = Number.isFinite(rating) ? rating : 0;
    const filledStars = Math.floor(safeRating);
    const hasHalfStar = safeRating % 1 >= 0.5;
    const emptyStars = 5 - filledStars - (hasHalfStar ? 1 : 0);

    let html = "";
    for (let i = 0; i < filledStars; i += 1) {
        html += '<span class="filled">★</span>';
    }
    if (hasHalfStar) {
        html += '<span class="filled">☆</span>';
    }
    for (let i = 0; i < emptyStars; i += 1) {
        html += '<span class="empty">☆</span>';
    }
    return html;
}

function renderApps(apps) {
    if (apps.length === 0) {
        return '<p class="empty-state">No apps found.</p>';
    }

    const cards = apps.map((app) => {
        const rating = Number.isFinite(app.averageUserRating) ? app.averageUserRating : 0;
        const iconUrl = app.artworkUrl100 || app.artworkUrl60 || "";
        const trackName = app.trackName || "Unnamed app";
        const trackViewUrl = app.trackViewUrl || "#";

        return `
            <a class="app-card" href="${escapeHtml(trackViewUrl)}" target="_blank" rel="noopener noreferrer">
                <div class="app-header">
                    <img src="${escapeHtml(iconUrl)}" alt="${escapeHtml(trackName)} app icon" class="app-icon" loading="lazy" width="60" height="60">
                    <div class="app-info">
                        <div class="app-name">${escapeHtml(trackName)}</div>
                        <div class="app-rating">
                            <span class="stars" aria-label="Rating: ${rating.toFixed(1)} out of 5">${renderStars(rating)}</span>
                            <span>${rating.toFixed(1)}</span>
                        </div>
                    </div>
                </div>
            </a>
        `.trim();
    }).join("\n");

    return `<section id="apps" class="apps-grid" aria-label="Apps">\n${cards}\n</section>`;
}

function renderLinks(items) {
    if (!Array.isArray(items) || items.length === 0) {
        return '<p class="empty-state">No links yet.</p>';
    }

    const rows = items.map((item) => {
        const title = item.title || item.url || "Untitled";
        const url = item.url || "#";
        let host = "";
        try {
            host = new URL(url).hostname;
        } catch (_error) {
            host = "";
        }

        const hostHtml = host ? `<span class="link-host">${escapeHtml(host)}</span>` : "";

        return `
            <li class="link-item">
                <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
                    <span>${escapeHtml(title)}</span>
                    ${hostHtml}
                </a>
            </li>
        `.trim();
    }).join("\n");

    return `<ul class="links-list" aria-label="Links">\n${rows}\n</ul>`;
}

async function fetchApps() {
    const response = await fetch(LOOKUP_URL, {
        headers: { Accept: "application/json" }
    });

    if (!response.ok) {
        throw new Error(`iTunes request failed: ${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    return (payload.results || [])
        .filter((item) => item.wrapperType === "software" || item.kind === "software")
        .sort((a, b) => (b.averageUserRating || 0) - (a.averageUserRating || 0));
}

function buildAppsJsonLd(apps, baseUrl) {
    const itemListElement = apps.map((app, index) => {
        const node = {
            "@type": "MobileApplication",
            position: index + 1,
            name: app.trackName,
            operatingSystem: "iOS",
            applicationCategory: app.primaryGenreName
                ? `${app.primaryGenreName}Application`
                : "MobileApplication",
            url: app.trackViewUrl,
            image: app.artworkUrl512 || app.artworkUrl100 || app.artworkUrl60,
            author: {
                "@type": "Person",
                name: CONFIG.artistName
            }
        };

        if (Number.isFinite(app.averageUserRating)
            && app.averageUserRating > 0
            && Number.isFinite(app.userRatingCount)
            && app.userRatingCount > 0) {
            node.aggregateRating = {
                "@type": "AggregateRating",
                ratingValue: Number(app.averageUserRating.toFixed(2)),
                ratingCount: app.userRatingCount,
                bestRating: 5,
                worstRating: 1
            };
        }

        if (typeof app.price === "number" && typeof app.currency === "string") {
            node.offers = {
                "@type": "Offer",
                price: app.price.toFixed(2),
                priceCurrency: app.currency
            };
        }

        return node;
    });

    return {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "Person",
                "@id": `${baseUrl}/#person`,
                name: CONFIG.artistName,
                alternateName: CONFIG.siteName,
                url: `${baseUrl}/`
            },
            {
                "@type": "WebSite",
                "@id": `${baseUrl}/#website`,
                url: `${baseUrl}/`,
                name: CONFIG.siteName,
                inLanguage: "en",
                publisher: { "@id": `${baseUrl}/#person` }
            },
            {
                "@type": "ItemList",
                name: `${CONFIG.artistName}'s Apps`,
                itemListOrder: "https://schema.org/ItemListOrderDescending",
                numberOfItems: itemListElement.length,
                itemListElement
            }
        ]
    };
}

function buildLinksJsonLd(linksConfig, baseUrl) {
    const itemListElement = (linksConfig.items || []).map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: item.url,
        name: item.title || item.url
    }));

    return {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        url: `${baseUrl}/links.html`,
        name: linksConfig.h1 || "Links",
        description: linksConfig.description || "",
        inLanguage: "en",
        isPartOf: { "@id": `${baseUrl}/#website` },
        mainEntity: {
            "@type": "ItemList",
            numberOfItems: itemListElement.length,
            itemListElement
        }
    };
}

function renderTemplate(template, replacements) {
    let output = template;
    for (const [key, value] of Object.entries(replacements)) {
        output = output.split(`{{${key}}}`).join(value);
    }
    return output;
}

function renderLead(text) {
    if (!text) return "";
    return `<p class="lead">${escapeHtml(text)}</p>`;
}

async function buildIndex(template, baseUrl) {
    const apps = await fetchApps();
    const appsHtml = renderApps(apps);
    const jsonLd = buildAppsJsonLd(apps, baseUrl);

    const description = `iOS apps by ${CONFIG.artistName} (${CONFIG.siteName}) — utilities for video, audio, wallpapers, productivity and more on the App Store.`;
    const title = `${CONFIG.artistName}'s Apps — ${CONFIG.siteName}`;

    const html = renderTemplate(template, {
        TITLE: escapeHtml(title),
        OG_TITLE: escapeHtml(title),
        DESCRIPTION: escapeHtml(description),
        KEYWORDS: escapeHtml(`Vladimir Ivakhnenko, c-basso, iOS apps, App Store, indie developer, ${apps.map((a) => a.trackName).filter(Boolean).slice(0, 8).join(", ")}`),
        CANONICAL: `${baseUrl}/`,
        H1: escapeHtml(`${CONFIG.artistName}'s Apps`),
        LEAD: "",
        NAV_PRIMARY: '<a href="/links.html">Links</a>',
        CONTENT: appsHtml,
        JSONLD: escapeJsonLd(jsonLd)
    });

    await writeFile(CONFIG.indexOutputPath, html, "utf8");
    process.stdout.write(`Generated index.html with ${apps.length} apps.\n`);
}

async function buildLinks(template, baseUrl) {
    const raw = await readFile(CONFIG.linksConfigPath, "utf8");
    const linksConfig = JSON.parse(raw);
    const items = Array.isArray(linksConfig.items) ? linksConfig.items : [];
    const linksHtml = renderLinks(items);
    const jsonLd = buildLinksJsonLd(linksConfig, baseUrl);

    const title = linksConfig.title || `Links — ${CONFIG.siteName}`;
    const description = linksConfig.description
        || `Curated links by ${CONFIG.artistName}.`;
    const h1 = linksConfig.h1 || "Links";

    const html = renderTemplate(template, {
        TITLE: escapeHtml(title),
        OG_TITLE: escapeHtml(title),
        DESCRIPTION: escapeHtml(description),
        KEYWORDS: escapeHtml(linksConfig.keywords || `Vladimir Ivakhnenko, c-basso, links, articles`),
        CANONICAL: `${baseUrl}/links.html`,
        H1: escapeHtml(h1),
        LEAD: renderLead(linksConfig.lead),
        NAV_PRIMARY: '<a href="/">Apps</a>',
        CONTENT: linksHtml,
        JSONLD: escapeJsonLd(jsonLd)
    });

    await writeFile(CONFIG.linksOutputPath, html, "utf8");
    process.stdout.write(`Generated links.html with ${items.length} links.\n`);
}

function normalizeBaseUrl(hostname) {
    return `https://${hostname.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
}

async function resolveBaseUrl() {
    const cnameContent = await readFile(CONFIG.cnamePath, "utf8");
    const host = cnameContent
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);

    if (!host) {
        throw new Error("CNAME is empty. Cannot generate sitemap.xml and robots.txt.");
    }

    return normalizeBaseUrl(host);
}

async function generateSitemap(baseUrl) {
    const entries = await readdir(CONFIG.rootPath, { withFileTypes: true });
    const htmlFiles = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));

    const urlNodes = htmlFiles.map((filename) => {
        const loc = filename === "index.html"
            ? `${baseUrl}/`
            : `${baseUrl}/${filename}`;

        return `  <url>\n    <loc>${loc}</loc>\n  </url>`;
    }).join("\n");

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
        `${urlNodes}\n` +
        `</urlset>\n`;

    await writeFile(CONFIG.sitemapPath, sitemap, "utf8");
    process.stdout.write(`Generated sitemap.xml with ${htmlFiles.length} pages.\n`);
}

async function generateRobots(baseUrl) {
    const robots = `User-agent: *\n` +
        `Allow: /\n\n` +
        `Sitemap: ${baseUrl}/sitemap.xml\n`;

    await writeFile(CONFIG.robotsPath, robots, "utf8");
    process.stdout.write("Generated robots.txt.\n");
}

async function buildHtml() {
    const [template, baseUrl] = await Promise.all([
        readFile(CONFIG.templatePath, "utf8"),
        resolveBaseUrl()
    ]);
    await buildIndex(template, baseUrl);
    await buildLinks(template, baseUrl);
}

async function buildSeo() {
    const baseUrl = await resolveBaseUrl();
    await generateSitemap(baseUrl);
    await generateRobots(baseUrl);
}

async function buildAll() {
    await buildHtml();
    await buildSeo();
}

const mode = process.argv[2] || "all";
const runners = {
    html: buildHtml,
    seo: buildSeo,
    all: buildAll
};

const run = runners[mode];

if (!run) {
    process.stderr.write(`Unknown build mode: ${mode}. Use one of: html, seo, all.\n`);
    process.exitCode = 1;
} else {
    run().catch((error) => {
        process.stderr.write(`${error.stack || error}\n`);
        process.exitCode = 1;
    });
}

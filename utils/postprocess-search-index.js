/*
  Purpose
  - Ensure MDX pages that include ESM imports/components are indexed for search.
  - Vocs’ default indexer renders MDX; render errors (due to imports) yield empty sections.
  - This script builds a supplemental MiniSearch index by parsing MDX as plain text
    (no execution) and writes it over the generated search-index-<hash>.json.

  High-level flow
  1) Locate the generated search index file by scanning common output dirs.
     - /vercel/path0/docs/dist/.vocs (Vercel build path)
     - .vercel/output/static/.vocs (Vercel static output)
     - docs/dist/.vocs (local build output)
  2) Walk docs/pages and extract sections using markdown headings (#, ##, ...).
  3) Create a MiniSearch index using titles + text (code fences stripped).
  4) Overwrite the found search-index-<hash>.json and mirror to the other dirs.

  Notes & caveats
  - We do not execute MDX; imports/components are treated as inert text.
  - Anchors are derived from headings (slugified). IDs are made unique with ::<i>.
  - This mirrors the structure Vocs expects (fields: href, html, isPage, text, title, titles).
*/

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const MiniSearch = require('minisearch');

const workspaceRoot = process.cwd();
const pagesDir = path.join(workspaceRoot, 'docs', 'pages');
const distVocsDir = path.join(workspaceRoot, 'docs', 'dist', '.vocs');
const vercelVocsDir = path.join(workspaceRoot, '.vercel', 'output', 'static', '.vocs');
const vercelPath0DistVocsDir = '/vercel/path0/docs/dist/.vocs';
const vercelStaticDir = path.join(workspaceRoot, '.vercel', 'output', 'static');
const vocsConfigPath = path.join(workspaceRoot, 'vocs.config.ts');

function walkFiles(dir, out = []) {
  // Recursively collect .md/.mdx files
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(p, out);
    else if (/\.(md|mdx)$/i.test(entry.name)) out.push(p);
  }
  return out;
}

function slugify(input) {
  // Minimal slug generator for anchor fragments derived from headings
  return String(input)
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s\-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/\-+/g, '-')
    .replace(/^\-|\-$/g, '');
}

function removeFences(str) {
  // Remove fenced code blocks’ opening lines to avoid dense token noise
  return str.replace(/^```.*$/gm, '').replace(/^~~~.*$/gm, '');
}

function normalizeSlashes(p) {
  return p.split(path.sep).join('/');
}

function computeHref(filePath) {
  // Map docs/pages/<path>.mdx to /<path> (index.md[x] collapses to directory route)
  const relFromPages = normalizeSlashes(path.relative(pagesDir, filePath));
  const withoutExt = relFromPages.replace(/\.(md|mdx)$/i, '');
  const noIndex = withoutExt.replace(/\/index$/i, '');
  return `/${noIndex}`;
}

function extractSectionsFromMdx(raw) {
  // Parse frontmatter, then split content into sections by ATX headings
  const { content } = matter(raw);
  const lines = content.split(/\r?\n/);

  const sections = [];
  let current = null;
  let parentTitles = [];

  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      // Emit previously collected section before starting a new heading
      if (current) sections.push(current);

      const level = m[1].length;
      const title = m[2].trim();
      const anchor = slugify(title);

      const titles = parentTitles.slice(0, level - 1);
      titles[level - 1] = title;
      parentTitles = titles.slice();

      current = {
        level,
        title,
        anchor,
        titles: titles.slice(0, -1),
        chunks: [],
      };
    } else {
      if (!current) continue; // ignore text until first heading
      current.chunks.push(line);
    }
  }

  if (current) sections.push(current);

  return sections.map((s, idx) => {
    const text = removeFences(s.chunks.join('\n'))
      .replace(/<[^>]*>/g, '')
      .trim();
    return {
      anchor: s.anchor,
      title: s.title,
      titles: s.titles,
      isPage: idx === 0,
      text,
    };
  });
}

async function main() {
  // Determine where the built search index exists (try /vercel/path0, Vercel outDir, docs/dist)
  // Try these directories in order; pick the first that contains the index
  const candidateDirs = [vercelPath0DistVocsDir, vercelVocsDir, distVocsDir];

  let baseDirForIndex = undefined;
  let fileName = undefined;

  for (const dir of candidateDirs) {
    try {
      if (!fs.existsSync(dir)) {
        console.log(`Listing skipped (not found): ${dir}`);
        continue;
      }
      const items = fs.readdirSync(dir);
      console.log(`Listing ${dir}:`, items);
      const candidates = items.filter((f) => /^search-index-.*\.json$/i.test(f)).sort();
      if (candidates.length > 0) {
        baseDirForIndex = dir;
        fileName = candidates[0];
        break;
      }
    } catch (e) {
      console.log(`Listing failed for ${dir}: ${e.message}`);
    }
  }

  if (!baseDirForIndex || !fileName) {
    console.error(`No existing Vocs search index file found in any candidate directory: ${candidateDirs.join(', ')}`);
    process.exit(1);
  }

  const payloadTargets = [];
  // Always write back to the discovered base dir first
  payloadTargets.push(path.join(baseDirForIndex, fileName));
  // And mirror to common output locations if they exist or can be created
  if (baseDirForIndex !== distVocsDir) payloadTargets.push(path.join(distVocsDir, fileName));
  if (baseDirForIndex !== vercelVocsDir) payloadTargets.push(path.join(vercelVocsDir, fileName));

  const files = walkFiles(pagesDir);
  const documents = [];

  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    const sections = extractSectionsFromMdx(raw);
    if (sections.length === 0) continue;

    const hrefBase = computeHref(file);
    sections.forEach((section, i) => {
      const href = `${hrefBase}#${section.anchor}`;
      const id = `${href}::${i}`; // ensure unique ID even if anchors repeat
      documents.push({
        href,
        html: '',
        id,
        isPage: section.isPage,
        text: section.text,
        title: section.title,
        titles: section.titles,
      });
    });
  }

  // Derive allowed routes from Vercel static output (preferred) or from vocs.config.ts
  let allowedRoutes = undefined;
  if (fs.existsSync(vercelStaticDir)) {
    // Walk .vercel/output/static and collect all directories that contain index.html
    const stack = [vercelStaticDir];
    const routes = new Set();
    while (stack.length) {
      const dir = stack.pop();
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      let hasIndex = false;
      for (const e of entries) {
        if (e.isFile() && e.name === 'index.html') hasIndex = true;
      }
      if (hasIndex) {
        const rel = normalizeSlashes(path.relative(vercelStaticDir, dir));
        const route = '/' + rel.replace(/^\/?/, '');
        routes.add(route === '/.' || route === '/' ? '/' : route);
      }
      for (const e of entries) {
        if (e.isDirectory()) stack.push(path.join(dir, e.name));
      }
    }
    // Remove obvious non-doc routes
    routes.delete('/');
    routes.delete('/404');
    allowedRoutes = routes;
  } else if (fs.existsSync(vocsConfigPath)) {
    try {
      const cfg = fs.readFileSync(vocsConfigPath, 'utf8');
      const linkRegex = /link:\s*'([^']+)'/g;
      const routes = new Set();
      let m;
      while ((m = linkRegex.exec(cfg)) !== null) {
        routes.add(m[1]);
      }
      if (routes.size > 0) allowedRoutes = routes;
    } catch {}
  }

  let filteredDocuments = documents;
  if (allowedRoutes && allowedRoutes.size > 0) {
    filteredDocuments = documents.filter((d) => allowedRoutes.has(d.href.split('#')[0]));
    console.log(`Filtering to sidebar/static routes: ${filteredDocuments.length} of ${documents.length} sections`);
  }

  const mini = new MiniSearch({
    fields: ['title', 'titles', 'text'],
    storeFields: ['href', 'html', 'isPage', 'text', 'title', 'titles'],
  });

  await mini.addAllAsync(filteredDocuments);
  const json = mini.toJSON();

  const payload = JSON.stringify(json);
  for (const target of payloadTargets) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, payload);
    console.log(`Search index written (${filteredDocuments.length} sections): ${target}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

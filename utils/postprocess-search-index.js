/*
  Post-process Vocs search index to include MDX pages that contain imports/components.
  Approach: build a MiniSearch index by parsing MDX as text (no execution),
  extracting headings and section text, then overwrite the built .vocs/search-index-<hash>.json.
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

function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(p, out);
    else if (/\.(md|mdx)$/i.test(entry.name)) out.push(p);
  }
  return out;
}

function slugify(input) {
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
  return str.replace(/^```.*$/gm, '').replace(/^~~~.*$/gm, '');
}

function normalizeSlashes(p) {
  return p.split(path.sep).join('/');
}

function computeHref(filePath) {
  const relFromPages = normalizeSlashes(path.relative(pagesDir, filePath));
  const withoutExt = relFromPages.replace(/\.(md|mdx)$/i, '');
  const noIndex = withoutExt.replace(/\/index$/i, '');
  return `/${noIndex}`;
}

function extractSectionsFromMdx(raw) {
  const { content } = matter(raw);
  const lines = content.split(/\r?\n/);

  const sections = [];
  let current = null;
  let parentTitles = [];

  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
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
      if (!current) continue;
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

  const mini = new MiniSearch({
    fields: ['title', 'titles', 'text'],
    storeFields: ['href', 'html', 'isPage', 'text', 'title', 'titles'],
  });

  await mini.addAllAsync(documents);
  const json = mini.toJSON();

  const payload = JSON.stringify(json);
  for (const target of payloadTargets) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, payload);
    console.log(`Search index written (${documents.length} sections): ${target}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

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
  if (!fs.existsSync(distVocsDir)) {
    console.error(`.vocs dir not found at ${distVocsDir}. Run docs build first.`);
    process.exit(1);
  }

  const indexFiles = fs
    .readdirSync(distVocsDir)
    .filter((f) => /^search-index-.*\.json$/i.test(f))
    .sort();
  if (indexFiles.length === 0) {
    console.error('No existing Vocs search index file found to overwrite.');
    process.exit(1);
  }

  const fileName = indexFiles[0];
  const targetIndexFile = path.join(distVocsDir, fileName);

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
  fs.writeFileSync(targetIndexFile, payload);
  console.log(`Search index overwritten with ${documents.length} sections at ${targetIndexFile}`);

  // Also copy into Vercel static output path
  const vercelVocsDir = path.join(workspaceRoot, '.vercel', 'output', 'static', '.vocs');
  try {
    fs.mkdirSync(vercelVocsDir, { recursive: true });
    const vercelTarget = path.join(vercelVocsDir, fileName);
    fs.writeFileSync(vercelTarget, payload);
    console.log(`Search index copied to ${vercelTarget}`);
  } catch (e) {
    console.warn('Warning: could not copy index to Vercel output:', e.message);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

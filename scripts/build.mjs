// Builds dist/artifact.html: the whole game in one file, for the playable copy in Claude's Artifact viewer.
// The site itself needs no build; this is only for that copy. Run: npm run build
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const read = f => readFileSync(root + f, 'utf8');
const b64 = f => readFileSync(root + f).toString('base64');

const js = execSync(`npx -y esbuild@0.24.0 ${root}js/app.js --bundle --format=iife --minify`, { encoding: 'utf8' });
const css = read('css/app.css')
  .replace('url(../fonts/alfa-slab-one.woff2)', `url(data:font/woff2;base64,${b64('fonts/alfa-slab-one.woff2')})`)
  .replace('url(../fonts/libre-franklin.woff2)', `url(data:font/woff2;base64,${b64('fonts/libre-franklin.woff2')})`)
  .replace('url(../fonts/unifraktur.woff2)', `url(data:font/woff2;base64,${b64('fonts/unifraktur.woff2')})`);

const html = read('index.html');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module"'));
// The charset comes first: the page holds ·, ☰ and ☷, and a viewer or a file opened from disk without it shows them as
// mojibake. The board game has one palette in both light and dark: felt and paper. Tell the viewer so.
const out = `<meta charset="utf-8">
<title>Boomtown</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light">
<style>${css}</style>
${body}
<script>window.BOOMTOWN_ARTIFACT = true;</script>
<script>${js.replace(/<\/script/g, '<\\/script')}</script>
`;
mkdirSync(root + 'dist', { recursive: true });
writeFileSync(root + 'dist/artifact.html', out);
console.log('dist/artifact.html', (out.length / 1024).toFixed(0), 'KB');

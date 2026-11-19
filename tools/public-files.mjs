import fs from 'node:fs';
import path from 'node:path';

export const ROOT_FILES = [
  '.editorconfig', '.gitattributes', '.gitignore', 'README.md', 'LICENSE',
  'THIRD_PARTY_NOTICES.md', 'PRIVACY.md', 'SECURITY.md', 'CONTRIBUTING.md',
  'CHANGELOG.md', 'package.json', 'package-lock.json', 'prepare.mjs',
  'distribute.mjs', 'verify.mjs',
];
const SOURCE_DIRS = ['extension', 'docs', 'examples', 'tools', '.github'];
const excludedDirectory = /^(?:node_modules|out|test-results|dist|coverage|__pycache__|\.git|\.cache)$/;
const forbiddenFile = /^(?:\.env(?:\..*)?|connection\.json|login-state\.json|storage-state\.json|cookies\.json)$/i;
const sourceExtension = /\.(?:js|cjs|mjs|html|css|json|md|yml|yaml)$/i;

export function publicFiles(root) {
  const files = [...ROOT_FILES];
  function walk(relative) {
    const folder = path.join(root, relative);
    if (!fs.existsSync(folder)) throw Error('Missing public directory: ' + relative);
    for (const item of fs.readdirSync(folder, {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))) {
      const name = relative + '/' + item.name;
      if (item.isSymbolicLink()) throw Error('Symbolic links are not release inputs: ' + name);
      if (item.isDirectory()) {
        if (!excludedDirectory.test(item.name)) walk(name);
      } else if (item.isFile()) {
        if (forbiddenFile.test(item.name) || /\.(?:pem|key|p12|pfx|har|zip|crx|pyc|log)$/i.test(item.name))
          throw Error('Private or generated file in a public source directory: ' + name);
        if (!sourceExtension.test(item.name) && !/^examples\/html\/assets\/[\w-]+\.png$/.test(name)
            && !/^docs\/images\/workbench\.png$/.test(name))
          throw Error('Unreviewed release file type: ' + name);
        files.push(name);
      }
    }
  }
  for (const folder of SOURCE_DIRS) walk(folder);
  for (const name of files) {
    const stat = fs.lstatSync(path.join(root,name));
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Not a regular public file: ' + name);
  }
  return files.sort();
}

export function extensionFiles(root) {
  return publicFiles(root).filter(name => name.startsWith('extension/')
    && !name.startsWith('extension/tests/') && name !== 'extension/README.md'
    && !/\.(?:check|test)\.(?:cjs|js)$/.test(name));
}

// @flow

import "core-js/stable";
import "regenerator-runtime/runtime";
import debug from 'debug';

import path from 'path';
import { promises as fs } from 'fs';
import { getInstalledPath } from 'get-installed-path';
import { parse } from '@babel/parser';
import documentation from 'documentation';
import { flatten } from 'lodash';

const log = debug('import-documentation');

const getLocalName = (specifier) => {
  const map = {
    ImportDefaultSpecifier: s => s.local.name,
    ImportSpecifier: s => s.imported.name,
  };

  return map[specifier.type](specifier);
};

export const generate = async (filePaths) => {
  const contentPromises = filePaths.map((filepath) => fs.readFile(filepath, 'utf8'));
  const contents = await Promise.all(contentPromises);
  const sources = contents.map(content => parse(content, { sourceType: 'module' }));
  const imports = sources.reduce((acc, source) => {
    const programImports = source.program.body
      .filter(item => item.type === 'ImportDeclaration')
      .filter(item => item.source.value.includes('hexlet'));
    return [...acc, ...programImports];
  }, []);

  const packages = imports.reduce((acc, importDeclaration) => {
    const previousSpecifiers = acc[importDeclaration.source.value] || new Set();
    const filteredSpecifiers = importDeclaration.specifiers.filter(s => s.type !== 'ImportNamespaceSpecifier');
    const newSpecifiers = filteredSpecifiers.reduce(
      (specifiers, specifier) => specifiers.add(getLocalName(specifier)),
      previousSpecifiers,
    );
    return { ...acc, [importDeclaration.source.value]: newSpecifiers };
  }, {});

  const promises = Object.keys(packages).map(async (packageName) => {
    let packagePath;
    try {
      packagePath = await getInstalledPath(packageName, { local: true });
    } catch (e) {
      packagePath = await getInstalledPath(packageName);
    }
    const allPackageDocs = await documentation.build([path.resolve(packagePath, 'src', 'index.js')], {});
    const functions = [...packages[packageName]];
    const packageDocsAll = functions.map((func) => {
      const docs = allPackageDocs.find(item => item.name === func);
      if (docs === undefined) {
        console.warn(`Documentation for function "${func}" not found!`);
      }
      return docs;
    });
    const packageDocs = packageDocsAll.filter(obj => obj !== undefined);
    return { packageName, packageDocs };
  });

  return Promise.all(promises);
};

export const write = (dir, docs) => {
  const promises = docs.map(async ({ packageName, packageDocs }) => {
    const md = await documentation.formats.md(packageDocs, {});
    const fileName = packageName.replace(/\//, '-');
    const filepath = path.resolve(dir, `${fileName}.md`);
    await fs.writeFile(filepath, md);
  });
  return Promise.all(promises);
};

const getJsFiles = async (dir) => {
  const files = await fs.readdir(dir);
  return files.filter((filepath) => filepath.endsWith('js'))
    .map((filepath) => path.resolve(dir, filepath));
};

export default async (outDir, items) => {
  const promises = items.map(async (item) => {
    const fullPath = path.resolve(process.cwd(), item);
    const stats = await fs.lstat(fullPath);
    return stats.isDirectory() ? getJsFiles(item) : item;
  });
  const nestedFiles = await Promise.all(promises);
  const files = flatten(nestedFiles);
  const pathnames = files.map((filepath) => path.resolve(process.cwd(), filepath));
  log('files', pathnames);
  const packagesDocs = await generate(pathnames);
  await write(outDir, packagesDocs);
};

#!/usr/bin/env node

/*
 * Notebook Navigator - Plugin for Obsidian
 * Copyright (c) 2025-2026 Johan Sanneblad
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import esbuild from 'esbuild';
import { builtinModules } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';

const sampleCountArg = Number(process.argv.find(arg => arg.startsWith('--samples='))?.split('=')[1]);
const sampleCount = Number.isFinite(sampleCountArg) && sampleCountArg > 0 ? Math.trunc(sampleCountArg) : 25;
const target = process.argv.find(arg => arg.startsWith('--target='))?.split('=')[1] ?? 'es2022';
const charset = process.argv.find(arg => arg.startsWith('--charset='))?.split('=')[1] ?? 'utf8';
const language = process.argv.find(arg => arg.startsWith('--language='))?.split('=')[1] ?? 'en';
const mode = process.argv.find(arg => arg.startsWith('--mode='))?.split('=')[1] ?? 'require';
const benchmarkMode = mode === 'onload' ? 'onload' : 'require';

const nodeBuiltins = builtinModules.flatMap(moduleName =>
    moduleName.startsWith('node:') ? [moduleName] : [moduleName, `node:${moduleName}`]
);

const external = [
    'obsidian',
    'electron',
    '@codemirror/autocomplete',
    '@codemirror/collab',
    '@codemirror/commands',
    '@codemirror/language',
    '@codemirror/lint',
    '@codemirror/search',
    '@codemirror/state',
    '@codemirror/view',
    '@lezer/common',
    '@lezer/highlight',
    '@lezer/lr',
    ...nodeBuiltins
];

function percentile(sortedValues, percentileValue) {
    if (sortedValues.length === 0) {
        return 0;
    }
    const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil((percentileValue / 100) * sortedValues.length) - 1));
    return sortedValues[index];
}

function summarizeSamples(samples) {
    const sorted = [...samples].sort((left, right) => left - right);
    const sum = sorted.reduce((total, value) => total + value, 0);
    return {
        samples: sorted,
        min: sorted[0] ?? 0,
        median: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        max: sorted[sorted.length - 1] ?? 0,
        mean: sorted.length ? sum / sorted.length : 0
    };
}

function formatMs(value) {
    return Math.round(value * 100) / 100;
}

function getGroupForInput(inputPath) {
    if (inputPath.startsWith('src/i18n/locales/')) {
        return 'src/i18n/locales/*';
    }
    if (inputPath.startsWith('node_modules/react-dom/')) {
        return 'node_modules/react-dom/*';
    }
    if (inputPath.startsWith('node_modules/react/')) {
        return 'node_modules/react/*';
    }
    if (inputPath.startsWith('node_modules/@dnd-kit/')) {
        return 'node_modules/@dnd-kit/*';
    }
    if (inputPath.startsWith('node_modules/@tanstack/')) {
        return 'node_modules/@tanstack/*';
    }
    if (inputPath.startsWith('node_modules/emojilib/')) {
        return 'node_modules/emojilib/*';
    }
    if (inputPath.startsWith('node_modules/emoji-regex')) {
        return 'node_modules/emoji-regex*';
    }
    return inputPath.split('/').slice(0, 3).join('/');
}

function getTopGroups(metafile, limit = 20) {
    const groups = new Map();
    for (const [inputPath, input] of Object.entries(metafile.inputs)) {
        const group = getGroupForInput(inputPath);
        groups.set(group, (groups.get(group) ?? 0) + input.bytes);
    }
    return Array.from(groups, ([group, bytes]) => ({ group, bytes }))
        .sort((left, right) => right.bytes - left.bytes)
        .slice(0, limit);
}

function getTopInputs(metafile, limit = 20) {
    return Object.entries(metafile.inputs)
        .map(([inputPath, input]) => ({ input: inputPath, bytes: input.bytes }))
        .sort((left, right) => right.bytes - left.bytes)
        .slice(0, limit);
}

function createRequireBenchmarkSource(bundlePath, samples, mockedLanguage, mode) {
    return `
const { performance } = require('perf_hooks');
const Module = require('module');
const originalLoad = Module._load;

class Plugin {
  constructor(app, manifest) {
    this.app = app ?? {};
    this.manifest = manifest ?? {};
  }
  async loadData() { return {}; }
  async saveData() {}
  register() {}
  registerEvent() {}
  registerView() {}
  addCommand() {}
  addSettingTab() {}
  addRibbonIcon() {
    return {
      addClass() {},
      removeClass() {},
      setAttribute() {},
      removeAttribute() {}
    };
  }
}
class ItemView {}
class PluginSettingTab {}
class Modal {}
class SuggestModal {}
class Notice {}
class TFile {}
class TFolder {}
class FileView {}
class WorkspaceLeaf {}

const chainable = new Proxy(function () {}, {
  get: () => chainable,
  apply: () => chainable,
  construct: () => chainable
});

const obsidian = new Proxy(
  {
    Plugin,
    ItemView,
    PluginSettingTab,
    Modal,
    SuggestModal,
    Notice,
    TFile,
    TFolder,
    FileView,
    WorkspaceLeaf,
    Platform: {
      isMobile: false,
      isDesktop: true,
      isMacOS: false,
      isWin: true,
      isAndroidApp: false,
      isIosApp: false
    },
    getLanguage: () => ${JSON.stringify(mockedLanguage)},
    normalizePath: value => value,
    addIcon: () => {},
    setIcon: () => {},
    requestUrl: async () => ({})
  },
  {
    get(target, property) {
      return property in target ? target[property] : chainable;
    }
  }
);

Module._load = function (request, parent, isMain) {
  if (request === 'obsidian') {
    return obsidian;
  }
  if (request === 'electron') {
    return {};
  }
  return originalLoad.call(this, request, parent, isMain);
};

function createEventSource() {
  return {
    on: () => ({}),
    offref() {},
    trigger() {}
  };
}

function createMockApp() {
  const workspace = {
    ...createEventSource(),
    onLayoutReady() {},
    getActiveFile: () => null,
    getActiveViewOfType: () => null,
    getLeavesOfType: () => [],
    getRightLeaf: () => null,
    iterateAllLeaves() {},
    revealLeaf: async () => {},
    setActiveLeaf() {},
    openLinkText: async () => null,
    getLeaf: () => ({ setViewState: async () => {}, detach() {} })
  };
  const vault = {
    ...createEventSource(),
    getAbstractFileByPath: () => null,
    getFileByPath: () => null,
    getFolderByPath: () => null,
    getMarkdownFiles: () => [],
    getFiles: () => [],
    adapter: {}
  };
  return {
    appId: 'benchmark-app',
    workspace,
    vault,
    metadataCache: {
      ...createEventSource(),
      getFileCache: () => null
    },
    internalPlugins: { plugins: {} },
    plugins: { plugins: {} },
    loadLocalStorage: () => null,
    saveLocalStorage() {}
  };
}

global.window = {
  setTimeout,
  clearTimeout,
  requestAnimationFrame: callback => setTimeout(callback, 0),
  localStorage: {
    getItem: () => null,
    setItem() {},
    removeItem() {}
  },
  matchMedia: () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {}
  }),
  open() {}
};
global.document = {
  createElement: () => ({
    style: {},
    classList: { add() {}, remove() {}, contains: () => false },
    setAttribute() {},
    appendChild() {},
    remove() {},
    addEventListener() {},
    removeEventListener() {},
    empty() {},
    createDiv: () => ({})
  }),
  head: { appendChild() {} },
  body: { appendChild() {} }
};
global.HTMLElement = class {};
global.Node = class {};
global.MutationObserver = class {
  observe() {}
  disconnect() {}
};
global.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
global.indexedDB = {
  open() {
    const request = {};
    setTimeout(() => {
      if (typeof request.onerror === 'function') {
        request.error = new Error('IndexedDB is not available in the startup benchmark.');
        request.onerror();
      }
    }, 0);
    return request;
  }
};

const bundlePath = ${JSON.stringify(bundlePath)};
const samples = [];
const mode = ${JSON.stringify(mode)};
console.log = () => {};
console.warn = () => {};
console.error = () => {};

(async () => {
  for (let index = 0; index < ${samples}; index += 1) {
    delete require.cache[require.resolve(bundlePath)];
    const start = performance.now();
    const required = require(bundlePath);
    if (mode === 'onload') {
      const PluginClass = required.default ?? required;
      const plugin = new PluginClass(createMockApp(), {
        id: 'notebook-navigator',
        version: '0.0.0',
        minAppVersion: '1.11.0'
      });
      await plugin.onload();
    }
    samples.push(performance.now() - start);
  }
  process.stdout.write(JSON.stringify(samples));
})().catch(error => {
  process.stderr.write(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
`;
}

async function run() {
    const build = await esbuild.build({
        entryPoints: ['src/main.ts'],
        bundle: true,
        define: {
            'process.env.NODE_ENV': '"production"'
        },
        external,
        format: 'cjs',
        target,
        charset,
        treeShaking: true,
        minify: true,
        write: false,
        metafile: true,
        logLevel: 'silent'
    });

    const output = build.outputFiles[0];
    const tempDir = mkdtempSync(path.join(tmpdir(), 'nn-startup-benchmark-'));
    const bundlePath = path.join(tempDir, 'main.cjs');
    const runnerPath = path.join(tempDir, 'runner.cjs');

    try {
        writeFileSync(bundlePath, output.contents);
        writeFileSync(runnerPath, createRequireBenchmarkSource(bundlePath, sampleCount, language, benchmarkMode));
        const rawSamples = execFileSync(process.execPath, [runnerPath], { encoding: 'utf8' });
        const requireSamples = JSON.parse(rawSamples);
        const requireSummary = summarizeSamples(requireSamples);
        const result = {
            target,
            charset,
            mode: benchmarkMode,
            language,
            bundleBytes: output.contents.length,
            gzipBytes: gzipSync(output.contents).length,
            requireMs: {
                min: formatMs(requireSummary.min),
                median: formatMs(requireSummary.median),
                mean: formatMs(requireSummary.mean),
                p95: formatMs(requireSummary.p95),
                max: formatMs(requireSummary.max),
                samples: requireSummary.samples.map(formatMs)
            },
            topGroups: getTopGroups(build.metafile),
            topInputs: getTopInputs(build.metafile)
        };

        console.log(JSON.stringify(result, null, 2));
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

await run();

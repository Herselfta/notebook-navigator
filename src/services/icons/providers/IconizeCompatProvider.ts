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

import { App } from 'obsidian';
import type { IconDefinition, IconProvider, IconRenderResult } from '../types';
import { getIconRenderToken, resetIconContainer } from './providerUtils';

/**
 * Compatibility provider for Iconize (obsidian-icon-folder) plugin icon packs.
 *
 * Iconize stores downloaded SVG icon packs under `.obsidian/icons/<pack-name>/`.
 * Each icon file is named in PascalCase (e.g., `SendPlaneLine.svg`).
 *
 * Icon IDs for this provider use the format: `<pack-name>/<PascalCaseIconName>`
 * For example: `remix-icons/SendPlaneLine`, `tabler-icons/Clock`, `simple-icons/Obsidian`
 *
 * This provider reads SVGs directly through the vault adapter so it can access
 * the `.obsidian/` system directory that is excluded from the vault's TFile index.
 */

const ICONIZE_ICONS_BASE_PATH = '.obsidian/icons';
const SVG_EXTENSION = '.svg';
const MAX_SVG_SOURCE_LENGTH = 200_000;

// Simple in-memory cache: path → { mtime, svg clone source }
interface CachedSvgSource {
    mtime: number;
    source: string;
}

const SVG_SOURCE_CACHE = new Map<string, CachedSvgSource>();

/** Sanitize and normalize an SVG string to use currentColor. */
function sanitizeSvg(raw: string): SVGSVGElement | null {
    if (!raw || raw.length > MAX_SVG_SOURCE_LENGTH) {
        return null;
    }

    if (typeof DOMParser === 'undefined') {
        return null;
    }

    const parsed = new DOMParser().parseFromString(raw, 'image/svg+xml');
    const root = parsed.documentElement;
    if (!(root instanceof SVGSVGElement)) {
        return null;
    }

    // Remove unsafe elements
    const forbidden = 'script,style,foreignObject,iframe,object,embed,link,image,a,animate,animateMotion,animateTransform,set';
    root.querySelectorAll(forbidden).forEach(el => el.remove());

    // Remove unsafe attributes
    const allElements = [root, ...Array.from(root.querySelectorAll('*'))];
    allElements.forEach(el => {
        Array.from(el.attributes).forEach(attr => {
            const name = attr.name.toLowerCase();
            if (name.startsWith('on') || name === 'class' || name === 'tabindex') {
                el.removeAttribute(attr.name);
            }
            if ((name === 'href' || name === 'xlink:href') && !attr.value.trim().startsWith('#')) {
                el.removeAttribute(attr.name);
            }
        });
    });

    if (!root.querySelector('path,circle,rect,line,polyline,polygon,ellipse,use,text')) {
        return null;
    }

    // Detect stroke vs fill icon
    let hasStroke = false;
    let hasFillNone = false;

    allElements.forEach(el => {
        const fill = el.getAttribute('fill');
        const stroke = el.getAttribute('stroke');
        if (stroke && stroke.trim().toLowerCase() !== 'none') hasStroke = true;
        if (fill && fill.trim().toLowerCase() === 'none') hasFillNone = true;
    });

    // Detect stroke hints from attribute names
    const hasStrokeHints = allElements.some(el =>
        el.hasAttribute('stroke-width') ||
        el.hasAttribute('stroke-linecap') ||
        el.hasAttribute('stroke-linejoin')
    );

    const treatAsStroke = hasStroke || (hasStrokeHints && hasFillNone);

    root.classList.add('nn-vault-icon-svg');
    if (treatAsStroke) {
        root.setAttribute('stroke', 'currentColor');
        root.setAttribute('fill', 'none');
    } else {
        root.setAttribute('fill', 'currentColor');
        root.setAttribute('stroke', 'none');
    }

    // Replace explicit fill/stroke colors with currentColor
    allElements.forEach(el => {
        const fill = el.getAttribute('fill');
        if (fill && fill.trim().toLowerCase() !== 'none') {
            el.setAttribute('fill', 'currentColor');
        }
        const stroke = el.getAttribute('stroke');
        if (stroke && stroke.trim().toLowerCase() !== 'none') {
            el.setAttribute('stroke', 'currentColor');
        }
    });

    return root;
}

export class IconizeCompatProvider implements IconProvider {
    id = 'iconize';
    name = 'Iconize Compat';

    private readonly app: App;
    private iconListCache: IconDefinition[] | null = null;

    constructor(app: App) {
        this.app = app;
    }

    isAvailable(): boolean {
        return true;
    }

    /**
     * Renders an Iconize icon from `.obsidian/icons/<pack>/<Name>.svg`.
     *
     * @param container - The target HTML element
     * @param iconId    - Format: `<pack-name>/<PascalCaseIconName>` e.g. `remix-icons/SendPlaneLine`
     * @param size      - Optional render size in pixels
     */
    render(container: HTMLElement, iconId: string, size?: number): IconRenderResult | Promise<IconRenderResult> {
        resetIconContainer(container);

        if (size) {
            container.style.width = `${size}px`;
            container.style.height = `${size}px`;
        } else {
            container.style.removeProperty('width');
            container.style.removeProperty('height');
        }

        if (!iconId || !iconId.includes('/')) {
            return 'not-found';
        }

        const svgPath = `${ICONIZE_ICONS_BASE_PATH}/${iconId}${SVG_EXTENSION}`;
        const token = getIconRenderToken(container);

        if (!token) {
            return 'not-found';
        }

        // Check cache using vault adapter stat for mtime
        return this.readSvgFromAdapter(svgPath, container, token, size);
    }

    private async readSvgFromAdapter(
        svgPath: string,
        container: HTMLElement,
        token: symbol,
        size?: number
    ): Promise<IconRenderResult> {
        try {
            const adapter = this.app.vault.adapter;

            // Check if file exists
            const exists = await adapter.exists(svgPath);
            if (!exists) {
                return 'not-found';
            }

            // Check cache by reading stat
            let mtime = 0;
            try {
                const stat = await adapter.stat(svgPath);
                mtime = stat?.mtime ?? 0;
            } catch {
                // stat may not be available on all platforms; skip cache check
            }

            let raw: string;
            const cached = SVG_SOURCE_CACHE.get(svgPath);

            if (cached && mtime > 0 && cached.mtime === mtime) {
                raw = cached.source;
            } else {
                raw = await adapter.read(svgPath);
                if (mtime > 0) {
                    SVG_SOURCE_CACHE.set(svgPath, { mtime, source: raw });
                }
            }

            // Check render token hasn't been invalidated
            if (getIconRenderToken(container) !== token) {
                return 'not-found';
            }

            const svg = sanitizeSvg(raw);
            if (!svg) {
                return 'not-found';
            }

            if (getIconRenderToken(container) !== token) {
                return 'not-found';
            }

            container.empty();
            container.appendChild(svg.cloneNode(true));
            return 'rendered';
        } catch (error) {
            console.error(`[IconizeCompatProvider] Failed to render icon at ${svgPath}:`, error);
            return 'not-found';
        }
    }

    search(query: string): IconDefinition[] {
        const q = query.trim().toLowerCase();
        if (!q) return [];
        return this.getAll().filter(icon =>
            icon.id.toLowerCase().includes(q) || icon.displayName.toLowerCase().includes(q)
        );
    }

    getAll(): IconDefinition[] {
        if (this.iconListCache) {
            return this.iconListCache.slice();
        }

        // We can't synchronously enumerate `.obsidian/icons` via the vault API,
        // so we return an empty list here. The list is populated lazily by
        // `refreshIconList()` which is called by the plugin on startup.
        return [];
    }

    /**
     * Scans the `.obsidian/icons` directory tree and populates the icon list cache.
     * Call this once after plugin load to enable search & getAll().
     */
    async refreshIconList(): Promise<void> {
        try {
            const adapter = this.app.vault.adapter;
            const baseExists = await adapter.exists(ICONIZE_ICONS_BASE_PATH);
            if (!baseExists) {
                this.iconListCache = [];
                return;
            }

            const icons: IconDefinition[] = [];
            const listed = await adapter.list(ICONIZE_ICONS_BASE_PATH);

            // Each item in folders is a pack directory like `remix-icons`
            for (const packDir of listed.folders) {
                const packName = packDir.split('/').pop() ?? packDir;
                const packListed = await adapter.list(packDir);
                for (const filePath of packListed.files) {
                    if (filePath.toLowerCase().endsWith(SVG_EXTENSION)) {
                        const fileName = filePath.split('/').pop() ?? filePath;
                        const iconName = fileName.slice(0, -SVG_EXTENSION.length);
                        const id = `${packName}/${iconName}`;
                        icons.push({
                            id,
                            displayName: `${packName}: ${iconName}`
                        });
                    }
                }
            }

            this.iconListCache = icons;
        } catch (error) {
            console.error('[IconizeCompatProvider] Failed to scan icon list:', error);
            this.iconListCache = [];
        }
    }

    /** Clears the icon list cache so it is rebuilt on next access. */
    invalidateIconList(): void {
        this.iconListCache = null;
    }
}

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

import { describe, expect, it } from 'vitest';
import {
    applyFileMetadataPatch,
    hasMetadataHiddenChanged,
    hasMetadataIconOrColorChanged,
    hasMetadataNameChanged
} from '../../src/storage/indexeddb/fileData';

describe('hasMetadataNameChanged', () => {
    it('treats trimmed-equivalent names as unchanged', () => {
        expect(hasMetadataNameChanged({ name: 'Folder' }, { name: '  Folder  ' })).toBe(false);
    });

    it('treats blank and missing names as unchanged', () => {
        expect(hasMetadataNameChanged({ name: '   ' }, {})).toBe(false);
        expect(hasMetadataNameChanged({ name: '' }, null)).toBe(false);
    });

    it('detects meaningful metadata name changes', () => {
        expect(hasMetadataNameChanged({ name: 'Alpha' }, { name: 'Beta' })).toBe(true);
        expect(hasMetadataNameChanged(null, { name: 'Alpha' })).toBe(true);
    });
});

describe('hasMetadataHiddenChanged', () => {
    it('treats missing and false hidden flags as unchanged', () => {
        expect(hasMetadataHiddenChanged({}, { hidden: false })).toBe(false);
        expect(hasMetadataHiddenChanged(null, {})).toBe(false);
    });

    it('detects frontmatter visibility changes', () => {
        expect(hasMetadataHiddenChanged({ hidden: false }, { hidden: true })).toBe(true);
        expect(hasMetadataHiddenChanged({ hidden: true }, null)).toBe(true);
    });
});

describe('hasMetadataIconOrColorChanged', () => {
    it('treats unchanged missing icon and color fields as unchanged', () => {
        expect(hasMetadataIconOrColorChanged({}, null)).toBe(false);
        expect(hasMetadataIconOrColorChanged(null, {})).toBe(false);
    });

    it('detects icon and color changes', () => {
        expect(hasMetadataIconOrColorChanged({ icon: 'lucide-star' }, { icon: 'lucide-book' })).toBe(true);
        expect(hasMetadataIconOrColorChanged({ color: 'red' }, { color: 'blue' })).toBe(true);
    });

    it('detects icon and color removals', () => {
        expect(hasMetadataIconOrColorChanged({ icon: 'lucide-star' }, {})).toBe(true);
        expect(hasMetadataIconOrColorChanged({ color: 'red' }, null)).toBe(true);
    });
});

describe('applyFileMetadataPatch', () => {
    it('reports unchanged patches without recreating metadata events', () => {
        const result = applyFileMetadataPatch({ icon: 'lucide-star', color: 'red' }, { icon: 'lucide-star' });

        expect(result.changed).toBe(false);
        expect(result.metadata).toEqual({ icon: 'lucide-star', color: 'red' });
    });

    it('treats missing undefined fields as unchanged', () => {
        const result = applyFileMetadataPatch({}, { icon: undefined });

        expect(result.changed).toBe(false);
        expect(result.metadata).toEqual({});
    });

    it('removes fields when a patch value is undefined', () => {
        const result = applyFileMetadataPatch({ icon: 'lucide-star', color: 'red' }, { icon: undefined });

        expect(result.changed).toBe(true);
        expect(result.metadata).toEqual({ color: 'red' });
    });

    it('applies string, number, and boolean metadata fields', () => {
        const result = applyFileMetadataPatch(null, {
            name: 'Display name',
            created: 123,
            modified: 456,
            hidden: true
        });

        expect(result.changed).toBe(true);
        expect(result.metadata).toEqual({
            name: 'Display name',
            created: 123,
            modified: 456,
            hidden: true
        });
    });
});

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
import { resolveFolderDisplayPath, resolveFolderDisplayPathSegments } from '../../src/utils/folderDisplayName';
import type { MetadataService } from '../../src/services/MetadataService';

function createMetadataService(displayNames: Record<string, string | undefined>): Pick<MetadataService, 'getFolderDisplayData'> {
    return {
        getFolderDisplayData: folderPath => ({
            displayName: displayNames[folderPath],
            color: undefined,
            backgroundColor: undefined,
            icon: undefined
        })
    };
}

describe('folderDisplayName', () => {
    it('resolves full paths with folder display names where available', () => {
        const metadataService = createMetadataService({
            Projects: 'Work',
            'Projects/Clients': undefined,
            'Projects/Clients/Acme': 'Acme Corp'
        });

        expect(resolveFolderDisplayPath({ metadataService, folderPath: 'Projects/Clients/Acme' })).toBe('Work/Clients/Acme Corp');
    });

    it('falls back to path segments when display names are missing', () => {
        const metadataService = createMetadataService({});

        expect(resolveFolderDisplayPath({ metadataService, folderPath: 'Archive/2026/May' })).toBe('Archive/2026/May');
    });

    it('resolves path segments with paths and display labels', () => {
        const metadataService = createMetadataService({
            Projects: 'Work',
            'Projects/Clients': undefined
        });

        expect(resolveFolderDisplayPathSegments({ metadataService, folderPath: 'Projects/Clients' })).toEqual([
            { path: 'Projects', label: 'Work' },
            { path: 'Projects/Clients', label: 'Clients' }
        ]);
    });
});

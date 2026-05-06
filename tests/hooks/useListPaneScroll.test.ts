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
import type { FileContentChange } from '../../src/storage/IndexedDBStorage';
import { isListRowHeightAffectingContentChange } from '../../src/hooks/useListPaneScroll';

function createContentChange(patch: Partial<FileContentChange>): FileContentChange {
    return {
        path: 'Notes/Daily.md',
        changes: {},
        ...patch
    };
}

describe('isListRowHeightAffectingContentChange', () => {
    it('detects content fields that can change estimated list row height', () => {
        expect(isListRowHeightAffectingContentChange(createContentChange({ changes: { preview: 'Preview' } }))).toBe(true);
        expect(isListRowHeightAffectingContentChange(createContentChange({ changes: { featureImageKey: 'key' } }))).toBe(true);
        expect(isListRowHeightAffectingContentChange(createContentChange({ changes: { featureImageStatus: 'has' } }))).toBe(true);
        expect(isListRowHeightAffectingContentChange(createContentChange({ changes: { properties: [] } }))).toBe(true);
        expect(isListRowHeightAffectingContentChange(createContentChange({ changes: { tags: ['work'] } }))).toBe(true);
        expect(isListRowHeightAffectingContentChange(createContentChange({ changes: { wordCount: 123 } }))).toBe(true);
    });

    it('ignores content fields that do not change estimated row height', () => {
        expect(isListRowHeightAffectingContentChange(createContentChange({ changes: { taskTotal: 4 } }))).toBe(false);
        expect(isListRowHeightAffectingContentChange(createContentChange({ changes: { taskUnfinished: 2 } }))).toBe(false);
        expect(
            isListRowHeightAffectingContentChange(
                createContentChange({
                    changes: { metadata: { name: 'Daily note', icon: 'lucide-star', color: '#ff0000', hidden: true } },
                    metadataHiddenChanged: true,
                    metadataNameChanged: true
                })
            )
        ).toBe(false);
    });
});

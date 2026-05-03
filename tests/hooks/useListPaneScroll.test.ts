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
import {
    getEstimatedPillContainerWidth,
    getListPaneScrollerClientWidth,
    getMeasuredVirtualItemHeight,
    isListRowHeightAffectingContentChange
} from '../../src/hooks/useListPaneScroll';

function createContentChange(patch: Partial<FileContentChange>): FileContentChange {
    return {
        path: 'Notes/Daily.md',
        changes: {},
        ...patch
    };
}

describe('getListPaneScrollerClientWidth', () => {
    it('uses client width so scrollbar gutters stay out of pill wrap estimates', () => {
        const element = {
            clientWidth: 284,
            getBoundingClientRect: () => ({ width: 300 })
        } as unknown as HTMLElement;

        expect(getListPaneScrollerClientWidth(element)).toBe(284);
    });
});

describe('getEstimatedPillContainerWidth', () => {
    it('does not floor narrow pane widths above the measured usable space', () => {
        expect(
            getEstimatedPillContainerWidth({
                scrollContainerWidth: 70,
                scrollerHorizontalPadding: 10,
                fileItemHorizontalPadding: 12,
                showFileIcons: false,
                fileIconSize: 16,
                fileIconSlotGap: 6,
                showFeatureImageArea: false,
                featureImageInlineSize: 0,
                fileRowGap: 4
            })
        ).toBe(26);
    });
});

describe('getMeasuredVirtualItemHeight', () => {
    const element = {
        getBoundingClientRect: () => ({ height: 42.75 })
    } as unknown as Element;

    it('preserves subpixel heights from the element fallback', () => {
        expect(getMeasuredVirtualItemHeight(element, undefined)).toBe(42.75);
    });

    it('preserves subpixel heights from ResizeObserver border boxes', () => {
        const entry = { borderBoxSize: [{ blockSize: 43.5 }] } as unknown as ResizeObserverEntry;

        expect(getMeasuredVirtualItemHeight(element, entry)).toBe(43.5);
    });

    it('supports object-shaped ResizeObserver border boxes', () => {
        const entry = { borderBoxSize: { blockSize: 44.25 } } as unknown as ResizeObserverEntry;

        expect(getMeasuredVirtualItemHeight(element, entry)).toBe(44.25);
    });
});

describe('isListRowHeightAffectingContentChange', () => {
    it('detects file content fields that can change measured row height', () => {
        expect(isListRowHeightAffectingContentChange(createContentChange({ changes: { preview: 'Preview' } }))).toBe(true);
        expect(isListRowHeightAffectingContentChange(createContentChange({ changes: { featureImageKey: 'key' } }))).toBe(true);
        expect(isListRowHeightAffectingContentChange(createContentChange({ changes: { featureImageStatus: 'has' } }))).toBe(true);
        expect(isListRowHeightAffectingContentChange(createContentChange({ changes: { properties: [] } }))).toBe(true);
        expect(isListRowHeightAffectingContentChange(createContentChange({ changes: { tags: ['work'] } }))).toBe(true);
        expect(isListRowHeightAffectingContentChange(createContentChange({ changes: { wordCount: 123 } }))).toBe(true);
    });

    it('remeasures metadata changes that can alter title or icon-slot width', () => {
        expect(
            isListRowHeightAffectingContentChange(
                createContentChange({
                    changes: { metadata: { name: 'Daily note' } },
                    metadataNameChanged: true
                })
            )
        ).toBe(true);

        expect(
            isListRowHeightAffectingContentChange(
                createContentChange({
                    changes: { metadata: { color: '#ff0000' } },
                    metadataIconOrColorChanged: true,
                    metadataNameChanged: false
                })
            )
        ).toBe(true);
        expect(
            isListRowHeightAffectingContentChange(
                createContentChange({
                    changes: { metadata: { background: '#00ff00', icon: 'lucide-star' } },
                    metadataIconOrColorChanged: true
                })
            )
        ).toBe(true);
        expect(
            isListRowHeightAffectingContentChange(
                createContentChange({
                    changes: { metadata: { background: '#00ff00' } }
                })
            )
        ).toBe(false);
    });

    it('does not remeasure rows for visibility metadata alone', () => {
        expect(
            isListRowHeightAffectingContentChange(
                createContentChange({
                    changes: { metadata: { hidden: true } },
                    metadataHiddenChanged: true
                })
            )
        ).toBe(false);
    });

    it('does not remeasure rows for task counters that only change icon glyphs or backgrounds', () => {
        expect(isListRowHeightAffectingContentChange(createContentChange({ changes: { taskUnfinished: 2 } }))).toBe(false);
    });
});

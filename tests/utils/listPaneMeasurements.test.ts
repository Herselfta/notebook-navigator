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
    getFileItemLayoutState,
    getSelectedPropertyValuePillToHide,
    getSelectedTagPillToHide,
    hasVisibleTagPills,
    getPropertyRowCount,
    isListPaneCompactMode,
    shouldShowFeatureImageArea,
    shouldShowFileItemParentFolderLine
} from '../../src/utils/listPaneMeasurements';
import { ItemType } from '../../src/types';
import { buildPropertyValueNodeId } from '../../src/utils/propertyTree';
import { createHiddenTagVisibility } from '../../src/utils/tagPrefixMatcher';
import { createTestTFile } from './createTestTFile';

describe('listPaneMeasurements layout helpers', () => {
    it('detects compact mode from hidden date, preview, and image sections', () => {
        expect(
            isListPaneCompactMode({
                showDate: false,
                showPreview: false,
                showImage: false
            })
        ).toBe(true);

        expect(
            isListPaneCompactMode({
                showDate: true,
                showPreview: false,
                showImage: false
            })
        ).toBe(false);
    });

    it('keeps the multiline preview slot when the feature image area is visible', () => {
        expect(
            getFileItemLayoutState({
                showDate: true,
                showPreview: true,
                showImage: true,
                previewRows: 3,
                isPinned: false,
                hasPreviewContent: false,
                showFeatureImageArea: true,
                hasVisiblePillRows: false
            })
        ).toMatchObject({
            isCompactMode: false,
            shouldUseSingleLineForDateAndPreview: false,
            shouldShowMultilinePreview: true,
            shouldReplaceEmptyPreviewWithPills: false,
            shouldShowDateForItem: true
        });
    });

    it('collapses empty preview space when pills are visible and no image is shown', () => {
        expect(
            getFileItemLayoutState({
                showDate: true,
                showPreview: true,
                showImage: false,
                previewRows: 3,
                isPinned: false,
                hasPreviewContent: false,
                showFeatureImageArea: false,
                hasVisiblePillRows: true
            })
        ).toMatchObject({
            shouldUseSingleLineForDateAndPreview: false,
            shouldShowMultilinePreview: false,
            shouldReplaceEmptyPreviewWithPills: true,
            shouldShowDateForItem: true
        });
    });

    it('matches the parent folder line rules for tag and descendant views', () => {
        expect(
            shouldShowFileItemParentFolderLine({
                showParentFolder: true,
                isPinned: false,
                selectionType: 'tag',
                includeDescendantNotes: false,
                parentFolder: 'Projects',
                fileParentPath: 'Projects/Archive'
            })
        ).toBe(true);

        expect(
            shouldShowFileItemParentFolderLine({
                showParentFolder: true,
                isPinned: false,
                selectionType: 'folder',
                includeDescendantNotes: true,
                parentFolder: 'Projects',
                fileParentPath: 'Projects/Archive'
            })
        ).toBe(true);

        expect(
            shouldShowFileItemParentFolderLine({
                showParentFolder: true,
                isPinned: false,
                selectionType: 'folder',
                includeDescendantNotes: true,
                parentFolder: 'Projects',
                fileParentPath: 'Projects'
            })
        ).toBe(false);

        expect(
            shouldShowFileItemParentFolderLine({
                showParentFolder: true,
                isPinned: false,
                selectionType: 'tag',
                includeDescendantNotes: false,
                parentFolder: null,
                fileParentPath: '/'
            })
        ).toBe(false);
    });

    it('keeps feature image visibility aligned for image files and cached thumbnails', () => {
        const markdownFile = createTestTFile('Notes/Daily.md');
        const imageFile = createTestTFile('Images/Cover.png');

        expect(
            shouldShowFeatureImageArea({
                showImage: true,
                file: markdownFile,
                featureImageStatus: 'has'
            })
        ).toBe(true);

        expect(
            shouldShowFeatureImageArea({
                showImage: true,
                file: imageFile,
                featureImageStatus: 'unprocessed'
            })
        ).toBe(true);
    });

    it('counts numeric frontmatter properties as visible property rows', () => {
        expect(
            getPropertyRowCount({
                notePropertyType: 'none',
                showFileProperties: true,
                showPropertiesOnSeparateRows: false,
                showFilePropertiesInCompactMode: true,
                isCompactMode: false,
                file: createTestTFile('Notes/Numbers.md'),
                wordCount: null,
                properties: [{ fieldKey: 'rating', value: '4.5', valueKind: 'number' }],
                visiblePropertyKeys: new Set<string>(['rating'])
            })
        ).toBe(1);
    });

    it('counts boolean frontmatter properties as visible property rows', () => {
        expect(
            getPropertyRowCount({
                notePropertyType: 'none',
                showFileProperties: true,
                showPropertiesOnSeparateRows: false,
                showFilePropertiesInCompactMode: true,
                isCompactMode: false,
                file: createTestTFile('Notes/Flags.md'),
                wordCount: null,
                properties: [{ fieldKey: 'flag', value: 'true', valueKind: 'boolean' }],
                visiblePropertyKeys: new Set<string>(['flag'])
            })
        ).toBe(1);
    });

    it('counts frontmatter property rows when separate rows are enabled', () => {
        const file = createTestTFile('Notes/Properties.md');
        const properties = [
            { fieldKey: 'topic', value: 'alpha', valueKind: 'string' as const },
            { fieldKey: 'topic', value: 'beta', valueKind: 'string' as const },
            { fieldKey: 'priority', value: 'high', valueKind: 'string' as const }
        ];

        expect(
            getPropertyRowCount({
                notePropertyType: 'none',
                showFileProperties: true,
                showPropertiesOnSeparateRows: false,
                showFilePropertiesInCompactMode: true,
                isCompactMode: false,
                file,
                wordCount: null,
                properties,
                visiblePropertyKeys: new Set<string>(['topic', 'priority'])
            })
        ).toBe(1);

        expect(
            getPropertyRowCount({
                notePropertyType: 'none',
                showFileProperties: true,
                showPropertiesOnSeparateRows: true,
                showFilePropertiesInCompactMode: true,
                isCompactMode: false,
                file,
                wordCount: null,
                properties,
                visiblePropertyKeys: new Set<string>(['topic', 'priority'])
            })
        ).toBe(2);
    });

    it('hides the selected tag from tag-row visibility checks', () => {
        const selectedTagToHide = getSelectedTagPillToHide({
            selectionType: ItemType.TAG,
            selectedTag: 'ai',
            showSelectedNavigationPills: false
        });
        const hiddenTagVisibility = createHiddenTagVisibility([], false);

        expect(
            hasVisibleTagPills({
                tags: ['ai'],
                hiddenTagVisibility,
                selectedTagToHide
            })
        ).toBe(false);

        expect(
            hasVisibleTagPills({
                tags: ['ai', 'ml'],
                hiddenTagVisibility,
                selectedTagToHide
            })
        ).toBe(true);
    });

    it('reduces property row counts when the selected property value pill is hidden', () => {
        const selectedPropertyValueNodeIdToHide = getSelectedPropertyValuePillToHide({
            selectionType: ItemType.PROPERTY,
            selectedProperty: buildPropertyValueNodeId('status', 'done'),
            showSelectedNavigationPills: false
        });

        expect(
            getPropertyRowCount({
                notePropertyType: 'none',
                showFileProperties: true,
                showPropertiesOnSeparateRows: false,
                showFilePropertiesInCompactMode: true,
                isCompactMode: false,
                file: createTestTFile('Notes/Status.md'),
                wordCount: null,
                properties: [{ fieldKey: 'status', value: 'done', valueKind: 'string' }],
                visiblePropertyKeys: new Set<string>(['status']),
                hiddenPropertyValueNodeId: selectedPropertyValueNodeIdToHide
            })
        ).toBe(0);

        expect(
            getPropertyRowCount({
                notePropertyType: 'none',
                showFileProperties: true,
                showPropertiesOnSeparateRows: false,
                showFilePropertiesInCompactMode: true,
                isCompactMode: false,
                file: createTestTFile('Notes/Status.md'),
                wordCount: null,
                properties: [
                    { fieldKey: 'status', value: 'done', valueKind: 'string' },
                    { fieldKey: 'priority', value: 'high', valueKind: 'string' }
                ],
                visiblePropertyKeys: new Set<string>(['status', 'priority']),
                hiddenPropertyValueNodeId: selectedPropertyValueNodeIdToHide
            })
        ).toBe(1);
    });

    it('keeps property row counts correct across repeated calls with different filters', () => {
        const properties = [
            { fieldKey: 'status', value: 'done', valueKind: 'string' as const },
            { fieldKey: 'priority', value: 'high', valueKind: 'string' as const }
        ];

        expect(
            getPropertyRowCount({
                notePropertyType: 'none',
                showFileProperties: true,
                showPropertiesOnSeparateRows: false,
                showFilePropertiesInCompactMode: true,
                isCompactMode: false,
                file: createTestTFile('Notes/Status.md'),
                wordCount: null,
                properties,
                visiblePropertyKeys: new Set<string>(['status'])
            })
        ).toBe(1);

        expect(
            getPropertyRowCount({
                notePropertyType: 'none',
                showFileProperties: true,
                showPropertiesOnSeparateRows: false,
                showFilePropertiesInCompactMode: true,
                isCompactMode: false,
                file: createTestTFile('Notes/Status.md'),
                wordCount: null,
                properties,
                visiblePropertyKeys: new Set<string>(['missing'])
            })
        ).toBe(0);

        expect(
            getPropertyRowCount({
                notePropertyType: 'none',
                showFileProperties: true,
                showPropertiesOnSeparateRows: false,
                showFilePropertiesInCompactMode: true,
                isCompactMode: false,
                file: createTestTFile('Notes/Status.md'),
                wordCount: null,
                properties,
                visiblePropertyKeys: new Set<string>(['status'])
            })
        ).toBe(1);
    });
});

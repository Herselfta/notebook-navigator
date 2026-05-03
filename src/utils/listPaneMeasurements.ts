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

import type { TFile } from 'obsidian';
import { ItemType, type NavigationItemType } from '../types';
import type { FeatureImageStatus, FileData } from '../storage/IndexedDBStorage';
import { type FeatureImageSizeSetting, type NotePropertyType } from '../settings/types';
import { isImageFile } from './fileTypeUtils';
import {
    buildPropertyKeyNodeId,
    buildPropertyValueNodeId,
    isPropertyKeyOnlyValuePath,
    normalizePropertyNodeId,
    normalizePropertyTreeValuePath,
    parsePropertyNodeId
} from './propertyTree';
import { casefold } from './recordUtils';
import type { HiddenTagVisibility } from './tagPrefixMatcher';
import { normalizeTagPath } from './tagUtils';

/**
 * Layout measurements used by the list pane virtualizer.
 * These values mirror the CSS variables defined in styles.css.
 */
export interface ListPaneMeasurements {
    scrollerHorizontalPadding: number;
    fileItemHorizontalPadding: number;
    fileRowGap: number;
    fileIconSlotGap: number;
    basePadding: number;
    titleLineHeight: number;
    singleTextLineHeight: number;
    multilineTextLineHeight: number;
    tagRowHeight: number;
    tagRowGap: number;
    featureImageHeight: number;
    firstHeader: number;
    subsequentHeader: number;
    fileIconSize: number;
    topSpacer: number;
    bottomSpacer: number;
}

export interface FeatureImageDisplayMeasurements {
    listMaxSize: number;
}

export const FEATURE_IMAGE_MAX_ASPECT_RATIO = 16 / 9;

const FEATURE_IMAGE_DISPLAY_MEASUREMENTS: Readonly<Record<FeatureImageSizeSetting, FeatureImageDisplayMeasurements>> = Object.freeze({
    '64': { listMaxSize: 64 },
    '96': { listMaxSize: 96 },
    '128': { listMaxSize: 128 }
});

const DESKTOP_MEASUREMENTS: ListPaneMeasurements = Object.freeze({
    scrollerHorizontalPadding: 10,
    fileItemHorizontalPadding: 12,
    fileRowGap: 4,
    fileIconSlotGap: 6,
    basePadding: 16, // 8px padding on each side
    titleLineHeight: 20,
    singleTextLineHeight: 19,
    multilineTextLineHeight: 18,
    tagRowHeight: 26, // 22px row + 4px gap
    tagRowGap: 4,
    featureImageHeight: 42,
    firstHeader: 35,
    subsequentHeader: 50,
    fileIconSize: 16,
    topSpacer: 8,
    bottomSpacer: 20
});

const MOBILE_MEASUREMENTS: ListPaneMeasurements = Object.freeze({
    scrollerHorizontalPadding: 10,
    fileItemHorizontalPadding: 12,
    fileRowGap: 4,
    fileIconSlotGap: 6,
    basePadding: 24, // 12px padding on each side
    titleLineHeight: 21,
    singleTextLineHeight: 20,
    multilineTextLineHeight: 19,
    tagRowHeight: 26, // 22px row + 4px gap
    tagRowGap: 4,
    featureImageHeight: 42,
    firstHeader: 43, // 35px + 8px mobile increment
    subsequentHeader: 58, // 50px + 8px mobile increment
    fileIconSize: 20, // 16px + 4px mobile increment
    topSpacer: 8,
    bottomSpacer: 20
});

/**
 * Returns the static measurement set for the current platform.
 */
export function getFeatureImageDisplayMeasurements(featureImageSize: FeatureImageSizeSetting): FeatureImageDisplayMeasurements {
    return FEATURE_IMAGE_DISPLAY_MEASUREMENTS[featureImageSize];
}

export function getEstimatedFeatureImageInlineSize({
    blockSize,
    forceSquareFeatureImage
}: {
    blockSize: number;
    forceSquareFeatureImage: boolean;
}): number {
    const normalizedBlockSize = Number.isFinite(blockSize) && blockSize > 0 ? blockSize : 0;
    return normalizedBlockSize * (forceSquareFeatureImage ? 1 : FEATURE_IMAGE_MAX_ASPECT_RATIO);
}

export function getListPaneMeasurements(isMobile: boolean): ListPaneMeasurements {
    return isMobile ? MOBILE_MEASUREMENTS : DESKTOP_MEASUREMENTS;
}

export function getSelectedTagPillToHide({
    selectionType,
    selectedTag,
    showSelectedNavigationPills
}: {
    selectionType: NavigationItemType | null | undefined;
    selectedTag: string | null | undefined;
    showSelectedNavigationPills: boolean;
}): string | null {
    if (showSelectedNavigationPills || selectionType !== ItemType.TAG) {
        return null;
    }

    return normalizeTagPath(selectedTag);
}

export function getSelectedPropertyValuePillToHide({
    selectionType,
    selectedProperty,
    showSelectedNavigationPills
}: {
    selectionType: NavigationItemType | null | undefined;
    selectedProperty: string | null | undefined;
    showSelectedNavigationPills: boolean;
}): string | null {
    if (showSelectedNavigationPills || selectionType !== ItemType.PROPERTY || !selectedProperty) {
        return null;
    }

    const parsedNode = parsePropertyNodeId(selectedProperty);
    if (!parsedNode?.valuePath) {
        return null;
    }

    return normalizePropertyNodeId(selectedProperty) ?? selectedProperty;
}

export function hasVisibleTagPills({
    tags,
    hiddenTagVisibility,
    selectedTagToHide
}: {
    tags: readonly string[];
    hiddenTagVisibility?: HiddenTagVisibility | null;
    selectedTagToHide?: string | null;
}): boolean {
    for (const tag of tags) {
        if (hiddenTagVisibility?.shouldFilterHiddenTags && !hiddenTagVisibility.isTagVisible(tag)) {
            continue;
        }

        if (selectedTagToHide && normalizeTagPath(tag) === selectedTagToHide) {
            continue;
        }

        return true;
    }

    return false;
}

type FrontmatterPropertyEntry = NonNullable<FileData['properties']>[number];
type FrontmatterPropertyEntries = NonNullable<FileData['properties']>;

export interface VisibleFrontmatterPropertyEntry {
    entry: FrontmatterPropertyEntry;
    trimmedFieldKey: string;
    rawValue: string;
    normalizedValuePath: string;
    isKeyOnlyValue: boolean;
    propertyNodeId?: string;
}

export function forEachVisibleFrontmatterProperty({
    properties,
    visiblePropertyKeys,
    hiddenPropertyValueNodeId,
    visitor
}: {
    properties: FileData['properties'] | undefined;
    visiblePropertyKeys?: ReadonlySet<string>;
    hiddenPropertyValueNodeId?: string | null;
    visitor: (property: VisibleFrontmatterPropertyEntry) => void | false;
}): void {
    if (!properties || properties.length === 0) {
        return;
    }

    for (const entry of properties) {
        const normalizedFieldKey = casefold(entry.fieldKey);
        if (visiblePropertyKeys && !visiblePropertyKeys.has(normalizedFieldKey)) {
            continue;
        }

        const rawValue = entry.value;
        if (rawValue.trim().length === 0) {
            continue;
        }

        const normalizedValuePath = normalizePropertyTreeValuePath(rawValue);
        const isKeyOnlyValue = entry.valueKind === 'boolean' ? false : isPropertyKeyOnlyValuePath(normalizedValuePath, entry.valueKind);
        if (entry.valueKind === undefined && isKeyOnlyValue) {
            continue;
        }

        const trimmedFieldKey = entry.fieldKey.trim();
        const rawPropertyNodeId =
            trimmedFieldKey.length === 0
                ? undefined
                : isKeyOnlyValue
                  ? buildPropertyKeyNodeId(trimmedFieldKey)
                  : buildPropertyValueNodeId(trimmedFieldKey, normalizedValuePath);
        const propertyNodeId = rawPropertyNodeId ? (normalizePropertyNodeId(rawPropertyNodeId) ?? rawPropertyNodeId) : undefined;

        if (hiddenPropertyValueNodeId && propertyNodeId === hiddenPropertyValueNodeId) {
            continue;
        }

        const result = visitor({
            entry,
            trimmedFieldKey,
            rawValue,
            normalizedValuePath,
            isKeyOnlyValue,
            propertyNodeId
        });
        if (result === false) {
            return;
        }
    }
}

export function isListPaneCompactMode({
    showDate,
    showPreview,
    showImage
}: {
    showDate: boolean;
    showPreview: boolean;
    showImage: boolean;
}): boolean {
    return !showDate && !showPreview && !showImage;
}

export function estimateRenderedTextRows({
    text,
    maxRows,
    charsPerRow
}: {
    text: string | null | undefined;
    maxRows: number;
    charsPerRow: number;
}): number {
    const normalizedMaxRows = Number.isFinite(maxRows) && maxRows > 0 ? Math.floor(maxRows) : 1;
    const normalizedCharsPerRow = Number.isFinite(charsPerRow) && charsPerRow > 0 ? Math.floor(charsPerRow) : 1;
    const normalizedText = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
    if (normalizedText.length === 0) {
        return 0;
    }

    if (normalizedMaxRows === 1) {
        return 1;
    }

    return Math.min(normalizedMaxRows, Math.max(1, Math.ceil(normalizedText.length / normalizedCharsPerRow)));
}

const DEFAULT_PILL_CONTAINER_WIDTH = 240;
const ESTIMATED_TAG_PILL_INLINE_SIZE = 72;
const ESTIMATED_TAG_ANCESTOR_PILL_INLINE_SIZE = 120;
const ESTIMATED_PROPERTY_PILL_INLINE_SIZE = 96;

export function estimateWrappedPillRowCount({
    pillCount,
    availableWidth,
    rowGap,
    estimatedPillInlineSize
}: {
    pillCount: number;
    availableWidth?: number;
    rowGap: number;
    estimatedPillInlineSize: number;
}): number {
    const normalizedPillCount = Number.isFinite(pillCount) && pillCount > 0 ? Math.floor(pillCount) : 0;
    if (normalizedPillCount === 0) {
        return 0;
    }

    const normalizedAvailableWidth =
        typeof availableWidth === 'number' && Number.isFinite(availableWidth) && availableWidth > 0
            ? availableWidth
            : DEFAULT_PILL_CONTAINER_WIDTH;
    const normalizedRowGap = Number.isFinite(rowGap) && rowGap > 0 ? rowGap : 0;
    const normalizedPillInlineSize =
        Number.isFinite(estimatedPillInlineSize) && estimatedPillInlineSize > 0
            ? Math.min(estimatedPillInlineSize, normalizedAvailableWidth)
            : normalizedAvailableWidth;
    const pillsPerRow = Math.max(
        1,
        Math.floor((normalizedAvailableWidth + normalizedRowGap) / (normalizedPillInlineSize + normalizedRowGap))
    );

    return Math.ceil(normalizedPillCount / pillsPerRow);
}

export function getTagPillDisplayName(tag: string, showFileTagAncestors: boolean): string {
    if (showFileTagAncestors) {
        return tag;
    }

    const segments = tag.split('/').filter(segment => segment.length > 0);
    if (segments.length === 0) {
        return tag;
    }

    return segments[segments.length - 1];
}

export function getTagPillRowCount({
    tags,
    hiddenTagVisibility,
    selectedTagToHide,
    showFileTagsOnMultipleRows,
    showFileTagAncestors,
    availableWidth,
    rowGap
}: {
    tags: readonly string[];
    hiddenTagVisibility?: HiddenTagVisibility | null;
    selectedTagToHide?: string | null;
    showFileTagsOnMultipleRows: boolean;
    showFileTagAncestors: boolean;
    availableWidth?: number;
    rowGap: number;
}): number {
    let visibleTagCount = 0;
    for (const tag of tags) {
        if (hiddenTagVisibility?.shouldFilterHiddenTags && !hiddenTagVisibility.isTagVisible(tag)) {
            continue;
        }

        if (selectedTagToHide && normalizeTagPath(tag) === selectedTagToHide) {
            continue;
        }

        if (!showFileTagsOnMultipleRows) {
            return 1;
        }

        visibleTagCount += 1;
    }

    if (visibleTagCount === 0) {
        return 0;
    }

    return estimateWrappedPillRowCount({
        pillCount: visibleTagCount,
        availableWidth,
        rowGap,
        estimatedPillInlineSize: showFileTagAncestors ? ESTIMATED_TAG_ANCESTOR_PILL_INLINE_SIZE : ESTIMATED_TAG_PILL_INLINE_SIZE
    });
}

export interface FileItemLayoutState {
    isCompactMode: boolean;
    shouldUseSingleLineForDateAndPreview: boolean;
    shouldShowMultilinePreview: boolean;
    shouldReplaceEmptyPreviewWithPills: boolean;
    shouldShowDateForItem: boolean;
    shouldShowSingleLineSecondLine: boolean;
}

export function getFileItemLayoutState({
    showDate,
    showPreview,
    showImage,
    previewRows,
    isPinned,
    hasPreviewContent,
    showFeatureImageArea,
    hasVisiblePillRows
}: {
    showDate: boolean;
    showPreview: boolean;
    showImage: boolean;
    previewRows: number;
    isPinned: boolean;
    hasPreviewContent: boolean;
    showFeatureImageArea: boolean;
    hasVisiblePillRows: boolean;
}): FileItemLayoutState {
    const isCompactMode = isListPaneCompactMode({ showDate, showPreview, showImage });
    const shouldUseSingleLineForDateAndPreview = isPinned || previewRows < 2;
    const shouldReplaceEmptyPreviewWithPills = !hasPreviewContent && hasVisiblePillRows;
    const shouldShowDateForItem = showDate && !isPinned;
    const shouldShowSingleLineSecondLine = shouldShowDateForItem || (showPreview && !shouldReplaceEmptyPreviewWithPills);
    const shouldShowMultilinePreview = showPreview && !shouldReplaceEmptyPreviewWithPills && (hasPreviewContent || showFeatureImageArea);

    return {
        isCompactMode,
        shouldUseSingleLineForDateAndPreview,
        shouldShowMultilinePreview,
        shouldReplaceEmptyPreviewWithPills,
        shouldShowDateForItem,
        shouldShowSingleLineSecondLine
    };
}

export function shouldShowFileItemParentFolderLine({
    showParentFolder,
    isPinned,
    selectionType,
    includeDescendantNotes,
    parentFolder,
    fileParentPath
}: {
    showParentFolder: boolean;
    isPinned: boolean;
    selectionType: NavigationItemType | null | undefined;
    includeDescendantNotes: boolean;
    parentFolder: string | null | undefined;
    fileParentPath: string | null | undefined;
}): boolean {
    if (!showParentFolder || isPinned || !fileParentPath || fileParentPath === '/') {
        return false;
    }

    if (selectionType === 'tag') {
        return true;
    }

    return includeDescendantNotes && Boolean(parentFolder) && fileParentPath !== parentFolder;
}

/**
 * Shared feature image visibility logic for list pane rendering and sizing.
 */
export function shouldShowFeatureImageArea({
    showImage,
    file,
    featureImageStatus,
    hasFeatureImageUrl
}: {
    showImage: boolean;
    file: TFile | null;
    featureImageStatus?: FeatureImageStatus | null;
    hasFeatureImageUrl?: boolean;
}): boolean {
    if (!showImage || !file) {
        return false;
    }

    if (hasFeatureImageUrl) {
        return true;
    }

    if (file.extension === 'canvas' || file.extension === 'base') {
        return true;
    }

    if (isImageFile(file)) {
        return true;
    }

    return featureImageStatus === 'has';
}

type VisibleFrontmatterPropertyPillCountCache = {
    unfiltered: Map<string, number>;
    filtered: WeakMap<ReadonlySet<string>, Map<string, number>>;
};

const visibleFrontmatterPropertyPillCountCache = new WeakMap<FrontmatterPropertyEntries, VisibleFrontmatterPropertyPillCountCache>();

function getVisibleFrontmatterPropertyPillCount({
    properties,
    visiblePropertyKeys,
    hiddenPropertyValueNodeId
}: {
    properties: FileData['properties'] | undefined;
    visiblePropertyKeys?: ReadonlySet<string>;
    hiddenPropertyValueNodeId?: string | null;
}): number {
    if (!properties || properties.length === 0) {
        return 0;
    }

    let cacheContainer = visibleFrontmatterPropertyPillCountCache.get(properties);
    if (!cacheContainer) {
        cacheContainer = {
            unfiltered: new Map<string, number>(),
            filtered: new WeakMap<ReadonlySet<string>, Map<string, number>>()
        };
        visibleFrontmatterPropertyPillCountCache.set(properties, cacheContainer);
    }

    let cacheBucket: Map<string, number>;
    if (!visiblePropertyKeys) {
        cacheBucket = cacheContainer.unfiltered;
    } else {
        const existingFilteredBucket = cacheContainer.filtered.get(visiblePropertyKeys);
        if (existingFilteredBucket) {
            cacheBucket = existingFilteredBucket;
        } else {
            cacheBucket = new Map<string, number>();
            cacheContainer.filtered.set(visiblePropertyKeys, cacheBucket);
        }
    }

    const hiddenPropertyCacheKey = hiddenPropertyValueNodeId ?? '';
    const cachedCount = cacheBucket.get(hiddenPropertyCacheKey);
    if (cachedCount !== undefined) {
        return cachedCount;
    }

    let pillCount = 0;

    forEachVisibleFrontmatterProperty({
        properties,
        visiblePropertyKeys,
        hiddenPropertyValueNodeId,
        visitor: () => {
            pillCount += 1;
        }
    });

    cacheBucket.set(hiddenPropertyCacheKey, pillCount);
    return pillCount;
}

export function getPropertyRowCount({
    notePropertyType,
    showFileProperties,
    showFilePropertiesOnMultipleRows,
    showFilePropertiesInCompactMode,
    isCompactMode,
    file,
    wordCount,
    properties,
    visiblePropertyKeys,
    hiddenPropertyValueNodeId,
    availableWidth,
    rowGap
}: {
    notePropertyType: NotePropertyType;
    showFileProperties: boolean;
    showFilePropertiesOnMultipleRows?: boolean;
    showFilePropertiesInCompactMode: boolean;
    isCompactMode: boolean;
    file: TFile | null;
    wordCount: FileData['wordCount'] | undefined;
    properties: FileData['properties'] | undefined;
    visiblePropertyKeys?: ReadonlySet<string>;
    hiddenPropertyValueNodeId?: string | null;
    availableWidth?: number;
    rowGap?: number;
}): number {
    // Computes the number of visual rows the property area will occupy.
    // This is used by the list pane virtualizer height estimator and must stay consistent with FileItem rendering.
    if (!file || file.extension !== 'md') {
        return 0;
    }

    if (isCompactMode && !showFilePropertiesInCompactMode) {
        return 0;
    }

    const wordCountEnabled =
        notePropertyType === 'wordCount' && typeof wordCount === 'number' && Number.isFinite(wordCount) && wordCount > 0;
    const wordCountRowCount = wordCountEnabled ? 1 : 0;

    if (!showFileProperties) {
        return wordCountRowCount;
    }

    if (!showFilePropertiesOnMultipleRows) {
        return getVisibleFrontmatterPropertyPillCount({
            properties,
            visiblePropertyKeys,
            hiddenPropertyValueNodeId
        }) > 0
            ? 1 + wordCountRowCount
            : wordCountRowCount;
    }

    const frontmatterPillCount = getVisibleFrontmatterPropertyPillCount({
        properties,
        visiblePropertyKeys,
        hiddenPropertyValueNodeId
    });
    if (frontmatterPillCount === 0) {
        return wordCountRowCount;
    }

    return (
        estimateWrappedPillRowCount({
            pillCount: frontmatterPillCount,
            availableWidth,
            rowGap: rowGap ?? 0,
            estimatedPillInlineSize: ESTIMATED_PROPERTY_PILL_INLINE_SIZE
        }) + wordCountRowCount
    );
}

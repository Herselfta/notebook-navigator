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

/**
 * useListPaneScroll - Orchestrates scrolling for the ListPane component
 *
 * ## Problem this solves:
 * The list pane rebuilds when navigating folders, changing settings, or applying
 * filters. Without proper synchronization, scrolls would execute before the list
 * updates, causing incorrect positioning or failed scrolls.
 *
 * ## Solution:
 * Priority-based scroll queue with version gating. Scrolls are prioritized by
 * importance and wait for list rebuilds before executing.
 *
 * ## Key concepts:
 * - **Priority system**: Higher priority scrolls override lower ones (reveal > navigation > visibility > config)
 * - **Index versioning**: Tracks list rebuilds for proper timing
 * - **Scroll reasons**: Different intents with specific alignment behaviors
 * - **Stabilization**: Handles rapid consecutive rebuilds gracefully
 *
 * ## Handles:
 * - Virtual list initialization with dynamic heights
 * - Folder/tag navigation with file preservation
 * - Configuration changes (descendants, appearance)
 * - Mobile drawer visibility
 * - Reveal operations (show active file)
 * - Search filter changes
 * - Sticky header tracking for date groups
 */

import { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import { TFile, TFolder } from 'obsidian';
import { useVirtualizer, Virtualizer } from '@tanstack/react-virtual';
import { useServices } from '../context/ServicesContext';
import { useFileCache } from '../context/StorageContext';
import { ItemType, ListPaneItemType, OVERSCAN } from '../types';
import { Align, ListScrollIntent, getListAlign, rankListPending } from '../types/scroll';
import type { ListPaneItem } from '../types/virtualization';
import type { NotebookNavigatorSettings } from '../settings';
import type { ListDisplayMode, ListNoteGroupingOption, NotePropertyType, SortOption } from '../settings/types';
import type { FileContentChange } from '../storage/IndexedDBStorage';
import type { SelectionDispatch, SelectionState } from '../context/SelectionContext';
import { calculateCompactListMetrics } from '../utils/listPaneMetrics';
import { getExtensionSuffix } from '../utils/fileTypeUtils';
import {
    estimateRenderedTextRows,
    getEstimatedFeatureImageInlineSize,
    getFileItemLayoutState,
    getFeatureImageDisplayMeasurements,
    getSelectedPropertyValuePillToHide,
    getSelectedTagPillToHide,
    getTagPillRowCount,
    getListPaneMeasurements,
    getPropertyRowCount,
    isListPaneCompactMode,
    shouldShowFeatureImageArea,
    shouldShowFileItemParentFolderLine
} from '../utils/listPaneMeasurements';
import type { PropertySelectionNodeId } from '../utils/propertyTree';
import { getCachedFileTags } from '../utils/tagUtils';
import type { HiddenTagVisibility } from '../utils/tagPrefixMatcher';

const LIST_PANE_WIDTH_CHANGE_EPSILON = 0.25;

/**
 * Parameters for the useListPaneScroll hook
 */
interface UseListPaneScrollParams {
    /** List items to be rendered in the virtual list */
    listItems: ListPaneItem[];
    /** Map from file paths to their index in listItems */
    filePathToIndex: Map<string, number>;
    /** Currently selected file */
    selectedFile: TFile | null;
    /** Currently selected folder */
    selectedFolder: TFolder | null;
    /** Currently selected tag */
    selectedTag: string | null;
    /** Currently selected property */
    selectedProperty: PropertySelectionNodeId | null;
    /** Plugin settings */
    settings: NotebookNavigatorSettings;
    /** Effective settings for the current folder */
    folderSettings: {
        mode: ListDisplayMode;
        titleRows: number;
        previewRows: number;
        notePropertyType: NotePropertyType;
        showDate: boolean;
        showPreview: boolean;
        showImage: boolean;
        groupBy: ListNoteGroupingOption;
    };
    /** Whether the list pane is currently visible */
    isVisible: boolean;
    /** Current selection state */
    selectionState: SelectionState;
    /** Selection state dispatcher */
    selectionDispatch: SelectionDispatch;
    /** Current search query (undefined if search is not active) */
    searchQuery?: string;
    /** Suppress scroll-to-top behavior after search filtering (used for mobile shortcuts) */
    suppressSearchTopScrollRef?: { current: boolean } | null;
    /** Height of the synthetic top spacer used ahead of file items */
    topSpacerHeight: number;
    /** Whether descendant notes should be shown */
    includeDescendantNotes: boolean;
    /** Visible frontmatter property keys for file list rows (normalized keys) */
    visiblePropertyKeys: ReadonlySet<string>;
    /** Stable key signature for visible frontmatter property keys */
    visiblePropertyKeySignature: string;
    /** Hidden tag filter rules shared with file-item pill rendering */
    hiddenTagVisibility: HiddenTagVisibility;
    /** Scroll margin used to offset the visible range and scrollToIndex alignment */
    scrollMargin?: number;
    /**
     * Bottom inset reserved by overlays that sit on top of the scroll content.
     *
     * The list pane can render a mobile floating toolbar at the bottom; scrolling and scrollToIndex
     * should keep the target row above that overlay.
     */
    scrollPaddingEnd?: number;
    /** Called when the virtualizer scrolling state changes */
    onVirtualizerScrollingChange?: (isScrolling: boolean, scrollElement: HTMLDivElement | null) => void;
}

type ListPaneAppearanceLayoutSettings = UseListPaneScrollParams['folderSettings'];
type ListLayoutSignatureSettings = Pick<
    NotebookNavigatorSettings,
    | 'compactItemHeight'
    | 'compactItemHeightScaleText'
    | 'featureImageSize'
    | 'forceSquareFeatureImage'
    | 'showFileIcons'
    | 'showFileProperties'
    | 'showFilePropertiesInCompactMode'
    | 'showFilePropertiesOnMultipleRows'
    | 'showFileTagAncestors'
    | 'showFileTags'
    | 'showFileTagsInCompactMode'
    | 'showFileTagsOnMultipleRows'
    | 'showParentFolder'
    | 'showSelectedNavigationPills'
    | 'showTags'
>;
type VisibleRowMeasurementSettings = Pick<
    NotebookNavigatorSettings,
    | 'colorFileProperties'
    | 'colorFileTags'
    | 'colorIconOnly'
    | 'enablePropertyExternalLinks'
    | 'inheritPropertyColors'
    | 'inheritTagColors'
    | 'prioritizeColoredFileProperties'
    | 'prioritizeColoredFileTags'
    | 'showParentFolderColor'
>;

/**
 * Return value of the useListPaneScroll hook
 */
interface UseListPaneScrollResult {
    /** TanStack Virtual virtualizer instance */
    rowVirtualizer: Virtualizer<HTMLDivElement, Element>;
    /** Reference to the scroll container element */
    scrollContainerRef: React.RefObject<HTMLDivElement | null>;
    /** Callback to set the scroll container ref */
    scrollContainerRefCallback: (element: HTMLDivElement | null) => void;
    /** Handler to scroll to top (mobile header tap) */
    handleScrollToTop: () => void;
}

// Path-index maps can be recreated with the same contents. Keep indexVersion tied to effective mapping changes.
function areFilePathIndexMapsEqual(previous: ReadonlyMap<string, number>, next: ReadonlyMap<string, number>): boolean {
    if (previous === next) {
        return true;
    }
    if (previous.size !== next.size) {
        return false;
    }
    for (const [path, index] of next) {
        if (previous.get(path) !== index) {
            return false;
        }
    }
    return true;
}

interface ListLayoutSignatureParams {
    topSpacerHeight: number;
    folderSettings: ListPaneAppearanceLayoutSettings;
    settings: ListLayoutSignatureSettings;
    selectionType: SelectionState['selectionType'];
    selectedTagToHide: string | null;
    selectedPropertyValueNodeIdToHide: string | null;
    includeDescendantNotes: boolean;
    hiddenTagVisibilitySignature: string;
    visiblePropertyKeySignature: string;
    estimatedPreviewCharsPerRow: number;
    estimatedTitleCharsPerRow: number;
    listMeasurements: ReturnType<typeof getListPaneMeasurements>;
}

interface ScrollPreservationSignatureParams {
    includeDescendantNotes: boolean;
    listLayoutSignature: string;
    groupBy: ListPaneAppearanceLayoutSettings['groupBy'];
    noteGrouping: NotebookNavigatorSettings['noteGrouping'];
    effectiveSort: SortOption;
    propertySortKey: NotebookNavigatorSettings['propertySortKey'];
    propertySortSecondary: NotebookNavigatorSettings['propertySortSecondary'];
}

interface PreviousScrollPreservationConfig {
    signature: string;
    includeDescendantNotes: boolean;
}

function getHiddenTagVisibilitySignature(hiddenTagVisibility: HiddenTagVisibility): string {
    const { matcher } = hiddenTagVisibility;
    return JSON.stringify({
        shouldFilterHiddenTags: hiddenTagVisibility.shouldFilterHiddenTags,
        matcher: {
            prefixes: matcher.prefixes,
            startsWithNames: matcher.startsWithNames,
            endsWithNames: matcher.endsWithNames,
            pathPatterns: matcher.pathPatterns
        }
    });
}

function getListLayoutSignature({
    topSpacerHeight,
    folderSettings,
    settings,
    selectionType,
    selectedTagToHide,
    selectedPropertyValueNodeIdToHide,
    includeDescendantNotes,
    hiddenTagVisibilitySignature,
    visiblePropertyKeySignature,
    estimatedPreviewCharsPerRow,
    estimatedTitleCharsPerRow,
    listMeasurements
}: ListLayoutSignatureParams): string {
    return JSON.stringify({
        spacers: {
            topSpacerHeight
        },
        appearance: {
            mode: folderSettings.mode,
            titleRows: folderSettings.titleRows,
            previewRows: folderSettings.previewRows,
            notePropertyType: folderSettings.notePropertyType,
            groupBy: folderSettings.groupBy,
            showDate: folderSettings.showDate,
            showPreview: folderSettings.showPreview,
            showImage: folderSettings.showImage
        },
        rowContent: {
            showFileProperties: settings.showFileProperties,
            showFilePropertiesInCompactMode: settings.showFilePropertiesInCompactMode,
            showFilePropertiesOnMultipleRows: settings.showFilePropertiesOnMultipleRows,
            showSelectedNavigationPills: settings.showSelectedNavigationPills,
            visiblePropertyKeySignature,
            showParentFolder: settings.showParentFolder,
            showTags: settings.showTags,
            showFileTags: settings.showFileTags,
            showFileTagsInCompactMode: settings.showFileTagsInCompactMode,
            showFileTagsOnMultipleRows: settings.showFileTagsOnMultipleRows,
            showFileTagAncestors: settings.showFileTagAncestors,
            showFileIcons: settings.showFileIcons,
            featureImageSize: settings.featureImageSize,
            forceSquareFeatureImage: settings.forceSquareFeatureImage,
            selectionType: selectionType ?? null,
            selectedTagToHide,
            selectedPropertyValueNodeIdToHide,
            includeDescendantNotes,
            hiddenTagVisibilitySignature
        },
        variableHeight: {
            compactItemHeight: settings.compactItemHeight,
            compactItemHeightScaleText: settings.compactItemHeightScaleText,
            estimatedPreviewCharsPerRow,
            estimatedTitleCharsPerRow
        },
        measurements: listMeasurements
    });
}

function getVisibleRowMeasurementSignature(settings: VisibleRowMeasurementSettings): string {
    return JSON.stringify(settings);
}

function getScrollPreservationSignature({
    includeDescendantNotes,
    listLayoutSignature,
    groupBy,
    noteGrouping,
    effectiveSort,
    propertySortKey,
    propertySortSecondary
}: ScrollPreservationSignatureParams): string {
    return JSON.stringify({
        includeDescendantNotes,
        listLayoutSignature,
        groupBy,
        noteGrouping,
        effectiveSort,
        propertySortKey: propertySortKey ?? null,
        propertySortSecondary
    });
}

export function getListPaneScrollerClientWidth(element: HTMLElement): number {
    const width = element.clientWidth;
    return Number.isFinite(width) ? Math.max(0, width) : 0;
}

function hasMeaningfulListPaneWidthChange(previousWidth: number, nextWidth: number): boolean {
    return Math.abs(previousWidth - nextWidth) >= LIST_PANE_WIDTH_CHANGE_EPSILON;
}

export function getEstimatedPillContainerWidth({
    scrollContainerWidth,
    scrollerHorizontalPadding,
    fileItemHorizontalPadding,
    showFileIcons,
    fileIconSize,
    fileIconSlotGap,
    showFeatureImageArea,
    featureImageInlineSize,
    fileRowGap
}: {
    scrollContainerWidth: number;
    scrollerHorizontalPadding: number;
    fileItemHorizontalPadding: number;
    showFileIcons: boolean;
    fileIconSize: number;
    fileIconSlotGap: number;
    showFeatureImageArea: boolean;
    featureImageInlineSize: number;
    fileRowGap: number;
}): number | undefined {
    if (scrollContainerWidth <= 0) {
        return undefined;
    }

    return Math.max(
        1,
        scrollContainerWidth -
            scrollerHorizontalPadding * 2 -
            fileItemHorizontalPadding * 2 -
            (showFileIcons ? fileIconSize + fileIconSlotGap : 0) -
            (showFeatureImageArea ? featureImageInlineSize + fileRowGap : 0)
    );
}

function hasFiniteBlockSize(value: unknown): value is { blockSize: number } {
    return (
        typeof value === 'object' &&
        value !== null &&
        'blockSize' in value &&
        typeof value.blockSize === 'number' &&
        Number.isFinite(value.blockSize)
    );
}

function getResizeObserverEntryBorderBoxHeight(entry: ResizeObserverEntry): number | null {
    const borderBoxSizeEntry: unknown = entry.borderBoxSize;
    const borderBoxSize: unknown = Array.isArray(borderBoxSizeEntry) ? (borderBoxSizeEntry as unknown[])[0] : borderBoxSizeEntry;
    if (hasFiniteBlockSize(borderBoxSize)) {
        return Math.max(0, borderBoxSize.blockSize);
    }

    return null;
}

export function getMeasuredVirtualItemHeight(element: Element, entry: ResizeObserverEntry | undefined): number {
    const borderBoxHeight = entry ? getResizeObserverEntryBorderBoxHeight(entry) : null;
    if (borderBoxHeight !== null) {
        return borderBoxHeight;
    }

    const height = element.getBoundingClientRect().height;
    return Number.isFinite(height) ? Math.max(0, height) : 0;
}

export function isListRowHeightAffectingContentChange(change: FileContentChange): boolean {
    return (
        change.changes.preview !== undefined ||
        change.changes.featureImageKey !== undefined ||
        change.changes.featureImageStatus !== undefined ||
        change.metadataNameChanged === true ||
        change.changes.properties !== undefined ||
        change.changes.tags !== undefined ||
        change.changes.wordCount !== undefined ||
        change.metadataIconOrColorChanged === true
    );
}

/**
 * Hook that manages scrolling behavior for the ListPane component.
 * Handles virtualization, scroll position, and various scroll scenarios.
 *
 * @param params - Configuration parameters
 * @returns Virtualizer instance and scroll management utilities
 */
export function useListPaneScroll({
    listItems,
    filePathToIndex,
    selectedFile,
    selectedFolder,
    selectedTag,
    selectedProperty,
    settings,
    folderSettings,
    isVisible,
    selectionState,
    selectionDispatch,
    searchQuery,
    suppressSearchTopScrollRef,
    topSpacerHeight,
    includeDescendantNotes,
    visiblePropertyKeys,
    visiblePropertyKeySignature,
    hiddenTagVisibility,
    scrollMargin = 0,
    scrollPaddingEnd = 0,
    onVirtualizerScrollingChange
}: UseListPaneScrollParams): UseListPaneScrollResult {
    const { app, isMobile } = useServices();
    const listMeasurements = getListPaneMeasurements(isMobile);
    const { hasPreview, getDB, getFileDisplayName, isStorageReady } = useFileCache();
    // The list pane only renders after StorageContext marks storage ready.
    const db = getDB();

    // Calculate compact list padding for height estimation in virtualization
    const compactListMetrics = useMemo(
        () =>
            calculateCompactListMetrics({
                compactItemHeight: settings.compactItemHeight,
                scaleText: settings.compactItemHeightScaleText,
                titleLineHeight: listMeasurements.titleLineHeight
            }),
        [listMeasurements.titleLineHeight, settings.compactItemHeight, settings.compactItemHeightScaleText]
    );
    const estimatedTitleCharsPerRow = isMobile ? 22 : 28;
    const estimatedPreviewCharsPerRow = isMobile ? 44 : 60;

    // Reference to the scroll container DOM element
    const scrollContainerRef = useRef<HTMLDivElement | null>(null);
    const scrollContainerWidthRef = useRef<number>(0);
    const [scrollContainerEl, setScrollContainerEl] = useState<HTMLDivElement | null>(null);
    const [containerVisible, setContainerVisible] = useState<boolean>(false);

    // Track list state changes and pending scroll operations
    const prevListKeyRef = useRef<string>(''); // Previous folder/tag context to detect navigation
    const prevScrollPreservationConfigRef = useRef<PreviousScrollPreservationConfig | null>(null);
    const prevSearchQueryRef = useRef<string | undefined>(undefined); // Track search query changes

    // ========== Scroll Orchestration ==========
    // Scroll reasons determine priority and alignment behavior
    type ScrollReason = ListScrollIntent;

    // Pending scroll stores requests until list is ready
    type PendingScroll = {
        type: 'file' | 'top'; // Scroll to specific file or top of list
        filePath?: string; // Target file path (for type='file')
        reason?: ScrollReason; // Why this scroll was requested
        minIndexVersion?: number; // Don't execute until indexVersion >= this
    };
    const pendingScrollRef = useRef<PendingScroll | null>(null);
    const [pendingScrollVersion, setPendingScrollVersion] = useState(0); // Triggers effect re-run
    // Tracks the currently selected file path to detect stale pending scrolls
    const selectedFilePathRef = useRef<string | null>(selectedFile ? selectedFile.path : null);

    // ========== Index Version Tracking ==========
    // Increments when list rebuilds to ensure scrolls execute with correct indices
    const indexVersionRef = useRef<number>(0);
    const prevIndexMapSizeRef = useRef<number>(filePathToIndex.size);
    const prevIndexMapObjRef = useRef<Map<string, number> | null>(null);

    // Context tracking for index-version based reorder detection within a list context
    const contextIndexVersionRef = useRef<{ key: string; version: number } | null>(null);
    const lastReportedVirtualizerScrollingRef = useRef(false);

    // Check if we're in compact mode
    const isCompactMode = isListPaneCompactMode({
        showDate: folderSettings.showDate,
        showPreview: folderSettings.showPreview,
        showImage: folderSettings.showImage
    });
    const revealFileOnListChanges = settings.revealFileOnListChanges;
    const hasSelectedFile = Boolean(selectedFile);
    const selectedTagToHide = useMemo(
        () =>
            getSelectedTagPillToHide({
                selectionType: selectionState.selectionType,
                selectedTag: selectionState.selectedTag,
                showSelectedNavigationPills: settings.showSelectedNavigationPills
            }),
        [selectionState.selectedTag, selectionState.selectionType, settings.showSelectedNavigationPills]
    );
    const selectedPropertyValueNodeIdToHide = useMemo(
        () =>
            getSelectedPropertyValuePillToHide({
                selectionType: selectionState.selectionType,
                selectedProperty: selectionState.selectedProperty,
                showSelectedNavigationPills: settings.showSelectedNavigationPills
            }),
        [selectionState.selectedProperty, selectionState.selectionType, settings.showSelectedNavigationPills]
    );

    /**
     * Initialize TanStack Virtual virtualizer with dynamic height calculation.
     * Handles different item types (headers, files, spacers) with appropriate heights.
     */
    const effectiveScrollMargin = Number.isFinite(scrollMargin) && scrollMargin > 0 ? scrollMargin : 0;
    const effectiveScrollPaddingEnd = Number.isFinite(scrollPaddingEnd) && scrollPaddingEnd > 0 ? scrollPaddingEnd : 0;
    const measureVirtualItemElement = useCallback(getMeasuredVirtualItemHeight, []);
    const rowVirtualizer = useVirtualizer({
        count: listItems.length,
        getItemKey: index => listItems[index]?.key ?? index,
        getScrollElement: () => {
            const element = scrollContainerRef.current;
            if (!element) {
                // No element available yet
            }
            return element;
        },
        // Align virtualizer scroll math with the start of the file rows (excluding overlay chrome).
        scrollMargin: effectiveScrollMargin,
        measureElement: measureVirtualItemElement,
        // Ensure scrollToIndex aligns items below the overlay chrome instead of under it.
        scrollPaddingStart: effectiveScrollMargin,
        estimateSize: index => {
            const item = listItems[index];
            const heights = listMeasurements;

            if (item.type === ListPaneItemType.HEADER) {
                // Date group headers have fixed heights from CSS
                // Index 1 because TOP_SPACER is at index 0
                const isFirstHeader = index === 1;
                if (isFirstHeader) {
                    return heights.firstHeader;
                }
                return heights.subsequentHeader;
            }

            if (item.type === ListPaneItemType.TOP_SPACER) {
                return topSpacerHeight;
            }
            if (item.type === ListPaneItemType.BOTTOM_SPACER) {
                return listMeasurements.bottomSpacer;
            }

            // For file items - calculate height including all components
            const file = item.type === ListPaneItemType.FILE && item.data instanceof TFile ? item.data : null;
            const fileRecord = file ? db.getFile(file.path) : null;

            // Get actual preview status for accurate height calculation
            let hasPreviewText = false;
            let hasOmnisearchExcerpt = false;
            let effectivePreviewText = '';
            if (file && folderSettings.showPreview) {
                if (file.extension === 'md') {
                    // Use synchronous check from cache for markdown preview text
                    hasPreviewText = hasPreview(file.path);
                }
                const excerpt = item.searchMeta?.excerpt;
                hasOmnisearchExcerpt = typeof excerpt === 'string' && excerpt.length > 0;
                effectivePreviewText = hasOmnisearchExcerpt && typeof excerpt === 'string' ? excerpt : db.getCachedPreviewText(file.path);
            }
            const hasPreviewContent = hasPreviewText || hasOmnisearchExcerpt;

            // Keep height estimation aligned with FileItem feature image rendering.
            // getFile reads from the in-memory cache; no IndexedDB reads occur during sizing.
            const featureImageStatus = fileRecord?.featureImageStatus ?? null;
            const showFeatureImageArea = shouldShowFeatureImageArea({
                showImage: folderSettings.showImage,
                file,
                featureImageStatus
            });
            const featureImageMaxSize = showFeatureImageArea
                ? getFeatureImageDisplayMeasurements(settings.featureImageSize).listMaxSize
                : 0;

            // Visibility and wrapping estimate for the tags area.
            const shouldShowFileTags = settings.showTags && settings.showFileTags && (!isCompactMode || settings.showFileTagsInCompactMode);
            const cachedTags =
                shouldShowFileTags && item.type === ListPaneItemType.FILE && item.hasTags && file
                    ? getCachedFileTags({ app, file, db, fileData: fileRecord })
                    : [];
            const showParentFolderLine = shouldShowFileItemParentFolderLine({
                showParentFolder: settings.showParentFolder,
                isPinned: Boolean(item.isPinned),
                selectionType: selectionState.selectionType,
                includeDescendantNotes,
                parentFolder: item.parentFolder,
                fileParentPath: file?.parent?.path ?? null
            });

            const estimatedTitleText = file ? `${getFileDisplayName(file)}${getExtensionSuffix(file)}` : '';
            const estimatedTitleRows = estimateRenderedTextRows({
                text: estimatedTitleText,
                maxRows: folderSettings.titleRows || 1,
                charsPerRow: estimatedTitleCharsPerRow
            });
            const estimatedPreviewRows = estimateRenderedTextRows({
                text: effectivePreviewText,
                maxRows: folderSettings.previewRows,
                charsPerRow: estimatedPreviewCharsPerRow
            });

            const availablePillWidth =
                scrollContainerWidthRef.current > 0
                    ? getEstimatedPillContainerWidth({
                          scrollContainerWidth: scrollContainerWidthRef.current,
                          scrollerHorizontalPadding: heights.scrollerHorizontalPadding,
                          fileItemHorizontalPadding: heights.fileItemHorizontalPadding,
                          showFileIcons: settings.showFileIcons,
                          fileIconSize: heights.fileIconSize,
                          fileIconSlotGap: heights.fileIconSlotGap,
                          showFeatureImageArea,
                          featureImageInlineSize: showFeatureImageArea
                              ? getEstimatedFeatureImageInlineSize({
                                    blockSize: featureImageMaxSize,
                                    forceSquareFeatureImage: settings.forceSquareFeatureImage
                                })
                              : 0,
                          fileRowGap: heights.fileRowGap
                      })
                    : undefined;
            const tagRowCount =
                cachedTags.length > 0
                    ? getTagPillRowCount({
                          tags: cachedTags,
                          hiddenTagVisibility,
                          selectedTagToHide,
                          showFileTagsOnMultipleRows: settings.showFileTagsOnMultipleRows,
                          showFileTagAncestors: settings.showFileTagAncestors,
                          availableWidth: availablePillWidth,
                          rowGap: heights.tagRowGap
                      })
                    : 0;

            // Keep visibility filtering aligned with FileItem rendering; wrapping is intentionally approximate.
            const propertyRowCount = getPropertyRowCount({
                notePropertyType: folderSettings.notePropertyType,
                showFileProperties: settings.showFileProperties,
                showFilePropertiesOnMultipleRows: settings.showFilePropertiesOnMultipleRows,
                showFilePropertiesInCompactMode: settings.showFilePropertiesInCompactMode,
                isCompactMode,
                file,
                wordCount: fileRecord?.wordCount ?? undefined,
                properties: fileRecord?.properties ?? undefined,
                visiblePropertyKeys,
                hiddenPropertyValueNodeId: selectedPropertyValueNodeIdToHide,
                availableWidth: availablePillWidth,
                rowGap: heights.tagRowGap
            });

            const estimateTextContentHeight = (tagRowCount: number, propertyRowCount: number): number => {
                const hasVisiblePillRows = tagRowCount > 0 || propertyRowCount > 0;
                const layoutState = getFileItemLayoutState({
                    showDate: folderSettings.showDate,
                    showPreview: folderSettings.showPreview,
                    showImage: folderSettings.showImage,
                    previewRows: folderSettings.previewRows,
                    isPinned: Boolean(item.isPinned),
                    hasPreviewContent,
                    showFeatureImageArea,
                    hasVisiblePillRows
                });

                // Start with base padding
                let nextTextContentHeight = 0;
                if (layoutState.isCompactMode) {
                    // Compact mode: only shows file name
                    nextTextContentHeight = heights.titleLineHeight * Math.max(1, estimatedTitleRows);
                } else {
                    // Normal mode
                    nextTextContentHeight += heights.titleLineHeight * Math.max(1, estimatedTitleRows); // File name

                    // Single row mode - show date+preview, tags, and parent folder
                    if (layoutState.shouldUseSingleLineForDateAndPreview) {
                        // Date and preview share one line
                        if (layoutState.shouldShowSingleLineSecondLine) {
                            nextTextContentHeight += heights.singleTextLineHeight;
                        }

                        if (showParentFolderLine) {
                            nextTextContentHeight += heights.singleTextLineHeight;
                        }
                    } else {
                        if (layoutState.shouldShowMultilinePreview && estimatedPreviewRows > 0) {
                            nextTextContentHeight += heights.multilineTextLineHeight * estimatedPreviewRows;
                        }

                        if (layoutState.shouldShowDateForItem || showParentFolderLine) {
                            nextTextContentHeight += heights.singleTextLineHeight;
                        }
                    }
                }

                // Add space for tags if file has tags and they are visible in this mode
                if (tagRowCount > 0) {
                    nextTextContentHeight += heights.tagRowHeight * tagRowCount;
                }

                if (propertyRowCount > 0) {
                    // `tagRowHeight` mirrors the combined CSS row height + margin-top gap for pill rows.
                    nextTextContentHeight += heights.tagRowHeight * propertyRowCount;
                }

                // Keep the estimated text area at least as tall as the shared thumbnail floor in normal mode.
                if (!isCompactMode && nextTextContentHeight < heights.featureImageHeight) {
                    nextTextContentHeight = heights.featureImageHeight;
                }

                return nextTextContentHeight;
            };

            const textContentHeight = estimateTextContentHeight(tagRowCount, propertyRowCount);

            // Use reduced padding for compact mode (with mobile-specific padding)
            const padding = isCompactMode
                ? isMobile
                    ? compactListMetrics.mobilePaddingTotal
                    : compactListMetrics.desktopPaddingTotal
                : heights.basePadding;
            return padding + textContentHeight;
        },
        overscan: OVERSCAN,
        scrollPaddingEnd: effectiveScrollPaddingEnd,
        useScrollendEvent: true,
        useAnimationFrameWithResizeObserver: true,
        onChange: instance => {
            const nextIsScrolling = instance.isScrolling;
            if (lastReportedVirtualizerScrollingRef.current === nextIsScrolling) {
                return;
            }

            lastReportedVirtualizerScrollingRef.current = nextIsScrolling;
            onVirtualizerScrollingChange?.(nextIsScrolling, instance.scrollElement);
        }
    });
    const remeasureRafRef = useRef<number | null>(null);
    const remeasureVisibleRows = useCallback(() => {
        if (!rowVirtualizer) {
            return;
        }
        if (remeasureRafRef.current !== null) {
            return;
        }

        remeasureRafRef.current = requestAnimationFrame(() => {
            remeasureRafRef.current = null;

            const scrollEl = scrollContainerRef.current;
            if (!scrollEl) {
                return;
            }

            const visibleFileRows = scrollEl.querySelectorAll<HTMLElement>('.nn-virtual-file-item[data-index]');
            visibleFileRows.forEach(node => {
                if (node.isConnected) {
                    rowVirtualizer.measureElement(node);
                }
            });
        });
    }, [rowVirtualizer]);
    const resetAndRemeasureVisibleRows = useCallback(() => {
        if (!rowVirtualizer) {
            return;
        }

        // TanStack Virtual clears the item size cache on `measure()`.
        // Re-measure the mounted rows on the next frame so visible items settle
        // to their exact post-commit heights instead of waiting for remount/resize.
        rowVirtualizer.measure();
        remeasureVisibleRows();
    }, [rowVirtualizer, remeasureVisibleRows]);

    /**
     * Callback for when scroll container ref is set.
     * Used as a ref callback to capture the DOM element.
     */
    const scrollContainerRefCallback = useCallback((element: HTMLDivElement | null) => {
        scrollContainerRef.current = element;
        setScrollContainerEl(element);
        if (!element) {
            setContainerVisible(false);
            scrollContainerWidthRef.current = 0;
            return;
        }

        scrollContainerWidthRef.current = getListPaneScrollerClientWidth(element);
    }, []);

    /**
     * Track the rendered visibility of the list scroll container.
     * TanStack Virtual scroll calls should not execute while the container (or parent)
     * is hidden because they will fail internally and emit retry errors.
     */
    useEffect(() => {
        const element = scrollContainerEl;
        if (!element) {
            setContainerVisible(false);
            scrollContainerWidthRef.current = 0;
            return;
        }

        const updateVisibility = () => {
            const rect = element.getBoundingClientRect();
            const isContainerVisible = rect.width > 0 && rect.height > 0;
            const nextWidth = getListPaneScrollerClientWidth(element);
            const previousWidth = scrollContainerWidthRef.current;
            setContainerVisible(prev => (prev === isContainerVisible ? prev : isContainerVisible));
            if (hasMeaningfulListPaneWidthChange(previousWidth, nextWidth)) {
                scrollContainerWidthRef.current = nextWidth;
                if (isContainerVisible) {
                    remeasureVisibleRows();
                }
            }
        };

        updateVisibility();

        if (typeof ResizeObserver === 'undefined') {
            const handleWindowResize = () => updateVisibility();
            window.addEventListener('resize', handleWindowResize);
            return () => {
                window.removeEventListener('resize', handleWindowResize);
            };
        }

        const observer = new ResizeObserver(entries => {
            const entry = entries[0];
            if (!entry) {
                return;
            }
            const { width, height } = entry.contentRect;
            const isContainerVisible = width > 0 && height > 0;
            const nextWidth = getListPaneScrollerClientWidth(element);
            const previousWidth = scrollContainerWidthRef.current;
            setContainerVisible(prev => (prev === isContainerVisible ? prev : isContainerVisible));
            if (hasMeaningfulListPaneWidthChange(previousWidth, nextWidth)) {
                scrollContainerWidthRef.current = nextWidth;
                if (isContainerVisible) {
                    remeasureVisibleRows();
                }
            }
        });

        observer.observe(element);

        return () => observer.disconnect();
    }, [remeasureVisibleRows, scrollContainerEl]);

    useEffect(() => {
        return () => {
            if (remeasureRafRef.current !== null) {
                cancelAnimationFrame(remeasureRafRef.current);
                remeasureRafRef.current = null;
            }
        };
    }, []);

    // Container is ready when both the list pane and the physical container are visible
    const isScrollContainerReady = isVisible && containerVisible;

    // Tracks inputs that affect estimated or measured row heights.
    const hiddenTagVisibilitySignature = useMemo(() => getHiddenTagVisibilitySignature(hiddenTagVisibility), [hiddenTagVisibility]);
    const listLayoutSettings = useMemo<ListLayoutSignatureSettings>(
        () => ({
            compactItemHeight: settings.compactItemHeight,
            compactItemHeightScaleText: settings.compactItemHeightScaleText,
            featureImageSize: settings.featureImageSize,
            forceSquareFeatureImage: settings.forceSquareFeatureImage,
            showFileIcons: settings.showFileIcons,
            showFileProperties: settings.showFileProperties,
            showFilePropertiesInCompactMode: settings.showFilePropertiesInCompactMode,
            showFilePropertiesOnMultipleRows: settings.showFilePropertiesOnMultipleRows,
            showFileTagAncestors: settings.showFileTagAncestors,
            showFileTags: settings.showFileTags,
            showFileTagsInCompactMode: settings.showFileTagsInCompactMode,
            showFileTagsOnMultipleRows: settings.showFileTagsOnMultipleRows,
            showParentFolder: settings.showParentFolder,
            showSelectedNavigationPills: settings.showSelectedNavigationPills,
            showTags: settings.showTags
        }),
        [
            settings.compactItemHeight,
            settings.compactItemHeightScaleText,
            settings.featureImageSize,
            settings.forceSquareFeatureImage,
            settings.showFileIcons,
            settings.showFileProperties,
            settings.showFilePropertiesInCompactMode,
            settings.showFilePropertiesOnMultipleRows,
            settings.showFileTagAncestors,
            settings.showFileTags,
            settings.showFileTagsInCompactMode,
            settings.showFileTagsOnMultipleRows,
            settings.showParentFolder,
            settings.showSelectedNavigationPills,
            settings.showTags
        ]
    );
    const visibleRowMeasurementSettings = useMemo<VisibleRowMeasurementSettings>(
        () => ({
            colorFileProperties: settings.colorFileProperties,
            colorFileTags: settings.colorFileTags,
            colorIconOnly: settings.colorIconOnly,
            enablePropertyExternalLinks: settings.enablePropertyExternalLinks,
            inheritPropertyColors: settings.inheritPropertyColors,
            inheritTagColors: settings.inheritTagColors,
            prioritizeColoredFileProperties: settings.prioritizeColoredFileProperties,
            prioritizeColoredFileTags: settings.prioritizeColoredFileTags,
            showParentFolderColor: settings.showParentFolderColor
        }),
        [
            settings.colorFileProperties,
            settings.colorFileTags,
            settings.colorIconOnly,
            settings.enablePropertyExternalLinks,
            settings.inheritPropertyColors,
            settings.inheritTagColors,
            settings.prioritizeColoredFileProperties,
            settings.prioritizeColoredFileTags,
            settings.showParentFolderColor
        ]
    );
    const visibleRowMeasurementSignature = useMemo(
        () => getVisibleRowMeasurementSignature(visibleRowMeasurementSettings),
        [visibleRowMeasurementSettings]
    );
    const listLayoutSignature = useMemo(
        () =>
            getListLayoutSignature({
                topSpacerHeight,
                folderSettings,
                settings: listLayoutSettings,
                selectionType: selectionState.selectionType,
                selectedTagToHide,
                selectedPropertyValueNodeIdToHide,
                includeDescendantNotes,
                hiddenTagVisibilitySignature,
                visiblePropertyKeySignature,
                estimatedPreviewCharsPerRow,
                estimatedTitleCharsPerRow,
                listMeasurements
            }),
        [
            topSpacerHeight,
            folderSettings,
            listLayoutSettings,
            selectionState.selectionType,
            selectedTagToHide,
            selectedPropertyValueNodeIdToHide,
            includeDescendantNotes,
            hiddenTagVisibilitySignature,
            visiblePropertyKeySignature,
            estimatedPreviewCharsPerRow,
            estimatedTitleCharsPerRow,
            listMeasurements
        ]
    );

    /**
     * Scroll to top handler for mobile header tap.
     */
    const handleScrollToTop = useCallback(() => {
        if (isMobile && scrollContainerRef.current) {
            scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }, [isMobile]);

    // Get scroll index for a file, adjusting to show top group header when navigating folders
    // This ensures the top group header (pinned or date) is visible when changing folders/tags
    const getSelectionIndex = useCallback(
        (filePath: string) => {
            const fileIndex = filePathToIndex.get(filePath);

            // File not found in index
            if (fileIndex === undefined || fileIndex === -1) {
                return -1;
            }

            // Check if there's a header immediately before this file
            const hasHeaderBefore = fileIndex > 0 && listItems[fileIndex - 1]?.type === ListPaneItemType.HEADER;
            if (!hasHeaderBefore) {
                return fileIndex;
            }

            // Special case: scroll to header for the very first file to show context
            // Index 0 is TOP_SPACER, Index 1 is first header (if exists), Index 2 is first file
            const isFirstFile = fileIndex <= 2;
            if (isFirstFile) {
                return fileIndex - 1; // Show the header above
            }

            // For all other files with headers, scroll directly to the file
            return fileIndex;
        },
        [filePathToIndex, listItems]
    );

    /**
     * Increment indexVersion when list structure changes.
     * Critical for ensuring scrolls execute after list rebuilds.
     */
    useEffect(() => {
        const previousMap = prevIndexMapObjRef.current;
        const mappingChanged = previousMap === null || !areFilePathIndexMapsEqual(previousMap, filePathToIndex);

        if (mappingChanged) {
            prevIndexMapSizeRef.current = filePathToIndex.size;
            prevIndexMapObjRef.current = filePathToIndex;
            indexVersionRef.current = indexVersionRef.current + 1;
            return;
        }

        if (prevIndexMapSizeRef.current !== filePathToIndex.size || prevIndexMapObjRef.current !== filePathToIndex) {
            prevIndexMapSizeRef.current = filePathToIndex.size;
            prevIndexMapObjRef.current = filePathToIndex;
        }
    }, [filePathToIndex, filePathToIndex.size]);

    /**
     * Priority-based scroll queue management.
     * Higher priority scrolls override lower priority ones.
     *
     * Priority order (lowest to highest):
     * 0. top - Scroll to top of list
     * 1. list-structure-change - Settings/layout changes within current context
     * 2. visibility-change - Mobile drawer opened
     * 3. folder-navigation - User changed folders
     * 4. reveal - Show active file command
     */
    const clearPending = useCallback(() => {
        // Drop any stale pending request so new context-specific scrolls can be queued
        if (pendingScrollRef.current) {
            pendingScrollRef.current = null;
            setPendingScrollVersion(v => v + 1);
        }
    }, []);

    const setPending = useCallback((next: PendingScroll) => {
        const current = pendingScrollRef.current;
        if (!current) {
            pendingScrollRef.current = next;
            setPendingScrollVersion(v => v + 1);
            return;
        }

        const nextRank = rankListPending(next);
        const currentRank = rankListPending(current);

        if (nextRank >= currentRank) {
            pendingScrollRef.current = next;
            setPendingScrollVersion(v => v + 1);
        }
    }, []);

    /**
     * Keep selectedFilePathRef in sync with the current selected file.
     * Used to detect and skip stale pending scrolls to previous selections.
     */
    useEffect(() => {
        selectedFilePathRef.current = selectedFile?.path ?? null;
    }, [selectedFile?.path]);

    /**
     * Process pending scrolls when conditions are met.
     * Central execution point for all scroll operations.
     *
     * Execution requirements:
     * 1. List must be visible
     * 2. Virtualizer must be ready
     * 3. indexVersion must meet minimum requirement
     *
     * Alignment policy:
     * - folder-navigation: center on mobile, auto on desktop
     * - visibility-change: auto (minimal movement)
     * - reveal: auto (show if not visible)
     * - list-structure-change: auto (maintain position)
     * - list-reorder: auto (maintain selection visibility)
     */
    useEffect(() => {
        if (!rowVirtualizer || !pendingScrollRef.current || !isScrollContainerReady) {
            return;
        }

        const pending = pendingScrollRef.current;
        let shouldClearPending = false;

        // Version gate: Wait for list rebuild if required
        const effectiveMin = pending.minIndexVersion ?? indexVersionRef.current;
        if (indexVersionRef.current < effectiveMin) {
            return;
        }

        if (pending.type === 'file') {
            const isStructuralChange = pending.reason === 'list-structure-change';

            if (!revealFileOnListChanges && isStructuralChange) {
                shouldClearPending = true;
            } else if (
                isStructuralChange &&
                pending.filePath &&
                selectedFilePathRef.current &&
                pending.filePath !== selectedFilePathRef.current
            ) {
                shouldClearPending = true;
            } else if (pending.filePath) {
                const index = getSelectionIndex(pending.filePath);
                if (index >= 0) {
                    let alignment: Align = getListAlign(pending.reason);
                    if (pending.reason === 'reveal' && selectionState.revealSource === 'startup') {
                        alignment = 'center';
                    }
                    rowVirtualizer.scrollToIndex(index, { align: alignment });

                    if (isStructuralChange) {
                        // Stabilization mechanism: Handle rapid consecutive rebuilds
                        const usedIndex = index;
                        const usedPath = pending.filePath;
                        requestAnimationFrame(() => {
                            const newIndex = usedPath ? getSelectionIndex(usedPath) : -1;
                            if (usedPath && newIndex >= 0 && newIndex !== usedIndex && revealFileOnListChanges) {
                                setPending({
                                    type: 'file',
                                    filePath: usedPath,
                                    reason: 'list-structure-change',
                                    minIndexVersion: indexVersionRef.current
                                });
                            }
                        });
                    }

                    shouldClearPending = true;
                } else {
                    // Keep pending until file appears in index
                    shouldClearPending = false;
                }
            }
        } else if (pending.type === 'top') {
            rowVirtualizer.scrollToOffset(0, { align: 'start', behavior: 'auto' });
            shouldClearPending = true;
        }

        if (shouldClearPending) {
            pendingScrollRef.current = null;
        }
    }, [
        rowVirtualizer,
        filePathToIndex,
        filePathToIndex.size,
        isScrollContainerReady,
        listItems.length,
        pendingScrollVersion,
        getSelectionIndex,
        isMobile,
        setPending,
        revealFileOnListChanges,
        selectionState.revealSource,
        selectedFile?.path
    ]);

    /**
     * Subscribe to database content changes and re-measure virtualizer when needed.
     * Handles preview text, feature images, tags, and metadata changes.
     */
    useEffect(() => {
        if (!rowVirtualizer) return;

        const db = getDB();
        const unsubscribe = db.onContentChange(changes => {
            const heightAffectingChanges = changes.filter(change => {
                return filePathToIndex.has(change.path) && isListRowHeightAffectingContentChange(change);
            });
            if (heightAffectingChanges.length === 0) {
                return;
            }

            const visibleFilePaths = new Set<string>();
            rowVirtualizer.getVirtualItems().forEach(virtualItem => {
                const item = listItems[virtualItem.index];
                if (item?.type === ListPaneItemType.FILE && item.data instanceof TFile) {
                    visibleFilePaths.add(item.data.path);
                }
            });
            const hasOffscreenHeightChanges = heightAffectingChanges.some(change => !visibleFilePaths.has(change.path));

            // Visible rows can be re-measured in place.
            // Offscreen row changes need a cache reset so stale measured heights do not persist until remount.
            if (hasOffscreenHeightChanges) {
                resetAndRemeasureVisibleRows();
            } else {
                remeasureVisibleRows();
            }
        });

        return () => {
            unsubscribe();
        };
    }, [filePathToIndex, getDB, listItems, remeasureVisibleRows, resetAndRemeasureVisibleRows, rowVirtualizer]);

    /**
     * Listen for mobile drawer visibility events.
     * Ensures selected file is visible when drawer opens.
     * SCROLL_MOBILE_VISIBILITY: Sets pending scroll with 'visibility-change' reason
     */
    useEffect(() => {
        if (!isMobile) return;

        const handleVisible = () => {
            // If we have a selected file, set a pending scroll
            // This works regardless of whether auto-reveal has run yet
            if (selectedFile && rowVirtualizer) {
                setPending({
                    type: 'file',
                    filePath: selectedFile.path,
                    reason: 'visibility-change',
                    minIndexVersion: indexVersionRef.current
                });
            }
        };

        window.addEventListener('notebook-navigator-visible', handleVisible);
        return () => window.removeEventListener('notebook-navigator-visible', handleVisible);
    }, [isMobile, selectedFile, rowVirtualizer, filePathToIndex, setPending]);

    /**
     * Re-measure all items when height-affecting settings change.
     * Includes date display, preview settings, feature images, etc.
     */
    useEffect(() => {
        if (!rowVirtualizer) return;

        resetAndRemeasureVisibleRows();
    }, [listLayoutSignature, rowVirtualizer, resetAndRemeasureVisibleRows]);

    /**
     * Re-measure mounted rows when visual decoration can alter actual pill wrapping.
     * These settings do not change the height estimator, so keep TanStack's measured-size cache intact.
     */
    useEffect(() => {
        if (!rowVirtualizer) return;

        remeasureVisibleRows();
    }, [remeasureVisibleRows, rowVirtualizer, visibleRowMeasurementSignature]);

    /**
     * Re-measure when storage becomes ready after cold boot.
     * Ensures heights are correct once preview data is available.
     */
    useEffect(() => {
        if (isStorageReady && rowVirtualizer) {
            resetAndRemeasureVisibleRows();
        }
    }, [isStorageReady, rowVirtualizer, resetAndRemeasureVisibleRows]);

    /**
     * Handle scrolling when list configuration changes (descendants toggle, appearance, grouping, or sort).
     * Maintains scroll position on the selected file.
     * Effect includes all dependencies but only scrolls when config actually changes.
     */
    // Calculate effective sort order based on current selection and custom overrides.
    const selectedFolderPath = selectionState.selectionType === ItemType.FOLDER ? (selectedFolder?.path ?? null) : null;
    const selectedSortOverride =
        selectionState.selectionType === ItemType.TAG && selectedTag
            ? settings.tagSortOverrides?.[selectedTag]
            : selectionState.selectionType === ItemType.PROPERTY && selectedProperty
              ? settings.propertySortOverrides?.[selectedProperty]
              : selectedFolderPath
                ? settings.folderSortOverrides?.[selectedFolderPath]
                : undefined;
    const effectiveSort = useMemo(() => {
        return selectedSortOverride ?? settings.defaultFolderSort;
    }, [settings.defaultFolderSort, selectedSortOverride]);
    const scrollPreservationSignature = useMemo(
        () =>
            getScrollPreservationSignature({
                includeDescendantNotes,
                listLayoutSignature,
                groupBy: folderSettings.groupBy,
                noteGrouping: settings.noteGrouping,
                effectiveSort,
                propertySortKey: settings.propertySortKey,
                propertySortSecondary: settings.propertySortSecondary
            }),
        [
            includeDescendantNotes,
            listLayoutSignature,
            folderSettings.groupBy,
            settings.noteGrouping,
            effectiveSort,
            settings.propertySortKey,
            settings.propertySortSecondary
        ]
    );
    useEffect(() => {
        if (!rowVirtualizer || !isScrollContainerReady) {
            return;
        }

        const previousConfig = prevScrollPreservationConfigRef.current;
        if (previousConfig === null) {
            prevScrollPreservationConfigRef.current = {
                signature: scrollPreservationSignature,
                includeDescendantNotes
            };
            return;
        }

        // Check if config actually changed
        if (previousConfig.signature === scrollPreservationSignature) {
            return; // No config change, don't scroll
        }

        // Detect descendants toggle for special handling
        const wasShowingDescendants = previousConfig.includeDescendantNotes;
        const nowShowingDescendants = includeDescendantNotes;

        // Update the ref
        prevScrollPreservationConfigRef.current = {
            signature: scrollPreservationSignature,
            includeDescendantNotes
        };

        // Layout-only changes can keep the same path/index map, so scroll against the current version.
        if (revealFileOnListChanges && selectedFile) {
            setPending({
                type: 'file',
                filePath: selectedFile.path,
                reason: 'list-structure-change',
                minIndexVersion: indexVersionRef.current
            });
        } else if (wasShowingDescendants && !nowShowingDescendants) {
            // Special case: When disabling descendants and no file selected, scroll to top
            setPending({
                type: 'top',
                reason: 'list-structure-change',
                minIndexVersion: indexVersionRef.current
            });
        }
    }, [
        isScrollContainerReady,
        rowVirtualizer,
        selectedFile,
        includeDescendantNotes,
        revealFileOnListChanges,
        scrollPreservationSignature,
        setPending
    ]);

    /**
     * Preserve scroll when the list index changes within the same context (implicit reorders like pin/unpin).
     * Uses indexVersion changes keyed by current folder/tag context. Avoids duplicate triggers on navigation.
     */
    useEffect(() => {
        if (!rowVirtualizer || !isScrollContainerReady) return;

        const propertySelectionKey = selectedProperty ?? '';
        const contextKey = `${selectedFolder?.path || ''}_${selectedTag || ''}_${propertySelectionKey}`;
        const prev = contextIndexVersionRef.current;

        // Initialize on first run or when context changes
        if (!prev || prev.key !== contextKey) {
            contextIndexVersionRef.current = { key: contextKey, version: indexVersionRef.current };
            return;
        }

        // Same context: if index version advanced, maintain position on selected file
        if (indexVersionRef.current > prev.version) {
            contextIndexVersionRef.current = { key: contextKey, version: indexVersionRef.current };

            // Only queue a file scroll if the selected file exists in the current index
            const inList = !!(selectedFile && filePathToIndex.has(selectedFile.path));
            if (revealFileOnListChanges && inList && selectedFile) {
                setPending({
                    type: 'file',
                    filePath: selectedFile.path,
                    reason: 'list-structure-change',
                    minIndexVersion: indexVersionRef.current
                });
            }
        }
    }, [
        rowVirtualizer,
        isScrollContainerReady,
        selectedFolder?.path,
        selectedTag,
        selectedProperty,
        filePathToIndex,
        filePathToIndex.size,
        selectedFile,
        setPending,
        revealFileOnListChanges
    ]);

    /**
     * Handle scrolling when navigating between folders/tags.
     * Supports both visible and hidden panes (for single-pane mode).
     * Manages folder navigation flags and list context changes.
     * SCROLL_FOLDER_NAVIGATION: Sets pending scroll with 'folder-navigation' reason
     */
    useEffect(() => {
        if (!rowVirtualizer) {
            return;
        }

        // Create a key representing the current list context
        const propertySelectionKey = selectedProperty ?? '';
        const currentListKey = `${selectedFolder?.path || ''}_${selectedTag || ''}_${propertySelectionKey}`;
        const listChanged = prevListKeyRef.current !== currentListKey;

        if (listChanged) {
            // Context changed while a pending scroll might still target the prior folder/tag
            clearPending();
        }

        // Check if this is a folder navigation where we need to scroll to maintain the selected file
        const isFolderNavigation = selectionState.isFolderNavigation;

        // Determine if we should scroll
        // We scroll in these cases:
        // 1. User navigated to a different folder/tag (isFolderNavigation = true)
        // 2. List context changed (folder/tag change)
        const shouldScroll = listChanged || (isFolderNavigation && hasSelectedFile);

        if (!shouldScroll) {
            if (isFolderNavigation) {
                selectionDispatch({ type: 'SET_FOLDER_NAVIGATION', isFolderNavigation: false });
            }
            return;
        }

        // On initial load, wait for list to be populated
        if (listChanged && listItems.length === 0) {
            return;
        }

        // For single-pane mode, always set pending scroll even if not visible
        // It will be processed when the pane becomes visible
        if (!isScrollContainerReady && (isFolderNavigation || listChanged)) {
            // Update the ref
            if (listChanged) {
                prevListKeyRef.current = currentListKey;
            }

            // Clear the folder navigation flag
            if (isFolderNavigation) {
                selectionDispatch({ type: 'SET_FOLDER_NAVIGATION', isFolderNavigation: false });
            }

            setPending(
                selectedFile
                    ? {
                          type: 'file',
                          filePath: selectedFile.path,
                          reason: 'folder-navigation',
                          minIndexVersion: indexVersionRef.current
                      }
                    : { type: 'top', reason: 'folder-navigation', minIndexVersion: indexVersionRef.current }
            );
            return;
        }

        // For folder navigation when visible, perform scroll immediately without RAF
        // RAF was causing issues with component re-renders cancelling the scroll
        if (isFolderNavigation && listItems.length > 0 && isScrollContainerReady) {
            // Update the ref
            if (listChanged) {
                prevListKeyRef.current = currentListKey;
            }

            // Clear the folder navigation flag
            selectionDispatch({ type: 'SET_FOLDER_NAVIGATION', isFolderNavigation: false });

            const pendingScroll = selectedFile
                ? {
                      type: 'file' as const,
                      filePath: selectedFile.path,
                      reason: 'folder-navigation' as const,
                      minIndexVersion: indexVersionRef.current
                  }
                : ({ type: 'top', reason: 'folder-navigation', minIndexVersion: indexVersionRef.current } as const);

            setPending(pendingScroll);
        } else {
            // For other cases (initial load), use pending scroll for consistency
            // RAF was getting canceled due to rapid re-renders

            // Update the ref
            if (listChanged) {
                prevListKeyRef.current = currentListKey;
            }

            setPending(
                selectedFile
                    ? {
                          type: 'file',
                          filePath: selectedFile.path,
                          reason: 'folder-navigation',
                          minIndexVersion: indexVersionRef.current
                      }
                    : { type: 'top', reason: 'folder-navigation', minIndexVersion: indexVersionRef.current }
            );
        }
    }, [
        isScrollContainerReady,
        rowVirtualizer,
        selectedFolder?.path,
        selectedTag,
        selectedProperty,
        selectedFile,
        selectionState.isFolderNavigation,
        selectionDispatch,
        filePathToIndex.size,
        listItems.length,
        setPending,
        clearPending,
        hasSelectedFile
    ]);

    /**
     * Handle reveal operations (e.g., reveal active file command).
     * Uses pending scroll for proper timing and measurement.
     * SCROLL_REVEAL_OPERATION: Sets pending scroll with 'reveal' reason
     */
    useEffect(() => {
        if (selectionState.isRevealOperation && selectedFile && isScrollContainerReady) {
            // Always use pending scroll for reveal operations
            // This ensures proper timing and measurement before scrolling
            setPending({
                type: 'file',
                filePath: selectedFile.path,
                reason: 'reveal',
                minIndexVersion: indexVersionRef.current
            });
            // Reveal behaves like a one-shot event; clear the flag once the list pane has queued the scroll.
            selectionDispatch({ type: 'CLEAR_REVEAL_OPERATION' });
        }
    }, [selectionState.isRevealOperation, selectedFile, isScrollContainerReady, selectionDispatch, filePathToIndex, setPending]);

    /**
     * Handle search query changes.
     * Scrolls to top when search filters change and selected file is not in results.
     * SCROLL_SEARCH: Sets pending scroll to top when appropriate
     */
    useEffect(() => {
        // Only handle when search is active (searchQuery is defined)
        if (searchQuery === undefined) {
            prevSearchQueryRef.current = searchQuery;
            return;
        }

        if (!selectedFile) {
            prevSearchQueryRef.current = searchQuery;
            return;
        }

        if (!isScrollContainerReady || !rowVirtualizer) {
            // Defer handling until visible/ready without consuming the query change
            return;
        }

        // Check if selected file exists in the filtered list (based on current index)
        const selectedFileInList = filePathToIndex.has(selectedFile.path);

        const queryChanged = prevSearchQueryRef.current !== searchQuery;
        prevSearchQueryRef.current = searchQuery;

        // Scroll to top when search filters remove the selected file, regardless of whether
        // this happened immediately on query change or after the list rebuilt
        // Check if scroll-to-top should be suppressed (used for mobile search shortcuts)
        const suppressTopScroll = suppressSearchTopScrollRef?.current ?? false;

        if (!selectedFileInList && listItems.length > 0) {
            // Skip scroll-to-top if suppressed (mobile shortcut activation)
            if (suppressTopScroll && suppressSearchTopScrollRef) {
                suppressSearchTopScrollRef.current = false;
                return;
            }
            setPending({ type: 'top', reason: 'list-structure-change', minIndexVersion: indexVersionRef.current });
            return;
        }

        // Reset suppression flag after checking
        if (suppressTopScroll && suppressSearchTopScrollRef) {
            suppressSearchTopScrollRef.current = false;
        }

        // If the selected file remains in the list, folder-navigation effects handle its visibility
        // No action needed here; keep for completeness when queryChanged
        if (queryChanged) {
            // No-op
        }
    }, [
        searchQuery,
        selectedFile,
        filePathToIndex,
        isScrollContainerReady,
        rowVirtualizer,
        listItems.length,
        setPending,
        suppressSearchTopScrollRef
    ]);

    return {
        rowVirtualizer,
        scrollContainerRef,
        scrollContainerRefCallback,
        handleScrollToTop
    };
}

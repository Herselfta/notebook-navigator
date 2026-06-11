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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { App, TFile } from 'obsidian';
import { IndexedDBStorage, type FeatureImageStatus, type FileContentChange, type PropertyItem } from '../../storage/IndexedDBStorage';
import { getCachedFileTags } from '../../utils/tagUtils';
import { isRasterImageFile } from '../../utils/fileTypeUtils';
import { arePropertyItemsEqual, clonePropertyItems } from '../../utils/propertyUtils';
import { areStringArraysEqual } from '../../utils/arrayUtils';
import { getVersionedResourcePath } from '../../utils/resourcePath';

const FEATURE_IMAGE_REGEN_THROTTLE_MS = 10000;

export type FileItemContentDb = Pick<
    IndexedDBStorage,
    'getCachedPreviewText' | 'getFile' | 'onFileContentChange' | 'ensurePreviewTextLoaded' | 'getFeatureImageBlob'
>;

export interface FileItemCacheSnapshot {
    previewText: string;
    tags: string[];
    featureImageKey: string | null;
    featureImageStatus: FeatureImageStatus;
    featureImageUrl: string | null;
    properties: PropertyItem[] | null;
    wordCount: number | null;
    characterCountWithSpaces: number | null;
    characterCountWithoutSpaces: number | null;
    taskUnfinished: number | null;
}

export interface FileItemContentLoadOptions {
    loadPreviewText?: boolean;
    loadTags?: boolean;
    loadFeatureImage?: boolean;
    loadProperties?: boolean;
    loadWordCount?: boolean;
    loadCharacterCount?: boolean;
    loadTaskUnfinished?: boolean;
}

type ResolvedFileItemContentLoadOptions = Required<FileItemContentLoadOptions>;

export interface UseFileItemContentStateParams {
    app: App;
    file: TFile;
    showPreview: boolean;
    showImage: boolean;
    skipFeatureImage?: boolean;
    fileStatMtime?: number;
    getDB: () => FileItemContentDb;
    regenerateFeatureImageForFile: (file: TFile) => Promise<void>;
    loadOptions?: FileItemContentLoadOptions;
    refreshMetadataVersionOnFeatureImageChange?: boolean;
}

export interface FileItemContentState {
    previewText: string;
    tags: string[];
    featureImageKey: string | null;
    featureImageStatus: FeatureImageStatus;
    featureImageUrl: string | null;
    properties: PropertyItem[] | null;
    wordCount: number | null;
    characterCountWithSpaces: number | null;
    characterCountWithoutSpaces: number | null;
    taskUnfinished: number | null;
    metadataVersion: number;
}

export function subscribeToFileItemContentState(params: {
    db: FileItemContentDb;
    filePath: string;
    loadSnapshot: () => FileItemCacheSnapshot;
    applySnapshot: (snapshot: FileItemCacheSnapshot) => void;
    onChange: (changes: FileContentChange['changes']) => void;
}): () => void {
    const { db, filePath, loadSnapshot, applySnapshot, onChange } = params;
    const unsubscribe = db.onFileContentChange(filePath, onChange);
    applySnapshot(loadSnapshot());
    return unsubscribe;
}

export function shouldRefreshFileItemMetadataVersionForContentChange({
    changes,
    shouldLoadFeatureImage,
    refreshMetadataVersionOnFeatureImageChange
}: {
    changes: FileContentChange['changes'];
    shouldLoadFeatureImage: boolean;
    refreshMetadataVersionOnFeatureImageChange: boolean;
}): boolean {
    if (changes.metadata !== undefined) {
        return true;
    }

    const hasFeatureImageChange = changes.featureImageKey !== undefined || changes.featureImageStatus !== undefined;
    return hasFeatureImageChange && !shouldLoadFeatureImage && refreshMetadataVersionOnFeatureImageChange;
}

function resolveFileItemContentLoadOptions(loadOptions?: FileItemContentLoadOptions): ResolvedFileItemContentLoadOptions {
    return {
        loadPreviewText: loadOptions?.loadPreviewText ?? true,
        loadTags: loadOptions?.loadTags ?? true,
        loadFeatureImage: loadOptions?.loadFeatureImage ?? true,
        loadProperties: loadOptions?.loadProperties ?? true,
        loadWordCount: loadOptions?.loadWordCount ?? true,
        loadCharacterCount: loadOptions?.loadCharacterCount ?? true,
        loadTaskUnfinished: loadOptions?.loadTaskUnfinished ?? true
    };
}

export function loadFileItemCacheSnapshot({
    app,
    file,
    showPreview,
    showImage,
    skipFeatureImage,
    fileStatMtime = file.stat.mtime,
    db,
    loadOptions
}: {
    app: App;
    file: TFile;
    showPreview: boolean;
    showImage: boolean;
    skipFeatureImage?: boolean;
    fileStatMtime?: number;
    db: FileItemContentDb;
    loadOptions?: FileItemContentLoadOptions;
}): FileItemCacheSnapshot {
    const {
        loadPreviewText: shouldLoadPreviewText,
        loadTags: shouldLoadTags,
        loadFeatureImage: shouldLoadFeatureImage,
        loadProperties: shouldLoadProperties,
        loadWordCount: shouldLoadWordCount,
        loadCharacterCount: shouldLoadCharacterCount,
        loadTaskUnfinished: shouldLoadTaskUnfinished
    } = resolveFileItemContentLoadOptions(loadOptions);
    const shouldReadFileRecord =
        shouldLoadTags ||
        shouldLoadFeatureImage ||
        shouldLoadProperties ||
        shouldLoadWordCount ||
        shouldLoadCharacterCount ||
        shouldLoadTaskUnfinished;
    const preview = shouldLoadPreviewText && showPreview && file.extension === 'md' ? db.getCachedPreviewText(file.path) : '';
    const record = shouldReadFileRecord ? db.getFile(file.path) : null;
    const tags = shouldLoadTags ? [...getCachedFileTags({ app, file, db, fileData: record })] : [];
    const isDirectImageFile = shouldLoadFeatureImage && showImage && !skipFeatureImage && isRasterImageFile(file);
    const featureImageKey =
        shouldLoadFeatureImage && record?.featureImageKey
            ? record.featureImageKey
            : isDirectImageFile
              ? `direct-image:${file.path}@${fileStatMtime}`
              : null;
    const featureImageStatus: FeatureImageStatus = shouldLoadFeatureImage ? (record?.featureImageStatus ?? 'unprocessed') : 'unprocessed';
    const properties = shouldLoadProperties ? clonePropertyItems(record?.properties ?? null) : null;
    const wordCount = shouldLoadWordCount ? (record?.wordCount ?? null) : null;
    const characterCountWithSpaces = shouldLoadCharacterCount ? (record?.characterCountWithSpaces ?? null) : null;
    const characterCountWithoutSpaces = shouldLoadCharacterCount ? (record?.characterCountWithoutSpaces ?? null) : null;
    const taskUnfinished = shouldLoadTaskUnfinished ? (record?.taskUnfinished ?? null) : null;

    let featureImageUrl: string | null = null;
    if (isDirectImageFile) {
        try {
            featureImageUrl = getVersionedResourcePath(app, file, fileStatMtime);
        } catch {
            featureImageUrl = null;
        }
    }

    return {
        previewText: preview,
        tags,
        featureImageKey,
        featureImageStatus,
        featureImageUrl,
        properties,
        wordCount,
        characterCountWithSpaces,
        characterCountWithoutSpaces,
        taskUnfinished
    };
}

export function useFileItemContentState({
    app,
    file,
    showPreview,
    showImage,
    skipFeatureImage = false,
    fileStatMtime = file.stat.mtime,
    getDB,
    regenerateFeatureImageForFile,
    loadOptions,
    refreshMetadataVersionOnFeatureImageChange = false
}: UseFileItemContentStateParams): FileItemContentState {
    const loadPreviewTextOption = loadOptions?.loadPreviewText;
    const loadTagsOption = loadOptions?.loadTags;
    const loadFeatureImageOption = loadOptions?.loadFeatureImage;
    const loadPropertiesOption = loadOptions?.loadProperties;
    const loadWordCountOption = loadOptions?.loadWordCount;
    const loadCharacterCountOption = loadOptions?.loadCharacterCount;
    const loadTaskUnfinishedOption = loadOptions?.loadTaskUnfinished;
    const resolvedLoadOptions = useMemo(
        () =>
            resolveFileItemContentLoadOptions({
                loadPreviewText: loadPreviewTextOption,
                loadTags: loadTagsOption,
                loadFeatureImage: loadFeatureImageOption,
                loadProperties: loadPropertiesOption,
                loadWordCount: loadWordCountOption,
                loadCharacterCount: loadCharacterCountOption,
                loadTaskUnfinished: loadTaskUnfinishedOption
            }),
        [
            loadCharacterCountOption,
            loadFeatureImageOption,
            loadPreviewTextOption,
            loadPropertiesOption,
            loadTagsOption,
            loadTaskUnfinishedOption,
            loadWordCountOption
        ]
    );
    const {
        loadPreviewText: shouldLoadPreviewText,
        loadTags: shouldLoadTags,
        loadFeatureImage: shouldLoadFeatureImage,
        loadProperties: shouldLoadProperties,
        loadWordCount: shouldLoadWordCount,
        loadCharacterCount: shouldLoadCharacterCount,
        loadTaskUnfinished: shouldLoadTaskUnfinished
    } = resolvedLoadOptions;
    const loadSnapshot = useCallback(() => {
        return loadFileItemCacheSnapshot({
            app,
            file,
            showPreview,
            showImage,
            skipFeatureImage,
            fileStatMtime,
            db: getDB(),
            loadOptions: resolvedLoadOptions
        });
    }, [app, file, fileStatMtime, getDB, resolvedLoadOptions, showImage, showPreview, skipFeatureImage]);

    const initialDataRef = useRef<FileItemCacheSnapshot | null>(null);
    const initialData = initialDataRef.current ?? loadSnapshot();
    initialDataRef.current = initialData;

    const [previewText, setPreviewText] = useState<string>(initialData.previewText);
    const [tags, setTags] = useState<string[]>(initialData.tags);
    const [featureImageKey, setFeatureImageKey] = useState<string | null>(initialData.featureImageKey);
    const [featureImageStatus, setFeatureImageStatus] = useState<FeatureImageStatus>(initialData.featureImageStatus);
    const [featureImageUrl, setFeatureImageUrl] = useState<string | null>(initialData.featureImageUrl);
    const [properties, setProperties] = useState<PropertyItem[] | null>(initialData.properties);
    const [wordCount, setWordCount] = useState<number | null>(initialData.wordCount);
    const [characterCountWithSpaces, setCharacterCountWithSpaces] = useState<number | null>(initialData.characterCountWithSpaces);
    const [characterCountWithoutSpaces, setCharacterCountWithoutSpaces] = useState<number | null>(initialData.characterCountWithoutSpaces);
    const [taskUnfinished, setTaskUnfinished] = useState<number | null>(initialData.taskUnfinished);
    const [metadataVersion, setMetadataVersion] = useState(0);

    const propertiesRef = useRef<PropertyItem[] | null>(initialData.properties);
    const featureImageObjectUrlRef = useRef<string | null>(null);
    const lastFeatureImageRegenRef = useRef<{ key: string; at: number } | null>(null);
    useLayoutEffect(() => {
        const db = getDB();
        const unsubscribe = subscribeToFileItemContentState({
            db,
            filePath: file.path,
            loadSnapshot,
            applySnapshot: initialSnapshot => {
                setPreviewText(prev => (prev === initialSnapshot.previewText ? prev : initialSnapshot.previewText));
                setTags(prev => (areStringArraysEqual(prev, initialSnapshot.tags) ? prev : initialSnapshot.tags));
                setFeatureImageKey(prev => (prev === initialSnapshot.featureImageKey ? prev : initialSnapshot.featureImageKey));
                setFeatureImageStatus(prev => (prev === initialSnapshot.featureImageStatus ? prev : initialSnapshot.featureImageStatus));
                if (!arePropertyItemsEqual(propertiesRef.current, initialSnapshot.properties)) {
                    propertiesRef.current = initialSnapshot.properties;
                    setProperties(initialSnapshot.properties);
                }
                setWordCount(prev => (prev === initialSnapshot.wordCount ? prev : initialSnapshot.wordCount));
                setCharacterCountWithSpaces(prev =>
                    prev === initialSnapshot.characterCountWithSpaces ? prev : initialSnapshot.characterCountWithSpaces
                );
                setCharacterCountWithoutSpaces(prev =>
                    prev === initialSnapshot.characterCountWithoutSpaces ? prev : initialSnapshot.characterCountWithoutSpaces
                );
                setTaskUnfinished(prev => (prev === initialSnapshot.taskUnfinished ? prev : initialSnapshot.taskUnfinished));
            },
            onChange: (changes: FileContentChange['changes']) => {
                const shouldRefreshMetadataVersion = shouldRefreshFileItemMetadataVersionForContentChange({
                    changes,
                    shouldLoadFeatureImage,
                    refreshMetadataVersionOnFeatureImageChange
                });

                if (changes.preview !== undefined && shouldLoadPreviewText && showPreview && file.extension === 'md') {
                    const nextPreview = changes.preview || '';
                    setPreviewText(prev => (prev === nextPreview ? prev : nextPreview));
                }

                if (changes.featureImageKey !== undefined) {
                    if (shouldLoadFeatureImage) {
                        setFeatureImageKey(prev => (prev === changes.featureImageKey ? prev : (changes.featureImageKey ?? null)));
                    }
                }

                if (changes.featureImageStatus !== undefined) {
                    if (shouldLoadFeatureImage) {
                        const nextStatus = changes.featureImageStatus;
                        setFeatureImageStatus(prev => (prev === nextStatus ? prev : nextStatus));
                    }
                }

                if (changes.tags !== undefined && shouldLoadTags) {
                    const nextTags = [...(changes.tags ?? [])];
                    setTags(prev => (areStringArraysEqual(prev, nextTags) ? prev : nextTags));
                }

                if (changes.wordCount !== undefined && shouldLoadWordCount) {
                    const nextWordCount = changes.wordCount ?? null;
                    setWordCount(prev => (prev === nextWordCount ? prev : nextWordCount));
                }

                if (changes.characterCountWithSpaces !== undefined && shouldLoadCharacterCount) {
                    const nextCharacterCountWithSpaces = changes.characterCountWithSpaces ?? null;
                    setCharacterCountWithSpaces(prev => (prev === nextCharacterCountWithSpaces ? prev : nextCharacterCountWithSpaces));
                }

                if (changes.characterCountWithoutSpaces !== undefined && shouldLoadCharacterCount) {
                    const nextCharacterCountWithoutSpaces = changes.characterCountWithoutSpaces ?? null;
                    setCharacterCountWithoutSpaces(prev =>
                        prev === nextCharacterCountWithoutSpaces ? prev : nextCharacterCountWithoutSpaces
                    );
                }

                if (changes.taskUnfinished !== undefined && shouldLoadTaskUnfinished) {
                    const nextTaskUnfinished = changes.taskUnfinished ?? null;
                    setTaskUnfinished(prev => (prev === nextTaskUnfinished ? prev : nextTaskUnfinished));
                }

                if (changes.properties !== undefined) {
                    if (shouldLoadProperties) {
                        const nextProperties = clonePropertyItems(changes.properties ?? null);
                        if (!arePropertyItemsEqual(propertiesRef.current, nextProperties)) {
                            propertiesRef.current = nextProperties;
                            setProperties(nextProperties);
                        }
                    }
                }

                if (shouldRefreshMetadataVersion) {
                    setMetadataVersion(version => version + 1);
                }
            }
        });

        if (shouldLoadPreviewText && showPreview && file.extension === 'md') {
            void db.ensurePreviewTextLoaded(file.path);
        }

        return () => {
            unsubscribe();
        };
    }, [
        file,
        file.path,
        getDB,
        loadSnapshot,
        shouldLoadCharacterCount,
        shouldLoadFeatureImage,
        shouldLoadPreviewText,
        shouldLoadProperties,
        shouldLoadTags,
        shouldLoadTaskUnfinished,
        shouldLoadWordCount,
        refreshMetadataVersionOnFeatureImageChange,
        showPreview
    ]);

    useEffect(() => {
        return () => {
            if (featureImageObjectUrlRef.current) {
                URL.revokeObjectURL(featureImageObjectUrlRef.current);
                featureImageObjectUrlRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        let isActive = true;

        if (featureImageObjectUrlRef.current) {
            URL.revokeObjectURL(featureImageObjectUrlRef.current);
            featureImageObjectUrlRef.current = null;
        }

        if (!shouldLoadFeatureImage || !showImage || skipFeatureImage) {
            setFeatureImageUrl(null);
            return () => {
                isActive = false;
            };
        }

        if (isRasterImageFile(file)) {
            try {
                setFeatureImageUrl(getVersionedResourcePath(app, file, fileStatMtime));
            } catch {
                setFeatureImageUrl(null);
            }

            return () => {
                isActive = false;
            };
        }

        if (featureImageStatus !== 'has' || !featureImageKey) {
            setFeatureImageUrl(null);
            return () => {
                isActive = false;
            };
        }

        const db = getDB();
        const expectedKey = featureImageKey;
        void db.getFeatureImageBlob(file.path, expectedKey).then(blob => {
            if (!isActive) {
                return;
            }

            if (!blob) {
                setFeatureImageUrl(null);
                const now = Date.now();
                const last = lastFeatureImageRegenRef.current;
                const shouldTrigger = !last || last.key !== expectedKey || now - last.at >= FEATURE_IMAGE_REGEN_THROTTLE_MS;
                if (shouldTrigger) {
                    lastFeatureImageRegenRef.current = { key: expectedKey, at: now };
                    void regenerateFeatureImageForFile(file);
                }
                return;
            }

            const nextUrl = URL.createObjectURL(blob);
            featureImageObjectUrlRef.current = nextUrl;
            setFeatureImageUrl(nextUrl);
        });

        return () => {
            isActive = false;
        };
    }, [
        app,
        featureImageKey,
        featureImageStatus,
        file,
        fileStatMtime,
        getDB,
        regenerateFeatureImageForFile,
        shouldLoadFeatureImage,
        showImage,
        skipFeatureImage
    ]);

    return {
        previewText,
        tags,
        featureImageKey,
        featureImageStatus,
        featureImageUrl,
        properties,
        wordCount,
        characterCountWithSpaces,
        characterCountWithoutSpaces,
        taskUnfinished,
        metadataVersion
    };
}

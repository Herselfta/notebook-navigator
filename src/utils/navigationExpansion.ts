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

import { TFolder } from 'obsidian';
import type { ExpansionAction } from '../context/ExpansionContext';
import { NavigationPaneItemType } from '../types';
import type { CombinedNavigationItem } from '../types/virtualization';
import { hasSubfolders } from './fileFilters';

export interface NavigationExpansionSets {
    expandedFolders: ReadonlySet<string>;
    expandedTags: ReadonlySet<string>;
    expandedProperties: ReadonlySet<string>;
    expandedVirtualFolders: ReadonlySet<string>;
}

export interface NavigationExpansionTarget {
    type: 'folder' | 'tag' | 'property' | 'virtual-folder';
    id: string;
    hasChildren: boolean;
}

interface NavigationExpansionTargetState {
    isExpanded: boolean;
    hasChildren: boolean;
    canExpand: boolean;
    canCollapse: boolean;
}

function getTargetExpandedState(target: NavigationExpansionTarget, expansionState: NavigationExpansionSets): boolean {
    switch (target.type) {
        case 'folder':
            return expansionState.expandedFolders.has(target.id);
        case 'tag':
            return expansionState.expandedTags.has(target.id);
        case 'property':
            return expansionState.expandedProperties.has(target.id);
        case 'virtual-folder':
            return expansionState.expandedVirtualFolders.has(target.id);
    }
}

function buildToggleAction(target: NavigationExpansionTarget): ExpansionAction {
    switch (target.type) {
        case 'folder':
            return { type: 'TOGGLE_FOLDER_EXPANDED', folderPath: target.id };
        case 'tag':
            return { type: 'TOGGLE_TAG_EXPANDED', tagPath: target.id };
        case 'property':
            return { type: 'TOGGLE_PROPERTY_EXPANDED', propertyNodeId: target.id };
        case 'virtual-folder':
            return { type: 'TOGGLE_VIRTUAL_FOLDER_EXPANDED', folderId: target.id };
    }
}

function getNavigationExpansionTargetState(
    target: NavigationExpansionTarget,
    expansionState: NavigationExpansionSets
): NavigationExpansionTargetState {
    const isExpanded = getTargetExpandedState(target, expansionState);
    return {
        isExpanded,
        hasChildren: target.hasChildren,
        canExpand: target.hasChildren && !isExpanded,
        canCollapse: isExpanded
    };
}

export function toggleNavigationExpansionTarget(
    target: NavigationExpansionTarget,
    expansionState: NavigationExpansionSets,
    dispatch: (action: ExpansionAction) => void,
    mode: 'toggle' | 'expand' | 'collapse' = 'toggle'
): boolean {
    const targetState = getNavigationExpansionTargetState(target, expansionState);
    const shouldToggle =
        mode === 'expand'
            ? targetState.canExpand
            : mode === 'collapse'
              ? targetState.canCollapse
              : targetState.canExpand || targetState.canCollapse;

    if (!shouldToggle) {
        return false;
    }

    dispatch(buildToggleAction(target));
    return true;
}

export function getNavigationExpansionTargetForItem(
    item: CombinedNavigationItem,
    options: { showHiddenItems: boolean }
): NavigationExpansionTarget | null {
    switch (item.type) {
        case NavigationPaneItemType.FOLDER:
            if (!(item.data instanceof TFolder)) {
                return null;
            }
            return {
                type: 'folder',
                id: item.data.path,
                hasChildren: hasSubfolders(item.data, item.parsedExcludedFolders ?? [], options.showHiddenItems)
            };
        case NavigationPaneItemType.TAG:
            return {
                type: 'tag',
                id: item.data.path,
                hasChildren: item.data.children.size > 0
            };
        case NavigationPaneItemType.PROPERTY_KEY:
        case NavigationPaneItemType.PROPERTY_VALUE:
            return {
                type: 'property',
                id: item.data.id,
                hasChildren: item.data.children.size > 0
            };
        case NavigationPaneItemType.VIRTUAL_FOLDER:
            if (typeof item.tagCollectionId !== 'string' && typeof item.propertyCollectionId !== 'string') {
                return null;
            }
            return {
                type: 'virtual-folder',
                id: item.data.id,
                hasChildren: item.hasChildren ?? false
            };
        default:
            return null;
    }
}

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

import { strings } from '../i18n';
import type { SettingDefinitionItem } from 'obsidian';
import { createAdvancedSettingDefinitions } from './tabs/AdvancedTab';
import { createCalendarSettingDefinitions } from './tabs/CalendarTab';
import { createFoldersAndFolderNotesSettingDefinitions, createTagsPropertiesSettingDefinitions } from './tabs/ContentTab';
import { createDisplayFiltersSettingDefinitions } from './tabs/DisplayFiltersTab';
import { createFilesSettingDefinitions } from './tabs/FilesTab';
import { createFrontmatterSettingDefinitions } from './tabs/FrontmatterTab';
import { createIconPacksSettingDefinitions } from './tabs/IconPacksTab';
import { createListPaneSettingDefinitions } from './tabs/ListTab';
import { createNavigationPaneSettingDefinitions } from './tabs/NavigationTab';
import { createNotesSettingDefinitions } from './tabs/NotesTab';
import { createShortcutsSettingDefinitions } from './tabs/ShortcutsTab';
import { createAppearanceBehaviorSettingDefinitions } from './tabs/AppearanceBehaviorTab';
import { renderAdvancedTab } from './tabs/legacy/AdvancedLegacyTab';
import { renderAppearanceBehaviorTab } from './tabs/legacy/AppearanceBehaviorLegacyTab';
import { renderCalendarTab } from './tabs/legacy/CalendarLegacyTab';
import { renderFoldersAndFolderNotesTab, renderTagsPropertiesTab } from './tabs/legacy/ContentLegacyTab';
import { renderDisplayFiltersTab } from './tabs/legacy/DisplayFiltersLegacyTab';
import { renderFilesTab } from './tabs/legacy/FilesLegacyTab';
import { renderFrontmatterTab } from './tabs/legacy/FrontmatterLegacyTab';
import { renderGeneralTab } from './tabs/legacy/GeneralLegacyTab';
import { renderIconPacksTab } from './tabs/legacy/IconPacksLegacyTab';
import { renderListPaneTab } from './tabs/legacy/ListLegacyTab';
import { renderNavigationPaneTab } from './tabs/legacy/NavigationLegacyTab';
import { renderNotesTab } from './tabs/legacy/NotesLegacyTab';
import { renderShortcutsTab } from './tabs/legacy/ShortcutsLegacyTab';
import type { SettingsTabContext, SettingsTabId } from './tabs/SettingsTabContext';

/** Identifiers for settings panes rendered as native settings pages. */
export type SettingsPaneId = Exclude<SettingsTabId, 'files' | 'tags' | 'properties'>;

export interface SettingsPageGroupDefinition {
    getHeading: () => string;
    items: SettingsPaneId[];
}

/** Registry entry shared by native setting pages and the legacy display() fallback. */
export interface SettingsPaneDefinition {
    id: SettingsPaneId;
    getLabel: () => string;
    render: (context: SettingsTabContext) => void;
    createDefinitions?: (context: SettingsTabContext) => SettingDefinitionItem[];
}

export const SETTINGS_PAGE_GROUP_DEFINITIONS: SettingsPageGroupDefinition[] = [
    {
        getHeading: () => strings.settings.pageGroups.configuration,
        items: ['vault-filters', 'appearance-behavior', 'file-operations']
    },
    {
        getHeading: () => strings.settings.pageGroups.navigationAndContent,
        items: ['navigation-pane', 'shortcuts', 'folders', 'tags-properties']
    },
    {
        getHeading: () => strings.settings.pageGroups.notesAndLists,
        items: ['list-pane', 'frontmatter', 'notes']
    },
    {
        getHeading: () => strings.settings.pageGroups.calendarAndTools,
        items: ['calendar', 'icon-packs', 'advanced']
    }
];

export const SETTINGS_PAGE_DESCRIPTION_GETTERS: Record<SettingsPaneId, () => string> = {
    general: () => strings.settings.pageDescriptions.general,
    'vault-filters': () => strings.settings.pageDescriptions.vaultFilters,
    'appearance-behavior': () => strings.settings.pageDescriptions.appearanceBehavior,
    'navigation-pane': () => strings.settings.pageDescriptions.navigationPane,
    shortcuts: () => strings.settings.pageDescriptions.shortcuts,
    calendar: () => strings.settings.pageDescriptions.calendar,
    folders: () => strings.settings.pageDescriptions.foldersAndFolderNotes,
    'tags-properties': () => strings.settings.pageDescriptions.tagsProperties,
    'file-operations': () => strings.settings.pageDescriptions.fileOperations,
    'list-pane': () => strings.settings.pageDescriptions.listPane,
    frontmatter: () => strings.settings.pageDescriptions.frontmatter,
    notes: () => strings.settings.pageDescriptions.notes,
    'icon-packs': () => strings.settings.pageDescriptions.iconPacks,
    advanced: () => strings.settings.pageDescriptions.advanced
};

// Native pages use createDefinitions; legacy pages use render.
const SETTINGS_PANE_DEFINITIONS: SettingsPaneDefinition[] = [
    { id: 'general', getLabel: () => strings.settings.sections.general, render: renderGeneralTab },
    {
        id: 'vault-filters',
        getLabel: () => strings.settings.sections.vaultFilters,
        render: renderDisplayFiltersTab,
        createDefinitions: createDisplayFiltersSettingDefinitions
    },
    {
        id: 'appearance-behavior',
        getLabel: () => strings.settings.sections.appearanceBehavior,
        render: renderAppearanceBehaviorTab,
        createDefinitions: createAppearanceBehaviorSettingDefinitions
    },
    {
        id: 'navigation-pane',
        getLabel: () => strings.settings.sections.navigationPane,
        render: renderNavigationPaneTab,
        createDefinitions: createNavigationPaneSettingDefinitions
    },
    {
        id: 'shortcuts',
        getLabel: () => strings.settings.sections.shortcutsAndRecentFiles,
        render: renderShortcutsTab,
        createDefinitions: createShortcutsSettingDefinitions
    },
    {
        id: 'folders',
        getLabel: () => strings.settings.sections.foldersAndFolderNotes,
        render: renderFoldersAndFolderNotesTab,
        createDefinitions: createFoldersAndFolderNotesSettingDefinitions
    },
    {
        id: 'tags-properties',
        getLabel: () => strings.settings.sections.tagsAndProperties,
        render: renderTagsPropertiesTab,
        createDefinitions: createTagsPropertiesSettingDefinitions
    },
    {
        id: 'list-pane',
        getLabel: () => strings.settings.sections.listPane,
        render: renderListPaneTab,
        createDefinitions: createListPaneSettingDefinitions
    },
    {
        id: 'file-operations',
        getLabel: () => strings.settings.sections.fileOperations,
        render: renderFilesTab,
        createDefinitions: createFilesSettingDefinitions
    },
    {
        id: 'frontmatter',
        getLabel: () => strings.settings.groups.notes.frontmatter,
        render: renderFrontmatterTab,
        createDefinitions: createFrontmatterSettingDefinitions
    },
    {
        id: 'notes',
        getLabel: () => strings.settings.sections.notes,
        render: renderNotesTab,
        createDefinitions: createNotesSettingDefinitions
    },
    {
        id: 'calendar',
        getLabel: () => strings.settings.sections.calendar,
        render: renderCalendarTab,
        createDefinitions: createCalendarSettingDefinitions
    },
    {
        id: 'icon-packs',
        getLabel: () => strings.settings.sections.icons,
        render: renderIconPacksTab,
        createDefinitions: createIconPacksSettingDefinitions
    },
    {
        id: 'advanced',
        getLabel: () => strings.settings.sections.advanced,
        render: renderAdvancedTab,
        createDefinitions: createAdvancedSettingDefinitions
    }
];

export const SETTINGS_PANE_DEFINITION_MAP = new Map<SettingsPaneId, SettingsPaneDefinition>(
    SETTINGS_PANE_DEFINITIONS.map(definition => [definition.id, definition])
);

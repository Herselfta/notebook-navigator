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

import { strings } from '../../i18n';
import type { SettingDefinitionItem } from 'obsidian';
import { formatCommaSeparatedList, parseCommaSeparatedList } from '../../utils/commaSeparatedListUtils';
import { normalizeTagPath } from '../../utils/tagUtils';
import { ensureVaultProfiles } from '../../utils/vaultProfiles';
import { createGroupDefinition, createRenderDefinition } from '../nativeSettingControls';
import type { SettingsTabContext } from './SettingsTabContext';

/** Builds native 1.13 setting definitions for active-profile filter settings. */
export function createDisplayFiltersSettingDefinitions(context: SettingsTabContext): SettingDefinitionItem[] {
    const { plugin } = context;
    ensureVaultProfiles(plugin.settings);

    const getActiveProfile = () => {
        return (
            plugin.settings.vaultProfiles.find(profile => profile.id === plugin.settings.vaultProfile) ??
            plugin.settings.vaultProfiles[0] ??
            null
        );
    };

    return [
        createGroupDefinition(undefined, [
            createRenderDefinition({
                name: strings.settings.items.excludedFileNamePatterns.name,
                desc: strings.settings.items.excludedFileNamePatterns.desc,
                aliases: [strings.settings.items.excludedFileNamePatterns.placeholder],
                render: setting => {
                    context.configureDebouncedTextSetting(
                        setting,
                        strings.settings.items.excludedFileNamePatterns.name,
                        strings.settings.items.excludedFileNamePatterns.desc,
                        strings.settings.items.excludedFileNamePatterns.placeholder,
                        () => formatCommaSeparatedList(getActiveProfile()?.hiddenFileNames ?? []),
                        value => {
                            const activeProfile = getActiveProfile();
                            if (!activeProfile) {
                                return;
                            }
                            activeProfile.hiddenFileNames = Array.from(new Set(parseCommaSeparatedList(value)));
                        }
                    );
                    setting.controlEl.addClass('nn-setting-wide-input');
                }
            }),
            createRenderDefinition({
                name: strings.settings.items.excludedFolders.name,
                desc: strings.settings.items.excludedFolders.desc,
                aliases: [strings.settings.items.excludedFolders.placeholder],
                render: setting => {
                    context.configureDebouncedTextSetting(
                        setting,
                        strings.settings.items.excludedFolders.name,
                        strings.settings.items.excludedFolders.desc,
                        strings.settings.items.excludedFolders.placeholder,
                        () => formatCommaSeparatedList(getActiveProfile()?.hiddenFolders ?? []),
                        value => {
                            const activeProfile = getActiveProfile();
                            if (!activeProfile) {
                                return;
                            }
                            activeProfile.hiddenFolders = Array.from(new Set(parseCommaSeparatedList(value)));
                        }
                    );
                    setting.controlEl.addClass('nn-setting-wide-input');
                }
            }),
            createRenderDefinition({
                name: strings.settings.items.descendantExcludedFolders.name,
                desc: strings.settings.items.descendantExcludedFolders.desc,
                aliases: [strings.settings.items.descendantExcludedFolders.placeholder],
                render: setting => {
                    context.configureDebouncedTextSetting(
                        setting,
                        strings.settings.items.descendantExcludedFolders.name,
                        strings.settings.items.descendantExcludedFolders.desc,
                        strings.settings.items.descendantExcludedFolders.placeholder,
                        () => formatCommaSeparatedList(getActiveProfile()?.descendantExcludedFolders ?? []),
                        value => {
                            const activeProfile = getActiveProfile();
                            if (!activeProfile) {
                                return;
                            }
                            activeProfile.descendantExcludedFolders = Array.from(new Set(parseCommaSeparatedList(value)));
                        }
                    );
                    setting.controlEl.addClass('nn-setting-wide-input');
                }
            }),
            createRenderDefinition({
                name: strings.settings.items.hiddenTags.name,
                desc: strings.settings.items.hiddenTags.desc,
                aliases: [strings.settings.items.hiddenTags.placeholder],
                render: setting => {
                    context.configureDebouncedTextSetting(
                        setting,
                        strings.settings.items.hiddenTags.name,
                        strings.settings.items.hiddenTags.desc,
                        strings.settings.items.hiddenTags.placeholder,
                        () => formatCommaSeparatedList(getActiveProfile()?.hiddenTags ?? []),
                        value => {
                            const activeProfile = getActiveProfile();
                            if (!activeProfile) {
                                return;
                            }
                            const normalizedHiddenTags = parseCommaSeparatedList(value)
                                .map(entry => normalizeTagPath(entry))
                                .filter((entry): entry is string => entry !== null);

                            activeProfile.hiddenTags = Array.from(new Set(normalizedHiddenTags));
                        }
                    );
                    setting.controlEl.addClass('nn-setting-wide-input');
                }
            }),
            createRenderDefinition({
                name: strings.settings.items.hiddenFileTags.name,
                desc: strings.settings.items.hiddenFileTags.desc,
                aliases: [strings.settings.items.hiddenFileTags.placeholder],
                render: setting => {
                    context.configureDebouncedTextSetting(
                        setting,
                        strings.settings.items.hiddenFileTags.name,
                        strings.settings.items.hiddenFileTags.desc,
                        strings.settings.items.hiddenFileTags.placeholder,
                        () => formatCommaSeparatedList(getActiveProfile()?.hiddenFileTags ?? []),
                        value => {
                            const activeProfile = getActiveProfile();
                            if (!activeProfile) {
                                return;
                            }

                            const normalizedHiddenFileTags = parseCommaSeparatedList(value)
                                .map(entry => normalizeTagPath(entry))
                                .filter((entry): entry is string => entry !== null);

                            activeProfile.hiddenFileTags = Array.from(new Set(normalizedHiddenFileTags));
                        }
                    );
                    setting.controlEl.addClass('nn-setting-wide-input');
                }
            }),
            createRenderDefinition({
                name: strings.settings.items.excludedNotes.name,
                desc: strings.settings.items.excludedNotes.desc,
                aliases: [strings.settings.items.excludedNotes.placeholder],
                render: setting => {
                    context.configureDebouncedTextSetting(
                        setting,
                        strings.settings.items.excludedNotes.name,
                        strings.settings.items.excludedNotes.desc,
                        strings.settings.items.excludedNotes.placeholder,
                        () => formatCommaSeparatedList(getActiveProfile()?.hiddenFileProperties ?? []),
                        value => {
                            const activeProfile = getActiveProfile();
                            if (!activeProfile) {
                                return;
                            }
                            activeProfile.hiddenFileProperties = Array.from(new Set(parseCommaSeparatedList(value)));
                        }
                    );
                    setting.controlEl.addClass('nn-setting-wide-input');
                }
            })
        ])
    ];
}

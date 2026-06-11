import { useCallback, useEffect, useRef } from 'react';
import { useServices } from '../context/ServicesContext';
import { useSettingsState } from '../context/SettingsContext';
import { runAsyncAction } from '../utils/async';
import { getDBInstance } from '../storage/fileOperations';
import { ContentProviderRegistry } from '../services/content/ContentProviderRegistry';
import { ContentReadCache } from '../services/content/ContentReadCache';
import { MarkdownPipelineContentProvider } from '../services/content/MarkdownPipelineContentProvider';
import { NotebookNavigatorView } from '../view/NotebookNavigatorView';
import { Calendar } from './calendar';
import type { CalendarFeatureImageTarget } from './calendar/useCalendarFeatureImages';

export function CalendarRightSidebar() {
    const { app, plugin } = useServices();
    const settings = useSettingsState();
    const isMountedRef = useRef(true);
    const featureImageRegistryRef = useRef<ContentProviderRegistry | null>(null);

    const getFeatureImageRegistry = useCallback(() => {
        if (!featureImageRegistryRef.current) {
            const readCache = new ContentReadCache(app);
            const registry = new ContentProviderRegistry();
            registry.registerProvider(new MarkdownPipelineContentProvider(app, readCache));
            featureImageRegistryRef.current = registry;
        }

        return featureImageRegistryRef.current;
    }, [app]);

    useEffect(() => {
        isMountedRef.current = true;

        return () => {
            isMountedRef.current = false;
            featureImageRegistryRef.current?.stopAllProcessing();
            featureImageRegistryRef.current = null;
        };
    }, []);

    const handleAddDateFilter = useCallback(
        (dateToken: string) => {
            runAsyncAction(async () => {
                let leaves = plugin.getNavigatorLeaves();
                let shouldRevealLeaf = true;
                if (leaves.length === 0) {
                    await plugin.activateView();
                    leaves = plugin.getNavigatorLeaves();
                    shouldRevealLeaf = false;
                }

                const navigatorLeaf = leaves[0];
                if (!navigatorLeaf) {
                    return;
                }

                const navigatorView = navigatorLeaf.view;
                if (!(navigatorView instanceof NotebookNavigatorView)) {
                    return;
                }

                navigatorView.addDateFilterToSearch(dateToken);
                if (shouldRevealLeaf) {
                    await app.workspace.revealLeaf(navigatorLeaf);
                }
            });
        },
        [app.workspace, plugin]
    );
    const handleMissingFeatureImage = useCallback(
        (target: CalendarFeatureImageTarget) => {
            runAsyncAction(async () => {
                if (!settings.showFeatureImage || target.file.extension !== 'md') {
                    return;
                }

                const db = getDBInstance();
                await db.clearFileContent(target.file.path, 'featureImage');
                if (!isMountedRef.current) {
                    return;
                }

                getFeatureImageRegistry().queueFilesForAllProviders([target.file], settings, { include: ['markdownPipeline'] });
            });
        },
        [getFeatureImageRegistry, settings]
    );

    return (
        <div className="nn-calendar-right-sidebar nn-list-pane">
            <div className="nn-calendar-right-sidebar-content">
                <Calendar
                    weeksToShowOverride={6}
                    onAddDateFilter={handleAddDateFilter}
                    onMissingFeatureImage={handleMissingFeatureImage}
                    isRightSidebar={true}
                />
            </div>
        </div>
    );
}

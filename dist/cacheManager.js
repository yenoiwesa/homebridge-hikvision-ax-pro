"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CacheManager = void 0;
/**
 * CacheManager
 * Centralized cache for subsystem and zone statuses, polling the panel
 * at a configurable interval and providing cached data to accessories.
 */
class CacheManager {
    constructor(hikaxpro, pollingInterval, log) {
        this.hikaxpro = hikaxpro;
        this.pollingInterval = pollingInterval;
        this.log = log;
        this.cachedSubsystems = [];
        this.cachedZones = [];
        this.updateCallbacks = [];
    }
    /**
     * Start polling for status updates
     */
    startPolling() {
        this.pollingTimer = setInterval(async () => {
            await this.updateAllStatuses();
        }, this.pollingInterval);
        // Initial update
        this.updateAllStatuses();
    }
    /**
     * Stop polling
     */
    stopPolling() {
        if (this.pollingTimer) {
            clearInterval(this.pollingTimer);
            this.pollingTimer = undefined;
        }
    }
    /**
     * Get cached subsystem statuses
     */
    getCachedSubsystems() {
        return this.cachedSubsystems;
    }
    /**
     * Get cached zone statuses
     */
    getCachedZones() {
        return this.cachedZones;
    }
    /**
     * Force an immediate status update
     */
    async forceUpdate() {
        await this.updateAllStatuses();
    }
    /**
     * Register a callback to be notified when cache is updated
     */
    onUpdate(callback) {
        this.updateCallbacks.push(callback);
    }
    /**
     * Fetch and cache all statuses, then notify subscribers
     */
    async updateAllStatuses() {
        try {
            // Single API call for all subsystems
            this.cachedSubsystems = await this.hikaxpro.fetchSubsystemStatuses();
            // Single API call for all zones
            this.cachedZones = await this.hikaxpro.fetchZoneStatuses();
            this.log.debug(`Polled: ${this.cachedSubsystems.length} subsystems, ${this.cachedZones.length} zones`);
            // Notify all registered callbacks
            this.notifySubscribers();
        }
        catch (error) {
            const err = error;
            this.log.error(`Failed to update statuses: ${err.message}`);
        }
    }
    /**
     * Notify all subscribers of cache update
     */
    notifySubscribers() {
        for (const callback of this.updateCallbacks) {
            try {
                callback();
            }
            catch (error) {
                const err = error;
                this.log.error(`Error in update callback: ${err.message}`);
            }
        }
    }
}
exports.CacheManager = CacheManager;

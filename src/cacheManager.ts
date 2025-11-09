import type { Logger } from 'homebridge';
import { HikAxPro, SubsystemStatus, ZoneStatus } from './hikaxpro';

/**
 * CacheManager
 * Centralized cache for subsystem and zone statuses, polling the panel
 * at a configurable interval and providing cached data to accessories.
 */
export class CacheManager {
  private cachedSubsystems: SubsystemStatus[] = [];
  private cachedZones: ZoneStatus[] = [];
  private pollingTimer?: ReturnType<typeof setInterval>;
  private updateCallbacks: Array<() => void> = [];

  constructor(
    private readonly hikaxpro: HikAxPro,
    private readonly pollingInterval: number,
    private readonly log: Logger
  ) {}

  /**
   * Start polling for status updates
   */
  public startPolling(): void {
    this.pollingTimer = setInterval(async () => {
      await this.updateAllStatuses();
    }, this.pollingInterval);

    // Initial update
    this.updateAllStatuses();
  }

  /**
   * Stop polling
   */
  public stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }
  }

  /**
   * Get cached subsystem statuses
   */
  public getCachedSubsystems(): SubsystemStatus[] {
    return this.cachedSubsystems;
  }

  /**
   * Get cached zone statuses
   */
  public getCachedZones(): ZoneStatus[] {
    return this.cachedZones;
  }

  /**
   * Force an immediate status update
   */
  public async forceUpdate(): Promise<void> {
    await this.updateAllStatuses();
  }

  /**
   * Register a callback to be notified when cache is updated
   */
  public onUpdate(callback: () => void): void {
    this.updateCallbacks.push(callback);
  }

  /**
   * Fetch and cache all statuses, then notify subscribers
   */
  private async updateAllStatuses(): Promise<void> {
    try {
      // Single API call for all subsystems
      this.cachedSubsystems = await this.hikaxpro.fetchSubsystemStatuses();

      // Single API call for all zones
      this.cachedZones = await this.hikaxpro.fetchZoneStatuses();

      this.log.debug(
        `Polled: ${this.cachedSubsystems.length} subsystems, ${this.cachedZones.length} zones`
      );

      // Notify all registered callbacks
      this.notifySubscribers();
    } catch (error) {
      const err = error as Error;
      this.log.error(`Failed to update statuses: ${err.message}`);
    }
  }

  /**
   * Notify all subscribers of cache update
   */
  private notifySubscribers(): void {
    for (const callback of this.updateCallbacks) {
      try {
        callback();
      } catch (error) {
        const err = error as Error;
        this.log.error(`Error in update callback: ${err.message}`);
      }
    }
  }
}

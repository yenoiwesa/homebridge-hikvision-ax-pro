import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import { HikAxPro, SubsystemStatus, ZoneStatus } from './hikaxpro';
import { SecuritySystemAccessory } from './securitySystemAccessory';
import { MotionSensorAccessory } from './motionSensorAccessory';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';

export interface HikvisionAxProConfig extends PlatformConfig {
  host: string;
  username: string;
  password: string;
  userLevel?: number;
  pollingInterval?: number; // in milliseconds, default 5000
}

/**
 * HikvisionAxProPlatform
 * This class is the main constructor for the plugin, parsing user config
 * and registering accessories with Homebridge.
 */
export class HikvisionAxProPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly hikaxpro!: HikAxPro;
  public readonly pollingInterval!: number;
  private pollingTimer?: NodeJS.Timeout;

  // Cached status data shared by all accessories
  private cachedSubsystems: SubsystemStatus[] = [];
  private cachedZones: ZoneStatus[] = [];

  // Store accessory instances for update notifications
  private securitySystemAccessories: SecuritySystemAccessory[] = [];
  private motionSensorAccessories: MotionSensorAccessory[] = [];

  constructor(
    public readonly log: Logger,
    public readonly config: HikvisionAxProConfig,
    public readonly api: API
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    // Validate configuration
    if (!config.host || !config.username || !config.password) {
      this.log.error('Missing required configuration: host, username, and password are required');
      return;
    }

    // Initialize HikAxPro client
    (this as { hikaxpro: HikAxPro }).hikaxpro = new HikAxPro({
      host: config.host,
      username: config.username,
      password: config.password,
      userLevel: config.userLevel || 1,
    });

    (this as { pollingInterval: number }).pollingInterval = config.pollingInterval || 5000;

    this.log.debug('Finished initializing platform');

    // Register accessories when Homebridge finishes launching
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      this.discoverDevices();
      // Start centralized polling after devices are discovered
      this.startPolling();
    });
  }

  /**
   * Get cached subsystem statuses (shared by all security system accessories)
   */
  public getCachedSubsystems(): SubsystemStatus[] {
    return this.cachedSubsystems;
  }

  /**
   * Get cached zone statuses (shared by all motion sensor accessories)
   */
  public getCachedZones(): ZoneStatus[] {
    return this.cachedZones;
  }

  /**
   * Start centralized polling - all accessories share these results
   */
  private startPolling() {
    this.pollingTimer = setInterval(() => {
      this.updateAllStatuses();
    }, this.pollingInterval);

    // Initial update
    this.updateAllStatuses();
  }

  /**
   * Update all statuses from the panel (called once per polling interval)
   * This method is also exposed publicly for accessories to trigger immediate updates
   */
  public async updateAllStatuses() {
    try {
      // Single API call for all subsystems
      this.cachedSubsystems = await this.hikaxpro.fetchSubsystemStatuses();

      // Single API call for all zones
      this.cachedZones = await this.hikaxpro.fetchZoneStatuses();

      this.log.debug(
        `Polled: ${this.cachedSubsystems.length} subsystems, ${this.cachedZones.length} zones`
      );

      // Notify all accessories to update their characteristics
      this.notifyAccessories();
    } catch (error) {
      const err = error as Error;
      this.log.error(`Failed to update statuses: ${err.message}`);
    }
  }

  /**
   * Notify all accessories to update their HomeKit characteristics with cached data
   */
  private notifyAccessories() {
    for (const accessory of this.securitySystemAccessories) {
      accessory.updateFromCache();
    }
    for (const accessory of this.motionSensorAccessories) {
      accessory.updateFromCache();
    }
  }

  /**
   * Register a security system accessory for update notifications
   */
  public registerSecuritySystemAccessory(accessory: SecuritySystemAccessory) {
    this.securitySystemAccessories.push(accessory);
  }

  /**
   * Register a motion sensor accessory for update notifications
   */
  public registerMotionSensorAccessory(accessory: MotionSensorAccessory) {
    this.motionSensorAccessories.push(accessory);
  }

  /**
   * Restore cached accessories from disk at startup.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  /**
   * Discover and register accessories
   */
  async discoverDevices() {
    try {
      // Fetch subsystems and zones from the panel
      const subsystems = await this.hikaxpro.fetchSubsystemStatuses();
      const zones = await this.hikaxpro.fetchZoneStatuses();

      this.log.info(`Discovered ${subsystems.length} subsystem(s) and ${zones.length} zone(s)`);

      // Register security system accessory (one per subsystem)
      for (const subsystem of subsystems) {
        const uuid = this.api.hap.uuid.generate(`security-${subsystem.id}`);
        const existingAccessory = this.accessories.get(uuid);

        if (existingAccessory) {
          this.log.info(
            'Restoring existing security system from cache:',
            existingAccessory.displayName
          );
          existingAccessory.context.device = subsystem;
          this.api.updatePlatformAccessories([existingAccessory]);
          const accessory = new SecuritySystemAccessory(this, existingAccessory);
          this.registerSecuritySystemAccessory(accessory);
        } else {
          this.log.info('Adding new security system:', subsystem.name);
          const accessory = new this.api.platformAccessory(subsystem.name, uuid);
          accessory.context.device = subsystem;
          const securityAccessory = new SecuritySystemAccessory(this, accessory);
          this.registerSecuritySystemAccessory(securityAccessory);
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }
      }

      // Register motion sensor accessory for each zone
      for (const zone of zones) {
        const uuid = this.api.hap.uuid.generate(`zone-${zone.id}`);
        const existingAccessory = this.accessories.get(uuid);

        if (existingAccessory) {
          this.log.info(
            'Restoring existing motion sensor from cache:',
            existingAccessory.displayName
          );
          existingAccessory.context.device = zone;
          this.api.updatePlatformAccessories([existingAccessory]);
          const accessory = new MotionSensorAccessory(this, existingAccessory);
          this.registerMotionSensorAccessory(accessory);
        } else {
          this.log.info('Adding new motion sensor:', zone.name);
          const accessory = new this.api.platformAccessory(zone.name, uuid);
          accessory.context.device = zone;
          const motionAccessory = new MotionSensorAccessory(this, accessory);
          this.registerMotionSensorAccessory(motionAccessory);
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }
      }
    } catch (error) {
      const err = error as Error;
      this.log.error('Failed to discover devices:', err.message);
    }
  }
}

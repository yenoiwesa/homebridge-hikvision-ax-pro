import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import { HikAxPro } from './hikaxpro';
import { CacheManager } from './cacheManager';
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
  public readonly hikaxpro: HikAxPro;
  public readonly cacheManager: CacheManager;

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
      throw new Error('Invalid configuration');
    }

    // Initialize HikAxPro client
    this.hikaxpro = new HikAxPro({
      host: config.host,
      username: config.username,
      password: config.password,
      userLevel: config.userLevel ?? 1,
    });

    // Initialize cache manager
    const pollingInterval = config.pollingInterval ?? 5000;
    this.cacheManager = new CacheManager(this.hikaxpro, pollingInterval, this.log);

    this.log.debug('Finished initializing platform');

    // Register accessories when Homebridge finishes launching
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      this.discoverDevices();
      // Start centralized polling after devices are discovered
      this.cacheManager.startPolling();
    });
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
          new SecuritySystemAccessory(this, existingAccessory, this.cacheManager);
        } else {
          this.log.info('Adding new security system:', subsystem.name);
          const accessory = new this.api.platformAccessory(subsystem.name, uuid);
          accessory.context.device = subsystem;
          new SecuritySystemAccessory(this, accessory, this.cacheManager);
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
          new MotionSensorAccessory(this, existingAccessory, this.cacheManager);
        } else {
          this.log.info('Adding new motion sensor:', zone.name);
          const accessory = new this.api.platformAccessory(zone.name, uuid);
          accessory.context.device = zone;
          new MotionSensorAccessory(this, accessory, this.cacheManager);
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }
      }
    } catch (error) {
      const err = error as Error;
      this.log.error('Failed to discover devices:', err.message);
    }
  }
}

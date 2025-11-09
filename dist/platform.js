"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HikvisionAxProPlatform = void 0;
const hikaxpro_1 = require("./hikaxpro");
const cacheManager_1 = require("./cacheManager");
const securitySystemAccessory_1 = require("./securitySystemAccessory");
const motionSensorAccessory_1 = require("./motionSensorAccessory");
const settings_1 = require("./settings");
/**
 * HikvisionAxProPlatform
 * This class is the main constructor for the plugin, parsing user config
 * and registering accessories with Homebridge.
 */
class HikvisionAxProPlatform {
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        this.accessories = new Map();
        this.Service = api.hap.Service;
        this.Characteristic = api.hap.Characteristic;
        // Validate configuration
        if (!config.host || !config.username || !config.password) {
            this.log.error('Missing required configuration: host, username, and password are required');
            return;
        }
        // Initialize HikAxPro client
        this.hikaxpro = new hikaxpro_1.HikAxPro({
            host: config.host,
            username: config.username,
            password: config.password,
            userLevel: config.userLevel || 1,
        });
        // Initialize cache manager
        const pollingInterval = config.pollingInterval || 5000;
        this.cacheManager = new cacheManager_1.CacheManager(this.hikaxpro, pollingInterval, this.log);
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
    configureAccessory(accessory) {
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
                    this.log.info('Restoring existing security system from cache:', existingAccessory.displayName);
                    existingAccessory.context.device = subsystem;
                    this.api.updatePlatformAccessories([existingAccessory]);
                    new securitySystemAccessory_1.SecuritySystemAccessory(this, existingAccessory, this.cacheManager);
                }
                else {
                    this.log.info('Adding new security system:', subsystem.name);
                    const accessory = new this.api.platformAccessory(subsystem.name, uuid);
                    accessory.context.device = subsystem;
                    new securitySystemAccessory_1.SecuritySystemAccessory(this, accessory, this.cacheManager);
                    this.api.registerPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [accessory]);
                }
            }
            // Register motion sensor accessory for each zone
            for (const zone of zones) {
                const uuid = this.api.hap.uuid.generate(`zone-${zone.id}`);
                const existingAccessory = this.accessories.get(uuid);
                if (existingAccessory) {
                    this.log.info('Restoring existing motion sensor from cache:', existingAccessory.displayName);
                    existingAccessory.context.device = zone;
                    this.api.updatePlatformAccessories([existingAccessory]);
                    new motionSensorAccessory_1.MotionSensorAccessory(this, existingAccessory, this.cacheManager);
                }
                else {
                    this.log.info('Adding new motion sensor:', zone.name);
                    const accessory = new this.api.platformAccessory(zone.name, uuid);
                    accessory.context.device = zone;
                    new motionSensorAccessory_1.MotionSensorAccessory(this, accessory, this.cacheManager);
                    this.api.registerPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [accessory]);
                }
            }
        }
        catch (error) {
            const err = error;
            this.log.error('Failed to discover devices:', err.message);
        }
    }
}
exports.HikvisionAxProPlatform = HikvisionAxProPlatform;

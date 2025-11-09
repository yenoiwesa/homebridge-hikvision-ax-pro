import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { HikvisionAxProPlatform, MotionSensorAccessoryContext } from './platform';
import type { CacheManager } from './cacheManager';

/**
 * Motion Sensor Accessory
 * Represents a Hikvision AX Pro zone as a HomeKit MotionSensor
 */
export class MotionSensorAccessory {
  private readonly service: Service;

  constructor(
    private readonly platform: HikvisionAxProPlatform,
    private readonly accessory: PlatformAccessory<MotionSensorAccessoryContext>,
    private readonly cacheManager: CacheManager
  ) {
    // Set accessory information
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Hikvision')
      .setCharacteristic(this.platform.Characteristic.Model, 'AX Pro Zone')
      .setCharacteristic(
        this.platform.Characteristic.SerialNumber,
        `ZONE-${this.accessory.context.device.id}`
      );

    // Get or create the MotionSensor service
    this.service =
      this.accessory.getService(this.platform.Service.MotionSensor) ||
      this.accessory.addService(this.platform.Service.MotionSensor);

    this.service.setCharacteristic(
      this.platform.Characteristic.Name,
      accessory.context.device.name
    );

    // Register handler for MotionDetected (read-only)
    this.service
      .getCharacteristic(this.platform.Characteristic.MotionDetected)
      .onGet(this.getMotionDetected.bind(this));

    // Register for cache updates
    this.cacheManager.onUpdate(() => this.updateFromCache());
  }

  /**
   * Get motion detected state from cached data
   */
  async getMotionDetected(): Promise<CharacteristicValue> {
    try {
      const zones = this.cacheManager.getCachedZones();
      const zone = zones.find((z) => z.id === this.accessory.context.device.id);

      if (zone) {
        const isTriggered = zone.status === 'trigger';
        this.platform.log.debug(
          `Get MotionDetected for ${zone.name}: ${zone.status} -> ${isTriggered}`
        );
        return isTriggered;
      }
    } catch (error) {
      const err = error as Error;
      this.platform.log.error(`Failed to get motion state: ${err.message}`);
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      );
    }
    return false;
  }

  /**
   * Update HomeKit characteristic from cached data
   */
  private updateFromCache() {
    try {
      const zones = this.cacheManager.getCachedZones();
      const zone = zones.find((z) => z.id === this.accessory.context.device.id);

      if (zone) {
        const isTriggered = zone.status === 'trigger';
        this.service.updateCharacteristic(this.platform.Characteristic.MotionDetected, isTriggered);
      }
    } catch (error) {
      const err = error as Error;
      this.platform.log.debug(`Failed to update from cache: ${err.message}`);
    }
  }
}

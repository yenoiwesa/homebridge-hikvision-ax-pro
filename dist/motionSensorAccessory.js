"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MotionSensorAccessory = void 0;
/**
 * Motion Sensor Accessory
 * Represents a Hikvision AX Pro zone as a HomeKit MotionSensor
 */
class MotionSensorAccessory {
    constructor(platform, accessory) {
        this.platform = platform;
        this.accessory = accessory;
        // Set accessory information
        this.accessory
            .getService(this.platform.Service.AccessoryInformation)
            .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Hikvision')
            .setCharacteristic(this.platform.Characteristic.Model, 'AX Pro Zone')
            .setCharacteristic(this.platform.Characteristic.SerialNumber, `ZONE-${this.accessory.context.device.id}`);
        // Get or create the MotionSensor service
        this.service =
            this.accessory.getService(this.platform.Service.MotionSensor) ||
                this.accessory.addService(this.platform.Service.MotionSensor);
        this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);
        // Register handler for MotionDetected (read-only)
        this.service
            .getCharacteristic(this.platform.Characteristic.MotionDetected)
            .onGet(this.getMotionDetected.bind(this));
    }
    /**
     * Get motion detected state from cached data
     */
    async getMotionDetected() {
        try {
            const zones = this.platform.getCachedZones();
            const zone = zones.find((z) => z.id === this.accessory.context.device.id);
            if (zone) {
                const isTriggered = zone.status === 'trigger';
                this.platform.log.debug(`Get MotionDetected for ${zone.name}: ${zone.status} -> ${isTriggered}`);
                return isTriggered;
            }
        }
        catch (error) {
            const err = error;
            this.platform.log.error(`Failed to get motion state: ${err.message}`);
            throw new this.platform.api.hap.HapStatusError(-70402 /* this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE */);
        }
        return false;
    }
    /**
     * Update HomeKit characteristic from cached data
     */
    updateFromCache() {
        try {
            const zones = this.platform.getCachedZones();
            const zone = zones.find((z) => z.id === this.accessory.context.device.id);
            if (zone) {
                const isTriggered = zone.status === 'trigger';
                this.service.updateCharacteristic(this.platform.Characteristic.MotionDetected, isTriggered);
            }
        }
        catch (error) {
            const err = error;
            this.platform.log.debug(`Failed to update from cache: ${err.message}`);
        }
    }
}
exports.MotionSensorAccessory = MotionSensorAccessory;

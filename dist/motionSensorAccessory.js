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
        // Start polling for status updates
        this.startPolling();
    }
    /**
     * Get motion detected state
     */
    async getMotionDetected() {
        try {
            const zones = await this.platform.hikaxpro.fetchZoneStatuses();
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
     * Poll the panel for zone status updates
     */
    startPolling() {
        this.pollingTimer = setInterval(() => {
            this.updateMotionState();
        }, this.platform.pollingInterval);
        // Initial update
        this.updateMotionState();
    }
    /**
     * Update the motion detected characteristic
     */
    async updateMotionState() {
        try {
            const zones = await this.platform.hikaxpro.fetchZoneStatuses();
            const zone = zones.find((z) => z.id === this.accessory.context.device.id);
            if (zone) {
                const isTriggered = zone.status === 'trigger';
                this.service.updateCharacteristic(this.platform.Characteristic.MotionDetected, isTriggered);
            }
        }
        catch (error) {
            const err = error;
            this.platform.log.debug(`Failed to update motion state: ${err.message}`);
        }
    }
}
exports.MotionSensorAccessory = MotionSensorAccessory;

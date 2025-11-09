"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecuritySystemAccessory = void 0;
/**
 * Security System Accessory
 * Represents a Hikvision AX Pro alarm subsystem as a HomeKit SecuritySystem
 */
class SecuritySystemAccessory {
    constructor(platform, accessory) {
        this.platform = platform;
        this.accessory = accessory;
        // Set accessory information
        this.accessory
            .getService(this.platform.Service.AccessoryInformation)
            .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Hikvision')
            .setCharacteristic(this.platform.Characteristic.Model, 'AX Pro')
            .setCharacteristic(this.platform.Characteristic.SerialNumber, `AXPRO-${this.accessory.context.device.id}`);
        // Get or create the SecuritySystem service
        this.service =
            this.accessory.getService(this.platform.Service.SecuritySystem) ||
                this.accessory.addService(this.platform.Service.SecuritySystem);
        this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);
        // Register handlers for SecuritySystemCurrentState (read-only)
        this.service
            .getCharacteristic(this.platform.Characteristic.SecuritySystemCurrentState)
            .onGet(this.getCurrentState.bind(this));
        // Register handlers for SecuritySystemTargetState (user sets this)
        this.service
            .getCharacteristic(this.platform.Characteristic.SecuritySystemTargetState)
            .onGet(this.getTargetState.bind(this))
            .onSet(this.setTargetState.bind(this));
        // Start polling for status updates
        this.startPolling();
    }
    /**
     * Map Hikvision arming state to HomeKit SecuritySystemCurrentState
     */
    mapArmingStateToCurrentState(arming) {
        switch (arming) {
            case 'stay':
                return this.platform.Characteristic.SecuritySystemCurrentState.STAY_ARM;
            case 'away':
                return this.platform.Characteristic.SecuritySystemCurrentState.AWAY_ARM;
            case 'disarm':
                return this.platform.Characteristic.SecuritySystemCurrentState.DISARMED;
            case 'arming':
            case 'disarming':
                // Return current state while transitioning
                return this.platform.Characteristic.SecuritySystemCurrentState.DISARMED;
            default:
                return this.platform.Characteristic.SecuritySystemCurrentState.DISARMED;
        }
    }
    /**
     * Map Hikvision arming state to HomeKit SecuritySystemTargetState
     */
    mapArmingStateToTargetState(arming) {
        switch (arming) {
            case 'stay':
                return this.platform.Characteristic.SecuritySystemTargetState.STAY_ARM;
            case 'away':
                return this.platform.Characteristic.SecuritySystemTargetState.AWAY_ARM;
            case 'disarm':
            case 'arming':
            case 'disarming':
            default:
                return this.platform.Characteristic.SecuritySystemTargetState.DISARM;
        }
    }
    /**
     * Get current security system state
     */
    async getCurrentState() {
        try {
            const subsystems = await this.platform.hikaxpro.fetchSubsystemStatuses();
            const subsystem = subsystems.find((s) => s.id === this.accessory.context.device.id);
            if (subsystem) {
                const state = this.mapArmingStateToCurrentState(subsystem.arming);
                this.platform.log.debug(`Get CurrentState for ${subsystem.name}: ${subsystem.arming} -> ${state}`);
                return state;
            }
        }
        catch (error) {
            const err = error;
            this.platform.log.error(`Failed to get current state: ${err.message}`);
            throw new this.platform.api.hap.HapStatusError(-70402 /* this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE */);
        }
        return this.platform.Characteristic.SecuritySystemCurrentState.DISARMED;
    }
    /**
     * Get target security system state
     */
    async getTargetState() {
        try {
            const subsystems = await this.platform.hikaxpro.fetchSubsystemStatuses();
            const subsystem = subsystems.find((s) => s.id === this.accessory.context.device.id);
            if (subsystem) {
                const state = this.mapArmingStateToTargetState(subsystem.arming);
                this.platform.log.debug(`Get TargetState for ${subsystem.name}: ${subsystem.arming} -> ${state}`);
                return state;
            }
        }
        catch (error) {
            const err = error;
            this.platform.log.error(`Failed to get target state: ${err.message}`);
        }
        return this.platform.Characteristic.SecuritySystemTargetState.DISARM;
    }
    /**
     * Set target security system state (arm/disarm)
     */
    async setTargetState(value) {
        const targetState = value;
        const subsystemId = this.accessory.context.device.id;
        try {
            this.platform.log.info(`Setting security system to state: ${targetState}`);
            switch (targetState) {
                case this.platform.Characteristic.SecuritySystemTargetState.STAY_ARM:
                    await this.platform.hikaxpro.armStay(subsystemId);
                    this.platform.log.info('Armed in STAY mode');
                    break;
                case this.platform.Characteristic.SecuritySystemTargetState.AWAY_ARM:
                    await this.platform.hikaxpro.armAway(subsystemId);
                    this.platform.log.info('Armed in AWAY mode');
                    break;
                case this.platform.Characteristic.SecuritySystemTargetState.DISARM:
                    await this.platform.hikaxpro.disarm(subsystemId);
                    this.platform.log.info('Disarmed');
                    break;
                case this.platform.Characteristic.SecuritySystemTargetState.NIGHT_ARM:
                    // Night arm not supported by Hikvision, treat as stay
                    await this.platform.hikaxpro.armStay(subsystemId);
                    this.platform.log.info('Armed in STAY mode (NIGHT requested but not supported)');
                    break;
            }
            // Update the current state after a short delay
            setTimeout(() => {
                this.updateCurrentState();
            }, 1000);
        }
        catch (error) {
            const err = error;
            this.platform.log.error(`Failed to set target state: ${err.message}`);
            throw new this.platform.api.hap.HapStatusError(-70402 /* this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE */);
        }
    }
    /**
     * Poll the panel for status updates
     */
    startPolling() {
        this.pollingTimer = setInterval(() => {
            this.updateCurrentState();
        }, this.platform.pollingInterval);
        // Initial update
        this.updateCurrentState();
    }
    /**
     * Update the current state characteristic
     */
    async updateCurrentState() {
        try {
            const subsystems = await this.platform.hikaxpro.fetchSubsystemStatuses();
            const subsystem = subsystems.find((s) => s.id === this.accessory.context.device.id);
            if (subsystem) {
                const currentState = this.mapArmingStateToCurrentState(subsystem.arming);
                this.service.updateCharacteristic(this.platform.Characteristic.SecuritySystemCurrentState, currentState);
                const targetState = this.mapArmingStateToTargetState(subsystem.arming);
                this.service.updateCharacteristic(this.platform.Characteristic.SecuritySystemTargetState, targetState);
            }
        }
        catch (error) {
            const err = error;
            this.platform.log.debug(`Failed to update current state: ${err.message}`);
        }
    }
}
exports.SecuritySystemAccessory = SecuritySystemAccessory;

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HikAxPro = void 0;
const axios_1 = __importDefault(require("axios"));
const xml2js_1 = __importDefault(require("xml2js"));
const crypto_1 = __importDefault(require("crypto"));
const ENDPOINTS = {
    Session_Capabilities: '/ISAPI/Security/sessionLogin/capabilities?username=',
    Session_Login: '/ISAPI/Security/sessionLogin',
    HostStatus: '/ISAPI/SecurityCP/status/host',
    Zones: '/ISAPI/SecurityCP/status/zones',
    SubSystems: '/ISAPI/SecurityCP/status/subSystems',
    // Control endpoints (subsystem id placeholder will be replaced)
    Alarm_Disarm: '/ISAPI/SecurityCP/control/disarm/{}',
    Alarm_ArmAway: '/ISAPI/SecurityCP/control/arm/{}?ways=away',
    Alarm_ArmHome: '/ISAPI/SecurityCP/control/arm/{}?ways=stay',
};
const XML_SCHEMA = 'http://www.hikvision.com/ver20/XMLSchema';
const SUBSYSTEM_WILDCARD = '0xffffffff';
/**
 * Custom error for when switching between arm modes requires disarming first
 */
class InvalidArmModeTransitionError extends Error {
    constructor(message, response) {
        super(message);
        this.response = response;
        this.name = 'InvalidArmModeTransitionError';
    }
}
class HikAxPro {
    constructor({ host, username, password, userLevel = 1 }) {
        // Session cookie for authenticated requests
        this.cookie = null;
        // Internal flag to avoid multiple simultaneous login attempts
        this.loginPromise = null;
        this.host = host;
        this.username = username;
        this.password = password;
        this.userLevel = userLevel;
    }
    /** Helper to inject subsystem id into endpoint templates */
    static fillSubsystemEndpoint(template, subsystemId) {
        return template.replace('{}', String(subsystemId));
    }
    /** Append format=json preserving existing query parameters */
    static withJsonFormat(endpoint) {
        return endpoint.includes('?') ? `${endpoint}&format=json` : `${endpoint}?format=json`;
    }
    getRequestHeaders(contentType = null) {
        const headers = { 'X-Userlevel': String(this.userLevel) };
        if (this.cookie)
            headers['Cookie'] = this.cookie;
        if (contentType)
            headers['Content-Type'] = contentType;
        return headers;
    }
    sha256(data) {
        return crypto_1.default.createHash('sha256').update(data).digest('hex');
    }
    async getSessionParams() {
        const url = `http://${this.host}${ENDPOINTS.Session_Capabilities}${encodeURIComponent(this.username)}`;
        const headers = this.getRequestHeaders();
        const response = await axios_1.default.get(url, { headers });
        const xml = response.data;
        const parsed = await xml2js_1.default.parseStringPromise(xml, { explicitArray: false });
        const root = parsed['SessionLoginCap'] || parsed['xmlns:SessionLoginCap'];
        return {
            sessionID: root['sessionID'] || root['xmlns:sessionID'],
            sessionIDVersion: root['sessionIDVersion'] || root['xmlns:sessionIDVersion'],
            challenge: root['challenge'] || root['xmlns:challenge'],
            salt: root['salt'] || root['xmlns:salt'],
            salt2: root['salt2'] || root['xmlns:salt2'],
            isIrreversible: (root['isIrreversible'] || root['xmlns:isIrreversible']) === 'true',
            iterations: parseInt(root['iterations'] || root['xmlns:iterations'] || '1', 10),
        };
    }
    encodePassword(params) {
        const { sessionIDVersion, isIrreversible, salt, salt2, challenge, iterations } = params;
        let result;
        if (sessionIDVersion === '2' && isIrreversible) {
            result = this.sha256(`${this.username}${salt}${this.password}`);
            result = this.sha256(`${result}${challenge}`);
            for (let i = 2; i < iterations; i++) {
                result = this.sha256(result);
            }
        }
        else if (isIrreversible) {
            result = this.sha256(`${this.username}${salt}${this.password}`);
            result = this.sha256(`${this.username}${salt2}${result}`);
            result = this.sha256(`${result}${challenge}`);
            for (let i = 2; i < iterations; i++) {
                result = this.sha256(result);
            }
        }
        else {
            result = `${this.sha256(this.password)}${challenge}`;
            for (let i = 1; i < iterations; i++) {
                result = this.sha256(result);
            }
        }
        return result;
    }
    buildLoginXML(sessionID, username, encodedPassword, sessionIDVersion) {
        return `<?xml version="1.0" encoding="UTF-8"?>
<SessionLogin xmlns="${XML_SCHEMA}">
  <sessionID>${sessionID}</sessionID>
  <userName>${username}</userName>
  <password>${encodedPassword}</password>
  <sessionIDVersion>${sessionIDVersion}</sessionIDVersion>
</SessionLogin>`;
    }
    async login() {
        const params = await this.getSessionParams();
        const encodedPassword = this.encodePassword(params);
        const xml = this.buildLoginXML(params.sessionID, this.username, encodedPassword, params.sessionIDVersion);
        const timestamp = Math.floor(Date.now() / 1000);
        const url = `http://${this.host}${ENDPOINTS.Session_Login}?timeStamp=${timestamp}`;
        const headers = this.getRequestHeaders('application/xml');
        const response = await axios_1.default.post(url, xml, { headers, validateStatus: () => true });
        if (response.status === 200) {
            let cookie = response.headers['set-cookie']
                ? response.headers['set-cookie'][0].split(';')[0]
                : null;
            if (!cookie && response.data) {
                try {
                    const parsed = await xml2js_1.default.parseStringPromise(response.data, { explicitArray: false });
                    const root = parsed['SessionLogin'] || parsed['xmlns:SessionLogin'];
                    const sessionID = root && (root['sessionID'] || root['xmlns:sessionID']);
                    if (sessionID) {
                        cookie = `WebSession=${sessionID}`;
                    }
                }
                catch {
                    // Ignore parse errors
                }
            }
            if (!cookie)
                throw new Error('No session cookie or sessionID provided');
            this.cookie = cookie;
            return;
        }
        else {
            this.cookie = null;
            throw new Error(`Login failed: ${response.status} ${response.data}`);
        }
    }
    /**
     * Centralized request helper that ensures we are logged in and retries once on 401.
     * @param method HTTP method
     * @param endpoint Endpoint path beginning with '/'
     * @param data Optional request body (for POST/PUT/etc.)
     * @param extraHeaders Optional extra headers to merge
     */
    async sendRequest(method, endpoint, data, extraHeaders = {}) {
        // Ensure endpoint formatting
        if (!endpoint.startsWith('/'))
            throw new Error('Endpoint must start with /');
        // Ensure we have a valid session (single-flight)
        if (!this.cookie) {
            if (!this.loginPromise) {
                this.loginPromise = this.login().finally(() => (this.loginPromise = null));
            }
            await this.loginPromise;
        }
        const attempt = async () => {
            const url = `http://${this.host}${endpoint}`;
            const headers = { ...this.getRequestHeaders(), ...extraHeaders };
            return (0, axios_1.default)({ method, url, data, headers, validateStatus: () => true });
        };
        let response = await attempt();
        if (response.status === 401) {
            // Session invalid – force re-login then retry once
            this.cookie = null;
            if (!this.loginPromise) {
                this.loginPromise = this.login().finally(() => (this.loginPromise = null));
            }
            await this.loginPromise;
            response = await attempt();
        }
        if (response.status < 200 || response.status >= 300) {
            // Check for specific error: Invalid Operation due to armedStatus
            // This occurs when trying to switch between arm modes without disarming first
            const responseData = response.data;
            if (responseData &&
                responseData.statusCode === 4 &&
                responseData.subStatusCode === 'armedStatus' &&
                responseData.errorCode === 1073774603) {
                throw new InvalidArmModeTransitionError('Cannot switch between arm modes without disarming first', responseData);
            }
            throw new Error(`Request failed: ${response.status} ${JSON.stringify(response.data) ?? ''}`);
        }
        return response.data;
    }
    /**
     * Fetch subsystem statuses from the /ISAPI/SecurityCP/status/subSystems endpoint.
     */
    async fetchSubsystemStatuses() {
        const data = await this.sendRequest('GET', `${ENDPOINTS.SubSystems}?format=json`);
        const subsystems = data?.SubSysList || [];
        return subsystems
            .map((s) => s.SubSys)
            .filter((s) => s !== undefined && s.enabled)
            .map((s) => ({
            id: s.id,
            name: s.name,
            arming: s.arming,
        }));
    }
    /**
     * Fetch zone statuses from the /ISAPI/SecurityCP/status/zones endpoint.
     */
    async fetchZoneStatuses() {
        const data = await this.sendRequest('GET', `${ENDPOINTS.Zones}?format=json`);
        const zones = data?.ZoneList || [];
        return zones
            .map((z) => z.Zone)
            .filter((z) => z !== undefined)
            .map((z) => ({
            id: z.id,
            name: z.name,
            status: z.status,
            detectorType: z.detectorType,
        }));
    }
    /**
     * Internal helper to execute arm/disarm operations with consistent logic.
     * Handles the case where switching between arm modes requires disarming first.
     */
    async executeArmDisarmOperation(endpoint, code, subsystemId, isRetry = false) {
        const body = code ? { Operate: { moduleOperateCode: code } } : undefined;
        try {
            return await this.sendRequest('PUT', endpoint, body, body ? { 'Content-Type': 'application/json' } : {});
        }
        catch (error) {
            // Handle InvalidArmModeTransitionError by disarming first, then retrying
            if (!isRetry && error instanceof InvalidArmModeTransitionError) {
                // Disarm first
                const sid = subsystemId ?? SUBSYSTEM_WILDCARD;
                const disarmEndpoint = HikAxPro.withJsonFormat(HikAxPro.fillSubsystemEndpoint(ENDPOINTS.Alarm_Disarm, sid));
                await this.executeArmDisarmOperation(disarmEndpoint, code, subsystemId, true);
                // Retry the original arm operation
                return this.executeArmDisarmOperation(endpoint, code, subsystemId, true);
            }
            throw error;
        }
    }
    /**
     * Arm subsystem in STAY/HOME mode. If subsystemId omitted, uses wildcard 0xffffffff (all / default).
     * Optional code will be sent for modules requiring authorization.
     */
    async armStay(subsystemId, code) {
        const sid = subsystemId ?? SUBSYSTEM_WILDCARD;
        const endpoint = HikAxPro.withJsonFormat(HikAxPro.fillSubsystemEndpoint(ENDPOINTS.Alarm_ArmHome, sid));
        return this.executeArmDisarmOperation(endpoint, code, sid);
    }
    /**
     * Arm subsystem in AWAY mode. If subsystemId omitted, uses wildcard 0xffffffff.
     */
    async armAway(subsystemId, code) {
        const sid = subsystemId ?? SUBSYSTEM_WILDCARD;
        const endpoint = HikAxPro.withJsonFormat(HikAxPro.fillSubsystemEndpoint(ENDPOINTS.Alarm_ArmAway, sid));
        return this.executeArmDisarmOperation(endpoint, code, sid);
    }
    /**
     * Disarm subsystem. If subsystemId omitted, uses wildcard 0xffffffff.
     */
    async disarm(subsystemId, code) {
        const sid = subsystemId ?? SUBSYSTEM_WILDCARD;
        const endpoint = HikAxPro.withJsonFormat(HikAxPro.fillSubsystemEndpoint(ENDPOINTS.Alarm_Disarm, sid));
        return this.executeArmDisarmOperation(endpoint, code, sid);
    }
}
exports.HikAxPro = HikAxPro;

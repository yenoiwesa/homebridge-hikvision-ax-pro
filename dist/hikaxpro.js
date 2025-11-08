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
};
const XML_SCHEMA = 'http://www.hikvision.com/ver20/XMLSchema';
class HikAxPro {
    constructor({ host, username, password, userLevel = 1 }) {
        this.host = host;
        this.username = username;
        this.password = password;
        this.userLevel = userLevel;
        this.cookie = null;
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
        return `<?xml version="1.0" encoding="UTF-8"?>\n<SessionLogin xmlns=\"${XML_SCHEMA}\">\n  <sessionID>${sessionID}</sessionID>\n  <userName>${username}</userName>\n  <password>${encodedPassword}</password>\n  <sessionIDVersion>${sessionIDVersion}</sessionIDVersion>\n</SessionLogin>`;
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
            return true;
        }
        else {
            this.cookie = null;
            throw new Error(`Login failed: ${response.status} ${response.data}`);
        }
    }
    async isArmed() {
        if (!this.cookie)
            throw new Error('Not logged in');
        const url = `http://${this.host}${ENDPOINTS.HostStatus}?format=json`;
        const headers = this.getRequestHeaders();
        try {
            const response = await axios_1.default.get(url, { headers });
            const data = response.data;
            const subsystems = data?.AlarmHostStatus?.SubSysList || [];
            const armedStatuses = subsystems
                .filter((s) => s.SubSys && s.SubSys.enabled)
                .map((s) => ({
                id: s.SubSys.id,
                name: s.SubSys.name,
                arming: s.SubSys.arming,
            }));
            if (armedStatuses.length === 0) {
                throw new Error('No enabled subsystems found');
            }
            return armedStatuses;
        }
        catch (err) {
            if (err.response) {
                console.error('isArmed error:', err.response.status, err.response.data);
                throw new Error(`isArmed request failed: ${err.response.status}`);
            }
            else {
                throw err;
            }
        }
    }
}
exports.HikAxPro = HikAxPro;

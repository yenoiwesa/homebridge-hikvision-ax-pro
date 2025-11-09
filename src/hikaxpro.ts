import axios from 'axios';
import type { AxiosResponse } from 'axios';
import xml2js from 'xml2js';
import crypto from 'crypto';

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
} as const;

const XML_SCHEMA = 'http://www.hikvision.com/ver20/XMLSchema' as const;
const SUBSYSTEM_WILDCARD = '0xffffffff' as const;

export type ArmingState = 'disarm' | 'away' | 'stay' | 'arming' | 'disarming';
export type ZoneStatusType = 'normal' | 'trigger' | 'tamper' | 'fault' | 'bypass';

export interface HikAxProOptions {
  host: string;
  username: string;
  password: string;
  userLevel?: number;
}

export interface SubsystemStatus {
  id: string;
  name: string;
  arming: ArmingState;
}

export interface ZoneStatus {
  id: string;
  name: string;
  status: ZoneStatusType;
}

export interface ArmDisarmResponse {
  statusCode: number;
  statusString: string;
  subStatusCode: string;
  errorCode: number;
  errorMsg: string;
}

interface SessionParams {
  sessionID: string;
  sessionIDVersion: string;
  challenge: string;
  salt: string;
  salt2: string;
  isIrreversible: boolean;
  iterations: number;
}

interface SubSystemResponse {
  SubSysList?: Array<{
    SubSys?: { id: string; name: string; arming: ArmingState; enabled: boolean };
  }>;
}

interface ZoneResponse {
  ZoneList?: Array<{ Zone?: { id: string; name: string; status: ZoneStatusType } }>;
}

export class HikAxPro {
  private readonly host: string;
  private readonly username: string;
  private readonly password: string;
  private readonly userLevel: number;

  // Session cookie for authenticated requests
  private cookie: string | null = null;

  // Internal flag to avoid multiple simultaneous login attempts
  private loginPromise: Promise<void> | null = null;

  constructor({ host, username, password, userLevel = 1 }: HikAxProOptions) {
    this.host = host;
    this.username = username;
    this.password = password;
    this.userLevel = userLevel;
  }

  /** Helper to inject subsystem id into endpoint templates */
  private static fillSubsystemEndpoint(template: string, subsystemId: string | number): string {
    return template.replace('{}', String(subsystemId));
  }

  /** Append format=json preserving existing query parameters */
  private static withJsonFormat(endpoint: string): string {
    return endpoint.includes('?') ? `${endpoint}&format=json` : `${endpoint}?format=json`;
  }

  private getRequestHeaders(contentType: string | null = null): Record<string, string> {
    const headers: Record<string, string> = { 'X-Userlevel': String(this.userLevel) };
    if (this.cookie) headers['Cookie'] = this.cookie;
    if (contentType) headers['Content-Type'] = contentType;
    return headers;
  }

  private sha256(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  private async getSessionParams(): Promise<SessionParams> {
    const url = `http://${this.host}${ENDPOINTS.Session_Capabilities}${encodeURIComponent(this.username)}`;
    const headers = this.getRequestHeaders();
    const response = await axios.get(url, { headers });
    const xml = response.data;
    const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false });
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

  private encodePassword(params: SessionParams): string {
    const { sessionIDVersion, isIrreversible, salt, salt2, challenge, iterations } = params;
    let result: string;
    if (sessionIDVersion === '2' && isIrreversible) {
      result = this.sha256(`${this.username}${salt}${this.password}`);
      result = this.sha256(`${result}${challenge}`);
      for (let i = 2; i < iterations; i++) {
        result = this.sha256(result);
      }
    } else if (isIrreversible) {
      result = this.sha256(`${this.username}${salt}${this.password}`);
      result = this.sha256(`${this.username}${salt2}${result}`);
      result = this.sha256(`${result}${challenge}`);
      for (let i = 2; i < iterations; i++) {
        result = this.sha256(result);
      }
    } else {
      result = `${this.sha256(this.password)}${challenge}`;
      for (let i = 1; i < iterations; i++) {
        result = this.sha256(result);
      }
    }
    return result;
  }

  private buildLoginXML(
    sessionID: string,
    username: string,
    encodedPassword: string,
    sessionIDVersion: string
  ): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<SessionLogin xmlns="${XML_SCHEMA}">
  <sessionID>${sessionID}</sessionID>
  <userName>${username}</userName>
  <password>${encodedPassword}</password>
  <sessionIDVersion>${sessionIDVersion}</sessionIDVersion>
</SessionLogin>`;
  }

  private async login(): Promise<void> {
    const params = await this.getSessionParams();
    const encodedPassword = this.encodePassword(params);
    const xml = this.buildLoginXML(
      params.sessionID,
      this.username,
      encodedPassword,
      params.sessionIDVersion
    );
    const timestamp = Math.floor(Date.now() / 1000);
    const url = `http://${this.host}${ENDPOINTS.Session_Login}?timeStamp=${timestamp}`;
    const headers = this.getRequestHeaders('application/xml');
    const response = await axios.post(url, xml, { headers, validateStatus: () => true });
    if (response.status === 200) {
      let cookie = response.headers['set-cookie']
        ? response.headers['set-cookie'][0].split(';')[0]
        : null;
      if (!cookie && response.data) {
        try {
          const parsed = await xml2js.parseStringPromise(response.data, { explicitArray: false });
          const root = parsed['SessionLogin'] || parsed['xmlns:SessionLogin'];
          const sessionID = root && (root['sessionID'] || root['xmlns:sessionID']);
          if (sessionID) {
            cookie = `WebSession=${sessionID}`;
          }
        } catch {
          // Ignore parse errors
        }
      }
      if (!cookie) throw new Error('No session cookie or sessionID provided');
      this.cookie = cookie;
      return;
    } else {
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
  private async sendRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    endpoint: string,
    data?: unknown,
    extraHeaders: Record<string, string> = {}
  ): Promise<T> {
    // Ensure endpoint formatting
    if (!endpoint.startsWith('/')) throw new Error('Endpoint must start with /');

    // Ensure we have a valid session (single-flight)
    if (!this.cookie) {
      if (!this.loginPromise) {
        this.loginPromise = this.login().finally(() => (this.loginPromise = null));
      }
      await this.loginPromise;
    }

    const attempt = async (): Promise<AxiosResponse<T>> => {
      const url = `http://${this.host}${endpoint}`;
      const headers = { ...this.getRequestHeaders(), ...extraHeaders };
      return axios({ method, url, data, headers, validateStatus: () => true });
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
      throw new Error(`Request failed: ${response.status} ${response.data ?? ''}`);
    }
    return response.data;
  }

  /**
   * Fetch subsystem statuses from the /ISAPI/SecurityCP/status/subSystems endpoint.
   */
  async fetchSubsystemStatuses(): Promise<SubsystemStatus[]> {
    const data = await this.sendRequest<SubSystemResponse>(
      'GET',
      `${ENDPOINTS.SubSystems}?format=json`
    );
    const subsystems = data?.SubSysList || [];
    return subsystems
      .map((s) => s.SubSys)
      .filter((s): s is NonNullable<typeof s> => s !== undefined && s.enabled)
      .map((s) => ({
        id: s.id,
        name: s.name,
        arming: s.arming,
      }));
  }

  /**
   * Fetch zone statuses from the /ISAPI/SecurityCP/status/zones endpoint.
   */
  async fetchZoneStatuses(): Promise<ZoneStatus[]> {
    const data = await this.sendRequest<ZoneResponse>('GET', `${ENDPOINTS.Zones}?format=json`);
    const zones = data?.ZoneList || [];
    return zones
      .map((z) => z.Zone)
      .filter((z): z is NonNullable<typeof z> => z !== undefined)
      .map((z) => ({
        id: z.id,
        name: z.name,
        status: z.status,
      }));
  }

  /**
   * Internal helper to execute arm/disarm operations with consistent logic.
   */
  private async executeArmDisarmOperation(
    endpoint: string,
    code?: string
  ): Promise<ArmDisarmResponse> {
    const body = code ? { Operate: { moduleOperateCode: code } } : undefined;
    return this.sendRequest<ArmDisarmResponse>(
      'PUT',
      endpoint,
      body,
      body ? { 'Content-Type': 'application/json' } : {}
    );
  }

  /**
   * Arm subsystem in STAY/HOME mode. If subsystemId omitted, uses wildcard 0xffffffff (all / default).
   * Optional code will be sent for modules requiring authorization.
   */
  async armStay(subsystemId?: string | number, code?: string): Promise<ArmDisarmResponse> {
    const sid = subsystemId ?? SUBSYSTEM_WILDCARD;
    const endpoint = HikAxPro.withJsonFormat(
      HikAxPro.fillSubsystemEndpoint(ENDPOINTS.Alarm_ArmHome, sid)
    );
    return this.executeArmDisarmOperation(endpoint, code);
  }

  /**
   * Arm subsystem in AWAY mode. If subsystemId omitted, uses wildcard 0xffffffff.
   */
  async armAway(subsystemId?: string | number, code?: string): Promise<ArmDisarmResponse> {
    const sid = subsystemId ?? SUBSYSTEM_WILDCARD;
    const endpoint = HikAxPro.withJsonFormat(
      HikAxPro.fillSubsystemEndpoint(ENDPOINTS.Alarm_ArmAway, sid)
    );
    return this.executeArmDisarmOperation(endpoint, code);
  }

  /**
   * Disarm subsystem. If subsystemId omitted, uses wildcard 0xffffffff.
   */
  async disarm(subsystemId?: string | number, code?: string): Promise<ArmDisarmResponse> {
    const sid = subsystemId ?? SUBSYSTEM_WILDCARD;
    const endpoint = HikAxPro.withJsonFormat(
      HikAxPro.fillSubsystemEndpoint(ENDPOINTS.Alarm_Disarm, sid)
    );
    return this.executeArmDisarmOperation(endpoint, code);
  }
}

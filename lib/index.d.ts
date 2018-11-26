declare namespace Hydra {

  // TODO: make a typed ConfigProps object for config
  export class Config {
    constructor();

    config: ConfigProps;

    getObject(): {};
    init(cfg: {}): Promise<void>;
  }

  export interface ConfigProps {
    a?: number;
  }

  export class Cache<T> {
    constructor();

    data: {[key: string]: T};

    put(key: string, value: T, expiration: number): void;
    get(key: string): T;
  }

  // TODO: make a typed OptionsProps object for options
  export class RedisConnection {
    constructor(redisConfig: {}, defaultRedisDb: number, testMode: boolean);

    getRedis(): any; // TODO: return a Redis constructor
    connect(options: {}): void;
    attempt(action: () => Promise<any>): void;
  }

  export class ServerRequest {
    constructor();

    send(options: {}): Promise<any>;
  }

  export class ServerResponse {
    constructor();

    testMode: boolean;
    corsEnabled: boolean;

    setTestMode(): void;
    enableCORS(state: boolean): void;
    createResponseObject(httpCode: number, resultPayload: {}): {};
    sendResponse(code: number, res: {}, data: {}): any;
    sendOk(res: {}, data: {}): void;
    sendCreated(res: {}, data: {}): void;
    sendMovedPermanently(res: {}, data: {}): void;
    sendInvalidRequest(res: {}, data: {}): void;
    sendInvalidUserCredentials(res: {}, data: {}): void;
    sendPaymentRequired(res: {}, data: {}): void;
    sendForbidden(res: {}, data: {}): void;
    sendNotFound(res: {}, data: {}): void;
    sendInvalidSession(res: {}, data: {}): void;
    sendRequestFailed(res: {}, data: {}): void;
    sendDataConflict(res: {}, data: {}): void;
    sendTooLarge(res: {}, data: {}): void;
    sendTooManyRequests(res: {}, data: {}): void;
    sendServerError(res: {}, data: {}): void;
    sendInternalError(res: {}, data: {}): void;
    sendMethodNotImplemented(res: {}, data: {}): void;
    sendUnavailableError(res: {}, data: {}): void;
  }

  export class UMFMessage {
    constructor();

    message: {};

    getTimeStamp(): string;
    createMessageID(): string;
    createShortMessageID(): string;
    signMessage(algo: string, sharedSecret: string): void;
    toJSON(): {};
    toShort(): {};
    validate(): boolean;
    createMessageInstance(message: {}): void;
    parseRoute(toValue: string): {};
  }
  
  export class Utils {

    static md5Hash(key: string): string;
    static safeJSONStringify(obj: {}): string;
    static safeJSONParse(str: string): {};
    static stringHash(str: string): number;
    static shortID(): string;
    static isUUID4(str: string): void;
    static shuffleArray(a: [any]): void;

  }
}

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

  // TODO: server-request
  // TODO: server-response
  // TODO: umfmessage
  // TODO: utils
}

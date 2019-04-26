import {RedisClient, Callback, ClientOpts} from 'redis';
import * as Route from 'route-parser';

export interface IRedis extends RedisClient {
  closing: boolean;
  quitAsync(): Promise<void>;
};
export interface IRedisOptions extends ClientOpts {};

// import * as IORedis from 'ioredis';
// export interface IRedis extends IORedis.Redis {};
// export type RedisOptions = IORedis.RedisOptions | string;

export type ServiceConfig = {
  environment: string;
  hydra: HydraConfig;
};
export type ServiceDetails = {
  serviceName: string;
  serviceVersion?: string;
  serviceIP?: string;
  serviceDNS?: string;
  servicePort?: any;
  serviceInterface?: string;
  serviceType?: string;
  serviceDescription?: string;
};
export interface HydraConfig extends ServiceDetails {
  plugins?: { [name: string]: Object };
  redis: IRedisOptions;
};

export type ShortFormUMFMessage = {
  mid: string;
  bdy: any;
  to: string;
  frm: string;
  ver: string;
  ts: string;
  aut?: string;
  for?: string;
  fwd?: string;
  hdr?: string;
  pri?: string;
  rmi?: string;
  sig?: string;
  tmo?: string;
  ttl?: string;
  typ?: string;
};
export type LongFormUMFMessage = {
  mid: string;
  body: any;
  to: string;
  from: string;
  version: string;
  timestamp: string;
  authorization?: string;
  for?: string;
  forward?: string;
  headers?: string;
  priority?: string;
  rmid?: string;
  signature?: string;
  timeout?: string;
  ttl?: string;
  type?: string;
};
export type UMF = LongFormUMFMessage & ShortFormUMFMessage;

export interface IHydra {
  instanceID: string;
  mcMessageChannelClient: IRedis;
  mcDirectMessageChannelClient: IRedis;
  messageChannelPool: Object;
  config: HydraConfig;
  serviceName: string;
  serviceDescription: string;
  serviceVersion: string;
  isService: boolean;
  redisdb: IRedis;
  _updatePresence: Function;
  _updateHealthCheck: Function;
  registeredRoutes: Route[];
  registeredPlugins: Array<HydraPlugin<IHydra>>;
  presenceTimerInterval: NodeJS.Timeout;
  healthTimerInterval: NodeJS.Timeout;
  initialized: boolean;
  hostName: string;
  internalCache: ICache;
  ready: Function;
  testMode: boolean;
  keyExpirationTTL: number;
  logExpirationTTL: number;
  redisPreKey: string;
  mcMessageKey: string;
  use(...plugins: HydraPlugin<IHydra>[]): Promise<void>;
  init(config: ServiceConfig | string, testMode: boolean): Promise<void>;
  shutdown(): Promise<void>;
  registerService(): Promise<ServiceDetails>;
  getServiceName(): string;
  getServices(): Promise<Array<Object>>;
  getServiceNodes(): Promise<Array<Object>>;
  findService(name: string): Promise<Object>;
  getServicePresence(name: string): Promise<Object>;
  getInstanceID(): string;
  getInstanceVersion(): string;
  getHealth(): Object;
  sendToHealthLog(type: string, message: string, suppressEmit?: boolean): void;
  getServiceHealthLog(name: string): Promise<Array<Object>>;
  getServiceHealthAll(): Promise<Array<Object>>;
  makeAPIRequest(message: UMF, sendOpts?: SendOptions): Promise<Object>;
  sendMessage(message: UMF): Promise<void>;
  sendReplyMessage(originalMessage: UMF, messageResponse: UMF): Promise<void>;
  sendBroadcastMessage(message: UMF): Promise<void>;
  registerRoutes(routes: Array<Object>): Promise<void>;
  getAllServiceRoutes(): Promise<Array<Object>>;
  matchRoute(routePath: string): boolean;
  queueMessage(message: UMF): Promise<void>;
  getQueuedMessage(serviceName: string): Promise<void>;
  markQueueMessage(
    message: UMF,
    completed: boolean,
    reason?: string
  ): Promise<void>;
  getConfig(label: string): Promise<ServiceConfig>;
  putConfig(label: string, config: ServiceConfig): Promise<void>;
  listConfig(serviceName: string): Promise<void>;
  hasServicePresence(name: string): Promise<boolean>;
  getClonedRedisClient(options?: object, callback?: Callback<RedisClient>): RedisClient;
  getUMFMessageHelper(): Object;
  getServerRequestHelper(): Object;
  getServerResponseHelper(): Object;
  getUtilsHelper(): Object;
  getConfigHelper(): Object;
};
export interface HydraPlugin<T extends IHydra> {
  setHydra(hydra: T): void;
};
export interface ICache {
  put(key: string, value: any, expiration: number): void;
  get(key: string): any;
};
export type ParsedRoute = {
  instance: string;
  apiRoute: string;
  httpMethod: string;
};
export type SendOptions = {
  host: string;
  port: string;
  path: string;
  method: string;
  timeout?: string;
  body?: string;
  headers?: {[header: string]: string};
};
export type ServicePresence = {
  serviceName: string;
  serviceDescription: string;
  version: string;
  instanceID: string;
  updatedOn: string;
  processID: string;
  ip: string;
  port: string;
  hostName: string;
  elapsed?: number;
};

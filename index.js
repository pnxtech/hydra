'use strict';

const debug = require('debug')('hydra');

const Promise = require('bluebird');
Promise.series = (iterable, action) => {
  return Promise.mapSeries(
    iterable.map(action),
    (value, index, _length) => value || iterable[index].name || null
  );
};

const EventEmitter = require('events');
const util = require('util');
const uuid = require('uuid');
const Route = require('route-parser');
const os = require('os');
const Utils = require('./lib/utils');
const UMFMessage = require('./lib/umfmessage');
const RedisConnection = require('./lib/redis-connection');
const ServerResponse = require('./lib/server-response');
let serverResponse = new ServerResponse();
const ServerRequest = require('./lib/server-request');
let serverRequest = new ServerRequest();
const Cache = require('./lib/cache');

let HYDRA_REDIS_DB = 0;
const redisPreKey = 'hydra:service';
const mcMessageKey = 'hydra:service:mc';
const MAX_ENTRIES_IN_HEALTH_LOG = 64;
const ONE_SECOND = 1000; // milliseconds
const ONE_WEEK_IN_SECONDS = 604800;
const PRESENCE_UPDATE_INTERVAL = ONE_SECOND;
const HEALTH_UPDATE_INTERVAL = ONE_SECOND * 5;
const KEY_EXPIRATION_TTL = 3; // three seconds
const KEYS_PER_SCAN = '100';
const UMF_INVALID_MESSAGE = 'UMF message requires "to", "from" and "body" fields';
const INSTANCE_ID_NOT_SET = 'not set';
/**
 * @name Hydra
 * @summary Base class for Hydra.
 * @fires Hydra#log
 * @fires Hydra#message
 */
class Hydra extends EventEmitter {
  /**
  * @name constructor
  * @return {undefined}
  */
  constructor() {
    super();

    this.instanceID = INSTANCE_ID_NOT_SET;
    this.mcMessageChannelClient;
    this.mcDirectMessageChannelClient;
    this.messageChannelPool = {};
    this.config = null;
    this.serviceName = '';
    this.serviceDescription = '';
    this.serviceVersion = '';
    this.isService = false;
    this.redisdb = null;
    this._updatePresence = this._updatePresence.bind(this);
    this._updateHealthCheck = this._updateHealthCheck.bind(this);
    this.registeredRoutes = [];
    this.registeredPlugins = [];
    this.presenceTimerInteval = null;
    this.healthTimerInterval = null;
    this.initialized = false;
    this.hostName = os.hostname();
    this.internalCache = new Cache();
    this.ready = () => Promise.reject(new Error('You must call hydra.init() before invoking hydra.ready()'));
  }

  /**
   * @name use
   * @summary Adds plugins to Hydra
   * @param {...object} plugins - plugins to register
   * @return {object} - Promise which will resolve when all plugins are registered
   */
  use(...plugins) {
    return Promise.series(plugins, (plugin) => this._registerPlugin(plugin));
  }

  /**
   * @name _registerPlugin
   * @summary Registers a plugin with Hydra
   * @param {object} plugin - HydraPlugin to use
   * @return {object} Promise or value
   */
  _registerPlugin(plugin) {
    this.registeredPlugins.push(plugin);
    return plugin.setHydra(this);
  }

  /**
   * @name init
   * @summary Register plugins then continue initialization
   * @param {mixed} config - a string with a path to a configuration file or an
   *                         object containing hydra specific keys/values
   * @param {boolean} testMode - whether hydra is being started in unit test mode
   * @return {object} promise - resolves with this._init or rejects with an appropriate
   *                  error if something went wrong
   */
  init(config, testMode) {
    // Reject() if we've already been called successfully
    if (INSTANCE_ID_NOT_SET !== this.instanceID) {
      return Promise.reject(new Error('Hydra.init() already invoked'));
    }

    this.testMode = testMode;

    if (typeof config === 'string') {
      const configHelper = require('./lib/config');
      return configHelper.init(config)
        .then(() => {
          return this.init(configHelper.getObject(), testMode);
        });
    }

    const initPromise = new Promise((resolve, reject) => {
      let loader = (newConfig) => {
        return Promise.series(this.registeredPlugins, (plugin) => plugin.setConfig(newConfig.hydra))
          .then((..._results) => {
            return this._init(newConfig.hydra);
          })
          .then(() => {
            resolve(newConfig);
            return 0;
          })
          .catch((err) => {
            this._logMessage('error', err.toString());
            reject(err);
          });
      };

      if (!config || !config.hydra) {
        config = Object.assign({
          'hydra': {
            'serviceIP': '',
            'servicePort': 0,
            'serviceType': '',
            'serviceDescription': '',
            'redis': {
              'url': 'redis://127.0.0.1:6379/15'
            }
          }
        });
      }

      if (!config.hydra.redis) {
        config.hydra = Object.assign(config.hydra, {
          'redis': {
            'url': 'redis://127.0.0.1:6379/15'
          }
        });
      }

      if (process.env.HYDRA_REDIS_URL) {
        Object.assign(config.hydra, {
          redis: {
            url: process.env.HYDRA_REDIS_URL
          }
        });
      }

      let partialConfig = true;
      if (process.env.HYDRA_SERVICE) {
        let hydraService = process.env.HYDRA_SERVICE.trim();
        if (hydraService[0] === '{') {
          let newHydraBranch = Utils.safeJSONParse(hydraService);
          Object.assign(config.hydra, newHydraBranch);
          partialConfig = false;
        }

        if (hydraService.includes('|')) {
          hydraService = hydraService.replace(/(\r\n|\r|\n)/g, '');
          let newHydraBranch = {};
          let key = '';
          let val = '';
          let segs = hydraService.split('|');
          segs.forEach((segment) => {
            segment = segment.trim();
            [key, val] = segment.split('=');
            newHydraBranch[key] = val;
          });
          Object.assign(config.hydra, newHydraBranch);
          partialConfig = false;
        }
      }

      if (!config.hydra.serviceName || (!config.hydra.servicePort && !config.hydra.servicePort === 0)) {
        reject(new Error('Config missing serviceName or servicePort'));
        return;
      }
      if (config.hydra.serviceName.includes(':')) {
        reject(new Error('serviceName can not have a colon character in its name'));
        return;
      }
      if (config.hydra.serviceName.includes(' ')) {
        reject(new Error('serviceName can not have a space character in its name'));
        return;
      }

      if (partialConfig && process.env.HYDRA_REDIS_URL) {
        this._connectToRedis({redis: {url: process.env.HYDRA_REDIS_URL}})
          .then(() => {
            if (!this.redisdb) {
              reject(new Error('No Redis connection'));
              return;
            }
            this.redisdb.select(HYDRA_REDIS_DB, (err, _result) => {
              if (!err) {
                this._getConfig(process.env.HYDRA_SERVICE)
                  .then((storedConfig) => {
                    this.redisdb.quit();
                    if (!storedConfig) {
                      reject(new Error('Invalid service stored config'));
                    } else {
                      return loader(storedConfig);
                    }
                  })
                  .catch((err) => reject(err));
              } else {
                reject(new Error('Invalid service stored config'));
              }
            });
          });
      } else {
        return loader(config);
      }
    });
    this.ready = () => initPromise;
    return initPromise;
  }

  /**
   * @name _init
   * @summary Initialize Hydra with config object.
   * @param {object} config - configuration object containing hydra specific keys/values
   * @return {object} promise - resolving if init success or rejecting otherwise
   */
  _init(config) {
    return new Promise((resolve, reject) => {
      let ready = () => {
        Promise.series(this.registeredPlugins, (plugin) => plugin.onServiceReady()).then((..._results) => {
          resolve();
        }).catch((err) => {
          this._logMessage('error', err.toString());
          reject(err);
        });
      };
      this.config = config;
      this._connectToRedis(this.config).then(() => {
        if (!this.redisdb) {
          reject(new Error('No Redis connection'));
          return;
        }

        let p = this._parseServicePortConfig(this.config.servicePort);
        p.then((port) => {
          this.config.servicePort = port;
          this.serviceName = config.serviceName;
          if (this.serviceName && this.serviceName.length > 0) {
            this.serviceName = this.serviceName.toLowerCase();
          }
          this.serviceDescription = this.config.serviceDescription || 'not specified';
          this.config.serviceVersion = this.serviceVersion = this.config.serviceVersion || this._getParentPackageJSONVersion();

          /**
          * Determine network DNS/IP for this service.
          * - First check whether serviceDNS is defined. If so, this is expected to be a DNS entry.
          * - Else check whether serviceIP exists and is not empty ('') and is not an segemented IP
          *   such as 192.168.100.106 If so, then use DNS lookup to determine an actual dotted IP address.
          * - Else check whether serviceIP exists and *IS* set to '' - that means the service author is
          *   asking Hydra to determine the machine's IP address.
          * - And final else - the serviceIP is expected to be populated with an actual dotted IP address
          *   or serviceDNS contains a valid DNS entry.
          */
          if (this.config.serviceDNS && this.config.serviceDNS !== '') {
            this.config.serviceIP = this.config.serviceDNS;
            this._updateInstanceData();
            ready();
          } else {
            const net = require('net');
            if (this.config.serviceIP && this.config.serviceIP !== '' && net.isIP(this.config.serviceIP) === 0) {
              const dns = require('dns');
              dns.lookup(this.config.serviceIP, (err, result) => {
                this.config.serviceIP = result;
                this._updateInstanceData();
                ready();
              });
            } else if (!this.config.serviceIP || this.config.serviceIP === '') {
              // handle IP selection
              const os = require('os');
              let interfaces = os.networkInterfaces();
              if (this.config.serviceInterface && this.config.serviceInterface !== '') {
                let segments = this.config.serviceInterface.split('/');
                if (segments && segments.length === 2) {
                  let interfaceName = segments[0];
                  let interfaceMask = segments[1];
                  Object.keys(interfaces).
                    forEach((itf) => {
                      interfaces[itf].forEach((interfaceRecord)=>{
                        if (itf === interfaceName && interfaceRecord.netmask === interfaceMask && interfaceRecord.family === 'IPv4') {
                          this.config.serviceIP = interfaceRecord.address;
                        }
                      });
                    });
                } else {
                  throw new Error('config serviceInterface is not a valid format');
                }
              } else {
                // not using serviceInterface - just select first eth0 entry.
                let firstSelected = false;
                Object.keys(interfaces).
                  forEach((itf) => {
                    interfaces[itf].forEach((interfaceRecord)=>{
                      if (!firstSelected && interfaceRecord.family === 'IPv4' && interfaceRecord.address !== '127.0.0.1') {
                        this.config.serviceIP = interfaceRecord.address;
                        firstSelected = true;
                      }
                    });
                  });
              }
              this._updateInstanceData();
              ready();
            } else {
              this._updateInstanceData();
              ready();
            }
          }
          return 0;
        }).catch((err) => reject(err));
        return p;
      }).catch((err) => reject(err));
    });
  }

  /**
   * @name _updateInstanceData
   * @summary Update instance id and direct message key
   * @return {undefined}
   */
  _updateInstanceData() {
    this.instanceID = this._serverInstanceID();
    this.initialized = true;
  }

  /**
   * @name _shutdown
   * @summary Shutdown hydra safely.
   * @return {undefined}
   */
  _shutdown() {
    return new Promise((resolve) => {
      clearInterval(this.presenceTimerInteval);
      clearInterval(this.healthTimerInterval);

      const promises = [];
      if (!this.testMode) {
        this._logMessage('error', 'Service is shutting down.');
        this.redisdb.batch()
          .expire(`${redisPreKey}:${this.serviceName}:${this.instanceID}:health`, KEY_EXPIRATION_TTL)
          .expire(`${redisPreKey}:${this.serviceName}:${this.instanceID}:health:log`, ONE_WEEK_IN_SECONDS)
          .exec();

        if (this.mcMessageChannelClient) {
          promises.push(this.mcMessageChannelClient.quitAsync());
        }
        if (this.mcDirectMessageChannelClient) {
          promises.push(this.mcDirectMessageChannelClient.quitAsync());
        }
      }
      Object.keys(this.messageChannelPool).forEach((keyname) => {
        promises.push(this.messageChannelPool[keyname].quitAsync());
      });
      if (this.redisdb) {
        this.redisdb.del(`${redisPreKey}:${this.serviceName}:${this.instanceID}:presence`, () => {
          this.redisdb.quit();
          Promise.all(promises).then(resolve);
        });
        this.redisdb.quit();
        Promise.all(promises).then(resolve);
      } else {
        Promise.all(promises).then(resolve);
      }
      this.initialized = false;
      this.instanceID = INSTANCE_ID_NOT_SET;
    });
  }

  /**
   * @name _connectToRedis
   * @summary Configure access to Redis and monitor emitted events.
   * @private
   * @param {object} config - Redis client configuration
   * @return {object} promise - resolves or reject
   */
  _connectToRedis(config) {
    let retryStrategy = config.redis.retry_strategy;
    delete config.redis.retry_strategy;
    let redisConnection = new RedisConnection(config.redis, 0, this.testMode);
    HYDRA_REDIS_DB = redisConnection.redisConfig.db;
    return redisConnection.connect(retryStrategy)
      .then((client) => {
        this.redisdb = client;
        client
          .on('reconnecting', () => {
            this._logMessage('error', 'Reconnecting to Redis server...');
          })
          .on('warning', (warning) => {
            this._logMessage('error', `Redis warning: ${warning}`);
          })
          .on('end', () => {
            this._logMessage('error', 'Established Redis server connection has closed');
          })
          .on('error', (err) => {
            this._logMessage('error', `Redis error: ${err}`);
          });
        return client;
      });
  }

  /**
   * @name _getKeys
   * @summary Retrieves a list of Redis keys based on pattern.
   * @param {string} pattern - pattern to filter with
   * @return {object} promise - promise resolving to array of keys or or empty array
   */
  _getKeys(pattern) {
    return new Promise((resolve, _reject) => {
      if (this.testMode) {
        this.redisdb.keys(pattern, (err, result) => {
          if (err) {
            resolve([]);
          } else {
            resolve(result);
          }
        });
      } else {
        let doScan = (cursor, pattern, retSet) => {
          this.redisdb.scan(cursor, 'MATCH', pattern, 'COUNT', KEYS_PER_SCAN, (err, result) => {
            if (!err) {
              cursor = result[0];
              let keys = result[1];
              keys.forEach((key, _i) => {
                retSet.add(key);
              });
              if (cursor === '0') {
                resolve(Array.from(retSet));
              } else {
                doScan(cursor, pattern, retSet);
              }
            } else {
              resolve([]);
            }
          });
        };
        let results = new Set();
        doScan('0', pattern, results);
      }
    });
  }

  /**
   * @name _getServiceName
   * @summary Retrieves the service name of the current instance.
   * @private
   * @throws Throws an error if this machine isn't an instance.
   * @return {string} serviceName - returns the service name.
   */
  _getServiceName() {
    if (!this.initialized) {
      let msg = 'init() not called, Hydra requires a configuration object.';
      this._logMessage('error', msg);
      throw new Error(msg);
    }
    return this.serviceName;
  }

  /**
   * @name _serverInstanceID
   * @summary Returns the server instance ID.
   * @private
   * @return {string} instance id
   */
  _serverInstanceID() {
    return uuid.
      v4().
      replace(RegExp('-', 'g'), '');
  }

  /**
   * @name _registerService
   * @summary Registers this machine as a Hydra instance.
   * @description This is an optional call as this module might just be used to monitor and query instances.
   * @private
   * @return {object} promise - resolving if registration success or rejecting otherwise
   */
  _registerService() {
    return new Promise((resolve, reject) => {
      if (!this.initialized) {
        let msg = 'init() not called, Hydra requires a configuration object.';
        this._logMessage('error', msg);
        reject(new Error(msg));
        return;
      }

      if (!this.redisdb) {
        let msg = 'No Redis connection';
        this._logMessage('error', msg);
        reject(new Error(msg));
        return;
      }
      this.isService = true;
      let serviceName = this.serviceName;

      let serviceEntry = Utils.safeJSONStringify({
        serviceName,
        type: this.config.serviceType,
        registeredOn: this._getTimeStamp()
      });
      this.redisdb.set(`${redisPreKey}:${serviceName}:service`, serviceEntry, (err, _result) => {
        if (err) {
          let msg = 'Unable to set :service key in Redis db.';
          this._logMessage('error', msg);
          reject(new Error(msg));
        } else {
          let testRedis;
          if (this.testMode) {
            let redisConnection;
            redisConnection = new RedisConnection(this.config.redis, 0, this.testMode);
            testRedis = redisConnection.getRedis();
          }
          // Setup service message courier channels
          this.mcMessageChannelClient = this.testMode ? testRedis.createClient() : this.redisdb.duplicate();
          this.mcMessageChannelClient.subscribe(`${mcMessageKey}:${serviceName}`);
          this.mcMessageChannelClient.on('message', (channel, message) => {
            let msg = Utils.safeJSONParse(message);
            if (msg) {
              let umfMsg = UMFMessage.createMessage(msg);
              this.emit('message', umfMsg.toShort());
            }
          });

          this.mcDirectMessageChannelClient = this.testMode ? testRedis.createClient() : this.redisdb.duplicate();
          this.mcDirectMessageChannelClient.subscribe(`${mcMessageKey}:${serviceName}:${this.instanceID}`);
          this.mcDirectMessageChannelClient.on('message', (channel, message) => {
            let msg = Utils.safeJSONParse(message);
            if (msg) {
              let umfMsg = UMFMessage.createMessage(msg);
              this.emit('message', umfMsg.toShort());
            }
          });

          // Schedule periodic updates
          this.presenceTimerInteval = setInterval(this._updatePresence, PRESENCE_UPDATE_INTERVAL);
          this.healthTimerInterval = setInterval(this._updateHealthCheck, HEALTH_UPDATE_INTERVAL);

          // Update presence immediately without waiting for next update interval.
          this._updatePresence();

          resolve({
            serviceName: this.serviceName,
            serviceIP: this.config.serviceIP,
            servicePort: this.config.servicePort
          });
        }
      });
    });
  }

  /**
   * @name _registerRoutes
   * @summary Register routes
   * @description Routes must be formatted as UMF To routes. https://github.com/cjus/umf#%20To%20field%20(routing)
   * @private
   * @param {array} routes - array of routes
   * @return {object} Promise - resolving or rejecting
   */
  _registerRoutes(routes) {
    return new Promise((resolve, reject) => {
      if (!this.redisdb) {
        reject(new Error('No Redis connection'));
        return;
      }
      this._flushRoutes().then(() => {
        let routesKey = `${redisPreKey}:${this.serviceName}:service:routes`;
        let trans = this.redisdb.multi();
        [
          `[get]/${this.serviceName}`,
          `[get]/${this.serviceName}/`,
          `[get]/${this.serviceName}/:rest`
        ].forEach((pattern) => {
          routes.push(pattern);
        });
        routes.forEach((route) => {
          trans.sadd(routesKey, route);
        });
        trans.exec((err, _result) => {
          if (err) {
            reject(err);
          } else {
            return this._getRoutes()
              .then((routeList) => {
                if (routeList.length) {
                  this.registeredRoutes = [];
                  routeList.forEach((route) => {
                    this.registeredRoutes.push(new Route(route));
                  });
                  if (this.serviceName !== 'hydra-router') {
                    // let routers know that a new service route was registered
                    resolve();
                    return this._sendBroadcastMessage(UMFMessage.createMessage({
                      to: 'hydra-router:/refresh',
                      from: `${this.serviceName}:/`,
                      body: {
                        action: 'refresh',
                        serviceName: this.serviceName
                      }
                    }));
                  } else {
                    resolve();
                  }
                } else {
                  resolve();
                }
              })
              .catch(reject);
          }
        });
      }).catch(reject);
    });
  }

  /**
   * @name _getRoutes
   * @summary Retrieves a array list of routes
   * @param {string} serviceName - name of service to retrieve list of routes.
   *                 If param is undefined, then the current serviceName is used.
   * @return {object} Promise - resolving to array of routes or rejection
   */
  _getRoutes(serviceName) {
    if (serviceName === undefined) {
      serviceName = this.serviceName;
    }
    return new Promise((resolve, reject) => {
      let routesKey = `${redisPreKey}:${serviceName}:service:routes`;
      this.redisdb.smembers(routesKey, (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
    });
  }

  /**
   * @name _getAllServiceRoutes
   * @summary Retrieve all service routes.
   * @return {object} Promise - resolving to an object with keys and arrays of routes
   */
  _getAllServiceRoutes() {
    return new Promise((resolve, reject) => {
      if (!this.redisdb) {
        let msg = 'No Redis connection';
        this._logMessage('error', msg);
        reject(new Error(msg));
        return;
      }
      let promises = [];
      let serviceNames = [];
      this._getKeys('*:routes')
        .then((serviceRoutes) => {
          serviceRoutes.forEach((service) => {
            let segments = service.split(':');
            let serviceName = segments[2];
            serviceNames.push(serviceName);
            promises.push(this._getRoutes(serviceName));
          });
          return Promise.all(promises);
        })
        .then((routes) => {
          let resObj = {};
          let idx = 0;
          routes.forEach((routesList) => {
            resObj[serviceNames[idx]] = routesList;
            idx += 1;
          });
          resolve(resObj);
        })
        .catch((err) => {
          reject(err);
        });
    });
  }

  /**
   * @name _matchRoute
   * @summary Matches a route path to a list of registered routes
   * @private
   * @param {string} routePath - a URL path to match
   * @return {boolean} match - true if match, false if not
   */
  _matchRoute(routePath) {
    let ret = false;
    for (let route of this.registeredRoutes) {
      if (route.match(routePath)) {
        ret = true;
        break;
      }
    }
    return ret;
  }

  /**
   * @name _flushRoutes
   * @summary Delete's the services routes.
   * @return {object} Promise - resolving or rejection
   */
  _flushRoutes() {
    return new Promise((resolve, reject) => {
      let routesKey = `${redisPreKey}:${this.serviceName}:service:routes`;
      this.redisdb.del(routesKey, (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
    });
  }

  /**
   * @name _updatePresence
   * @summary Update service presence.
   * @private
   * @return {undefined}
   */
  _updatePresence() {
    let entry = Utils.safeJSONStringify({
      serviceName: this.serviceName,
      serviceDescription: this.serviceDescription,
      version: this.serviceVersion,
      instanceID: this.instanceID,
      updatedOn: this._getTimeStamp(),
      processID: process.pid,
      ip: this.config.serviceIP,
      port: this.config.servicePort,
      hostName: this.hostName
    });
    if (entry && !this.redisdb.closing) {
      let cmd = (this.testMode) ? 'multi' : 'batch';
      this.redisdb[cmd]()
        .setex(`${redisPreKey}:${this.serviceName}:${this.instanceID}:presence`, KEY_EXPIRATION_TTL, this.instanceID)
        .hset(`${redisPreKey}:nodes`, this.instanceID, entry)
        .exec();
    }
  }

  /**
   * @name _updateHealthCheck
   * @summary Update service heath.
   * @private
   * @return {undefined}
   */
  _updateHealthCheck() {
    let entry = Object.assign({
      updatedOn: this._getTimeStamp()
    }, this._getHealth());
    let cmd = (this.testMode) ? 'multi' : 'batch';
    this.redisdb[cmd]()
      .setex(`${redisPreKey}:${this.serviceName}:${this.instanceID}:health`, KEY_EXPIRATION_TTL, Utils.safeJSONStringify(entry))
      .expire(`${redisPreKey}:${this.serviceName}:${this.instanceID}:health:log`, ONE_WEEK_IN_SECONDS)
      .exec();
  }

  /**
   * @name _getHealth
   * @summary Retrieve server health info.
   * @private
   * @return {object} obj - object containing server info
   */
  _getHealth() {
    let lines = [];
    let keyval = [];
    let map = {};
    let memory = util.inspect(process.memoryUsage());

    memory = memory.replace(/[\ \{\}.|\n]/g, '');
    lines = memory.split(',');
    lines.forEach((line) => {
      keyval = line.split(':');
      map[keyval[0]] = Number(keyval[1]);
    });

    let uptimeInSeconds = process.uptime();
    return {
      serviceName: this.serviceName,
      instanceID: this.instanceID,
      hostName: this.hostName,
      sampledOn: this._getTimeStamp(),
      processID: process.pid,
      architecture: process.arch,
      platform: process.platform,
      nodeVersion: process.version,
      memory: map,
      uptimeSeconds: uptimeInSeconds
    };
  }

  /**
   * @name _logMessage
   * @summary Log a message to the service's health log queue.
   * @private
   * @throws Throws an error if this machine isn't an instance.
   * @event Hydra#log
   * @param {string} type - type of message ('error', 'info', 'debug' or user defined)
   * @param {string} message - message to log
   * @param {boolean} suppressEmit - false by default. If true then suppress log emit
   * @return {undefined}
   */
  _logMessage(type, message, suppressEmit) {
    let errMessage = {
      ts: this._getTimeStamp(),
      serviceName: this.serviceName || 'not a service',
      type,
      processID: process.pid,
      msg: message
    };

    let entry = Utils.safeJSONStringify(errMessage);
    debug(entry);

    if (!suppressEmit) {
      this.emit('log', errMessage);
    }

    if (entry) {
      // If issue is with Redis we can't use Redis to log this error.
      // however the above call to the application logger would be one way of detecting the issue.
      if (this.isService) {
        if (entry.toLowerCase().indexOf('redis') === -1) {
          if (!this.redisdb.closing) {
            let key = `${redisPreKey}:${this.serviceName}:${this.instanceID}:health:log`;
            this.redisdb.multi()
              .select(HYDRA_REDIS_DB)
              .lpush(key, entry)
              .ltrim(key, 0, MAX_ENTRIES_IN_HEALTH_LOG - 1)
              .exec();
          }
        }
      }
    } else {
      console.log('Unable to log this message', type, message);
    }
  }

  /**
   * @name _getServices
   * @summary Retrieve a list of available services.
   * @private
   * @return {promise} promise - returns a promise
   */
  _getServices() {
    return new Promise((resolve, reject) => {
      if (!this.redisdb) {
        reject(new Error('No Redis connection'));
        return;
      }
      this._getKeys('*:service')
        .then((services) => {
          let trans = this.redisdb.multi();
          services.forEach((service) => {
            trans.get(service);
          });
          trans.exec((err, result) => {
            if (err) {
              reject(err);
            } else {
              let serviceList = result.map((service) => {
                return Utils.safeJSONParse(service);
              });
              resolve(serviceList);
            }
          });
        });
    });
  }

  /**
   * @name _getServiceNodes
   * @summary Retrieve a list of services even if inactive.
   * @private
   * @return {promise} promise - returns a promise
   */
  _getServiceNodes() {
    return new Promise((resolve, reject) => {
      if (!this.redisdb) {
        reject(new Error('No Redis connection'));
        return;
      }
      let now = (new Date()).getTime();
      this.redisdb.hgetall(`${redisPreKey}:nodes`, (err, data) => {
        if (err) {
          reject(err);
        } else {
          let nodes = [];
          if (data) {
            Object.keys(data).forEach((entry) => {
              let item = Utils.safeJSONParse(data[entry]);
              item.elapsed = parseInt((now - (new Date(item.updatedOn)).getTime()) / ONE_SECOND);
              nodes.push(item);
            });
          }
          resolve(nodes);
        }
      });
    });
  }

  /**
   * @name _findService
   * @summary Find a service.
   * @private
   * @param {string} name - service name - note service name is case insensitive
   * @return {promise} promise - which resolves with service
   */
  _findService(name) {
    return new Promise((resolve, reject) => {
      if (!this.redisdb) {
        reject(new Error('No Redis connection'));
        return;
      }
      this.redisdb.get(`${redisPreKey}:${name}:service`, (err, result) => {
        if (err) {
          reject(err);
        } else {
          if (!result) {
            reject(new Error(`Can't find ${name} service`));
          } else {
            let js = Utils.safeJSONParse(result);
            resolve(js);
          }
        }
      });
    });
  }

  /**
   * @name _checkServicePresence
   * @summary Retrieves all the "present" service instances information.
   * @description Differs from getServicePresence (which calls this one)
   *              in that this performs only bare minimum fatal error checking that
   *              would throw a reject().  This is useful when it's expected to perhaps
   *              have some dead serivces, etc. as used in getServiceHealthAll()
   *              for example.
   * @param {string} [name=our service name] - service name - note service name is case insensitive
   * @return {promise} promise - which resolves with a randomized service presence array or else
   *              a reject() if a "fatal" error occured (Redis error for example)
   */
  _checkServicePresence(name) {
    name = name || this._getServiceName();
    return new Promise((resolve, reject) => {
      let cacheKey = `checkServicePresence:${name}`;
      let cachedValue = this.internalCache.get(cacheKey);
      if (cachedValue) {
        // Re-randomized the array each call to make sure we return a good
        // random set each time we access the cache... no need to store
        // the new random array again since it will just be randomzied again next call
        Utils.shuffleArray(cachedValue);
        resolve(cachedValue);
        return;
      }
      this._getKeys(`*:${name}:*:presence`)
        .then((instances) => {
          if (instances.length === 0) {
            resolve([]);
            return;
          }
          let trans = this.redisdb.multi();
          instances.forEach((instance) => {
            let instanceId = instance.split(':')[3];
            trans.hget(`${redisPreKey}:nodes`, instanceId);
          });
          trans.exec((err, result) => {
            if (err) {
              reject(err);
            } else {
              let instanceList = [];
              result.forEach((instance) => {
                if (instance) {
                  let instanceObj = Utils.safeJSONParse(instance);
                  if (instanceObj) {
                    instanceObj.updatedOnTS = (new Date(instanceObj.updatedOn).getTime());
                  }
                  instanceList.push(instanceObj);
                }
              });
              if (instanceList.length) {
                Utils.shuffleArray(instanceList);
                this.internalCache.put(cacheKey, instanceList, KEY_EXPIRATION_TTL);
              }
              resolve(instanceList);
            }
          });
        });
    });
  }

  /**
   * @name getServicePresence
   * @summary Retrieve a service / instance's presence info.
   * @private
   * @param {string} name - service name - note service name is case insensitive
   * @return {promise} promise - which resolves with service presence
   */
  _getServicePresence(name) {
    if (name === undefined) {
      name = this._getServiceName();
    }
    return new Promise((resolve, reject) => {
      return this._checkServicePresence(name)
        .then((result) => {
          if (result === null) {
            let msg = `Service instance for ${name} is unavailable`;
            this._logMessage('error', msg);
            reject(new Error(msg));
          } else {
            resolve(result);
          }
        })
        .catch((err) => {
          reject(err);
        });
    });
  }

  /**
   * @name _getServiceHealth
   * @summary Retrieve the health status of an instance service.
   * @private
   * @param {string} name - name of instance service.
   * @description If not specified then the current instance is assumed. - note service name is case insensitive.
   * @return {promise} promise - a promise resolving to the instance's health info
   */
  _getServiceHealth(name) {
    if (name === undefined && !this.isService) {
      let err = new Error('getServiceHealth() failed. Cant get health log since this machine isn\'t a instance.');
      throw err;
    }
    if (name === undefined) {
      name = this._getServiceName();
    }
    return new Promise((resolve, reject) => {
      let cacheKey = `getServiceHealth:${name}`;
      let cachedValue = this.internalCache.get(cacheKey);
      if (cachedValue) {
        resolve(cachedValue);
        return;
      }
      this._getKeys(`*:${name}:*:health`)
        .then((instances) => {
          if (instances.length === 0) {
            resolve([]);
            return;
          }
          let trans = this.redisdb.multi();
          instances.forEach((instance) => {
            trans.get(instance);
          });
          trans.exec((err, result) => {
            if (err) {
              reject(err);
            } else {
              let instanceList = result.map((instance) => {
                return Utils.safeJSONParse(instance);
              });
              this.internalCache.put(cacheKey, instanceList, KEY_EXPIRATION_TTL);
              resolve(instanceList);
            }
          });
        });
    });
  }

  /**
   * @name _getInstanceID
   * @summary Return the instance id for this process
   * @return {number} id - instanceID
   */
  _getInstanceID() {
    return this.instanceID;
  }

  /**
   * @name _getInstanceVersion
   * @summary Return the version of this instance
   * @return {number} version - instance version
   */
  _getInstanceVersion() {
    return this.serviceVersion;
  }

  /**
   * @name _getServiceHealthLog
   * @summary Get this service's health log.
   * @private
   * @throws Throws an error if this machine isn't a instance
   * @param {string} name - name of instance service. If not specified then the current instance is assumed.
   * @return {promise} promise - resolves to log entries
   */
  _getServiceHealthLog(name) {
    if (name === undefined && !this.isService) {
      let err = new Error('getServiceHealthLog() failed. Can\'t get health log since this machine isn\'t an instance.');
      throw err;
    }
    if (name === undefined) {
      name = this._getServiceName();
    }
    return new Promise((resolve, reject) => {
      this._getKeys(`*:${name}:*:health:log`)
        .then((instances) => {
          if (instances.length === 0) {
            resolve([]);
            return;
          }
          let trans = this.redisdb.multi();
          instances.forEach((instance) => {
            trans.lrange(instance, 0, MAX_ENTRIES_IN_HEALTH_LOG - 1);
          });
          trans.exec((err, result) => {
            if (err) {
              reject(err);
            } else {
              let response = [];
              if (result && result.length > 0) {
                result = result[0];
                result.forEach((entry) => {
                  response.push(Utils.safeJSONParse(entry));
                });
              }
              resolve(response);
            }
          });
        });
    });
  }

  /**
   * @name _getServiceHealthAll
   * @summary Retrieve the health status of all instance services.
   * @private
   * @return {promise} promise - resolves with an array of objects containing instance health information.
   */
  _getServiceHealthAll() {
    return new Promise((resolve, reject) => {
      if (!this.redisdb) {
        reject(new Error('No Redis connection'));
        return;
      }
      this._getServices()
        .then((services) => {
          let listOfPromises = [];
          services.forEach((service) => {
            let serviceName = service.serviceName;
            listOfPromises.push(this._getServiceHealth(serviceName));
            listOfPromises.push(this._getServiceHealthLog(serviceName));
            listOfPromises.push(this._checkServicePresence(serviceName));
          });
          return Promise.all(listOfPromises);
        })
        .then((values) => {
          let response = [];
          for (let i = 0; i < values.length; i += 3) {
            response.push({
              health: values[i],
              log: values[i + 1],
              presence: values[i + 2]
            });
          }
          resolve(response);
        })
        .catch((err) => {
          reject(err);
        });
    });
  }

  /**
   * @name _chooseServiceInstance
   * @summary Choose an instance from a list of service instances.
   * @private
   * @param {array} instanceList - array list of service instances
   * @param {string} defaultInstance - default instance
   * @return {object} promise - resolved or rejected
   */
  _chooseServiceInstance(instanceList, defaultInstance) {
    return new Promise((resolve, reject) => {
      let instance;

      if (defaultInstance) {
        for (let i = 0; i < instanceList.length; i++) {
          if (instanceList[i].instanceID === defaultInstance) {
            instance = instanceList[i];
            break;
          }
        }
      }

      instance = instance || instanceList[0];
      this.redisdb.get(`${redisPreKey}:${instance.serviceName}:${instance.instanceID}:presence`, (err, _result) => {
        if (err) {
          reject(err);
        } else {
          this.redisdb.hget(`${redisPreKey}:nodes`, instance.instanceID, (err, result) => {
            if (err) {
              reject(err);
            } else {
              resolve(Utils.safeJSONParse(result));
            }
          });
        }
      });
    });
  }

  /**
   * @name _tryAPIRequest
   * @summary Attempt an API request to a hydra service.
   * @description
   * @param {array} instanceList - array of service instance objects
   * @param {object} parsedRoute - parsed route
   * @param {object} umfmsg - UMF message
   * @param {function} resolve - promise resolve function
   * @param {function} reject - promise reject function
   * @param {object} sendOpts - serverResponse.send options
   * @return {undefined}
   */
  _tryAPIRequest(instanceList, parsedRoute, umfmsg, resolve, reject, sendOpts) {
    let instance;

    if (parsedRoute) {
      for (let i = 0; i < instanceList.length; i++) {
        if (instanceList[i].instanceID === parsedRoute.instance) {
          instance = instanceList[i];
          break;
        }
      }
    }

    instance = instance || instanceList[0];

    this.redisdb.get(`${redisPreKey}:${instance.serviceName}:${instance.instanceID}:presence`, (err, _result) => {
      if (err) {
        this.emit('metric', `service:unavailable|${instance.serviceName}|${instance.instanceID}|presence:not:found`);
        reject(err);
      } else {
        this.redisdb.hget(`${redisPreKey}:nodes`, instance.instanceID, (err, result) => {
          if (err) {
            this.emit('metric', `service:unavailable|${instance.serviceName}|${instance.instanceID}|instance:not:found`);
            reject(err);
          } else {
            instance = Utils.safeJSONParse(result);
            let options = {
              host: instance.ip,
              port: instance.port,
              path: parsedRoute.apiRoute,
              method: parsedRoute.httpMethod.toUpperCase()
            };
            let preHeaders = {};
            if (options.method === 'POST' || options.method === 'PUT' || options.method === 'PATCH') {
              preHeaders['content-type'] = 'application/json';
            }
            options.headers = Object.assign(preHeaders, umfmsg.headers);
            if (umfmsg.authorization) {
              options.headers.Authorization = umfmsg.authorization;
            }
            if (umfmsg.timeout) {
              options.timeout = umfmsg.timeout;
            }
            options.body = Utils.safeJSONStringify(umfmsg.body);
            serverRequest.send(Object.assign(options, sendOpts))
              .then((res) => {
                if (res.payLoad && res.headers['content-type'] && res.headers['content-type'].indexOf('json') > -1) {
                  res = Object.assign(res, Utils.safeJSONParse(res.payLoad.toString('utf8')));
                  delete res.payLoad;
                }
                resolve(serverResponse.createResponseObject(res.statusCode, res));
              })
              .catch((err) => {
                instanceList.shift();
                if (instanceList.length === 0) {
                  this.emit('metric', `service:unavailable|${instance.serviceName}|${instance.instanceID}|${err.message}`);
                  this.emit('metric', `service:unavailable|${instance.serviceName}|${instance.instanceID}|attempts:exhausted`);
                  resolve(this._createServerResponseWithReason(ServerResponse.HTTP_SERVICE_UNAVAILABLE, `An instance of ${instance.serviceName} is unavailable`));
                } else {
                  this.emit('metric', `service:unavailable|${instance.serviceName}|${instance.instanceID}|${err.message}`);
                  this._tryAPIRequest(instanceList, parsedRoute, umfmsg, resolve, reject, sendOpts);
                }
              });
          }
        });
      }
    });
  }

  /**
   * @name _makeAPIRequest
   * @summary Makes an API request to a hydra service.
   * @description If the service isn't present and the message object has its
   *              message.body.fallbackToQueue value set to true, then the
   *              message will be sent to the services message queue.
   * @param {object} message - UMF formatted message
   * @param {object} sendOpts - serverResponse.send options
   * @return {promise} promise - response from API in resolved promise or
   *                   error in rejected promise.
   */
  _makeAPIRequest(message, sendOpts = { }) {
    return new Promise((resolve, reject) => {
      let umfmsg = UMFMessage.createMessage(message);
      if (!umfmsg.validate()) {
        resolve(this._createServerResponseWithReason(ServerResponse.HTTP_BAD_REQUEST, UMF_INVALID_MESSAGE));
        return;
      }

      let parsedRoute = UMFMessage.parseRoute(umfmsg.to);
      if (parsedRoute.error) {
        resolve(this._createServerResponseWithReason(ServerResponse.HTTP_BAD_REQUEST, parsedRoute.error));
        return;
      }

      if (!parsedRoute.httpMethod) {
        resolve(this._createServerResponseWithReason(ServerResponse.HTTP_BAD_REQUEST, 'HTTP method not specified in `to` field'));
        return;
      }

      if (parsedRoute.apiRoute === '') {
        resolve(this._createServerResponseWithReason(ServerResponse.HTTP_BAD_REQUEST, 'message `to` field does not specify a valid route'));
        return;
      }

      this._getServicePresence(parsedRoute.serviceName)
        .then((instances) => {
          if (instances.length === 0) {
            this.emit('metric', `service:unavailable|${parsedRoute.serviceName}`);
            resolve(this._createServerResponseWithReason(ServerResponse.HTTP_SERVICE_UNAVAILABLE, `Unavailable ${parsedRoute.serviceName} instances`));
            return;
          }
          this._tryAPIRequest(instances, parsedRoute, umfmsg, resolve, reject, sendOpts);
          return 0;
        })
        .catch((err) => {
          resolve(this._createServerResponseWithReason(ServerResponse.HTTP_SERVER_ERROR, err.message));
        });
    });
  }

  /**
   * @name _sendMessageThroughChannel
   * @summary Sends a message to a Redis pubsub channel
   * @param {string} channel - channel name
   * @param {object} message - UMF formatted message object
   * @return {undefined}
   */
  _sendMessageThroughChannel(channel, message) {
    let messageChannel;
    let chash = Utils.stringHash(channel);
    if (this.messageChannelPool[chash]) {
      messageChannel = this.messageChannelPool[chash];
    } else {
      messageChannel = this.redisdb.duplicate();
      this.messageChannelPool[chash] = messageChannel;
    }
    if (messageChannel) {
      let msg = UMFMessage.createMessage(message);
      let strMessage = Utils.safeJSONStringify(msg.toShort());
      messageChannel.publish(channel, strMessage);
    }
  }

  /**
   * @name sendMessage
   * @summary Sends a message to an instances of a hydra service.
   * @param {object} message - UMF formatted message object
   * @return {object} promise - resolved promise if sent or
   *                  HTTP error in resolve() if something bad happened
   */
  _sendMessage(message) {
    return new Promise((resolve, _reject) => {
      let {
        serviceName,
        instance
      } = UMFMessage.parseRoute(message.to);
      this._getServicePresence(serviceName)
        .then((instances) => {
          if (instances.length === 0) {
            let msg = `Unavailable ${serviceName} instances`;
            this._logMessage('error', msg);
            resolve(this._createServerResponseWithReason(ServerResponse.HTTP_SERVICE_UNAVAILABLE, msg));
            return;
          }
          // Did the user specify a specific service instance to use?
          if (instance && instance !== '') {
            // Make sure supplied instance actually exists in the array
            let found = instances.filter((entry) => entry.instanceID === instance);
            if (found.length > 0) {
              this._sendMessageThroughChannel(`${mcMessageKey}:${serviceName}:${instance}`, message);
            } else {
              let msg = `Unavailable ${serviceName} instance named ${instance}`;
              this._logMessage('error', msg);
              resolve(this._createServerResponseWithReason(ServerResponse.HTTP_SERVICE_UNAVAILABLE, msg));
              return;
            }
          } else {
            // Send to a random service.  It's random beause currently _getServicePresence()
            // returns a shuffled array.
            let serviceInstance = instances[0];
            this._sendMessageThroughChannel(`${mcMessageKey}:${serviceName}:${serviceInstance.instanceID}`, message);
          }
          resolve();
        })
        .catch((err) => {
          let msg = err.message;
          this._logMessage('error', msg);
          resolve(this._createServerResponseWithReason(ServerResponse.HTTP_SERVER_ERROR, msg));
        });
    });
  }

  /**
   * @name _sendReplyMessage
   * @summary Sends a reply message based on the original message received.
   * @param {object} originalMessage - UMF formatted message object
   * @param {object} messageResponse - UMF formatted message object
   * @return {object} promise - resolved promise if sent or
   *                   error in rejected promise.
   */
  _sendReplyMessage(originalMessage, messageResponse) {
    let longOriginalMessage = UMFMessage
      .createMessage(originalMessage)
      .toJSON();
    let longMessageResponse = UMFMessage
      .createMessage(messageResponse)
      .toJSON();
    let reply = Object.assign(longOriginalMessage, {
      rmid: longOriginalMessage.mid,
      to: longOriginalMessage.from,
      from: longOriginalMessage.to
    }, longMessageResponse);
    if (longOriginalMessage.via) {
      reply.to = longOriginalMessage.via;
    }
    if (longOriginalMessage.forward) {
      reply.forward = longOriginalMessage.forward;
    }
    return this._sendMessage(reply);
  }

  /**
   * @name sendBroadcastMessage
   * @summary Sends a message to all present instances of a hydra service.
   * @param {object} message - UMF formatted message object
   * @return {object} promise - resolved promise if sent or
   *                   error in rejected promise.
   */
  _sendBroadcastMessage(message) {
    return new Promise((resolve, _reject) => {
      let {
        serviceName
      } = UMFMessage.parseRoute(message.to);
      this._getServicePresence(serviceName)
        .then((instances) => {
          if (instances.length === 0) {
            if (serviceName !== 'hydra-router') {
              let msg = `Unavailable ${serviceName} instances`;
              this._logMessage('error', msg);
              resolve(this._createServerResponseWithReason(ServerResponse.HTTP_SERVICE_UNAVAILABLE, msg));
            } else {
              resolve();
            }
            return;
          }
          this._sendMessageThroughChannel(`${mcMessageKey}:${serviceName}`, message);
          resolve();
        })
        .catch((err) => {
          let msg = err.message;
          this._logMessage('error', msg);
          resolve(this._createServerResponseWithReason(ServerResponse.HTTP_SERVER_ERROR, msg));
        });
    });
  }

  /**
   * @name _queueMessage
   * @summary Queue a message
   * @param {object} message - UMF message to queue
   * @return {promise} promise - resolving to the message that was queued or a rejection.
   */
  _queueMessage(message) {
    return new Promise((resolve, reject) => {
      let umfmsg = UMFMessage.createMessage(message);
      if (!umfmsg.validate()) {
        resolve(this._createServerResponseWithReason(ServerResponse.HTTP_BAD_REQUEST, UMF_INVALID_MESSAGE));
        return;
      }

      let parsedRoute = UMFMessage.parseRoute(umfmsg.to);
      if (parsedRoute.error) {
        resolve(this._createServerResponseWithReason(ServerResponse.HTTP_BAD_REQUEST, parsedRoute.error));
        return;
      }

      let serviceName = parsedRoute.serviceName;
      this.redisdb.lpush(`${redisPreKey}:${serviceName}:mqrecieved`, Utils.safeJSONStringify(umfmsg.toShort()), (err, _data) => {
        if (err) {
          reject(err);
        } else {
          resolve(message);
        }
      });
    });
  }

  /**
   * @name _getQueuedMessage
   * @summary retrieve a queued message
   * @param {string} serviceName who's queue might provide a message
   * @return {promise} promise - resolving to the message that was dequeued or a rejection.
   */
  _getQueuedMessage(serviceName) {
    return new Promise((resolve, reject) => {
      this.redisdb.rpoplpush(`${redisPreKey}:${serviceName}:mqrecieved`, `${redisPreKey}:${serviceName}:mqinprogress`, (err, data) => {
        if (err) {
          reject(err);
        } else {
          let msg = Utils.safeJSONParse(data);
          resolve(msg);
        }
      });
    });
  }

  /**
   * @name _markQueueMessage
   * @summary Mark a queued message as either completed or not
   * @param {object} message - message in question
   * @param {boolean} completed - (true / false)
   * @param {string} reason - if not completed this is the reason processing failed
   * @return {promise} promise - resolving to the message that was dequeued or a rejection.
   */
  _markQueueMessage(message, completed, reason) {
    let serviceName = this._getServiceName();
    return new Promise((resolve, reject) => {
      let strMessage = Utils.safeJSONStringify(message);
      this.redisdb.lrem(`${redisPreKey}:${serviceName}:mqinprogress`, -1, strMessage, (err, _data) => {
        if (err) {
          reject(err);
        } else {
          if (message.bdy) {
            message.bdy.reason = reason || 'reason not provided';
          } else if (message.body) {
            message.body.reason = reason || 'reason not provided';
          }
          if (completed) {
            resolve(message);
          } else {
            strMessage = Utils.safeJSONStringify(message);
            this.redisdb.rpush(`${redisPreKey}:${serviceName}:mqincomplete`, strMessage, (err, data) => {
              if (err) {
                reject(err);
              } else {
                resolve(data);
              }
            });
          }
        }
      });
    });
  }

  /**
   * @name _hasServicePresence
   * @summary Indicate if a service has presence.
   * @description Indicates if a service has presence, meaning the
   *              service is running in at least one node.
   * @param {string} name - service name - note service name is case insensitive
   * @return {promise} promise - which resolves with TRUE if presence is found, FALSE otherwise
   */
  _hasServicePresence(name) {
    name = name || this._getServiceName();
    return new Promise((resolve, reject) => {
      this._getKeys(`*:${name}:*:presence`)
        .then((instances) => {
          resolve(instances.length !== 0);
        })
        .catch(reject);
    });
  }

  /**
   * @name _getConfig
   * @summary retrieve a stored configuration file
   * @param {string} label - service label containing servicename and version: such as myservice:0.0.1
   * @return {promise} promise - resolving to a configuration file in object format
   */
  _getConfig(label) {
    return new Promise((resolve, reject) => {
      let parts = label.split(':');
      if (parts.length !== 2) {
        let msg = 'label not in this form: myservice:0.1.1.';
        this._logMessage('error', msg);
        reject(new Error(msg));
      }
      this.redisdb.hget(`${redisPreKey}:${parts[0]}:configs`, parts[1], (err, result) => {
        if (err) {
          let msg = 'Unable to set :configs key in Redis db.';
          this._logMessage('error', msg);
          reject(new Error(msg));
        } else {
          resolve(Utils.safeJSONParse(result));
        }
      });
    });
  }

  /**
   * @name _putConfig
   * @summary store a configuration file
   * @param {string} label - service label containing servicename and version: such as myservice:0.0.1
   * @param {object} config - configuration object
   * @return {promise} promise - resolving or rejecting.
   */
  _putConfig(label, config) {
    return new Promise((resolve, reject) => {
      let parts = label.split(':');
      if (parts.length !== 2) {
        let msg = 'label not in this form: myservice:0.1.1.';
        this._logMessage('error', msg);
        reject(new Error(msg));
      }
      this.redisdb.hset(`${redisPreKey}:${parts[0]}:configs`, `${parts[1]}`, Utils.safeJSONStringify(config), (err, _result) => {
        if (err) {
          reject(new Error('Unable to set :configs key in Redis db.'));
        } else {
          resolve();
        }
      });
    });
  }

  /**
  * @name _listConfig
  * @summary Return a list of config keys
  * @param {string} serviceName - name of service
  * @return {promise} promise - resolving or rejecting.
  */
  _listConfig(serviceName) {
    return new Promise((resolve, reject) => {
      this.redisdb.hkeys(`${redisPreKey}:${serviceName}:configs`, (err, result) => {
        if (err) {
          let msg = 'Unable to retrieve :config keys from Redis db.';
          this._logMessage('error', msg);
          reject(new Error(msg));
        } else {
          if (result) {
            result.sort();
            resolve(result.map((item) => `${serviceName}:${item}`));
          } else {
            resolve([]);
          }
        }
      });
    });
  }

  /**
  * @name _getClonedRedisClient
  * @summary get a Redis client connection which points to the same Redis server that hydra is using
  * @param {object} [options] - override options from original createClient call
  * @param {function} [callback] - callback for async connect
  * @return {object} - Redis Client
  */
  _getClonedRedisClient(options, callback) {
    return this.redisdb.duplicate(options, callback);
  }

  /**
  * @name _getUMFMessageHelper
  * @summary returns UMF object helper
  * @return {object} helper - UMF helper
  */
  _getUMFMessageHelper() {
    return require('./lib/umfmessage');
  }

  /**
  * @name _getServerRequestHelper
  * @summary returns ServerRequest helper
  * @return {object} helper - service request helper
  */
  _getServerRequestHelper() {
    return require('./lib/server-request');
  }

  /**
  * @name _getServerResponseHelper
  * @summary returns ServerResponse helper
  * @return {object} helper - service response helper
  */
  _getServerResponseHelper() {
    return require('./lib/server-response');
  }

  /**
  * @name _getUtilsHelper
  * @summary returns a utils helper
  * @return {object} helper - utils helper
  */
  _getUtilsHelper() {
    return require('./lib/utils');
  }

  /**
  * @name _getConfigHelper
  * @summary returns a config helper
  * @return {object} helper - config helper
  */
  _getConfigHelper() {
    return require('./lib/config');
  }

  /** **************************************************************
   *  Hydra private utility functions.
   * ***************************************************************/

  /**
   * @name _createServerResponseWithReason
   * @summary Create a server response using an HTTP code and reason
   * @param {number} httpCode - code using ServerResponse.HTTP_XXX
   * @param {string} reason - reason description
   * @return {object} response - response object for use with promise resolve and reject calls
   */
  _createServerResponseWithReason(httpCode, reason) {
    return serverResponse.createResponseObject(httpCode, {
      result: {
        reason: reason
      }
    });
  }

  /**
   * @name _parseServicePortConfig
   * @summary Parse and process given port data in config
   * @param {mixed} port - configured port
   * @return {promise} promise - resolving with unassigned port, rejecting when no free port is found
   */
  _parseServicePortConfig(port) {
    return new Promise((resolve, reject) => {
      // No port given, get unassigned port from standard ranges
      if (typeof port === 'undefined' || !port || port == 0) {
        port = '1024-65535';
      } else if (! /-|,/.test(port.toString())) {
        // Specific port given, skip free port check
        resolve(port.toString());
        return;
      }
      let portRanges = port.toString().split(',')
        .map((p) => {
          p = p.trim();
          const ipRe = '(?:6553[0-5]|655[0-2][0-9]|65[0-4][0-9]{2}|6[0-4][0-9]{3}|[1-5][0-9]{4}|[1-9][0-9]{1,3}|[1-9])';
          let matches = p.match(new RegExp(`^${ipRe}-${ipRe}$`, 'g'));
          if (matches !== null) {
            return p;
          } else {
            matches = p.match(new RegExp(`^${ipRe}$`, 'g'));
            if (matches !== null) {
              return p;
            }
          }
          return null;
        })
        .filter((p) => p != null);
      let receivedCallBacks = 0;
      if (portRanges.length == 0) {
        let msg = 'servicePort configuration does not contain valid port(s)';
        this._logMessage('error', msg);
        reject(msg);
        return;
      }
      portRanges.forEach((rangeToCheck, _index) => {
        let min = 0;
        let max = 0;
        let foundRanges = rangeToCheck.split('-');
        if (foundRanges.length == 1) {
          min = foundRanges[0];
          max = min;
        } else {
          min = foundRanges[0];
          max = foundRanges[1];
        }
        this._getUnassignedRandomServicePort(parseInt(min), parseInt(max), (port) => {
          receivedCallBacks++;
          if (port !== 0) {
            resolve(port);
            return;
          } else {
            if (receivedCallBacks === portRanges.length) {
              let msg = 'No available service port in provided port range';
              this._logMessage('error', msg);
              reject(msg);
            }
          }
        });
      });
    });
  }

  /**
   * @name _getUnassignedRandomServicePort
   * @summary retrieve a free service port in given range
   * @param {number} min - Minimum port number, included
   * @param {number} max - Maximum port number, included
   * @param {function} callback - Callback function when done
   * @param {array} portsTried - Ports which have been tried
   * @return {undefined}
   **/
  _getUnassignedRandomServicePort(min, max, callback, portsTried) {
    const instance = this;
    const host = this.config.serviceIP;
    if (typeof portsTried === 'undefined') {
      portsTried = [];
    } else {
      if (portsTried.length == (max - min + 1)) {
        callback(0);
        return;
      }
    }

    let port = Math.floor(Math.random() * (max - min + 1)) + min;
    while (portsTried.indexOf(port) !== -1) {
      port = Math.floor(Math.random() * (max - min + 1)) + min;
    }
    portsTried.push(port);

    const server = require('net').createServer();
    server.listen({port, host}, () => {
      server.once('close', () => {
        callback(port);
      });
      server.close();
    });
    server.on('error', () => {
      instance._getUnassignedRandomServicePort(min, max, callback, portsTried);
    });
  }

  /**
   * @name _createUMFMessage
   * @summary Create a UMF style message.
   * @description This is a helper function which helps format a UMF style message.
   *              The caller is responsible for ensuring that required fields such as
   *              "to", "from" and "body" are provided either before or after using
   *              this function.
   * @param {object} message - optional message overrides.
   * @return {object} message - a UMF formatted message.
   */
  _createUMFMessage(message) {
    return UMFMessage.createMessage(message);
  }

  /**
   * @name _getTimeStamp
   * @summary Retrieve an ISO 8601 timestamp.
   * @return {string} timestamp - ISO 8601 timestamp
   */
  _getTimeStamp() {
    return new Date().toISOString();
  }

  /**
  * @name _getParentPackageJSONVersion
  * @summary Retrieve the version from the host app's package.json file.
  * @return {string} version - package version
  */
  _getParentPackageJSONVersion() {
    let version;
    try {
      const path = require('path');
      let fpath = `${path.dirname(process.argv[1])}/package.json`;
      version = require(fpath).version;
    } catch (e) {
      version = 'unspecified';
    }
    return version;
  }
}

/** **************************************************************
 *  Hydra interface class
 * ***************************************************************/

/**
 * @name IHydra
 * @summary Interface to Hydra, can provide microservice functionality or be used to monitor microservices.
 * @fires Hydra#log
 * @fires Hydra#message
 */
class IHydra extends Hydra {
  /**
   * @name constructor
   */
  constructor() {
    super();
  }

  /**
   * @name init
   * @summary Initialize Hydra with config object.
   * @param {mixed} config - a string with a path to a configuration file or an
   *                         object containing hydra specific keys/values
   * @param {boolean} testMode - whether hydra is being started in unit test mode
   * @return {object} promise - resolving if init success or rejecting otherwise
   */
  init(config, testMode = false) {
    return super.init(config, testMode);
  }

  /**
  * @name use
  * @summary Use plugins
  * @param {array} plugins - plugins to process
  * @return {undefined}
  */
  use(...plugins) {
    return super.use(...plugins);
  }

  /**
   * @name _shutdown
   * @summary Shutdown hydra safely.
   * @return {undefined}
   */
  shutdown() {
    return super._shutdown();
  }

  /**
   * @name registerService
   * @summary Registers this machine as a Hydra instance.
   * @description This is an optional call as this module might just be used to monitor and query instances.
   * @return {object} promise - resolving if registration success or rejecting otherwise
   */
  registerService() {
    return super._registerService();
  }

  /**
   * @name getServiceName
   * @summary Retrieves the service name of the current instance.
   * @throws Throws an error if this machine isn't a instance.
   * @return {string} serviceName - returns the service name.
   */
  getServiceName() {
    return super._getServiceName();
  }

  /**
   * @name getServices
   * @summary Retrieve a list of available instance services.
   * @return {promise} promise - returns a promise which resolves to an array of objects.
   */
  getServices() {
    return super._getServices();
  }

  /**
   * @name getServiceNodes
   * @summary Retrieve a list of services even if inactive.
   * @return {promise} promise - returns a promise
   */
  getServiceNodes() {
    return super._getServiceNodes();
  }

  /**
   * @name findService
   * @summary Find a service.
   * @param {string} name - service name - note service name is case insensitive
   * @return {promise} promise - which resolves with service
   */
  findService(name) {
    return super._findService(name);
  }

  /**
   * @name getServicePresence
   * @summary Retrieve a service / instance's presence info.
   * @param {string} name - service name - note service name is case insensitive
   * @return {promise} promise - which resolves with service presence
   */
  getServicePresence(name) {
    return super._getServicePresence(name);
  }

  /**
   * @name getInstanceID
   * @summary Return the instance id for this process
   * @return {number} id - instanceID
   */
  getInstanceID() {
    return super._getInstanceID();
  }

  /**
   * @name getInstanceVersion
   * @summary Return the version of this instance
   * @return {number} version - instance version
   */
  getInstanceVersion() {
    return super._getInstanceVersion();
  }

  /**
   * @name getHealth
   * @summary Retrieve service health info.
   * @private
   * @return {object} obj - object containing service health info
   */
  getHealth() {
    return this._getHealth();
  }

  /**
   * @name sendToHealthLog
   * @summary Log a message to the service instance's health log queue.
   * @private
   * @throws Throws an error if this machine isn't a instance.
   * @param {string} type - type of message ('error', 'info', 'debug' or user defined)
   * @param {string} message - message to log
   * @param {boolean} suppressEmit - false by default. If true then suppress log emit
   * @return {undefined}
   */
  sendToHealthLog(type, message, suppressEmit) {
    this._logMessage(type, message, suppressEmit);
  }

  /**
   * @name getServiceHealthLog
   * @summary Get this service's health log.
   * @throws Throws an error if this machine isn't a instance
   * @param {string} name - name of instance, use getName() if current service is the target.
   *                        note service name is case insensitive.
   * @return {promise} promise - resolves to log entries
   */
  getServiceHealthLog(name) {
    return super._getServiceHealthLog(name);
  }

  /**
   * @name getServiceHealthAll
   * @summary Retrieve the health status of all instance services.
   * @return {promise} promise - resolves with an array of objects containing instance health information.
   */
  getServiceHealthAll() {
    return super._getServiceHealthAll();
  }

  /**
   * @name createUMFMessage
   * @summary Create a UMF style message.
   * @description This is a helper function which helps format a UMF style message.
   *              The caller is responsible for ensuring that required fields such as
   *              "to", "from" and "body" are provided either before or after using
   *              this function.
   * @param {object} message - optional message overrides.
   * @return {object} message - a UMF formatted message.
   */
  createUMFMessage(message) {
    return super._createUMFMessage(message);
  }

  /**
   * @name makeAPIRequest
   * @summary Makes an API request to a hydra service.
   * @description If the service isn't present and the message object has its
   *              message.body.fallbackToQueue value set to true, then the
   *              message will be sent to the services message queue.
   * @param {object} message - UMF formatted message
   * @param {object} sendOpts - serverResponse.send options
   * @return {promise} promise - response from API in resolved promise or
   *                   error in rejected promise.
   */
  makeAPIRequest(message, sendOpts = { }) {
    return super._makeAPIRequest(message, sendOpts);
  }

  /**
   * @name sendMessage
   * @summary Sends a message to all present instances of a  hydra service.
   * @param {string | object} message - Plain string or UMF formatted message object
   * @return {object} promise - resolved promise if sent or
   *                   error in rejected promise.
   */
  sendMessage(message) {
    return super._sendMessage(message);
  }

  /**
   * @name sendReplyMessage
   * @summary Sends a reply message based on the original message received.
   * @param {object} originalMessage - UMF formatted message object
   * @param {object} messageResponse - UMF formatted message object
   * @return {object} promise - resolved promise if sent or
   *                   error in rejected promise.
   */
  sendReplyMessage(originalMessage, messageResponse) {
    return super._sendReplyMessage(originalMessage, messageResponse);
  }

  /**
   * @name sendBroadcastMessage
   * @summary Sends a message to all present instances of a  hydra service.
   * @param {string | object} message - Plain string or UMF formatted message object
   * @return {object} promise - resolved promise if sent or
   *                   error in rejected promise.
   */
  sendBroadcastMessage(message) {
    return super._sendBroadcastMessage(message);
  }

  /**
   * @name registerRoutes
   * @summary Register routes
   * @description Routes must be formatted as UMF To routes. https://github.com/cjus/umf#%20To%20field%20(routing)
   * @param {array} routes - array of routes
   * @return {object} Promise - resolving or rejecting
   */
  registerRoutes(routes) {
    return super._registerRoutes(routes);
  }

  /**
   * @name getAllServiceRoutes
   * @summary Retrieve all service routes.
   * @return {object} Promise - resolving to an object with keys and arrays of routes
   */
  getAllServiceRoutes() {
    return super._getAllServiceRoutes();
  }

  /**
   * @name matchRoute
   * @summary Matches a route path to a list of registered routes
   * @private
   * @param {string} routePath - a URL path to match
   * @return {boolean} match - true if match, false if not
   */
  matchRoute(routePath) {
    return super._matchRoute(routePath);
  }

  /**
   * @name queueMessage
   * @summary Queue a message
   * @param {object} message - UMF message to queue
   * @return {promise} promise - resolving to the message that was queued or a rejection.
   */
  queueMessage(message) {
    return super._queueMessage(message);
  }

  /**
   * @name getQueuedMessage
   * @summary retrieve a queued message
   * @param {string} serviceName who's queue might provide a message
   * @return {promise} promise - resolving to the message that was dequeued or a rejection.
   */
  getQueuedMessage(serviceName) {
    return super._getQueuedMessage(serviceName);
  }

  /**
   * @name markQueueMessage
   * @summary Mark a queued message as either completed or not
   * @param {object} message - message in question
   * @param {boolean} completed - (true / false)
   * @param {string} reason - if not completed this is the reason processing failed
   * @return {promise} promise - resolving to the message that was dequeued or a rejection.
   */
  markQueueMessage(message, completed, reason) {
    return super._markQueueMessage(message, completed, reason);
  }

  /**
   * @name _getConfig
   * @summary retrieve a stored configuration file
   * @param {string} label - service label containing servicename and version: such as myservice:0.0.1
   * @return {promise} promise - resolving to a configuration file in object format
   */
  getConfig(label) {
    return super._getConfig(label);
  }

  /**
   * @name _putConfig
   * @summary store a configuration file
   * @param {string} label - service label containing servicename and version: such as myservice:0.0.1
   * @param {object} config - configuration object
   * @return {promise} promise - resolving or rejecting.
   */
  putConfig(label, config) {
    return super._putConfig(label, config);
  }

  /**
  * @name listConfig
  * @summary Return a list of config keys
  * @param {string} serviceName - name of service
  * @return {promise} promise - resolving or rejecting.
  */
  listConfig(serviceName) {
    return super._listConfig(serviceName);
  }

  /**
   * @name hasServicePresence
   * @summary Indicate if a service has presence.
   * @description Indicates if a service has presence, meaning the
   *              service is running in at least one node.
   * @param {string} name - service name - note service name is case insensitive
   * @return {promise} promise - which resolves with TRUE if presence is found, FALSE otherwise
   */
  hasServicePresence(name) {
    return super._hasServicePresence(name);
  }

  /**
  * @name getClonedRedisClient
  * @summary get a Redis client connection which points to the same Redis server that hydra is using
  * @return {object} - Redis Client
  */
  getClonedRedisClient() {
    return super._getClonedRedisClient();
  }

  /**
  * @name getUMFMessageHelper
  * @summary returns UMF object helper
  * @return {object} helper - UMF helper
  */
  getUMFMessageHelper() {
    return super._getUMFMessageHelper();
  }

  /**
  * @name getServerRequestHelper
  * @summary returns ServerRequest helper
  * @return {object} helper - service request helper
  */
  getServerRequestHelper() {
    return super._getServerRequestHelper();
  }

  /**
  * @name getServerResponseHelper
  * @summary returns ServerResponse helper
  * @return {object} helper - service response helper
  */
  getServerResponseHelper() {
    return super._getServerResponseHelper();
  }

  /**
  * @name getUtilsHelper
  * @summary returns a Utils helper
  * @return {object} helper - utils helper
  */
  getUtilsHelper() {
    return super._getUtilsHelper();
  }

  /**
  * @name getConfigHelper
  * @summary returns a config helper
  * @return {object} helper - config helper
  */
  getConfigHelper() {
    return super._getConfigHelper();
  }
}

module.exports = new IHydra;

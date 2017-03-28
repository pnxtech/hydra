'use strict';

const Promise = require('bluebird');
Promise.series = (iterable, action) => {
  return Promise.mapSeries(
    iterable.map(action),
    (value, index, _length) => value || iterable[index].name || null
  );
};

const dns = require('dns');
const net = require('net');
const EventEmitter = require('events');
const util = require('util');
const humanize = require('humanize-duration');
const spawn = require('child_process').spawn;
const Route = require('route-parser');

const request = require('request');
const Utils = require('fwsp-jsutils');
const ServerResponse = require('fwsp-server-response');
let serverResponse = new ServerResponse();
const UMFMessage = require('fwsp-umf-message');

const RedisConnection = require('fwsp-redis-connection');

let HYDRA_REDIS_DB = 0;
const redisPreKey = 'hydra:service';
const mcMessageKey = 'hydra:service:mc';
const MAX_ENTRIES_IN_HEALTH_LOG = 1024;
const PRESENCE_UPDATE_INTERVAL = 5000; // unit = milli-seconds, so every 5 seconds
const HEALTH_UPDATE_INTERVAL = 5000;
const KEY_EXPIRATION_TTL = parseInt((PRESENCE_UPDATE_INTERVAL / 1000) * 2);
const UMF_INVALID_MESSAGE = 'UMF message requires "to", "from" and "body" fields';

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

    this.mcMessageChannelClient;
    this.mcDirectMessageChannelClient;
    this.messageChannelPool = {};
    this.config = null;
    this.serviceName = '';
    this.serviceDescription = '';
    this.serviceVersion = '';
    this.isService = false;
    this.initialized = false;
    this.redisdb = null;
    this._updatePresence = this._updatePresence.bind(this);
    this._updateHealthCheck = this._updateHealthCheck.bind(this);
    this.registeredRoutes = [];
    this.registeredPlugins = [];
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
   * @param {object} config - configuration object containing hydra specific keys/values
   * @return {object} promise - resolves with this._init
   */
  init(config) {
    return new Promise((resolve, reject) => {
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

      if (process.env.HYDRA_REDIS_URL && process.env.HYDRA_SERVICE) {
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
        Promise.series(this.registeredPlugins, (plugin) => plugin.onServiceReady())
          .then((..._results) => {
            resolve();
          })
          .catch((err) => this._logMessage('error', err.toString()));
      };
      this.config = config;
      this._connectToRedis(this.config)
        .then(() => {
          if (!this.redisdb) {
            reject(new Error('No Redis connection'));
            return;
          }
          this.config.servicePort = this.config.servicePort || this._getRandomServicePort();
          this.serviceName = config.serviceName;
          if (this.serviceName && this.serviceName.length > 0) {
            this.serviceName = this.serviceName.toLowerCase();
          }
          this.serviceDescription = this.config.serviceDescription || 'not specified';
          this.serviceVersion = this.config.serviceVersion || this._getParentPackageJSONVersion();

          // if serviceIP field contains a name rather than a dotted IP address
          // then use DNS to resolve the name to an IP address.
          if (this.config.serviceIP && this.config.serviceIP !== '' && net.isIP(this.config.serviceIP) === 0) {
            dns.lookup(this.config.serviceIP, (err, result) => {
              this.config.serviceIP = result;
              this._updateInstanceData();
              ready();
            });
          } else if (!this.config.serviceIP || this.config.serviceIP === '') {
            let ip = require('ip');
            this.config.serviceIP = ip.address();
            this._updateInstanceData();
            ready();
          } else {
            this._updateInstanceData();
            ready();
          }
          return 0;
        })
        .catch((err) => reject(err));
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
    this._logMessage('error', 'Service is shutting down.');
    if (this.mcMessageChannelClient) {
      this.mcMessageChannelClient.unsubscribe();
      this.mcMessageChannelClient.quit();
    }
    if (this.mcDirectMessageChannelClient) {
      this.mcDirectMessageChannelClient.unsubscribe();
      this.mcDirectMessageChannelClient.quit();
    }
    Object.keys(this.messageChannelPool).forEach((keyname) => {
      this.messageChannelPool[keyname].quit();
    });
    if (this.redisdb) {
      this.redisdb.del(`${redisPreKey}:${this.serviceName}:${this.instanceID}:presence`, () => {
        this.redisdb.quit();
      });
    }
  }

  /**
   * @name _connectToRedis
   * @summary Configure access to redis and monitor emitted events.
   * @private
   * @param {object} config - redis client configuration
   * @return {object} promise - resolves or reject
   */
  _connectToRedis(config) {
    let retryStrategy = config.redis.retry_strategy;
    delete config.redis.retry_strategy;
    let redisConnection = new RedisConnection(config.redis);
    HYDRA_REDIS_DB = redisConnection.redisConfig.db;
    return redisConnection.connect(retryStrategy)
      .then((client) => {
        this.redisdb = client;
        client
          .on('reconnecting', () => {
            this._logMessage('error', 'Reconnecting to redis server...');
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
      })
      .catch((err) => {
        let message = `Redis error: ${err.message}`;
        this._logMessage('error', message);
        throw err;
      });
  }

  /**
   * @name _getKeys
   * @summary Retrieves a list of redis keys based on pattern.
   * @param {string} pattern - pattern to filter with
   * @return {object} promise - promise resolving to array of keys or or empty array
   */
  _getKeys(pattern) {
    return new Promise((resolve, _reject) => {
      this.redisdb.keys(pattern, (err, result) => {
        if (err) {
          resolve([]);
        } else {
          resolve(result);
        }
      });
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
      throw new Error('init() not called, Hydra requires a configuration object.');
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
    return Utils.md5Hash(`${this.config.serviceIP}:${this.config.servicePort}`);
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
        reject(new Error('init() not called, Hydra requires a configuration object.'));
        return;
      }

      if (!this.redisdb) {
        reject(new Error('No Redis connection'));
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
          reject(new Error('Unable to set :service key in redis db.'));
        } else {
          // Setup service message courier channels
          this.mcMessageChannelClient = this.redisdb.duplicate();
          this.mcMessageChannelClient.subscribe(`${mcMessageKey}:${serviceName}`);
          this.mcMessageChannelClient.on('message', (channel, message) => {
            let msg = Utils.safeJSONParse(message);
            if (msg) {
              let umfMsg = UMFMessage.createMessage(msg);
              this.emit('message', umfMsg.toShort());
            }
          });

          this.mcDirectMessageChannelClient = this.redisdb.duplicate();
          this.mcDirectMessageChannelClient.subscribe(`${mcMessageKey}:${serviceName}:${this.instanceID}`);
          this.mcDirectMessageChannelClient.on('message', (channel, message) => {
            let msg = Utils.safeJSONParse(message);
            if (msg) {
              let umfMsg = UMFMessage.createMessage(msg);
              this.emit('message', umfMsg.toShort());
            }
          });

          // Schedule periodic updates
          setInterval(this._updatePresence, PRESENCE_UPDATE_INTERVAL);
          setInterval(this._updateHealthCheck, HEALTH_UPDATE_INTERVAL);

          resolve({
            serviceName: this.serviceName,
            serviceIP: this.config.serviceIP,
            servicePort: this.config.servicePort
          });

          // Update presence immediately without waiting for next update interval.
          this._updatePresence();
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
   * @param {string} serviceName - name of service to retreieve list of routes.
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
        reject(new Error('No Redis connection'));
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
    let match;
    this.registeredRoutes.forEach((route) => {
      match = route.match(routePath);
      if (match) {
        return true;
      }
    });
    return false;
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
      port: this.config.servicePort
    });
    if (entry) {
      this.redisdb.setex(`${redisPreKey}:${this.serviceName}:${this.instanceID}:presence`, KEY_EXPIRATION_TTL, this.instanceID);
      this.redisdb.hset(`${redisPreKey}:nodes`, this.instanceID, entry);
      const ONE_WEEK_IN_SECONDS = 604800;
      this.redisdb.multi()
        .expire(`${redisPreKey}:${this.serviceName}:${this.instanceID}:health`, KEY_EXPIRATION_TTL)
        .expire(`${redisPreKey}:${this.serviceName}:${this.instanceID}:health:log`, ONE_WEEK_IN_SECONDS)
        .exec();
    }
  }

  /**
   * @name _updateHealthCheck
   * @summary Update service helath.
   * @private
   * @return {undefined}
   */
  _updateHealthCheck() {
    let entry = Object.assign({
      updatedOn: this._getTimeStamp()
    }, this._getHealth());
    if (entry) {
      this._getUsedDiskSpace()
        .then((usedspace) => {
          entry = Utils.safeJSONStringify(Object.assign({}, entry, {
            usedDiskSpace: usedspace
          }));
          if (entry) {
            this.redisdb.setex(`${redisPreKey}:${this.serviceName}:${this.instanceID}:health`, KEY_EXPIRATION_TTL, entry);
          }
        })
        .catch((err) => {
          this._logMessage('error', err.message);
        });
    }
  }

  /**
   * @name _getUsedDiskSpace
   * @summary Get used disk space for current volume.
   * @return {promise} promise - promise which resolves with total used disk space
   */
  _getUsedDiskSpace() {
    return new Promise((resolve, reject) => {
      const USED_DISKSPACE_FIELD = 7;
      const SECOND_LINE = 1; // zero index ;-)
      let df = spawn('df', ['-k', '.']);
      df.on('error', (err) => {
        if (err.code === 'ENOENT') {
          // df command could not be executed on host environment.
          // this is currently the case on Windows - cjus
          resolve('not supported on os');
        } else {
          reject(err);
        }
      });
      df.stdout.on('data', (data) => {
        let lines = data.toString().split('\n');
        let results = lines[SECOND_LINE]
          .split(' ')
          .filter((element) => element !== '');
        resolve(results[USED_DISKSPACE_FIELD]);
      });
      df.stderr.on('data', (data) => {
        reject(data);
      });
    });
  }

  /**
   * @name _getHealth
   * @summary Retrieve server health info.
   * @private
   * @return {object} obj - object containing server info
   */
  _getHealth() {
    let lines, keyval;
    let map = {};
    let memory = util.inspect(process.memoryUsage());

    memory = memory.replace(/[\ \{\}]/g, '');
    lines = memory.split(',');

    Array.from(lines, (line) => {
      keyval = line.split(':');
      map[keyval[0]] = Number(keyval[1]);
    });

    let uptimeInSeconds = process.uptime();
    return {
      serviceName: this.serviceName,
      instanceID: this.instanceID,
      sampledOn: this._getTimeStamp(),
      processID: process.pid,
      architecture: process.arch,
      platform: process.platform,
      nodeVersion: process.version,
      memory: map,
      uptime: humanize(uptimeInSeconds * 1000),
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

    if (!suppressEmit) {
      this.emit('log', errMessage);
    }

    let entry = Utils.safeJSONStringify(errMessage);
    if (entry) {
      // If issue is with redis we can't use redis to log this error.
      // however the above call to the application logger would be one way of detecting the issue.
      if (this.isService) {
        if (message.toLowerCase().indexOf('redis') === -1) {
          let key = `${redisPreKey}:${this.serviceName}:${this.instanceID}:health:log`;
          this.redisdb.multi()
            .select(HYDRA_REDIS_DB)
            .lpush(key, entry)
            .ltrim(key, 0, MAX_ENTRIES_IN_HEALTH_LOG - 1)
            .exec();
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
              item.elapsed = parseInt((now - (new Date(item.updatedOn)).getTime()) / 1000);
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
   * @summary Retrieve a service / instance's presence info.
   * @description Differs from getServicePresence in that it always
   *              resolves and never reject promise. This is useful
   *              when _checkServicePresence is called by
   *              getServiceHealthAll.
   * @param {string} name - service name - note service name is case insensitive
   * @return {promise} promise - which resolves with service presence
   */
  _checkServicePresence(name) {
    name = name || this._getServiceName();
    return new Promise((resolve, reject) => {
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
              let instanceList = result.map((instance) => {
                let instanceObj = Utils.safeJSONParse(instance);
                if (instanceObj) {
                  instanceObj.updatedOnTS = (new Date(instanceObj.updatedOn).getTime());
                }
                return instanceObj;
              });
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
            reject(new Error(`Service instance for ${name} is unavailable`));
          } else {
            if (result.length > 1) {
              result.sort((a, b) => {
                return (a.updatedOnTS < b.updatedOnTS) ? 1 : ((b.updatedOnTS < a.updatedOnTS) ? -1 : 0);
              });
            }
            resolve(result);
          }
        })
        .catch((_err) => {
          reject(new Error(`Service instance for ${name} is unavailable`));
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
              if (result || result.length > 0) {
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
   * @return {promise} promise - resolves with an array of objects containint instance health information.
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
   * @return {undefined}
   */
  _tryAPIRequest(instanceList, parsedRoute, umfmsg, resolve, reject) {
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
        reject(err);
      } else {
        this.redisdb.hget(`${redisPreKey}:nodes`, instance.instanceID, (err, result) => {
          if (err) {
            reject(err);
          } else {
            instance = Utils.safeJSONParse(result);
            let url = `http://${instance.ip}:${instance.port}${parsedRoute.apiRoute}`;
            let options = {
              url,
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json; charset=UTF-8'
              },
              method: parsedRoute.httpMethod
            };
            if (umfmsg.authorization) {
              options.headers.Authorization = umfmsg.authorization;
            }
            if (umfmsg.body) {
              options.body = Utils.safeJSONStringify(umfmsg.body);
            }
            request(options, (error, response, body) => {
              if (!error) {
                if (response.headers['content-type'] && response.headers['content-type'].indexOf('json') > -1) {
                  let bdy = Utils.safeJSONParse(body);
                  if (bdy.statusCode) {
                    resolve(bdy);
                  } else {
                    let resObject = serverResponse.createResponseObject(response.statusCode, {
                      result: bdy
                    });
                    resolve(resObject);
                  }
                } else {
                  resolve({
                    headers: response.headers,
                    body,
                    statusCode: response.statusCode
                  });
                }
              } else {
                instanceList.shift();
                if (instanceList.length === 0) {
                  resolve(this._createServerResponseWithReason(ServerResponse.HTTP_SERVER_ERROR, err.message));
                } else {
                  this._tryAPIRequest(instanceList, parsedRoute, umfmsg, resolve, reject);
                }
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
   * @return {promise} promise - response from API in resolved promise or
   *                   error in rejected promise.
   */
  _makeAPIRequest(message) {
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

      // check if a non-service message (HTTP passthrough) is being sent and handle accordingly
      if (parsedRoute.serviceName.indexOf('http') === 0) {
        let options = {
          url: `${parsedRoute.serviceName}${parsedRoute.apiRoute}`,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json; charset=UTF-8'
          },
          method: parsedRoute.httpMethod
        };
        if (umfmsg.authorization) {
          options.headers.Authorization = umfmsg.authorization;
        }
        if (umfmsg.body && (parsedRoute.httpMethod === 'post' || parsedRoute.httpMethod === 'put')) {
          options.body = Utils.safeJSONStringify(umfmsg.body);
        }
        request(options, (error, response, body) => {
          if (!error) {
            let resObject = serverResponse.createResponseObject(response.statusCode, {
              result: Utils.safeJSONParse(body)
            });
            resolve(resObject);
          } else {
            resolve(this._createServerResponseWithReason(response.statusCode, error.message));
          }
        });
        return;
      }

      // handle service message
      this._getServicePresence(parsedRoute.serviceName)
        .then((instances) => {
          if (instances.length === 0) {
            resolve(this._createServerResponseWithReason(ServerResponse.HTTP_SERVICE_UNAVAILABLE, `Unavailable ${parsedRoute.serviceName} instances`));
            return;
          }
          this._tryAPIRequest(instances, parsedRoute, umfmsg, resolve, reject);
          return 0;
        })
        .catch((err) => {
          resolve(this._createServerResponseWithReason(ServerResponse.HTTP_SERVER_ERROR, err.message));
        });
    });
  }

  /**
   * @name _sendMessageThroughChannel
   * @summary Sends a message to a redis pubsub channel
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
   *                   error in rejected promise.
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
            resolve(this._createServerResponseWithReason(ServerResponse.HTTP_SERVICE_UNAVAILABLE, `Unavailable ${serviceName} instances`));
            return;
          }
          if (instance && instance !== '') {
            this._sendMessageThroughChannel(`${mcMessageKey}:${serviceName}:${instance}`, message);
          } else {
            let serviceInstance = instances[0];
            this._sendMessageThroughChannel(`${mcMessageKey}:${serviceName}:${serviceInstance.instanceID}`, message);
          }
          resolve();
        })
        .catch((err) => {
          resolve(this._createServerResponseWithReason(ServerResponse.HTTP_SERVER_ERROR, err.message));
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
            resolve(this._createServerResponseWithReason(ServerResponse.HTTP_SERVICE_UNAVAILABLE, `Unavailable ${serviceName} instances`));
            return;
          }
          this._sendMessageThroughChannel(`${mcMessageKey}:${serviceName}`, message);
          resolve();
        })
        .catch((err) => {
          resolve(this._createServerResponseWithReason(ServerResponse.HTTP_SERVER_ERROR, err.message));
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
      this.redisdb.rpush(`${redisPreKey}:${serviceName}:mqrecieved`, Utils.safeJSONStringify(umfmsg.toShort()), (err, _data) => {
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
      if (reason) {
        message.body.reason = reason || 'reason not provided';
      }
      let strMessage = Utils.safeJSONStringify(message);
      this.redisdb.lrem(`${redisPreKey}:${serviceName}:mqinprogress`, -1, strMessage, (err, _data) => {
        if (err) {
          reject(err);
        } else {
          if (completed) {
            resolve(message);
          } else {
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
   * @name _getConfig
   * @summary retrieve a stored configuration file
   * @param {string} label - service label containing servicename and version: such as myservice:0.0.1
   * @return {promise} promise - resolving to a configuration file in object format
   */
  _getConfig(label) {
    return new Promise((resolve, reject) => {
      let parts = label.split(':');
      if (parts.length !== 2) {
        reject(new Error('label not in this form: myservice:0.1.1.'));
      }
      this.redisdb.hget(`${redisPreKey}:${parts[0]}:configs`, parts[1], (err, result) => {
        if (err) {
          reject(new Error('Unable to set :configs key in redis db.'));
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
        reject(new Error('label not in this form: myservice:0.1.1.'));
      }
      this.redisdb.hset(`${redisPreKey}:${parts[0]}:configs`, `${parts[1]}`, Utils.safeJSONStringify(config), (err, _result) => {
        if (err) {
          reject(new Error('Unable to set :configs key in redis db.'));
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
          reject(new Error('Unable to retrieve :config keys from redis db.'));
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
  * @summary get a redis client connection which points to the same Redis server that hydra is using
  * @return {object} - Redis Client
  */
  _getClonedRedisClient() {
    return this.redisdb.duplicate();
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
   * @name _getRandomServicePort
   * @summary Retrieves a random TCP/IP port.
   * @return {number} port - new random socket port
   */
  _getRandomServicePort() {
    const maxSocketPort = 65535;
    const nonPriviliagePortBountry = 1024;
    return parseInt(nonPriviliagePortBountry + (new Date().getTime() % (Math.random() * (maxSocketPort - nonPriviliagePortBountry))));
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
  * @summary Retreieve the vesion from the host app's package.json file.
  * @return {string} version - package version
  */
  _getParentPackageJSONVersion() {
    let version = 'not specified';
    if (process.argv[1]) {
      const path = require('path');
      version = require(`${path.dirname(process.argv[1])}/package.json`).version;
    }
    return version;
  }
}

/** **************************************************************
 *  Hydra interface class
 * ***************************************************************/

/**
 * @name IHydra
 * @summary Interface to Hydra, can provide microservice funtionality or be used to monitor microservices.
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
   * @param {object} config - configuration object containing hydra specific keys/values
   * @return {object} promise - resolving if init success or rejecting otherwise
   */
  init(config) {
    return super.init(config);
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
    super._shutdown();
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
   * @return {promise} promise - resolves with an array of objects containint instance health information.
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
   * @return {promise} promise - response from API in resolved promise or
   *                   error in rejected promise.
   */
  makeAPIRequest(message) {
    return super._makeAPIRequest(message);
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
  * @name getClonedRedisClient
  * @summary get a redis client connection which points to the same Redis server that hydra is using
  * @return {object} - Redis Client
  */
  getClonedRedisClient() {
    return super._getClonedRedisClient();
  }
}

module.exports = new IHydra;

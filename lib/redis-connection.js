const Promise = require('bluebird');
let redis;

/**
* @name RedisConnection
* @summary Handles Redis connect
*/
class RedisConnection {
  /**
  * @name constructor
  * @summary
  * @description
  * @param {object} redisConfig - redis configuration object
  * @param {number} defaultRedisDb - default redis database number
  * @param {boolean} testMode - whether redis mock library is being used
  * @return {undefined}
  */
  constructor(redisConfig, defaultRedisDb = 0, testMode = false) {
    if (testMode) {
      redis = require('redis-mock');
    } else {
      redis = require('redis');
      Promise.promisifyAll(redis.RedisClient.prototype);
      Promise.promisifyAll(redis.Multi.prototype);
    }

    let url = {};
    if (redisConfig.url) {
      let parsedUrl = require('redis-url').parse(redisConfig.url);
      url = {
        host: parsedUrl.hostname,
        port: parsedUrl.port,
        db: parsedUrl.database
      };
      if (parsedUrl.password) {
        url.password = parsedUrl.password;
      }
    }
    this.redisConfig = Object.assign({db: defaultRedisDb}, url, redisConfig);
    if (this.redisConfig.host) {
      delete this.redisConfig.url;
    }
    this.options = {
      maxReconnectionAttempts: 6,
      maxDelayBetweenReconnections: 5
    };
  }

  /**
  * @name getRedis
  * @summary Get Redis constructor
  * @return {funcion} redis
  */
  getRedis() {
    return redis;
  }

  /**
  * @name connect
  * @summary connection entry point
  * @param {object} options - connection options - description
  * @return {undefined}
  */
  connect(options) {
    if (options) {
      this.options = options;
    }
    let reconnections = 0;
    return this.attempt(() => this._connect()).until(
      `max reconnection attempts (${reconnections}) reached`,
      () => ++reconnections > this.options.maxReconnectionAttempts
    );
  }

  /**
  * @name _connect
  * @summary private member used by connect to rettry connections
  * @return {object} promise
  */
  _connect() {
    let self = new Promise((resolve, reject) => {
      let timeout = setTimeout(() => {
        reject(new Error('connection timed out'));
      }, this.options.maxDelayBetweenReconnections * 1000);
      let db = redis.createClient(this.redisConfig);
      db.once('ready', () => resolve(db));
      db.on('error', (err) => {
        clearTimeout(timeout);
        if (self.isPending()) {
          return reject(err);
        }
      });
    });
    return self;
  }

  /**
  * @name attempt
  * @summary connection attempt
  * @param {function} action
  * @return {undefined}
  */
  attempt(action) {
    let self = {
      until: (rejection, condition) => new Promise((resolve, reject) => {
        if (condition()) {
          reject(new Error(rejection));
        } else {
          action()
            .then(resolve)
            .catch(() => resolve(self.until(rejection, condition)));
        }
      })
    };
    return self;
  }
}

module.exports = RedisConnection;

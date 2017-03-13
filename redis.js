const redis = require('redis');
const Promise = require('bluebird');

class RedisConnection {
  constructor(redisConfig) {
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
    this.redisConfig = Object.assign(url, redisConfig);
    if (this.redisConfig.host) {
      delete this.redisConfig.url;
    }
    this.options = {
      maxReconnectionAttempts: 6,
      maxDelayBetweenReconnections: 5
    };
  }
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
  _connect() {
    let self = new Promise((resolve, reject) => {
      let timeout = setTimeout(() => {
        reject(new Error('connection timed out'));
      }, this.options.maxDelayBetweenReconnections * 1000);
      let db = redis.createClient(this.redisConfig);
      db.once('ready', () => resolve(db));
      db.on('error', err => {
        clearTimeout(timeout);
        if (self.isPending()) {
          return reject(err);
        }
      });
    });
    return self;
  }
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

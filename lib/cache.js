'use strict';

/**
* @name Cache
* @summary Internal cache helper
*/
class Cache {
  /**
  * @name constructor
  * @summary constructor
  * @return {undefined}
  */
  constructor() {
    this.data = {};
  }

  /**
  * @name put
  * @summary put a value in the cache
  * @param {string} key - key for value
  * @param {any} value - value associated with key
  * @param {number} expiration - expiration in seconds
  * @return {undefined}
  */
  put(key, value, expiration = 0) {
    this.data[key] = {
      value,
      ts: new Date().getTime() / 1000 | 0,
      expiration
    };
  }

  /**
  * @name get
  * @summary get a value based on key
  * @param {string} key - key for value
  * @return {any} value - value associated with key or undefined if missing or expired
  */
  get(key) {
    let item = this.data[key];
    if (item) {
      let current = new Date().getTime() / 1000 | 0;
      if (current > (item.ts + item.expiration)) {
        this.data[key] = item = undefined;
      }
    }
    return item ? item.value : undefined;
  }
}

module.exports = Cache;

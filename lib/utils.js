'use strict';

const crypto = require('crypto');

/**
* @name Utils
* @return {undefined}
*/
class Utils {
  /**
  * @name md5Hash
  * @summary Hashes a key to produce an MD5 hash
  * @param {string} key - input key to hash
  * @return {string} hash - hashed value
  */
  static md5Hash(key) {
    return crypto
      .createHash('md5')
      .update(key)
      .digest('hex');
  }

  /**
   * @name safeJSONStringify
   * @summary Safe JSON stringify
   * @param {object} obj - object to stringify
   * @return {string} string - stringified object.
   */
  static safeJSONStringify(obj) {
    // replaceErrors below credited to Jonathan Lonowski via Stackoverflow:
    // https://stackoverflow.com/questions/18391212/is-it-not-possible-to-stringify-an-error-using-json-stringify
    let replaceErrors = (key, value) => {
      if (value instanceof Error) {
        let error = {};
        Object.getOwnPropertyNames(value).forEach((key) => {
          error[key] = value[key];
        });
        return error;
      }
      return value;
    };
    return JSON.stringify(obj, replaceErrors);
  }

  /**
   * @name safeJSONParse
   * @summary Safe JSON parse
   * @private
   * @param {string} str - string which will be parsed
   * @return {object} obj - parsed object
   *   Returns undefined if string can't be parsed into an object
   */
  static safeJSONParse(str) {
    let data;
    try {
      data = JSON.parse(str);
    } catch (e) {
      data = undefined;
    }
    return data;
  }

  /**
   * @name stringHash
   * @summary returns a hash value for a supplied string
   * @see https://github.com/darkskyapp/string-hash
   * @private
   * @param {object} str - string to hash
   * @return {number} hash - hash value
   */
  static stringHash(str) {
    let hash = 5381;
    let i = str.length;
    while (i) {
      hash = (hash * 33) ^ str.charCodeAt(--i);
    }
    /* JavaScript does bitwise operations (like XOR, above) on 32-bit signed
     * integers. Since we want the results to be always positive, convert the
     * signed int to an unsigned by doing an unsigned bitshift. */
    return hash >>> 0;
  }

  /**
  * @name shortID
  * @summary generate a random id composed of alphanumeric characters
  * @see https://en.wikipedia.org/wiki/Base36
  * @return {string} random string id
  */
  static shortID() {
    return (Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)).toString(36);
  }

  /**
  * @name isUUID4
  * @summary determine whether a string is a valid UUID
  * @param {string} str - possible UUID
  * @return {undefined}
  */
  static isUUID4(str) {
    const uuidPattern = '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$';
    return (new RegExp(uuidPattern)).test(str);
  }

  /**
  * @name shuffeArray
  * @summary shuffle an array in place
  * @param {array} a - array elements may be numbers, string or objects.
  * @return {undefined}
  */
  static shuffleArray(a) {
    for (let i = a.length; i; i--) {
      let j = Math.floor(Math.random() * i);
      [a[i - 1], a[j]] = [a[j], a[i - 1]];
    }
  }
}

module.exports = Utils;

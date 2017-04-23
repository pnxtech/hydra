'use strict';

const crypto = require('crypto');
const jss = require('json-stringify-safe');

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
   * @description Note, that this function if very different from the
   *  JSON.stringify function in that it won't accept non objects.
   * @param {object} obj - object to stringify
   * @return {string} string - stringified object.
   *   Returns undefined if the object isn't a valid object or can't be stringified
   */
  static safeJSONStringify(obj) {
    return jss(obj);
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
    }
    return data;
  }

}

module.exports = Utils;

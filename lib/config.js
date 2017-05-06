'use strict';

const fs = require('fs');
const Promise = require('bluebird');
const Utils = require('./utils');

/**
* @name Config
* @summary config helper
* @return {undefined}
*/
class Config {
  /**
  * @name constructor
  * @summary init config object
  * @return {undefined}
  */
  constructor() {
    this.config = {};
  }

  /**
  * @name getObject
  * @summary Returns a plain-old JavaScript object
  * @return {object} obj - a Plain old JavaScript Object.
  */
  getObject() {
    return Object.assign({}, this.config);
  }

  /**
  * @name _doInit
  * @summary Perform initialization process.
  * @param {string/object} cfg - path or URL to configuration JSON data or object
  * @param {function} resolve - resolve function
  * @param {function} reject - reject function
  * @return {undefined}
  */
  _doInit(cfg, resolve, reject) {
    if (!cfg) {
      reject(new Error('no config specified'));
    } else {
      try {
        if (typeof cfg === 'string') {
          this._doInitViaFile(cfg, resolve, reject);
        } else {
          this.config = Object.assign({}, cfg);
          resolve();
        }
      } catch (err) {
        reject(err);
      }
    }
  }

  /**
  * @name _doInitViaFile
  * @summary Perform initialization from a file.
  * @param {string} configFilePath - path to configuration JSON data
  * @param {function} resolve - resolve function
  * @param {function} reject - reject function
  * @return {undefined}
  */
  _doInitViaFile(configFilePath, resolve, reject) {
    fs.readFile(configFilePath, (err, result) => {
      if (!err) {
        let config = Utils.safeJSONParse(result.toString());
        if (!config) {
          reject(new Error('unable to parse config file'));
          return;
        }
        if (config.location) {
          this._doInit(config.location, resolve, reject);
        } else {
          this.config = Object.assign({}, config);
          resolve();
        }
      } else {
        reject(err);
      }
    });
  }

  /**
  * @name init
  * @summary Initializes config object with JSON file data.
  * @param {object/string} cfg - path to config file or config object
  * @return {object} promise - resolves if successful, else rejects
  */
  init(cfg) {
    return new Promise((resolve, reject) => {
      this._doInit(cfg, resolve, reject);
    });
  }
}

/**
* Return an ES6 Proxy object which provides access to configuration fields.
*/
module.exports = new Proxy(new Config(), {
  get: function(target, name, _receiver) {
    return name in target ?
      target[name] : target.config[name];
  }
});

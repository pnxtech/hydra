'use strict';

const uuid = require('uuid');
const crypto = require('crypto');
const UMF_VERSION = 'UMF/1.4.6';

const isNotEmptyString = (string, checkContents = true) => string != null && (!checkContents || string.trim() != '');

// Works like the es2020 ?? operator
const nCoalescg = (...args) => args.find((el) => el != null && el != undefined);

/**
* @name UMFMessage
* @summary UMF Message helper
*/
class UMFMessage {
  /**
  * @name constructor
  * @summary class constructor
  * @return {undefined}
  */
  constructor() {
    this.message = {};
  }

  /**
  * @name getTimeStamp
  * @summary retrieve an ISO 8601 timestamp
  * @return {string} timestamp - ISO 8601 timestamp
  */
  getTimeStamp() {
    return new Date().toISOString();
  }

  /**
  * @name createMessageID
  * @summary Returns a UUID for use with messages
  * @return {string} uuid - UUID
  */
  createMessageID() {
    return uuid.v4();
  }

  /**
  * @name createShortMessageID
  * @summary Returns a short form UUID for use with messages
   @see https://en.wikipedia.org/wiki/Base36
  * @return {string} short identifer
  */
  createShortMessageID() {
    return (Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)).toString(36);
  }

  /**
  * @name signMessage
  * @summary sign message with cryptographic signature
  * @param {string} algo - such as 'sha256'
  * @param {string} sharedSecret - shared secret
  * @return {undefined}
  */
  signMessage(algo, sharedSecret) {
    (this.message.signature) && delete this.message.signature;
    this.message.signature = crypto
      .createHmac(algo, sharedSecret)
      .update(JSON.stringify(this.message))
      .digest('hex');
  }

  /**
  * @name toJSON
  * @return {object} A JSON stringifiable version of message
  */
  toJSON() {
    return this.message;
  }

  /**
  * @name toShort
  * @summary convert a long message to a short one
  * @return {object} converted message
  */
  toShort() {
    let message = {};
    if (isNotEmptyString(this.message['to'])) {
      message['to'] = this.message['to'];
    }
    if (isNotEmptyString(this.message['from'])) {
      message['frm'] = this.message['from'];
    }
    if (this.message['headers'] != null) {
      message['hdr'] = this.message['headers'];
    }
    if (isNotEmptyString(this.message['mid'])) {
      message['mid'] = this.message['mid'];
    }
    if (isNotEmptyString(this.message['rmid'])) {
      message['rmid'] = this.message['rmid'];
    }
    if (isNotEmptyString(this.message['signature'])) {
      message['sig'] = this.message['signature'];
    }
    if (isNotEmptyString(this.message['timeout'])) {
      message['tmo'] = this.message['timeout'];
    }
    if (isNotEmptyString(this.message['timestamp'])) {
      message['ts'] = this.message['timestamp'];
    }
    if (isNotEmptyString(this.message['type'])) {
      message['typ'] = this.message['type'];
    }
    if (isNotEmptyString(this.message['version'])) {
      message['ver'] = this.message['version'];
    }
    if (isNotEmptyString(this.message['via'])) {
      message['via'] = this.message['via'];
    }
    if (isNotEmptyString(this.message['forward'])) {
      message['fwd'] = this.message['forward'];
    }
    if (this.message['body'] != null) {
      message['bdy'] = this.message['body'];
    }
    if (isNotEmptyString(this.message['authorization'])) {
      message['aut'] = this.message['authorization'];
    }
    return message;
  }

  /**
  * @name validate
  * @summary Validates that a UMF message has required fields
  * @return {boolean} response - returns true is valid otherwise false
  */
  validate() {
    return isNotEmptyString(this.message.from) && isNotEmptyString(this.message.to) && this.message.body != null;
  }
}

/**
* @name createMessageInstance
* @summary Create a message instance
* @param {object} message - message object
* @return {undefined}
*/
function createMessageInstance(message) {
  let proxy = new Proxy(new UMFMessage(), {
    get: function(target, name, _receiver) {
      return name in target ?
        target[name] : target.message[name];
    },
    set: (obj, prop, value) => {
      obj.message[prop] = value;
      return true;
    }
  });
  if (isNotEmptyString(message.to)) {
    proxy.to = message.to;
  }
  if (isNotEmptyString(nCoalescg(message.from, message.frm))) {
    proxy.from = nCoalescg(message.from, message.frm);
  }
  if (nCoalescg(message.headers, message.hdr) != null) {
    proxy.headers = nCoalescg(message.headers, message.hdr);
  }
  proxy.mid = nCoalescg(message.mid, proxy.createMessageID());
  if (isNotEmptyString(message.rmid)) {
    proxy.rmid = message.rmid;
  }
  if (isNotEmptyString(nCoalescg(message.signature, message.sig))) {
    proxy.signature = nCoalescg(message.signature, message.sig);
  }
  if (isNotEmptyString(nCoalescg(message.timeout, message.tmo))) {
    proxy.timeout = nCoalescg(message.timeout, message.tmo);
  }
  proxy.timestamp = nCoalescg(message.timestamp, message.ts, proxy.getTimeStamp());
  if (isNotEmptyString(nCoalescg(message.type, message.typ))) {
    proxy.type = nCoalescg(message.type, message.typ);
  }
  proxy.version = nCoalescg(message.version, message.ver, UMF_VERSION);
  if (isNotEmptyString(message.via)) {
    proxy.via = message.via;
  }
  if (isNotEmptyString(nCoalescg(message.forward, message.fwd))) {
    proxy.forward = nCoalescg(message.forward, message.fwd);
  }
  if (nCoalescg(message.body, message.bdy) != null) {
    proxy.body = nCoalescg(message.body, message.bdy);
  }
  if (isNotEmptyString(nCoalescg(message.authorization, message.aut))) {
    proxy.authorization = nCoalescg(message.authorization, message.aut);
  }
  return proxy;
}

/**
 * @name parseRoute
 * @summary parses message route strings
 * @private
 * @param {string} toValue - string to be parsed
 * @return {object} object - containing route parameters. If the
 *                  object contains an error field then the route
 *                  isn't valid.
 */
function parseRoute(toValue) {
  let serviceName = '';
  let httpMethod;
  let apiRoute = '';
  let error = '';
  let urlRoute = toValue;
  let instance = '';
  let subID = '';

  let segments = urlRoute.split(':');
  if (segments.length < 2) {
    error = 'route field has invalid number of routable segments';
  } else {
    let atPos = segments[0].indexOf('@');
    if (atPos > -1) {
      let x = segments.shift();
      instance = x.substring(0, atPos);
      segments.unshift(x.substring(atPos + 1));
      let segs = instance.split('-');
      if (segs.length > 1) {
        instance = segs[0];
        subID = segs[1];
      }
    }
    if (segments[0].indexOf('http') === 0) {
      let url = `${segments[0]}:${segments[1]}`;
      segments.shift();
      segments[0] = url;
    }
    serviceName = segments.shift();
    apiRoute = segments.join(':');
    let s1 = apiRoute.indexOf('[');
    if (s1 === 0) {
      let s2 = apiRoute.indexOf(']');
      if (s2 < 0) {
        error = 'route field has ill-formed HTTP method verb in segment';
      } else {
        httpMethod = apiRoute.substring(s1 + 1, s2).toLowerCase();
      }
      if (!error) {
        let s3 = httpMethod.length;
        if (s3 > 0) {
          apiRoute = apiRoute.substring(s3 + 2, apiRoute.length);
        }
      }
    }
  }
  return {
    instance,
    subID,
    serviceName,
    httpMethod,
    apiRoute,
    error
  };
}

/**
* Return an ES6 Proxy object which provides access to message fields.
*/
module.exports = {
  createMessage: createMessageInstance,
  parseRoute: parseRoute
};
